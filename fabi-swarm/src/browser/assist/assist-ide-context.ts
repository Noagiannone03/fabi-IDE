import { inject, injectable } from '@theia/core/shared/inversify';
import { DisposableCollection, Emitter } from '@theia/core';
import URI from '@theia/core/lib/common/uri';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { EditorManager } from '@theia/editor/lib/browser';
import { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { ScmService } from '@theia/scm/lib/browser/scm-service';
import { FabiAgentsModel } from '../agents/fabi-agents-model';
import { AssistIdeContext } from '../../common/fabi-assist-protocol';

/** Workspace-local observation, not a claim to know unobserved actions or their author. */
@injectable()
export class AssistIdeObserver implements FrontendApplicationContribution {
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(ScmService) protected readonly scm: ScmService;
    @inject(StorageService) protected readonly storage: StorageService;
    @inject(FabiAgentsModel) protected readonly agents: FabiAgentsModel;
    private readonly contextChanges = new Emitter<void>();
    readonly onContextChange = this.contextChanges.event;
    private readonly diskChanges = new Emitter<URI>();
    readonly onDiskChange = this.diskChanges.event;
    private readonly subscriptions = new DisposableCollection();
    private events = new Map<string, AssistIdeContext['events']>();
    private readonly lastTool = new Map<string, number>();
    private states = new Map<string, string>();
    private readonly pendingRoots = new Map<string, URI>();
    private writeTimer?: ReturnType<typeof setTimeout>;
    private writing = false;
    private key(root: URI): string { return `fabi.assist.observation:${root.toString()}`; }
    private path(root: URI, uri: URI): string | undefined {
        const path = root.isEqualOrParent(uri) ? root.path.relative(uri.path)?.toString() : undefined;
        return path && !/(^|\/)(node_modules|\.git|\.env[^/]*|\.ssh|\.secrets|credentials[^/]*|id_rsa|id_ed25519)(\/|$)|\.(pem|key|p12)$/i.test(path) ? path : undefined;
    }
    async onStart(): Promise<void> {
        await this.workspace.ready;
        for (const { resource: root } of this.workspace.tryGetRoots()) {
            const saved = await this.storage.getData<AssistIdeContext['events']>(this.key(root), []);
            this.events.set(root.toString(), Array.isArray(saved) ? saved.filter(e => typeof e?.at === 'number' && typeof e.detail === 'string' && typeof e.kind === 'string').slice(-120) : []);
        }
        this.subscriptions.push(this.editors.onCurrentEditorChanged(widget => {
            if (widget) { this.recordFile(widget.editor.uri, 'opened'); }
        }));
        const observe = (widget: EditorWidget) => {
            const listener = widget.editor.onDocumentContentChanged(() => this.recordFile(widget.editor.uri, 'edited-in-editor'));
            widget.disposed.connect(() => { listener.dispose(); this.recordFile(widget.editor.uri, 'closed'); });
            this.subscriptions.push(listener);
        };
        this.editors.all.forEach(observe);
        this.subscriptions.push(this.editors.onCreated(observe));
        this.subscriptions.push(this.files.onDidFilesChange(event => {
            for (const change of event.changes.slice(0, 80)) { this.recordFile(change.resource, ['modified', 'created', 'deleted'][change.type] ?? 'modified'); }
        }));
        this.subscriptions.push(this.agents.onDidChange(() => {
            for (const { resource: root } of this.workspace.tryGetRoots()) {
                for (const agent of this.agents.rowsFor(root)) {
                    const key = root.toString() + agent.key, state = agent.state;
                    const previousTool = this.lastTool.get(key) ?? 0;
                    for (const observation of agent.observations ?? []) {
                        if (observation.at > previousTool) this.record(root, 'agent-tool', `${observation.source} · ${observation.sessionId} · ${observation.phase} · ${observation.tool}${observation.path ? ' · ' + observation.path : ''}`);
                    }
                    this.lastTool.set(key, agent.observations?.at(-1)?.at ?? previousTool);
                    if (this.states.get(key) !== state) {
                        this.states.set(key, state); this.record(root, 'agent', `${agent.kind} · ${agent.title.slice(0, 120)} · ${state}`);
                    }
                }
            }
        }));
    }
    private recordFile(uri: URI, kind: string): void {
        for (const { resource: root } of this.workspace.tryGetRoots()) {
            const path = this.path(root, uri); if (path) { this.record(root, kind, path); if (['modified', 'created', 'deleted'].includes(kind)) this.diskChanges.fire(root); }
        }
    }
    private record(root: URI, kind: string, detail: string): void {
        const key = root.toString(), events = this.events.get(key) ?? [], last = events.at(-1);
        if (last?.kind === kind && last.detail === detail && Date.now() - last.at < 3000) { return; }
        const next = [...events, { at: Date.now(), kind, detail }].slice(-120);
        this.events.set(key, next); this.contextChanges.fire();
        this.pendingRoots.set(key, root);
        if (!this.writeTimer) this.writeTimer = setTimeout(() => { this.writeTimer = undefined; void this.flush(); }, 500);
    }
    /** At most one write in flight; event bursts retain only the latest snapshot. */
    private async flush(): Promise<void> {
        if (this.writing) return;
        this.writing = true;
        try {
            while (this.pendingRoots.size) {
                const roots = [...this.pendingRoots.values()]; this.pendingRoots.clear();
                for (const root of roots) await this.storage.setData(this.key(root), this.events.get(root.toString()) ?? []).catch(() => {});
            }
        } finally { this.writing = false; }
    }
    snapshot(root: URI): AssistIdeContext {
        const openFiles = this.editors.all.flatMap(widget => {
            const path = this.path(root, widget.editor.uri); return path ? [{ path, dirty: widget.editor.document.dirty }] : [];
        }).slice(0, 40);
        const editor = this.editors.currentEditor?.editor;
        const current = editor?.uri, activeFile = current ? this.path(root, current) : undefined;
        const start = Math.max(0, (editor?.selection.start.line ?? 0) - 20);
        return { capturedAt: Date.now(), activeFile, openFiles,
            activeExcerpt: activeFile && editor ? { path: activeFile, startLine: start + 1, text: editor.document.getText().split('\n').slice(start, start + 60).join('\n').slice(0, 10000) } : undefined,
            events: (this.events.get(root.toString()) ?? []).slice(-50),
            agents: this.agents.rowsFor(root).slice(0, 12).map(row => ({ title: row.title.slice(0, 160), state: row.state, sessionId: row.sessionId, observations: row.observations?.slice(-12), preview: row.preview?.slice(0, 1000) })),
            changes: this.scm.repositories.flatMap(repo => repo.provider.groups.flatMap(group => group.resources.flatMap(resource => {
                const path = this.path(root, resource.sourceUri); return path ? [{ path, status: group.label.slice(0, 100) }] : [];
            }))).slice(0, 100) };
    }
    onStop(): void { this.subscriptions.dispose(); clearTimeout(this.writeTimer); this.writeTimer = undefined; void this.flush(); }
}
