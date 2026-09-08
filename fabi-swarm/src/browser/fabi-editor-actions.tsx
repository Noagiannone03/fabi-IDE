import * as React from '@theia/core/shared/react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, MessageService } from '@theia/core/lib/common';
import { ApplicationShell, Widget, WidgetManager } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalLocation } from '@theia/terminal/lib/browser/base/terminal-widget';

/**
 * Factory de chats Fabi « multi-instances ». Le ChatViewWidget d'origine est un
 * singleton (une seule vue). Comme le widget, son arbre de messages et son input
 * sont tous bindés en scope *transient*, on peut en créer autant qu'on veut via
 * une factory dédiée : chaque instance a son propre arbre, son propre input
 * (= notre FabiChatInputWidget) et sa propre session de chat. On leur donne juste
 * un id unique pour cohabiter dans la zone d'édition.
 */
export const FABI_CHAT_INSTANCE_FACTORY_ID = 'fabi-chat-instance';

const NEW_CHAT = Command.toLocalizedCommand({ id: 'fabi.newChat', label: 'Nouvelle conversation', iconClass: 'codicon codicon-add' });
const NEW_TERMINAL = Command.toLocalizedCommand({ id: 'fabi.newTerminalTab', label: 'Nouveau terminal en zone de code' });

/**
 * Bouton « Fabi AI » (îlot) à droite de la barre d'onglets de la zone de code :
 * chaque clic ouvre une NOUVELLE instance de chat en onglet → multi-chat natif.
 * Le bouton ne s'affiche que sur la barre d'onglets de la zone d'édition.
 *
 * Cette contribution nettoie aussi la zone latérale DROITE au démarrage : tout
 * widget qui y resterait (layout restauré) est ramené en zone d'édition, ce qui
 * laisse la zone droite vide → Theia rétracte la barre latérale droite d'elle-même
 * (cf. SidePanelHandler.refresh : `tabBar.setHidden(isEmpty)`).
 */
@injectable()
export class FabiEditorActionsContribution implements CommandContribution, TabBarToolbarContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(TerminalService)
    protected readonly terminalService: TerminalService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    protected chatCounter = 0;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(NEW_CHAT, { execute: () => this.openNewChat() });
        // Commande conservée (palette) ; plus de bouton terminal dans la barre.
        commands.registerCommand(NEW_TERMINAL, { execute: () => this.openNewTerminal() });
    }

    registerToolbarItems(registry: TabBarToolbarRegistry): void {
        registry.registerItem({
            id: 'fabi.agents.newConversation',
            command: NEW_CHAT.id,
            group: 'navigation',
            priority: 10,
            isVisible: widget => !!widget && this.shell.getAreaFor(widget) === 'main'
                && (widget.id === 'chat-view-widget' || widget.id.startsWith(FABI_CHAT_INSTANCE_FACTORY_ID + ':'))
        });
        registry.registerItem({
            id: 'fabi.editor.newChat',
            group: 'navigation',
            priority: 100,
            isVisible: w => this.onMainTabBar(w),
            render: () => this.renderButton('newChat', 'codicon-comment-discussion', 'Fabi AI', () => this.openNewChat())
        });
        registry.registerItem({
            id: 'fabi.editor.newTerminal',
            group: 'navigation',
            priority: 101,
            isVisible: w => this.onMainTabBar(w),
            render: () => this.renderButton('newTerminal', 'codicon-terminal', 'Terminal', () => this.openNewTerminal())
        });
    }

    protected renderButton(key: string, icon: string, label: string, onClick: () => void): React.ReactNode {
        return (
            <button
                key={key}
                className="fabi-editor-action"
                title={`Nouveau ${label}`}
                // On bloque la propagation pour ne pas déclencher la sélection d'onglet.
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
                onClick={e => { e.preventDefault(); e.stopPropagation(); onClick(); }}
            >
                <span className={`codicon ${icon} fabi-editor-action-icon`} />
                <span className="fabi-editor-action-label">{label}</span>
            </button>
        );
    }

    protected onMainTabBar(widget?: Widget): boolean {
        return !!widget && this.shell.getAreaFor(widget) === 'main';
    }

    /** Id incrémental, calé au-dessus des instances déjà ouvertes (restaurées). */
    protected nextChatUid(): number {
        let max = this.chatCounter;
        for (const w of this.widgetManager.getWidgets(FABI_CHAT_INSTANCE_FACTORY_ID)) {
            const n = Number(w.id.split(':').pop());
            if (!Number.isNaN(n) && n > max) {
                max = n;
            }
        }
        this.chatCounter = max + 1;
        return this.chatCounter;
    }

    protected async openNewChat(): Promise<void> {
        try {
            const uid = this.nextChatUid();
            const widget = await this.widgetManager.getOrCreateWidget(FABI_CHAT_INSTANCE_FACTORY_ID, { uid });
            await this.shell.addWidget(widget, { area: 'main' });
            await this.shell.activateWidget(widget.id);
        } catch (err) {
            this.messageService.error('Fabi : impossible d’ouvrir un nouveau chat — ' + (err instanceof Error ? err.message : String(err)));
        }
    }

    protected async openNewTerminal(): Promise<void> {
        // Ouverture explicite en zone d'édition, sans `ref` (donc indépendante d'un
        // éventuel terminal résiduel du panneau bas) → un nouvel onglet à chaque fois.
        const terminal = await this.terminalService.newTerminal({ location: TerminalLocation.Editor });
        await terminal.start();
        this.terminalService.open(terminal, { widgetOptions: { area: 'main' } });
    }
}
