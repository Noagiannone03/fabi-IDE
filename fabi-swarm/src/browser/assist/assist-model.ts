import { AssistOrigin, AssistProgress, AssistKnowledge } from '../../common/fabi-assist-protocol';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, generateUuid, MessageService } from '@theia/core';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ApplicationShell, RemoteConnectionProvider, ServiceConnectionProvider } from '@theia/core/lib/browser';
import { EditorManager } from '@theia/editor/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { AssistAccount, AssistContext, AssistThread, AssistMode, AssistNotebook, FabiAssistClient, FabiAssistService, FABI_ASSIST_PATH } from '../../common/fabi-assist-protocol';
import { FabiAgentsModel, FabiAgentRow } from '../agents/fabi-agents-model';
import { prepareCliPrompt, cliPaste } from '../../common/fabi-assist-dispatch';
import { AssistIdeObserver } from './assist-ide-context';

/** One RPC channel; each surface subscribes only to its own request IDs. */
@injectable()
export class AssistConnection implements FabiAssistClient {
    readonly progress = new Emitter<AssistProgress>();
    readonly service: FabiAssistService;
    constructor(@inject(RemoteConnectionProvider) connection: ServiceConnectionProvider) {
        this.service = connection.createProxy<FabiAssistService>(FABI_ASSIST_PATH, this);
    }
    onProgress(event: AssistProgress): void { this.progress.fire(event); }
}

export const ContextAssistModel = Symbol('ContextAssistModel');

@injectable()
export class AssistModel implements FabiAssistClient {
    @inject(AssistIdeObserver) readonly observer: AssistIdeObserver;
    get ideContext() { return this.root ? this.observer.snapshot(this.root) : undefined; }
    async askAboutReply(title: string, text: string, question: string): Promise<void> {
        this.context = { ...this.context, replyExcerpt: { title: title.slice(0, 160), text: text.slice(0, 4000) } };
        await this.ask(question, 'explore', undefined);
    }
    @inject(EditorManager) readonly editors: EditorManager;
    @inject(WorkspaceService) readonly workspace: WorkspaceService;
    @inject(ApplicationShell) readonly shell: ApplicationShell;
    @inject(FabiAgentsModel) readonly agents: FabiAgentsModel;
    @inject(TerminalService) readonly terminals: TerminalService;
    @inject(MessageService) readonly messages: MessageService;
    readonly service: FabiAssistService;
    readonly changed = new Emitter<void>();
    readonly onChange = this.changed.event;
    surface: 'context' | 'terminal' = 'terminal';
    account: AssistAccount = { connected: false, models: [] };
    book?: AssistNotebook;
    readonly knowledge = new Map<string, AssistKnowledge>();
    root?: URI;
    context: AssistContext = {};
    thread: AssistThread = { id: generateUuid(), kind: 'context', title: 'Nouvelle question' };
    private readonly terminalThreads = new Map<string, AssistThread>();
    get turns() { return this.book?.turns.filter(turn => (turn.thread?.id ?? 'legacy') === this.thread.id) ?? []; }
    get threads(): AssistThread[] {
        const threads = new Map<string, AssistThread>();
        for (const turn of this.book?.turns ?? []) {
            const thread = turn.thread ?? { id: 'legacy', kind: 'context' as const, title: 'Anciens échanges' };
            if (thread.kind === this.surface) { threads.set(thread.id, thread); }
        }
        return [...threads.values()].reverse();
    }
    newThread(kind = this.thread.kind): void {
        if (this.busy) { return; }
        this.thread = { id: generateUuid(), kind, title: kind === 'terminal' ? this.context.terminal?.title ?? 'Avec mon CLI' : this.context.path?.split(/[\\/]/).pop() ?? 'Nouvelle question', terminalId: kind === 'terminal' ? this.context.terminal?.id : undefined };
        if (this.thread.terminalId) { this.terminalThreads.set(this.thread.terminalId, this.thread); }
        this.proposal = undefined; this.dispatchStatus = '';
        this.draft = ''; this.answerTo = undefined; this.error = ''; this.changed.fire();
    }
    selectThread(thread: AssistThread): void {
        if (this.busy) { return; }
        this.thread = thread;
        const last = this.book?.turns.filter(turn => (turn.thread?.id ?? 'legacy') === thread.id).at(-1);
        this.proposal = undefined;
        this.context = last?.context ?? {}; this.follow(this.rows.find(row => row.widgetId === thread.terminalId)?.key ?? ''); this.draft = ''; this.answerTo = undefined; this.changed.fire();
    }
    mode: AssistMode = 'learn';
    busy?: string;
    progress = '';
    progressDetail?: AssistProgress;
    pendingMessage?: { id: string; question: string; mode: AssistMode; origin: AssistOrigin; threadId: string; failed?: boolean; answerTo?: string };
    get cliStatus(): string {
        const state = this.agent?.state;
        if (state === 'working') return 'En cours';
        if (state === 'permission') return 'Attend ton accord';
        if (state === 'error') return 'Erreur';
        if (this.dispatchedTo) return 'Envoyé · en attente du CLI';
        if (state === 'done') return 'Tour terminé';
        return 'Au repos';
    }
    error = '';
    draft = '';
    replySerial = 0;
    answerTo?: string;
    selectedAgent?: string;
    completed?: FabiAgentRow;
    proposal?: { text: string; terminalId: string; source: string; sessionId?: string };
    dispatching = false;
    dispatchStatus = '';
    private dispatchedTo?: string;
    private previousState?: string;
    private loading = 0;

    constructor(@inject(AssistConnection) connection: AssistConnection) {
        this.service = connection.service;
        connection.progress.event(event => this.onProgress(event));
    }

    @postConstruct()
    protected init(): void {
        this.observer.onContextChange(() => this.changed.fire());
        this.agents.onDidChange(() => {
            const agent = this.agent;
            if (agent?.state === 'working') this.completed = undefined;
            if (this.previousState === 'working' && agent && ['idle', 'done', 'error'].includes(agent.state)) {
                this.completed = { ...agent };
                if (this.dispatchedTo === agent.widgetId && ['done', 'error'].includes(agent.state)) {
                    this.dispatchedTo = undefined;
                    this.dispatchStatus = agent.state === 'done' ? 'Tour terminé' : 'Le CLI a rencontré une erreur';
                }
            }
            this.previousState = agent?.state;
            this.changed.fire();
        });
    }

    async updateLearning(update: import('../../common/fabi-assist-protocol').AssistLearningUpdate): Promise<void> {
        if (!this.root || this.busy) return;
        try { this.book = await this.service.updateLearning(FileUri.fsPath(this.root), update); this.changed.fire(); }
        catch (error) { this.fail(error); }
    }

    async reviewConcept(id: string): Promise<void> {
        if (!this.root || this.busy) return;
        try { this.book = await this.service.reviewConcept(FileUri.fsPath(this.root), id); this.changed.fire(); }
        catch (error) { this.fail(error); }
    }

    sourceChanged(turn: import('../../common/fabi-assist-protocol').AssistTurn): boolean {
        if (turn.reply.sources.some(source => source.stale)) return true;
        if (turn.context.snapshot && turn.context.path && this.root) {
            const uri = turn.context.path.startsWith('/') ? FileUri.create(turn.context.path) : this.root.resolve(turn.context.path);
            const editor = this.editors.all.find(widget => widget.editor.uri.isEqual(uri))?.editor;
            if (editor) {
                const current = editor.document.getText(turn.context.snapshot.range).slice(0, 16000);
                if (current !== turn.context.text) return true;
            } else if (turn.context.snapshot.stale) return true;
        }
        if (!this.root) return false;
        const paths = new Set(turn.reply.sources.map(source => source.path));
        if (turn.context.path) paths.add(turn.context.path.replace(FileUri.fsPath(this.root) + '/', ''));
        return this.observer.snapshot(this.root).events.some(event => event.at > turn.at && paths.has(event.detail)
            && ['modified', 'created', 'deleted', 'edited-in-editor'].includes(event.kind));
    }
    async refreshExplanation(turn: import('../../common/fabi-assist-protocol').AssistTurn): Promise<void> {
        const path = turn.context.path ?? turn.reply.sources[0]?.path;
        if (!path || !this.root || this.busy) return;
        const uri = path.startsWith('/') ? FileUri.create(path) : this.root.resolve(path);
        await this.prepare(uri, undefined, this.surface);
        await this.ask(turn.question, 'explore');
    }

    get rows(): FabiAgentRow[] { return this.root ? this.agents.rowsFor(this.root) : []; }
    get agent(): FabiAgentRow | undefined { return this.rows.find(row => row.key === this.selectedAgent); }

    follow(key: string): void {
        this.selectedAgent = key || undefined;
        this.previousState = this.agent?.state;
        this.completed = undefined;
        this.changed.fire();
    }

    async prepare(uri?: URI, explicitTerminal?: TerminalWidget, surface: 'context' | 'terminal' = 'context'): Promise<void> {
        if (this.busy) { return; }
        const editor = this.editors.currentEditor?.editor;
        const terminal = !uri ? explicitTerminal ?? (this.shell.currentWidget instanceof TerminalWidget ? this.shell.currentWidget : undefined) : undefined;
        const target = uri ?? terminal?.lastCwd ?? editor?.uri;
        const roots = this.workspace.tryGetRoots();
        const root = roots.filter(item => target && item.resource.isEqualOrParent(target))
            .sort((a, b) => b.resource.path.toString().length - a.resource.path.toString().length)[0]?.resource ?? roots[0]?.resource;
        if (!root) { this.error = 'Ouvre un dossier pour commencer ton parcours.'; this.changed.fire(); return; }
        if (this.busy && this.root && !this.root.isEqual(root)) {
            this.error = 'Arrête la réponse en cours avant de changer de projet.'; this.changed.fire(); return;
        }
        this.context = {};
        if (terminal) {
            const selected = terminal.getSelection();
            const buffer = terminal.buffer;
            this.context = { kind: 'terminal', terminal: { id: terminal.id, title: terminal.title.label.slice(0, 300), selected: !!selected },
                text: (selected || buffer.getLines(Math.max(0, buffer.length - 80), Math.min(80, buffer.length), true).join('\n')).slice(-12000) };
        } else if (target && root.isEqualOrParent(target)) {
            this.context.path = FileUri.fsPath(target);
            this.context.kind = 'file';
            if (editor && editor.uri.isEqual(target)) {
                const selection = editor.selection;
                const selected = editor.document.getText(selection);
                this.context.snapshot = { version: editor.document.version, dirty: editor.document.dirty, ...(selected ? { range: selection } : {}) };
                this.context.kind = selected ? 'selection' : 'file';
                this.context.text = (selected || editor.document.getText()).slice(0, 16000);
                this.context.startLine = selected ? selection.start.line + 1 : 1;
                if (selected) {
                    const lines = editor.document.getText().split('\n');
                    const start = Math.max(0, selection.start.line - 35);
                    this.context.surrounding = { startLine: start + 1, text: lines.slice(start, selection.end.line + 36).join('\n').slice(0, 14000) };
                }
                this.context.endLine = selected ? selection.end.line + 1 : undefined;
            }
        }
        if (!this.root?.isEqual(root)) {
            this.book = undefined; this.draft = ''; this.answerTo = undefined; this.selectedAgent = undefined;
        }
        this.root = root;
        if (surface === 'terminal' && terminal) {
            const previous = this.terminalThreads.get(terminal.id) ?? this.threads.find(thread => thread.terminalId === terminal.id);
            if (previous) { this.thread = previous; } else { this.newThread('terminal'); }
            this.mode = 'learn';
        } else { this.newThread(this.surface); this.mode = this.surface === 'context' ? 'explore' : 'learn'; }
        const current = this.rows.find(row => row.widgetId === terminal?.id);
        this.follow(current?.key ?? '');
        const epoch = ++this.loading;
        try {
            const [book, account] = await Promise.all([this.service.notebook(FileUri.fsPath(root)), this.service.account()]);
            if (epoch !== this.loading) { return; }
            this.book = book; this.account = account; this.error = '';
            if (surface === 'terminal' && terminal && !book.turns.some(turn => turn.thread?.id === this.thread.id)) {
                const saved = this.threads.find(thread => thread.terminalId === terminal.id);
                if (saved) { this.thread = saved; this.terminalThreads.set(terminal.id, saved); }
            }
        } catch (error) { this.fail(error); }
        this.changed.fire();
    }

    onProgress(event: AssistProgress): void {
        if (event.id === this.busy) { this.progress = event.text; this.progressDetail = event; this.changed.fire(); }
    }

    async ask(question = this.draft, mode = this.mode, answerTo = this.answerTo, origin: AssistOrigin = mode === 'review' ? 'cli-review' : 'user'): Promise<void> {
        if (this.busy || !this.root || !question.trim()) { return; }
        const id = generateUuid();
        this.busy = id; this.error = ''; this.progress = 'Lecture du contexte…';
        this.progressDetail = { id, text: this.progress, phase: 'thinking' };
        this.pendingMessage = { id, question, mode, origin, threadId: this.thread.id, answerTo };
        if (origin === 'user' && question === this.draft) this.draft = '';
        this.answerTo = undefined; this.changed.fire();
        const agent = this.agent;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(() => {
                void this.service.cancel(id).catch(() => {});
                reject(new Error('La réponse a dépassé le délai prévu. Ta question est conservée ; réessaie.'));
            }, 200_000);
        });
        try {
            await this.refreshCliContext();
            this.book = await Promise.race([expired, this.service.ask({ id, project: FileUri.fsPath(this.root), mode, question, origin,
                answerTo, thread: { ...this.thread, title: this.turns.length ? this.thread.title : question.slice(0, 80) }, context: { ...this.context, ide: this.ideContext, activity: agent ? {
                    title: agent.title.slice(0, 1000), status: agent.state, preview: agent.preview?.slice(0, 12000)
                } : undefined } })]);
            this.replySerial++;
            const proposal = this.turns.at(-1)?.reply.developerPrompt;
            if (proposal && this.thread.kind === 'terminal') this.prepareDispatch(proposal, this.turns.at(-1)?.reply.intent === 'develop');
            delete this.context.replyExcerpt;
            this.pendingMessage = undefined;
        } catch (error) {
            if (this.pendingMessage?.id === id) this.pendingMessage.failed = true;
            this.fail(error);
            // Provider checks must not keep the composer spinning after a failed RPC.
            void this.service.account().then(account => { this.account = account; this.changed.fire(); }).catch(() => {});
        }
        finally { clearTimeout(deadline); this.busy = undefined; this.changed.fire(); }
    }

    async cancel(): Promise<void> { if (this.busy) { await this.service.cancel(this.busy); } }

    async refreshProvider(): Promise<void> {
        try { this.account = await this.service.account(); this.error = ''; this.changed.fire(); }
        catch (error) { this.fail(error); }
    }

    async openSource(path: string, line = 1): Promise<void> {
        if (!this.root || path.split(/[\\/]/).includes('..')) { return; }
        await this.editors.open(this.root.resolve(path), { selection: { start: { line: line - 1, character: 0 } } });
    }

    reviewCompletedRun(): void {
        if (!this.completed || this.busy || this.completed.widgetId !== this.context.terminal?.id) return;
        void this.ask('Explique la réponse du dernier tour du CLI à la demande de l’utilisateur. Appuie-toi sur sa conversation actuelle, sans inventer de modifications.', 'review');
    }

    async refreshCliContext(): Promise<void> {
        const agent = this.agent;
        const terminal = this.context.terminal?.id ? this.terminals.getById(this.context.terminal.id) : undefined;
        if (terminal) {
            const buffer = terminal.buffer;
            this.context.text = buffer.getLines(Math.max(0, buffer.length - 100), Math.min(100, buffer.length), true).join('\n').slice(-12000);
        }
        if (this.root && agent) {
            try { this.context.cli = await this.service.cliContext(FileUri.fsPath(this.root), agent.kind, agent.sessionId); }
            catch { this.context.cli = { source: agent.kind, sessionId: agent.sessionId, status: 'unavailable', messages: [], truncated: false }; }
        }
    }

    prepareDispatch(text = this.draft, implementation = false): void {
        const agent = this.agent;
        if (!agent?.widgetId || agent.widgetId !== this.context.terminal?.id) { this.fail(new Error('Ouvre Assist dans le terminal du CLI destinataire.')); return; }
        try {
            this.proposal = { text: prepareCliPrompt(text, implementation), terminalId: agent.widgetId, source: agent.kind, sessionId: agent.sessionId };
            this.error = ''; this.changed.fire();
        } catch (error) { this.fail(error); }
    }

    async dispatch(): Promise<void> {
        const proposal = this.proposal;
        if (!proposal || this.dispatching) return;
        this.dispatching = true; this.error = ''; this.changed.fire();
        try {
            const terminal = this.terminals.getById(proposal.terminalId);
            const agent = this.agent;
            if (!terminal || !agent || agent.widgetId !== proposal.terminalId || agent.kind !== proposal.source || agent.sessionId !== proposal.sessionId || ['working', 'permission'].includes(agent.state)) {
                throw new Error('La session a changé ou attend une action. Vérifie le terminal avant de réessayer.');
            }
            await this.service.assertCliProcess(await terminal.processId, proposal.source);
            if (this.proposal !== proposal || this.agent?.widgetId !== proposal.terminalId || ['working', 'permission'].includes(this.agent?.state ?? '')) throw new Error('La session a changé pendant la vérification.');
            terminal.sendText(cliPaste(proposal.text));
            this.dispatchedTo = proposal.terminalId;
            this.dispatchStatus = 'Envoyé · en attente du CLI';
            this.proposal = undefined; this.draft = '';
        } catch (error) { this.fail(error); }
        finally { this.dispatching = false; this.changed.fire(); }
    }

    async copyPrompt(prompt: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(prompt);
            if (this.agent) { await this.agents.open(this.agent); }
            void this.messages.info('Prompt copié. Colle-le dans ton CLI pour lancer le travail.');
        } catch (error) { this.fail(error); }
    }

    fail(error: unknown): void { this.error = error instanceof Error ? error.message : String(error); this.changed.fire(); }
}
