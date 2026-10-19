import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { FabiNavigatorWidget } from './fabi-project-tree';
import { ViewContainer } from '@theia/core/lib/browser/view-container';
import { EXPLORER_VIEW_CONTAINER_ID } from '@theia/navigator/lib/browser/navigator-widget-factory';
import { FILE_NAVIGATOR_ID } from '@theia/navigator/lib/browser/navigator-widget';

/**
 * Le panneau Espace ne montre que notre vue sessions et fichiers : les sections
 * secondaires de l'explorateur (Open Editors, NPM Scripts, Timeline…) sont
 * masquées, y compris celles que les extensions ajoutent après le démarrage.
 */
@injectable()
export class FabiProjectsLayout implements FrontendApplicationContribution, CommandContribution {

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand({ id: 'fabi.projects.showFiles', label: 'Fabi : parcourir les fichiers' }, {
            execute: async () => {
                await this.shell.activateWidget(EXPLORER_VIEW_CONTAINER_ID);
                const navigator = this.shell.widgets.find(widget => widget.id === FILE_NAVIGATOR_ID);
                if (navigator instanceof FabiNavigatorWidget) navigator.showFiles();
            }
        });
    }

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
