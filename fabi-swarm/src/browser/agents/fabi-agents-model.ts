import { inject, injectable } from '@theia/core/shared/inversify';
import { DisposableCollection, Emitter, Event } from '@theia/core';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { MaestroAgent } from '../../common/fabi-maestro-protocol';
import { agentCli, FabiAgentCliId } from '../../common/fabi-agent-clis';
import { FabiMaestroFrontend } from '../maestro/fabi-maestro-frontend';
import { MaestroSurfaceReporter } from '../maestro/maestro-surface-reporter';
import { FabiAgentTerminals } from './fabi-agent-terminals';

/**
 * État affiché d'un agent (calqué sur Superset) :
 *  - working    : un tour est en cours ;
 *  - permission : bloqué sur une validation de l'utilisateur ;
 *  - done       : tour terminé, l'agent attend la suite ;
 *  - idle       : au repos / statut inconnu (agent sans hooks) ;
 *  - error      : le dernier tour a échoué.
 */
export type FabiAgentState = 'working' | 'permission' | 'done' | 'idle' | 'error';

export interface FabiAgentRow {
    /** Id du widget quand l'agent vit dans un onglet, sinon clé Maestro. */
    key: string;
    title: string;
    kind: FabiAgentCliId | 'fabi';
    state: FabiAgentState;
    /** A fini (ou réclame une validation) sans avoir été regardé depuis. */
    unread: boolean;
    preview?: string;
    folder?: URI;
    widgetId?: string;
    updatedAt: number;
}

interface SpacesHostBridge {
    reportAttention?(count: number): void;
    activateSelf?(): Promise<unknown>;
}

function hostBridge(): SpacesHostBridge | undefined {
    return (window as unknown as { fabiSpaceHost?: SpacesHostBridge }).fabiSpaceHost;
}

function stateOf(agent: MaestroAgent | undefined): FabiAgentState {
    switch (agent?.status) {
        case 'generating': return 'working';
        case 'waiting': return agent.waitingKind === 'permission' ? 'permission' : 'done';
        case 'error': return 'error';
        default: return 'idle';
    }
}

/**
 * Agents IA de CE Space, rangés par dossier du workspace. Source unique : les
 * snapshots Maestro (hooks Claude/Codex + chats Fabi AI) croisés avec les
 * terminaux d'agents lancés depuis la barre Projets. Gère aussi le « non lu »
 * et les notifications de fin de tour, comme Superset/Herd.
 */
@injectable()
export class FabiAgentsModel implements FrontendApplicationContribution {

    @inject(FabiMaestroFrontend) protected readonly maestro: FabiMaestroFrontend;
    @inject(MaestroSurfaceReporter) protected readonly reporter: MaestroSurfaceReporter;
    @inject(FabiAgentTerminals) protected readonly agentTerminals: FabiAgentTerminals;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;

    protected readonly changedEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changedEmitter.event;

    protected rows: FabiAgentRow[] = [];
    protected readonly lastState = new Map<string, FabiAgentState>();
    protected readonly unread = new Set<string>();
    protected attention = -1;
    protected readonly toDispose = new DisposableCollection();

    onStart(): void {
        this.toDispose.pushAll([
            this.maestro.onSnapshotEvent(() => this.recompute()),
            this.agentTerminals.onDidChange(() => this.recompute()),
            this.terminals.onDidCreateTerminal(() => this.recompute()),
            this.shell.onDidChangeCurrentWidget(() => this.markCurrentSeen()),
            this.workspace.onWorkspaceChanged(() => this.recompute())
        ]);
        window.addEventListener('focus', this.onWindowFocus);
        this.recompute();
    }

    onStop(): void {
        window.removeEventListener('focus', this.onWindowFocus);
        this.toDispose.dispose();
    }

    /** Agents rattachés à ce dossier racine (le plus spécifique l'emporte). */
    rowsFor(root: URI): FabiAgentRow[] {
        const roots = this.workspace.tryGetRoots().map(stat => stat.resource);
        return this.rows.filter(row => {
            const folder = row.folder;
            if (!folder) {
                return roots[0]?.isEqual(root) ?? false;
            }
            const owner = roots
                .filter(candidate => candidate.isEqualOrParent(folder))
                .sort((a, b) => b.path.toString().length - a.path.toString().length)[0];
            return !!owner && owner.isEqual(root);
        });
    }

    async open(row: FabiAgentRow): Promise<void> {
        if (row.widgetId) {
            await this.shell.activateWidget(row.widgetId);
        }
        this.setSeen(row.key);
    }

    protected readonly onWindowFocus = () => this.markCurrentSeen();

    protected recompute(): void {
        const owner = this.reporter.owner;
        const agents = this.maestro.last.agents.filter(agent => !!owner && agent.surface?.ownerId === owner);
        const byWidget = new Map(agents.filter(agent => agent.surface?.widgetId).map(agent => [agent.surface!.widgetId, agent]));
        const rows: FabiAgentRow[] = [];

        for (const [widgetId, binding] of this.agentTerminals.all()) {
            if (!this.terminals.getById(widgetId)) {
                continue;
            }
            const agent = byWidget.get(widgetId);
            byWidget.delete(widgetId);
            if (agent && (agent.source === 'claude' || agent.source === 'codex') && !agent.approximate
                && agent.key === `${agent.source}:${agent.id}`) {
                this.agentTerminals.recordSession(widgetId, agent.id);
            }
            rows.push({
                key: widgetId,
                title: agent && !agent.approximate ? agent.title : agentCli(binding.cli)?.label ?? binding.cli,
                kind: binding.cli,
                state: stateOf(agent),
                unread: false,
                preview: agent?.preview,
                folder: new URI(binding.cwd),
                widgetId,
                updatedAt: agent?.updatedAt ?? binding.createdAt
            });
        }
        for (const agent of byWidget.values()) {
            rows.push({
                key: agent.surface?.widgetId ?? agent.key,
                title: agent.title,
                kind: agent.source,
                state: stateOf(agent),
                unread: false,
                preview: agent.preview,
                folder: agent.directory ? new URI(FileUri.create(agent.directory).toString()) : undefined,
                widgetId: agent.surface?.widgetId,
                updatedAt: agent.updatedAt
            });
        }

        for (const row of rows) {
            this.trackTransition(row);
            row.unread = this.unread.has(row.key);
        }
        const keys = new Set(rows.map(row => row.key));
        for (const key of [...this.lastState.keys()]) {
            if (!keys.has(key)) {
                this.lastState.delete(key);
                this.unread.delete(key);
            }
        }
        // Ordre stable (ordre de lancement) : une ligne ne saute pas à chaque événement.
        this.rows = rows;
        this.publishAttention();
        this.changedEmitter.fire();
    }

    /** Fin de tour / demande de validation non vue → non lu + notification. */
    protected trackTransition(row: FabiAgentRow): void {
        const previous = this.lastState.get(row.key);
        this.lastState.set(row.key, row.state);
        if (previous === undefined || previous === row.state) {
            return;
        }
        const finished = previous === 'working' && (row.state === 'done' || row.state === 'idle' || row.state === 'error');
        const blocked = row.state === 'permission';
        if (!finished && !blocked) {
            return;
        }
        if (this.isWatched(row)) {
            return;
        }
        this.unread.add(row.key);
        this.notify(row);
    }

    protected isWatched(row: FabiAgentRow): boolean {
        return document.visibilityState === 'visible' && document.hasFocus()
            && !!row.widgetId && this.shell.currentWidget?.id === row.widgetId;
    }

    protected notify(row: FabiAgentRow): void {
        if (typeof Notification === 'undefined') {
            return;
        }
        const project = row.folder?.path.base ?? this.workspace.tryGetRoots()[0]?.resource.path.base ?? 'Fabi';
        const status = row.state === 'permission' ? 'Attend ta validation'
            : row.state === 'error' ? 'A échoué' : 'A terminé';
        const notification = new Notification(`${project} › ${row.title}`, {
            body: row.preview ? `${status} — ${row.preview}` : status,
            tag: row.key
        });
        notification.onclick = () => {
            void hostBridge()?.activateSelf?.();
            window.focus();
            void this.open(row);
        };
    }

    protected markCurrentSeen(): void {
        const current = this.shell.currentWidget?.id;
        const row = current ? this.rows.find(candidate => candidate.widgetId === current) : undefined;
        if (row && document.hasFocus()) {
            this.setSeen(row.key);
        }
    }

    protected setSeen(key: string): void {
        if (this.unread.delete(key)) {
            for (const row of this.rows) {
                row.unread = this.unread.has(row.key);
            }
            this.publishAttention();
            this.changedEmitter.fire();
        }
    }

    /** Pastille du Space dans la colonne des espaces (agents à regarder). */
    protected publishAttention(): void {
        const count = this.rows.filter(row => row.unread || row.state === 'permission').length;
        if (count !== this.attention) {
            this.attention = count;
            hostBridge()?.reportAttention?.(count);
        }
    }
}
