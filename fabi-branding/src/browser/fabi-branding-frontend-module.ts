/**
 * Module frontend Fabi — point d'assemblage du branding.
 *
 * On suit le modèle Theia « étendre sans casser » :
 *  - on AJOUTE notre page d'accueil et nos couleurs de marque (bind) ;
 *  - on REMPLACE le dialog À-propos par le nôtre (rebind), sans toucher au core.
 */
import '../../src/browser/style/fabi-type.css';   // EN PREMIER : la typographie est la base de la DA
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
import { ViewContainerPart } from '@theia/core/lib/browser/view-container';

import { FabiWelcomeWidget } from './welcome/fabi-welcome-widget';
import { FabiWelcomeContribution } from './welcome/fabi-welcome-contribution';
import { FabiAboutDialog } from './about/fabi-about-dialog';
import { FabiColorContribution } from './theme/fabi-color-contribution';
import { FabiThemeContribution } from './theme/fabi-theme-contribution';
import { FabiSidePanelHandler, FabiLeftPanelOpenContribution, FabiRightPanelContribution } from './shell/fabi-side-panel-handler';

// --- Hauteur des en-têtes de sections (Explorer : Open Editors / Timeline / Outline…) ---
// Theia positionne les *parts* d'un view-container en ABSOLU à partir d'une CONSTANTE
// JS, `ViewContainerPart.HEADER_HEIGHT` (= 22px), PAS à partir du CSS. Notre design
// « îlots » rend les en-têtes plus hauts (34px : --theia-view-container-title-height +
// fabi-islands.css). Tant que la constante reste à 22, le layout réserve trop peu de
// place par en-tête → ils débordent de leur case et SE CHEVAUCHENT (très visible quand
// les sections sont repliées et empilées). Aucun ajustement CSS ne corrige ça : c'est la
// géométrie JS qui décide. On aligne donc la constante du layout sur notre hauteur
// visuelle → layout et CSS s'accordent, plus aucun chevauchement. (À faire au CHARGEMENT
// du module, avant que les view-containers soient bâtis.)
(ViewContainerPart as unknown as { HEADER_HEIGHT: number }).HEADER_HEIGHT = 34;

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
