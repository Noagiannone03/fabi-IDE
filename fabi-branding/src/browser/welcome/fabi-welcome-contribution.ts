import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { CommonMenus, FrontendApplication, FrontendApplicationContribution, ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { FabiWelcomeWidget } from './fabi-welcome-widget';

export const FabiWelcomeCommand: Command = {
    id: 'fabi.welcome.open',
    label: 'Fabi : Bienvenue'
};

/**
 * Pilote la page d'accueil Fabi :
 *  - l'enregistre dans le layout par défaut (premier lancement / pas d'état restauré),
 *  - expose une commande pour la rouvrir,
 *  - l'ajoute au menu Aide.
 */
@injectable()
export class FabiWelcomeContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    // `initializeLayout` n'est appelé que lorsqu'aucun layout n'a été sauvegardé
    // (premier démarrage) : l'endroit idéal pour présenter l'accueil.
    async initializeLayout(_app: FrontendApplication): Promise<void> {
        await this.openWelcome();
    }

    // `onStart` s'exécute à CHAQUE démarrage (même avec un layout sauvegardé) :
    // on y ouvre le panneau IA s'il n'est pas déjà visible (commande officielle
    // `aiChat:toggle`), pour qu'il soit accessible direct sans le chercher.
    async onStart(_app: FrontendApplication): Promise<void> {
        try {
            // s'assure que le widget chat existe, déplie la barre de droite si
            // besoin (idempotent : jamais de fermeture), puis l'active.
            await this.widgetManager.getOrCreateWidget('chat-view-widget');
            if (!this.shell.isExpanded('right')) {
                this.shell.expandPanel('right');
            }
            await this.shell.activateWidget('chat-view-widget');
        } catch {
            /* @theia/ai-chat-ui absent : on ignore */
        }
    }

    protected async openWelcome(): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget(FabiWelcomeWidget.ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(FabiWelcomeCommand, {
            execute: () => this.openWelcome()
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.HELP, {
            commandId: FabiWelcomeCommand.id,
            label: 'Bienvenue',
            order: 'a0'
        });
    }
}
