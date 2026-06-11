import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import { FabiSwarmWidget } from './fabi-swarm-widget';

/**
 * Enregistre le panneau « Fabi Swarm » dans la barre de droite (à côté du chat
 * IA) + une commande de bascule `fabi-swarm:toggle`.
 */
@injectable()
export class FabiSwarmViewContribution extends AbstractViewContribution<FabiSwarmWidget> {
    constructor() {
        super({
            widgetId: FabiSwarmWidget.ID,
            widgetName: FabiSwarmWidget.LABEL,
            defaultWidgetOptions: { area: 'right', rank: 200 },
            toggleCommandId: 'fabi-swarm:toggle'
        });
    }

    /**
     * Ouvre le panneau Fabi Swarm par défaut au tout premier lancement (layout
     * vierge). Les lancements suivants respectent la disposition de l'utilisateur —
     * `initializeLayout` ne s'exécute que quand aucune disposition n'est sauvegardée.
     */
    async initializeLayout(): Promise<void> {
        await this.openView({ reveal: true, activate: false });
    }
}
