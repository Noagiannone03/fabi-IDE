// FabiSidePanelHandler — pour le panneau de GAUCHE, on retire la colonne d'activité
// VERTICALE native et on pose à la place notre barre d'icônes HORIZONTALE (FabiActivityBar)
// en bas du panneau, façon Cursor.
//
// Points clés (pour ne RIEN casser) :
//  - On ne touche PAS à la structure de l'« îlot » : le wrapper garde l'id
//    `theia-left-content-panel` et son unique enfant reste le contentPanel
//    (`:not(.theia-app-sidebar-container)`) → le CSS « îlots » continue de s'appliquer,
//    l'entête EXPLORER reste lié à sa section.
//  - On NE rend PAS le SideTabBar natif en horizontal (il bugge) : il reste créé et
//    VIVANT (il connaît les vues + la sélection), simplement non affiché. FabiActivityBar
//    le lit et le pilote.
//  - Tout le custom est encapsulé en try/catch → fallback layout natif si quoi que ce soit casse.

import { injectable, inject } from '@theia/core/shared/inversify';
import { Panel, BoxPanel, BoxLayout, DockPanel, Title, Widget } from '@theia/core/shared/@lumino/widgets';
import { SidePanelHandler } from '@theia/core/lib/browser/shell/side-panel-handler';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FabiActivityBar, FabiActivityBarHost } from './fabi-activity-bar';

@injectable()
export class FabiSidePanelHandler extends SidePanelHandler implements FabiActivityBarHost {

    protected fabiActivityBar?: FabiActivityBar;
    protected dockNavigation = false;

    get activityBar(): FabiActivityBar | undefined { return this.fabiActivityBar; }

    enableDockNavigation(): void { this.dockNavigation = true; this.refresh(); }

    override refresh(): void {
        super.refresh();
        // Native Theia keeps its launcher column visible when collapsed. Our
        // launcher lives in the dock, so the entire sidebar must disappear.
        if (this.side === 'left' && this.dockNavigation) {
            this.container.setHidden(!this.tabBar.currentTitle);
        }
    }

    protected override onWidgetRemoved(sender: DockPanel, widget: Widget): void {
        super.onWidgetRemoved(sender, widget);
        this.fabiActivityBar?.refreshViews();
    }

    /**
     * Le panneau gauche n'est JAMAIS replié : il reste toujours ouvert (au pire
     * compressé à sa largeur mini) pour que la barre d'icônes du bas reste visible.
     */
    override collapse(): Promise<void> {
        if (this.side === 'left' && !this.dockNavigation) {
            return Promise.resolve();
        }
        return super.collapse();
    }

    /** FabiActivityBarHost : sélectionne/affiche une vue (le panneau reste ouvert). */
    selectView(title: Title<Widget>): void {
        if (this.tabBar.currentTitle !== title) {
            // Déclenche onCurrentTabChanged → déplie le panneau + active la vue.
            this.tabBar.currentTitle = title;
        } else if (this.dockNavigation) {
            void this.collapse();
        } else {
            // Déjà active : on (re)donne juste le focus à la vue.
            title.owner.activate();
        }
    }

    protected override createContainer(): Panel {
        if (this.side !== 'left') {
            // Keep auxiliary views available through commands, without a second
            // vertical launcher competing with the workbench dock.
            const content = new BoxPanel({ direction: 'top-to-bottom', spacing: 0 });
            BoxPanel.setStretch(this.toolBar, 0);
            content.addWidget(this.toolBar);
            BoxPanel.setStretch(this.dockPanel, 1);
            content.addWidget(this.dockPanel);
            const container = new BoxPanel({ direction: 'left-to-right', spacing: 0 });
            container.id = 'theia-right-content-panel';
            container.addWidget(content);
            return container;
        }
        try {
            // Le contentPanel = l'ÎLOT (toolBar + dockPanel) + notre barre d'activité en bas.
            const contentBox = new BoxLayout({ direction: 'top-to-bottom', spacing: 0 });
            BoxPanel.setStretch(this.toolBar, 0);
            contentBox.addWidget(this.toolBar);
            BoxPanel.setStretch(this.dockPanel, 1);
            contentBox.addWidget(this.dockPanel);

            this.fabiActivityBar = new FabiActivityBar(this);
            BoxPanel.setStretch(this.fabiActivityBar, 0);
            contentBox.addWidget(this.fabiActivityBar);

            const contentPanel = new BoxPanel({ layout: contentBox });

            // Wrapper avec l'id attendu par le CSS « îlots » — SANS colonne d'activité
            // verticale (donc plus de double-barre, plus de gap à gauche).
            const containerLayout = new BoxLayout({ direction: 'left-to-right', spacing: 0 });
            BoxPanel.setStretch(contentPanel, 1);
            containerLayout.addWidget(contentPanel);
            const boxPanel = new BoxPanel({ layout: containerLayout });
            boxPanel.id = 'theia-left-content-panel';
            boxPanel.addClass('fabi-left-horizontal-activity');
            return boxPanel;
        } catch (err) {
            console.error('[fabi] barre d\'activité horizontale échouée → layout natif :', err);
            return super.createContainer();
        }
    }
}

/**
 * Force le panneau de GAUCHE à être OUVERT par défaut : juste après la restauration
 * du layout, si aucune vue n'y est active, on active la première (l'explorateur).
 * Couplé au `collapse()` no-op du handler → l'explorateur est toujours présent.
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
