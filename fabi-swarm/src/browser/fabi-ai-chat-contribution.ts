import { injectable } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser';
import { AIChatContribution } from '@theia/ai-chat-ui/lib/browser/ai-chat-ui-contribution';

/**
 * Ouvre le chat Fabi comme un ONGLET de la zone d'édition (main area) par défaut,
 * au lieu de la sidebar droite d'origine.
 *
 * `AbstractViewContribution.openView()` lit `defaultViewOptions` UNIQUEMENT à la
 * première ouverture (quand le widget n'est pas encore attaché). On surcharge donc
 * ce getter : le chat s'ouvre en zone-code, et l'utilisateur peut ensuite le
 * renvoyer dans la sidebar via le bouton d'onglet (cf. FabiPanelDockContribution),
 * Theia mémorisant alors sa position dans le layout sauvegardé.
 */
@injectable()
export class FabiAIChatContribution extends AIChatContribution {
    override get defaultViewOptions(): ApplicationShell.WidgetOptions {
        return { area: 'main' };
    }
}
