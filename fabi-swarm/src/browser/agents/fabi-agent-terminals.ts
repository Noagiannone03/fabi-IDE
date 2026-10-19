import { MessageLoop } from '@theia/core/shared/@lumino/messaging';
import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, Emitter, Event, generateUuid, MessageService } from '@theia/core';
import { isWindows } from '@theia/core/lib/common/os';
import URI from '@theia/core/lib/common/uri';
import { FrontendApplicationContribution, StorageService } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalLocation, TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import {
    agentCli, FabiAgentCli, FabiAgentCliId, FABI_AGENT_TERMINAL_ENV, FABI_AGENT_TERMINAL_PREFIX
} from '../../common/fabi-agent-clis';
import { FabiTerminalWidget } from '../fabi-terminal-widget';
import { FabiAgentPicker } from './fabi-agent-picker';

/** Lien persistant entre un onglet de terminal et la conversation qu'il porte. */
export interface FabiAgentTerminalBinding {
    cli: FabiAgentCliId;
    /** Dossier de travail (URI) — le dossier du projet où l'agent a été lancé. */
    cwd: string;
    /** Id de session de l'agent : imposé au lancement (Claude) ou appris des hooks. */
    sessionId?: string;
    /** PTY du backend : on s'y rattache tant qu'il vit (rechargement du frontend). */
    ptyId?: number;
    /** PID du shell : s'il change, le PTY est neuf → on relance la conversation. */
    shellPid?: number;
    createdAt: number;
    title?: string;
}

/** Stockage propre au workspace (la clé de StorageService inclut le dossier). */
const STORAGE_KEY = 'fabi.agentTerminals';

/** Argument optionnel : l'URI du dossier (sinon le premier dossier du workspace). */
export const FABI_NEW_AGENT_COMMAND = 'fabi.agents.new';

/**
 * Terminaux d'agents IA : lancement (Claude Code, Codex…) en onglet de la zone de
 * code, mémorisation onglet ↔ session, et reprise au redémarrage. Comme Superset :
 * on se rattache au PTY s'il vit encore, sinon on relance la conversation exacte
 * (`claude --resume <id>`…) dans un shell neuf. Le terminal reste un terminal Theia.
 */
@injectable()
export class FabiAgentTerminals implements FrontendApplicationContribution, CommandContribution {

    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(FabiAgentPicker) protected readonly picker: FabiAgentPicker;
    @inject(StorageService) protected readonly storage: StorageService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(FrontendApplicationStateService) protected readonly state: FrontendApplicationStateService;
    protected stopped = false;

    protected readonly tracked = new WeakSet<TerminalWidget>();
    protected readonly bindings = new Map<string, FabiAgentTerminalBinding>();
    protected readonly changedEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changedEmitter.event;

    onDidInitializeLayout(): void {
        // CLI output/credentials/network readiness must never gate the workbench.
        void this.restoreSavedSessions().catch(error => {
            if (!this.stopped) void this.messages.error(`Impossible de reprendre les sessions : ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    onStop(): void { this.stopped = true; }

    protected async restoreSavedSessions(): Promise<void> {
        const stored = await this.storage.getData<Record<string, FabiAgentTerminalBinding>>(STORAGE_KEY, {});
        if (this.stopped) return;
        for (const [id, binding] of Object.entries(stored ?? {})) {
            this.bindings.set(id, binding);
        }
        this.changedEmitter.fire();
        await this.state.reachedState('ready');
        if (this.stopped) return;
        await Promise.all([...this.bindings].map(([id, binding]) => this.restore(id, binding)));
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({ id: FABI_NEW_AGENT_COMMAND, label: 'Nouvel agent IA (Claude Code, Codex…)' }, {
            execute: (folder?: URI) => {
                const target = folder instanceof URI ? folder : this.workspace.tryGetRoots()[0]?.resource;
                return target ? this.pickAndLaunch(target) : undefined;
            }
        });
    }

    all(): ReadonlyMap<string, FabiAgentTerminalBinding> {
        return this.bindings;
    }

    /** Demande quel agent lancer, puis l'ouvre dans un nouvel onglet de terminal. */
    async pickAndLaunch(folder: URI): Promise<void> {
        const cli = await this.picker.pick(folder);
        if (cli) {
            await this.launch(cli, folder);
        }
    }

    async launch(cliId: FabiAgentCliId, folder: URI): Promise<void> {
        const cli = agentCli(cliId);
        if (!cli) {
            return;
        }
        const uuid = generateUuid();
        const id = FABI_AGENT_TERMINAL_PREFIX + uuid;
        const binding: FabiAgentTerminalBinding = {
            cli: cli.id,
            cwd: folder.toString(),
            sessionId: cli.presetSession ? uuid : undefined,
            createdAt: Date.now()
        };
        try {
            const terminal = await this.open(id, cli, binding, true);
            await this.run(terminal, cli, cli.start(uuid), 'Démarrage…');
        } catch (error) {
            void this.messages.error(`Impossible de lancer ${cli.label} : ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** Session apprise des hooks (Codex ne permet pas de l'imposer au lancement). */
    recordSession(widgetId: string, sessionId: string): void {
        const binding = this.bindings.get(widgetId);
        if (binding && binding.sessionId !== sessionId) {
            binding.sessionId = sessionId;
            void this.save();
        }
    }

    /** Recrée l'onglet d'un agent au démarrage et relance sa conversation si son PTY est mort. */
    protected async restore(id: string, binding: FabiAgentTerminalBinding): Promise<void> {
        const cli = agentCli(binding.cli);
        if (!cli) return;
        const existing = this.terminals.getById(id);
        if (existing) { this.track(existing, binding); return; }
        try {
            const previousPid = binding.shellPid;
            const terminal = await this.open(id, cli, binding, false);
            if (binding.shellPid !== previousPid) {
                await this.run(terminal, cli, cli.resume(binding.sessionId), 'Reprise de la conversation…');
            }
        } catch {
            this.bindings.delete(id);
            await this.save();
        }
    }

    /**
     * Ouvre l'onglet d'agent : rattachement au PTY connu s'il vit encore, sinon
     * shell neuf. Résout quand le shell a affiché son prompt (on peut alors taper).
     */
    protected async open(id: string, cli: FabiAgentCli, binding: FabiAgentTerminalBinding, activate: boolean): Promise<TerminalWidget> {
        const terminal = await this.terminals.newTerminal({
            id,
            title: binding.title || cli.label,
            iconClass: 'codicon codicon-sparkle',
            // Chaîne, pas d'objet URI : les options du widget sont sérialisées.
            cwd: binding.cwd,
            env: { [FABI_AGENT_TERMINAL_ENV]: id },
            useServerTitle: false,
            location: TerminalLocation.Editor
        });
        const ready = this.whenOutputSettles(terminal, 250, 4000);
        binding.ptyId = await terminal.start(binding.ptyId);
        binding.shellPid = await terminal.processId;
        this.bindings.set(id, binding);
        await this.save();
        this.track(terminal, binding);
        this.terminals.open(terminal, { widgetOptions: { area: 'main' }, mode: activate ? 'activate' : 'open' });
        await ready;
        return terminal;
    }

    /** Closing a tab hides it; explicit session closure disposes its PTY. */
    protected track(terminal: TerminalWidget, binding: FabiAgentTerminalBinding): void {
        if (this.tracked.has(terminal)) return;
        this.tracked.add(terminal);
        if (binding.title) terminal.title.label = binding.title;
        const hook = (_handler: unknown, message: { type: string }) => {
            if (message.type !== 'close-request') return true;
            terminal.parent = null;
            this.changedEmitter.fire();
            return false;
        };
        MessageLoop.installMessageHook(terminal, hook);
        terminal.onDidDispose(() => {
            MessageLoop.removeMessageHook(terminal, hook);
            if (this.bindings.delete(terminal.id)) void this.save();
            this.changedEmitter.fire();
        });
    }

    async rename(id: string, title: string): Promise<void> {
        const binding = this.bindings.get(id);
        if (!binding) return;
        binding.title = title.trim().slice(0, 160) || undefined;
        const terminal = this.terminals.getById(id);
        if (terminal) terminal.title.label = binding.title || agentCli(binding.cli)?.label || binding.cli;
        await this.save();
    }

    close(id: string): void {
        this.terminals.getById(id)?.dispose();
        if (this.bindings.delete(id)) void this.save();
        this.changedEmitter.fire();
    }

    /**
     * Tape la commande de l'agent derrière un écran de chargement : l'écran est
     * nettoyé (`clear`) puis l'overlay s'efface quand l'agent a fini de s'afficher.
     */
    protected async run(terminal: TerminalWidget, cli: FabiAgentCli, command: string, status: string): Promise<void> {
        const overlay = document.createElement('div');
        overlay.className = 'fabi-agent-boot';
        const logo = document.createElement('span');
        logo.className = 'fabi-agent-logo';
        logo.dataset.cli = cli.id;
        const name = document.createElement('strong');
        name.textContent = cli.label;
        const caption = document.createElement('span');
        caption.textContent = status;
        const bar = document.createElement('i');
        overlay.append(logo, name, caption, bar);
        terminal.node.append(overlay);
        const settled = this.whenOutputSettles(terminal, 1200, 15000);
        terminal.sendText(`${isWindows ? 'cls;' : 'clear &&'} ${command}\r`);
        await settled;
        overlay.classList.add('leaving');
        setTimeout(() => overlay.remove(), 260);
    }

    /**
     * Résout quand la sortie du terminal se tait depuis `quietMs` (ou au plus tard
     * après `limitMs`). Sert à attendre le prompt du shell avant de taper (sinon la
     * commande apparaît en double), puis l'affichage de l'agent.
     */
    protected whenOutputSettles(terminal: TerminalWidget, quietMs: number, limitMs: number): Promise<void> {
        return new Promise(resolve => {
            let quiet: ReturnType<typeof setTimeout> | undefined;
            const done = () => {
                listener.dispose();
                clearTimeout(quiet);
                clearTimeout(limit);
                resolve();
            };
            // Theia onOutput follows xterm parsing, which may never run for hidden tabs.
            // Boot readiness depends on bytes arriving, not on a visible renderer.
            const output = terminal instanceof FabiTerminalWidget ? terminal.onDidReceiveOutput : terminal.onOutput;
            const listener = output(() => {
                clearTimeout(quiet);
                quiet = setTimeout(done, quietMs);
            });
            const limit = setTimeout(done, limitMs);
        });
    }

    protected async save(): Promise<void> {
        await this.storage.setData(STORAGE_KEY, Object.fromEntries(this.bindings));
        this.changedEmitter.fire();
    }
}
