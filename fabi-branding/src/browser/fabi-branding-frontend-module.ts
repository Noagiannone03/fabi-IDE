/**
 * Module frontend Fabi — point d'assemblage du branding.
 *
 * On suit le modèle Theia « étendre sans casser » :
 *  - on AJOUTE notre page d'accueil et nos couleurs de marque (bind) ;
 *  - on REMPLACE le dialog À-propos par le nôtre (rebind), sans toucher au core.
 */
import '../../src/browser/style/index.css';
import '../../src/browser/style/fabi-ui-polish.css';
import '../../src/browser/style/fabi-islands.css';
import '../../src/browser/style/fabi-activity-bar.css';
import '../../src/browser/style/fabi-space-accent.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { AboutDialog, AboutDialogProps } from '@theia/core/lib/browser/about-dialog';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { SidePanelHandler } from '@theia/core/lib/browser/shell/side-panel-handler';

import { FabiWelcomeWidget } from './welcome/fabi-welcome-widget';
import { FabiWelcomeContribution } from './welcome/fabi-welcome-contribution';
import { FabiAboutDialog } from './about/fabi-about-dialog';
import { FabiColorContribution } from './theme/fabi-color-contribution';
import { FabiThemeContribution } from './theme/fabi-theme-contribution';
import { FabiSidePanelHandler, FabiLeftPanelOpenContribution, FabiRightPanelContribution } from './shell/fabi-side-panel-handler';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    // --- Page d'accueil Fabi (widget autonome) ---
    bind(FabiWelcomeWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: FabiWelcomeWidget.ID,
        createWidget: () => ctx.container.get(FabiWelcomeWidget)
    })).inSingletonScope();

    bind(FabiWelcomeContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(FabiWelcomeContribution);
    bind(MenuContribution).toService(FabiWelcomeContribution);
    bind(FrontendApplicationContribution).toService(FabiWelcomeContribution);

    // --- Couleurs de marque + thème Fabi Islands ---
    bind(ColorContribution).to(FabiColorContribution).inSingletonScope();
    bind(FabiThemeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(FabiThemeContribution);

    // --- Dialog « À propos » rebrandé ---
    rebind(AboutDialog).to(FabiAboutDialog).inSingletonScope();
    rebind(AboutDialogProps).toConstantValue({ title: 'Fabi' });

    // --- Barre d'activité gauche : icônes horizontales en bas (façon Cursor) ---
    // Transient (PAS singleton) : la factory instancie un handler distinct gauche/droite.
    rebind(SidePanelHandler).to(FabiSidePanelHandler);

    // --- Panneau gauche toujours ouvert (explorateur visible par défaut) ---
    bind(FabiLeftPanelOpenContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(FabiLeftPanelOpenContribution);

    // --- Panneau droit : garder IA, retirer seulement Outline ---
    bind(FabiRightPanelContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(FabiRightPanelContribution);
});
