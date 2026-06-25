import { inject, injectable } from '@theia/core/shared/inversify';
import { DisposableCollection } from '@theia/core';
import { ApplicationShell, FrontendApplicationContribution, RemoteConnectionProvider, ServiceConnectionProvider } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { FabiChatInstanceWidget } from '../fabi-chat-instance-widget';
import { FabiCodeAgent } from '../fabi-code-agent';
import {
    FabiMaestroService, FABI_MAESTRO_REPORTER_PATH, MaestroSurface
} from '../../common/fabi-maestro-protocol';

interface MaestroHostContext {
    spaceId?: string;
}

interface MaestroHostBridge {
    getContext(): MaestroHostContext;
    onActivateSurface(handler: (widgetId: string) => void): { dispose(): void };
    onWriteTerminal(handler: (widgetId: string, text: string) => void): { dispose(): void };
}

function hostBridge(): MaestroHostBridge | undefined {
    return (window as unknown as { fabiMaestroHost?: MaestroHostBridge }).fabiMaestroHost;
}

/**
 * Publie uniquement les surfaces réellement ouvertes dans ce frontend. Maestro
 * ne déduit donc plus l'activité depuis tout l'historique présent sur disque.
 */
@injectable()
export class MaestroSurfaceReporter implements FrontendApplicationContribution {

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FabiCodeAgent) protected readonly fabiAgent: FabiCodeAgent;

    protected readonly service: FabiMaestroService;
    protected readonly toDispose = new DisposableCollection();
    protected ownerId = '';
    protected timer: ReturnType<typeof setInterval> | undefined;
    protected reporting = false;

    constructor(@inject(RemoteConnectionProvider) connectionProvider: ServiceConnectionProvider) {
        this.service = connectionProvider.createProxy<FabiMaestroService>(FABI_MAESTRO_REPORTER_PATH);
    }

    async onDidInitializeLayout(): Promise<void> {
        if (new URLSearchParams(window.location.search).get('maestro') === '1') {
            return;
        }
        const host = hostBridge();
        const root = this.workspace.tryGetRoots()[0]?.resource.path.toString();
        const context = host?.getContext();
        this.ownerId = context?.spaceId || root || `frontend:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        this.toDispose.pushAll([
            this.shell.onDidAddWidget(() => void this.report()),
            this.shell.onDidRemoveWidget(() => void this.report()),
            this.shell.onDidChangeCurrentWidget(() => void this.report())
        ]);
        if (host) {
            this.toDispose.push(host.onActivateSurface(widgetId => {
                void this.shell.activateWidget(widgetId);
            }));
            this.toDispose.push(host.onWriteTerminal((widgetId, text) => {
                const terminal = this.terminals.getById(widgetId);
                if (terminal) {
                    terminal.sendText(text.endsWith('\r') || text.endsWith('\n') ? text : `${text}\r`);
                    void this.shell.activateWidget(widgetId);
                }
            }));
        }
        await this.report();
        this.timer = setInterval(() => void this.report(), 2000);
    }

    onStop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        this.toDispose.dispose();
        if (this.ownerId) {
            void this.service.reportOpenSurfaces(this.ownerId, []);
        }
    }

    protected async report(): Promise<void> {
        if (this.reporting || !this.ownerId) {
            return;
        }
        this.reporting = true;
        try {
            const host = hostBridge();
            const context = host?.getContext();
            const root = this.workspace.tryGetRoots()[0]?.resource.path.toString();
            const workspaceName = root ? this.basename(root) : undefined;
            const surfaces: MaestroSurface[] = [];

            const chatWidgets = new Set<FabiChatInstanceWidget>();
            for (const area of ['main', 'left', 'right', 'bottom'] as ApplicationShell.Area[]) {
                for (const widget of this.shell.getWidgets(area)) {
                    if (widget instanceof FabiChatInstanceWidget) {
                        chatWidgets.add(widget);
                    }
                }
            }
            for (const widget of chatWidgets) {
                if (widget instanceof FabiChatInstanceWidget) {
                    const session = widget.getMaestroSession();
                    surfaces.push({
                        ownerId: this.ownerId,
                        spaceId: context?.spaceId,
                        widgetId: widget.id,
                        kind: 'fabi-chat',
                        title: widget.title.label || session.title,
                        directory: root,
                        workspaceName,
                        active: this.shell.currentWidget?.id === widget.id,
                        updatedAt: session.updatedAt,
                        theiaSessionId: session.id,
                        openCodeSessionId: this.fabiAgent.getOpenCodeSessionId(session.id)
                    });
                }
            }

            const terminalSurfaces = await Promise.all(this.terminals.all
                .filter(terminal => terminal.isAttached)
                .map(terminal => this.toTerminalSurface(terminal, context?.spaceId, root, workspaceName)));
            surfaces.push(...terminalSurfaces.filter((surface): surface is MaestroSurface => !!surface));
            await this.service.reportOpenSurfaces(this.ownerId, surfaces);
        } catch {
            // Heartbeat best-effort : le prochain passage réessaiera.
        } finally {
            this.reporting = false;
        }
    }

    protected async toTerminalSurface(
        terminal: TerminalWidget,
        spaceId: string | undefined,
        root: string | undefined,
        workspaceName: string | undefined
    ): Promise<MaestroSurface | undefined> {
        try {
            const processId = await terminal.processId;
            const lastCommand = terminal.commandHistoryState?.commandHistory.slice(-1)[0]?.command ?? '';
            const sourceHint = /\bclaude\b/i.test(lastCommand)
                ? 'claude'
                : /\bcodex\b/i.test(lastCommand) ? 'codex' : undefined;
            const directory = terminal.lastCwd?.path.toString() || root;
            return {
                ownerId: this.ownerId,
                spaceId,
                widgetId: terminal.id,
                kind: 'terminal',
                title: terminal.title.label || 'Terminal',
                directory,
                workspaceName: directory ? this.basename(directory) : workspaceName,
                active: this.shell.currentWidget?.id === terminal.id,
                updatedAt: Date.now(),
                terminalId: terminal.terminalId,
                processId,
                sourceHint
            };
        } catch {
            return undefined;
        }
    }

    protected basename(path: string): string {
        const parts = path.split(/[/\\]/).filter(Boolean);
        return parts[parts.length - 1] || path;
    }
}
