// Sessions are the primary workspace surface. Files keep Theia's native tree,
// identity, menus, Git decorations and drag/drop in a project-scoped view.
import * as React from '@theia/core/shared/react';
import { pathRound } from 'd3-path';
import { CommandRegistry } from '@theia/core/lib/common';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { Path } from '@theia/core/lib/common/path';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { ApplicationShell, NodeProps, TreeNode, TreeWidget, TreeModel, SelectableTreeNode } from '@theia/core/lib/browser';
import { FileNavigatorTree, WorkspaceRootNode } from '@theia/navigator/lib/browser/navigator-tree';
import { FileNavigatorModel } from '@theia/navigator/lib/browser/navigator-model';
import { FileNavigatorWidget } from '@theia/navigator/lib/browser/navigator-widget';
import { FabiAgentRow, FabiAgentsModel } from './fabi-agents-model';
import { FABI_NEW_AGENT_COMMAND } from './fabi-agent-terminals';
import { FabiAgentLogo } from './fabi-agent-picker';
import { migrateProjectTreeState } from '../../common/fabi-project-tree-state';
import { agentCli } from '../../common/fabi-agent-clis';

@injectable()
export class FabiNavigatorTree extends FileNavigatorTree {
    override async createWorkspaceRoot(rootFolder: Parameters<FileNavigatorTree['createWorkspaceRoot']>[0],
        workspaceNode: Parameters<FileNavigatorTree['createWorkspaceRoot']>[1]): Promise<WorkspaceRootNode> {
        const node = await super.createWorkspaceRoot(rootFolder, workspaceNode);
        return Object.assign(node, { visible: true });
    }
}

@injectable()
export class FabiNavigatorModel extends FileNavigatorModel {
    projectFilter?: (node: TreeNode) => boolean;
    protected override isVisibleSelectableNode(node: TreeNode): node is SelectableTreeNode {
        return super.isVisibleSelectableNode(node) && (this.projectFilter?.(node) ?? true);
    }
}

const STATE_LABEL: Record<FabiAgentRow['state'], string> = {
    working: 'En cours', permission: 'À valider', done: 'Terminé', idle: 'Au repos', error: 'Erreur'
};

/** Agent notifications must never move the file viewport. */
class FabiNavigatorView extends TreeWidget.View {
    private revealed?: string;
    protected override readonly scrollIntoViewIfNeeded = () => {
        const index = this.props.scrollToRow;
        const id = index === undefined ? undefined : this.props.rows[index]?.node.id;
        if (!this.list || id === undefined || id === this.revealed) return;
        this.revealed = id;
        this.list.scrollIntoView({ index: index!, align: 'center' });
    };
}

@injectable()
export class FabiNavigatorWidget extends FileNavigatorWidget {
    @inject(FabiAgentsModel) protected readonly agents: FabiAgentsModel;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(ApplicationShell) protected readonly workbench: ApplicationShell;
    @inject(CommandRegistry) protected readonly sessionCommands: CommandRegistry;
    protected home = '';
    protected filesOpen = false;
    protected fileHeight = 0;
    private activeProject?: string;
    private collapsedProjects = new Set<string>();
    private lastRevealedSelection?: string;
    private opening?: string;
    private sessionError = '';

    @postConstruct()
    protected override init(): void {
        super.init();
        this.addClass('fabi-session-navigator');
        for (const [id, label, action] of [
            ['fabi.sessions.rename', 'Renommer…', (row: FabiAgentRow) => this.agents.rename(row)],
            ['fabi.sessions.close', 'Fermer la session', (row: FabiAgentRow) => this.agents.close(row)]
        ] as const) {
            this.toDispose.push(this.sessionCommands.registerCommand({ id, label }, {
                execute: action, isEnabled: (row: FabiAgentRow) => !!row && this.agents.canManage(row)
            }));
            this.toDispose.push(this.contextMenuRenderer.menuRegistry.registerMenuAction(['fabi-session-context'], { commandId: id, label, order: id.endsWith('rename') ? '1' : '2' }));
        }
        if (this.model instanceof FabiNavigatorModel) this.model.projectFilter = node => this.shouldDisplayNode(node);
        this.toDispose.push(this.agents.onDidChange(() => this.update()));
        this.toDispose.push(this.workbench.onDidChangeCurrentWidget(() => this.update()));
        void this.env.getHomeDirUri().then(home => { this.home = new URI(home).path.fsPath(); this.update(); });
    }

    override storeState(): object { return { ...super.storeState(), fabiFilesOpen: this.filesOpen, fabiActiveProject: this.activeProject, fabiCollapsedProjects: [...this.collapsedProjects] }; }
    override restoreState(state: any): void {
        // Flatten the previous synthetic Agents/Code nodes, preserving file IDs
        // and expansion state. Never put a saved agent object into the file tree.
        this.filesOpen = state?.fabiFilesOpen === true;
        this.activeProject = typeof state?.fabiActiveProject === 'string' ? state.fabiActiveProject : undefined;
        this.collapsedProjects = new Set(Array.isArray(state?.fabiCollapsedProjects) ? state.fabiCollapsedProjects.filter((uri: unknown) => typeof uri === 'string') : []);
        super.restoreState({ ...state, root: migrateProjectTreeState(state?.root) });
    }

    protected readonly measureFileArea = (height: number): void => {
        if (height !== this.fileHeight) { this.fileHeight = height; this.update(); }
    };

    protected override renderTree(model: TreeModel): React.ReactNode {
        if (!model.root || this.props.virtualized === false) return super.renderTree(model);
        return <FabiNavigatorView ref={view => this.view = view ?? undefined}
            width={this.node.offsetWidth} height={Math.max(1, this.fileHeight)}
            rows={Array.from(this.rows.values())} renderNodeRow={this.renderNodeRow}
            scrollToRow={this.scrollToRow} onScrollEmitter={this.onScrollEmitter} {...this.props.viewProps} />;
    }

    showFiles(): void { this.filesOpen = true; this.update(); }

    private openProjectFiles(uri: URI): void {
        this.selectProject(uri); this.showFiles();
    }

    private showSessions(): void {
        this.filesOpen = false; this.update();
        requestAnimationFrame(() => {
            const buttons = this.node.querySelectorAll<HTMLButtonElement>('.fabi-project-code');
            Array.from(buttons).find(button => button.dataset.project === this.projectURI())?.focus({ preventScroll: true });
        });
    }

    private projectURI(): string | undefined {
        const roots = this.workspaceService.tryGetRoots();
        return roots.find(root => root.resource.toString() === this.activeProject)?.resource.toString() ?? roots[0]?.resource.toString();
    }

    private selectProject(uri: URI): void {
        this.activeProject = uri.toString();
        this.lastRevealedSelection = undefined; this.scrollToRow = undefined;
        this.model.selectedNodes.forEach(node => this.model.toggleNode(node));
        this.doUpdateRows();
    }

    protected override shouldDisplayNode(node: TreeNode): boolean {
        const root = WorkspaceRootNode.find(node);
        return (!root || root.uri.toString() === this.projectURI()) && super.shouldDisplayNode(node);
    }

    protected override doUpdateRows(): void { super.doUpdateRows(); this.title.label = 'Espace'; }

    protected override scrollToSelected(): void {
        if (!this.filesOpen) return;
        const selection = this.model.selectedNodes.map(node => node.id).join('\n');
        if (selection === this.lastRevealedSelection) return;
        this.lastRevealedSelection = selection; super.scrollToSelected();
    }

    protected pathLabel(uri: URI): string {
        const path = Path.tildify(uri.path.fsPath(), this.home);
        return uri.authority ? `${uri.authority}:${path}` : path;
    }

    protected async launch(root: URI): Promise<void> {
        if (this.opening) return;
        this.opening = root.toString(); this.sessionError = ''; this.update();
        try { await this.commandService.executeCommand(FABI_NEW_AGENT_COMMAND, root); }
        catch (error) { this.sessionError = error instanceof Error ? error.message : String(error); }
        finally { this.opening = undefined; this.update(); }
    }

    protected sessionRow(agent: FabiAgentRow, root: URI, siblings: FabiAgentRow[]): React.ReactNode {
        const label = agent.kind === 'fabi' ? 'Fabi' : agentCli(agent.kind)?.label ?? agent.kind;
        const sameKind = siblings.filter(row => row.kind === agent.kind);
        const ordinal = sameKind.length > 1 ? ` ${sameKind.indexOf(agent) + 1}` : '';
        const folder = agent.folder ? this.pathLabel(agent.folder) : 'Dossier non identifié';
        const relative = agent.folder && root.isEqualOrParent(agent.folder) ? root.path.relative(agent.folder.path)?.toString() : undefined;
        const location = agent.folder ? root.isEqual(agent.folder) ? root.path.base : relative || folder : 'Dossier non identifié';
        const title = agent.title.trim();
        const hasTopic = title.toLowerCase() !== label.toLowerCase();
        const active = !!agent.widgetId && this.workbench.currentWidget?.id === agent.widgetId;
        return <button key={agent.key} type='button' className='fabi-session-entry' data-state={agent.state} data-current={active}
            aria-current={active ? 'true' : undefined} title={`${label} · ${folder}\n${STATE_LABEL[agent.state]}${hasTopic ? `\n${title}` : ''}`}
            onContextMenu={event => { event.preventDefault(); event.stopPropagation(); this.contextMenuRenderer.render({ menuPath: ['fabi-session-context'], anchor: { x: event.clientX, y: event.clientY }, args: [agent], context: event.currentTarget }); }}
            onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); this.contextMenuRenderer.render({ menuPath: ['fabi-session-context'], anchor: { x: rect.left + 20, y: rect.bottom }, args: [agent], context: event.currentTarget }); } }}
            onClick={() => void this.agents.open(agent).catch(error => { this.sessionError = String(error); this.update(); })}>
            <span className='fabi-session-mark'>{agent.kind === 'fabi' ? <span className='codicon codicon-comment-discussion'/> : <FabiAgentLogo cli={agent.kind}/>}</span>
            <span className='fabi-session-body'>
                <strong className='fabi-session-title'>{hasTopic ? title : `${label}${ordinal}`}</strong>
                <span className='fabi-session-meta'>{hasTopic && <span>{label}{ordinal}</span>}<span className='fabi-session-state'><i/>{STATE_LABEL[agent.state]}</span></span>
                {(!agent.folder || !root.isEqual(agent.folder)) && <span className='fabi-session-folder'>{location}</span>}
            </span>
            {agent.unread && <span className='fabi-session-unread' aria-label='Nouvelle activité'/>}
        </button>;
    }

    protected override render(): React.ReactNode {
        const roots = this.workspaceService.tryGetRoots();
        if (!roots.length) return super.render();
        const root = roots.find(item => item.resource.toString() === this.projectURI()) ?? roots[0];
        return <div className='fabi-workspace-browser' data-files-open={this.filesOpen}>
            <div className='fabi-session-list' hidden={this.filesOpen} aria-label='Sessions par dossier' onKeyDownCapture={event => event.stopPropagation()}>
                {roots.map(item => {
                    const uri = item.resource, id = uri.toString(), rows = this.agents.rowsFor(uri);
                    const collapsed = this.collapsedProjects.has(id);
                    const working = rows.filter(a => a.state === 'working').length;
                    const attention = rows.some(a => a.state === 'permission' || a.unread);
                    return <section className='fabi-folder-group' key={id} data-project={id} aria-label={`Dossier ${uri.path.base}`}>
                        <div className='fabi-folder-heading'>
                            <button className='fabi-folder-disclosure' aria-expanded={!collapsed} title={this.pathLabel(uri)} onClick={() => { collapsed ? this.collapsedProjects.delete(id) : this.collapsedProjects.add(id); this.update(); }}>
                                <span className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} aria-hidden='true'/><span className={`codicon codicon-folder${collapsed ? '' : '-opened'}`} aria-hidden='true'/>
                                <strong>{uri.path.base || item.name}</strong>
                                <span className='fabi-folder-activity' data-working={working > 0} data-attention={attention} aria-label={`${working} en cours${attention ? ', à consulter' : ''}`}>{attention ? '•' : working || rows.length || ''}</span>
                            </button>
                            <button className='fabi-project-code' data-project={id} aria-label={`Fichiers de ${uri.path.base}`} title={`Parcourir les fichiers de ${uri.path.base}`} onClick={() => this.openProjectFiles(uri)}><span className='codicon codicon-code'/></button>
                            <button className='fabi-session-new' aria-label={`Nouveau CLI dans ${uri.path.base}`} title='Nouvelle session IA' disabled={!!this.opening} onClick={() => void this.launch(uri)}><span className={`codicon ${this.opening === id ? 'codicon-loading codicon-modifier-spin' : 'codicon-add'}`}/></button>
                        </div>
                        <p className='fabi-folder-path' title={this.pathLabel(uri)}>{this.pathLabel(uri.parent)}</p>
                        <SessionOutline open={!collapsed}>
                            {rows.map(agent => this.sessionRow(agent, uri, rows))}
                            {!rows.length && <button className='fabi-session-start' disabled={!!this.opening} onClick={() => void this.launch(uri)}><span className='codicon codicon-add'/>Nouvelle session</button>}
                        </SessionOutline>
                    </section>;
                })}
            </div>
            <div className='fabi-code-navigation' hidden={!this.filesOpen} onKeyDownCapture={event => { event.stopPropagation(); if (event.key === 'Escape') this.showSessions(); }}>
                <button className='fabi-sessions-back' onClick={() => this.showSessions()}><span className='codicon codicon-arrow-left'/>Sessions</button>
                <span className='fabi-code-location' title={this.pathLabel(root.resource)}>{root.resource.path.base}</span>
            </div>
            {this.sessionError && <p className='fabi-session-error' role='alert'>{this.sessionError}</p>}
            <FileViewport open={this.filesOpen} onResize={this.measureFileArea}>{super.render()}</FileViewport>
        </div>;
    }

    protected override createNodeClassNames(node: TreeNode, props: NodeProps): string[] {
        const classes = super.createNodeClassNames(node, props);
        if (WorkspaceRootNode.is(node)) classes.push('fabi-file-root');
        return classes;
    }

    protected override renderCaption(node: TreeNode, props: NodeProps): React.ReactNode {
        if (WorkspaceRootNode.is(node)) return <div className='theia-TreeNodeSegment theia-TreeNodeSegmentGrow fabi-file-root-name' title={this.pathLabel(node.uri)}>{this.toNodeName(node)}</div>;
        return super.renderCaption(node, props);
    }
}

/** Measure after React applies the disclosure, including occluded Electron
 * windows where ResizeObserver delivery may wait for a native paint. */
function FileViewport({ open, onResize, children }: { open: boolean; onResize: (height: number) => void; children: React.ReactNode }): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useLayoutEffect(() => { if (ref.current) onResize(Math.round(ref.current.clientHeight)); });
    React.useEffect(() => {
        const element = ref.current;
        if (!element) return;
        const observer = new ResizeObserver(() => onResize(Math.round(element.clientHeight)));
        observer.observe(element);
        return () => observer.disconnect();
    }, [onResize]);
    return <div id='fabi-project-files' className='fabi-files-viewport' ref={ref} hidden={!open}>{children}</div>;
}

/** One SVG stroke, measured from the real row layout, including wrapped titles. */
function SessionOutline({ open, children }: { open: boolean; children: React.ReactNode }): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    const [drawing, setDrawing] = React.useState({ d: '', height: 0 });
    React.useLayoutEffect(() => {
        const element = ref.current;
        if (!element || !open) return;
        const rows = Array.from(element.children).filter((child): child is HTMLButtonElement => child instanceof HTMLButtonElement);
        const measure = () => {
            // offset coordinates ignore the entrance animation's transform.
            const centers = rows.map(row => {
                const mark = row.querySelector<HTMLElement>('.fabi-session-mark, .codicon');
                return row.offsetTop + (mark ? mark.offsetTop + mark.offsetHeight / 2 : row.offsetHeight / 2);
            });
            const path = pathRound(2);
            const x = 0.75, end = 13, radius = 8;
            const last = centers[centers.length - 1];
            if (last !== undefined && element.offsetHeight) {
                path.moveTo(x, 0);
                path.lineTo(x, last - radius);
                path.arcTo(x, last, end, last, radius);
                path.lineTo(end, last);
                for (const y of centers.slice(0, -1)) {
                    path.moveTo(x, y - radius);
                    path.arcTo(x, y, end, y, radius);
                    path.lineTo(end, y);
                }
            }
            const next = { d: path.toString(), height: element.offsetHeight };
            setDrawing(previous => previous.d === next.d && previous.height === next.height ? previous : next);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        rows.forEach(row => observer.observe(row));
        return () => observer.disconnect();
    }, [open, children]);
    return <div className='fabi-project-sessions' hidden={!open} ref={ref}>
        <svg className='fabi-session-branches' width='14' height={drawing.height} aria-hidden='true'>
            <path d={drawing.d}/>
        </svg>
        {children}
    </div>;
}
