import { injectable } from '@theia/core/shared/inversify';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';

/**
 * Épure la barre d'outils du panneau IA : on ne garde que « Nouveau chat » (+) et
 * « Historique ». Tout le reste (lock de scroll, réglages de session, réglages IA,
 * résumé, navigation) est retiré proprement via `TabBarToolbarRegistry.unregisterItem`
 * — API officielle de Theia. Cette contribution est chargée APRÈS ai-chat-ui /
 * ai-ide (fabi-swarm en dépend), donc nos retraits passent après leurs ajouts.
 */

// Ids des items à retirer (tels qu'enregistrés par @theia/ai-chat-ui).
// On GARDE volontairement « Historique » (`ai-chat-ui.show-chats`) et les
// « réglages IA » (`chat-view.ai-chat-ui.show-settings`) : ce sont les deux
// seules actions qu'on veut sur l'onglet du chat. On retire le reste, dont le
// « + Nouveau chat » (`ai-chat-ui.new-chat`) — on a déjà le chip « Fabi AI » dans
// la barre d'onglets de la zone de code.
const REMOVE_TOOLBAR_ITEMS = [
    'chat:widget:lock',
    'chat:widget:unlock',
    'chat:widget:session-settings',
    'chat-view.ai-chat-summary-current-session',
    'chat-view.ai-chat-open-current-session-summary',
    'ai-chat-ui.navigate-back',
    'ai-chat-ui.navigate-forward',
    'ai-chat-ui.new-chat',
    // « Ouvrir dans une fenêtre à part » : item GÉNÉRIQUE de @theia/secondary-window
    // (chargé avant fabi-swarm → désenregistrement déterministe). On le retire
    // partout : on ne veut pas de détachement fenêtre sur nos onglets.
    'extract-widget'
];

@injectable()
export class FabiChatHeaderContribution implements TabBarToolbarContribution {
    registerToolbarItems(registry: TabBarToolbarRegistry): void {
        for (const id of REMOVE_TOOLBAR_ITEMS) {
            registry.unregisterItem(id);
        }
    }
}
