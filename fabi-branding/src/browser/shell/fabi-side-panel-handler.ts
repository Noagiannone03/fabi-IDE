// FabiSidePanelHandler — les panneaux latéraux sans colonne d'activité.
//
// Tout se lance depuis le dock du bas (cf. FabiWorkbenchDockContribution) :
//  - à GAUCHE ne reste que la barre « Projets » (l'explorateur) ;
//  - à DROITE s'ouvrent Git, la recherche dans les fichiers, debug, extensions…,
//    avec une croix dans l'en-tête pour refermer le panneau.
// Le SideTabBar natif reste créé et vivant (il connaît les vues + la sélection),
// simplement jamais affiché. Un panneau replié disparaît donc entièrement.

import { injectable, inject } from '@theia/core/shared/inversify';
import { Panel, BoxPanel } from '@theia/core/shared/@lumino/widgets';
import { SidePanelHandler } from '@theia/core/lib/browser/shell/side-panel-handler';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';

@injectable()
export class FabiSidePanelHandler extends SidePanelHandler {

    protected dockNavigation = false;

    enableDockNavigation(): void { this.dockNavigation = true; this.refresh(); }

    override refresh(): void {
        super.refresh();
        // Theia garde sa colonne de lanceurs visible quand le panneau est replié.
        // Nos lanceurs vivent dans le dock : le panneau replié doit disparaître.
        if (this.side === 'right' || this.dockNavigation) {
            this.container.setHidden(!this.tabBar.currentTitle);
        }
        if (this.side === 'left' && this.dockNavigation) {
            document.body.classList.toggle('fabi-sidebar-collapsed', !this.tabBar.currentTitle);
        }
    }

    protected override createContainer(): Panel {
        const content = new BoxPanel({ direction: 'top-to-bottom', spacing: 0 });
        BoxPanel.setStretch(this.toolBar, 0);
        content.addWidget(this.toolBar);
        BoxPanel.setStretch(this.dockPanel, 1);
        content.addWidget(this.dockPanel);
        // Wrapper avec l'id attendu par le CSS « îlots », sans colonne d'activité.
        const container = new BoxPanel({ direction: 'left-to-right', spacing: 0 });
        container.id = `theia-${this.side}-content-panel`;
        container.addWidget(content);
        return container;
    }
}

/**
 * Force le panneau de GAUCHE à être OUVERT par défaut : juste après la restauration
 * d'un layout neuf, si aucune vue n'y est active, on active la première (l'explorateur).
 */
@injectable()
export class FabiLeftPanelOpenContribution implements FrontendApplicationContribution {

    protected freshLayout = false;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    initializeLayout(): void { this.freshLayout = true; }

    onDidInitializeLayout(): void {
        if (!this.freshLayout) { return; }
        try {
            const tabBar = this.shell.leftPanelHandler.tabBar;
            if (!tabBar.currentTitle && tabBar.titles.length > 0) {
                tabBar.currentTitle = tabBar.titles[0];
            }
        } catch (err) {
            console.error('[fabi] ouverture du panneau gauche par défaut :', err);
        }
    }
}

const CLOSE_RIGHT_PANEL: Command = { id: 'fabi.closeRightPanel', label: 'Fermer le panneau de droite', iconClass: 'codicon codicon-close' };

/** Croix de fermeture dans l'en-tête du panneau de droite. */
@injectable()
export class FabiRightPanelCloseContribution implements CommandContribution, TabBarToolbarContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CLOSE_RIGHT_PANEL, {
            execute: () => this.shell.collapsePanel('right'),
            isVisible: widget => !!widget && this.shell.getAreaFor(widget) === 'right'
        });
    }

    registerToolbarItems(registry: TabBarToolbarRegistry): void {
        registry.registerItem({
            id: CLOSE_RIGHT_PANEL.id,
            command: CLOSE_RIGHT_PANEL.id,
            tooltip: CLOSE_RIGHT_PANEL.label,
            priority: 1000,
            group: 'navigation'
        });
    }
}
