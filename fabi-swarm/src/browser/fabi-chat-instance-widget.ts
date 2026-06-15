import { injectable } from '@theia/core/shared/inversify';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';

/**
 * Chat Fabi « épinglé » = une instance de chat indépendante, pour le multi-onglets.
 *
 * Le `ChatViewWidget` d'origine écoute `chatService.onSessionEvent` (dans
 * `initListeners`) et réaligne SA vue sur la **session active globale** dès qu'elle
 * change. Comme le `chatService` est un singleton, toutes les vues de chat se
 * synchronisent alors sur la même conversation → impossible d'avoir plusieurs
 * chats distincts côte à côte.
 *
 * Ici on garde tout le reste du widget, mais on **n'écoute plus** le changement de
 * session active : chaque instance conserve la session créée dans son `init()`
 * (cf. `this.chatSession = this.chatService.createSession()`), donc chaque onglet
 * est une conversation autonome. On conserve seulement l'écoute « soumission d'une
 * édition » (re-poser une requête éditée), qui est locale au widget.
 */
@injectable()
export class FabiChatInstanceWidget extends ChatViewWidget {

    protected override initListeners(): void {
        this.toDispose.push(
            this.treeWidget.onDidSubmitEdit(request => {
                this.onQuery(request);
            })
        );
    }
}
