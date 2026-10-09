import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, Emitter, Event, generateUuid, MessageService } from '@theia/core';
import { isWindows } from '@theia/core/lib/common/os';
import URI from '@theia/core/lib/common/uri';
import { FrontendApplicationContribution, StorageService } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalLocation, TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import {
    agentCli, FabiAgentCli, FabiAgentCliId, FABI_AGENT_TERMINAL_ENV, FABI_AGENT_TERMINAL_PREFIX
} from '../../common/fabi-agent-clis';
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

    protected readonly bindings = new Map<string, FabiAgentTerminalBinding>();
    protected readonly changedEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changedEmitter.event;

    async onDidInitializeLayout(): Promise<void> {
        const stored = await this.storage.getData<Record<string, FabiAgentTerminalBinding>>(STORAGE_KEY, {});
        for (const [id, binding] of Object.entries(stored ?? {})) {
            this.bindings.set(id, binding);
        }
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
        if (!cli || this.terminals.getById(id)) {
            return;
        }
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
            title: cli.label,
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
        terminal.onDidDispose(() => {
            // Onglet fermé par l'utilisateur : la conversation n'est plus rattachée.
            if (this.bindings.delete(id)) {
                void this.save();
            }
        });
        this.terminals.open(terminal, { widgetOptions: { area: 'main' }, mode: activate ? 'activate' : 'open' });
        await ready;
        return terminal;
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
            const listener = terminal.onOutput(() => {
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
