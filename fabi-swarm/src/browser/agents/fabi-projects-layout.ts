import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ViewContainer } from '@theia/core/lib/browser/view-container';
import { EXPLORER_VIEW_CONTAINER_ID } from '@theia/navigator/lib/browser/navigator-widget-factory';
import { FILE_NAVIGATOR_ID } from '@theia/navigator/lib/browser/navigator-widget';

/**
 * La barre « Projets » ne montre que les dossiers (agents + code) : les sections
 * secondaires de l'explorateur (Open Editors, NPM Scripts, Timeline…) sont
 * masquées, y compris celles que les extensions ajoutent après le démarrage.
 */
@injectable()
export class FabiProjectsLayout implements FrontendApplicationContribution {

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;

    onDidInitializeLayout(): void {
        const container = this.shell.getWidgets('left').find(widget => widget.id === EXPLORER_VIEW_CONTAINER_ID);
        if (!(container instanceof ViewContainer)) {
            return;
        }
        const hideSecondaryParts = () => {
            for (const part of container.getParts()) {
                if (part.wrapped.id !== FILE_NAVIGATOR_ID && part.canHide && !part.isHidden) {
                    part.setHidden(true);
                }
            }
        };
        hideSecondaryParts();
        container.onDidChangeTrackableWidgets(hideSecondaryParts);
    }
}
