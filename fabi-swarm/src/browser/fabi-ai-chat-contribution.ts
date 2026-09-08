import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell, TreeNode } from '@theia/core/lib/browser';
import { CommandRegistry, MessageService } from '@theia/core';
import { AIChatContribution } from '@theia/ai-chat-ui/lib/browser/ai-chat-ui-contribution';
import { ChatNodeToolbarCommands } from '@theia/ai-chat-ui/lib/browser/chat-node-toolbar-action-contribution';
import { isResponseNode } from '@theia/ai-chat-ui/lib/browser/chat-tree-view';
import { ChatService } from '@theia/ai-chat/lib/common/chat-service';

/**
 * Ouvre le chat dans un onglet, à côté des fichiers.
 *
 * `AbstractViewContribution.openView()` lit `defaultViewOptions` UNIQUEMENT à la
 * première ouverture (quand le widget n'est pas encore attaché). On surcharge donc
 * ce getter : le choix ne s'applique qu'à une première ouverture. Theia mémorise
 * ensuite la position choisie par l'utilisateur dans le layout sauvegardé.
 */
@injectable()
export class FabiAIChatContribution extends AIChatContribution {

    @inject(ChatService) protected readonly fabiChatService: ChatService;
    @inject(MessageService) protected readonly fabiMessages: MessageService;

    override get defaultViewOptions(): ApplicationShell.WidgetOptions {
        return { area: 'main' };
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        // --- Fix retry multi-session ---
        // Le handler d'origine cherche la requête dans getActiveSession() puis
        // l'envoie sur node.sessionId : incohérent dès qu'il y a plusieurs chats
        // (multi-instances) → « Request not found for retry ». On le réenregistre
        // pour chercher dans la session DU NŒUD cliqué.
        registry.unregisterCommand(ChatNodeToolbarCommands.RETRY);
        registry.registerCommand(ChatNodeToolbarCommands.RETRY, {
            isEnabled: (node: TreeNode) => isResponseNode(node) && (node.response.isError || node.response.isCanceled),
            isVisible: (node: TreeNode) => isResponseNode(node) && (node.response.isError || node.response.isCanceled),
            execute: async (node: TreeNode) => {
                if (!isResponseNode(node)) {
                    return;
                }
                const session = this.fabiChatService.getSession(node.sessionId) ?? this.fabiChatService.getActiveSession();
                const request = session?.model.getRequests().find(r => r.response.id === node.response.id);
                if (!request) {
                    this.fabiMessages.error('Fabi : requête introuvable pour le retry.');
                    return;
                }
                await this.fabiChatService.sendRequest(node.sessionId, request.request);
            }
        });
    }
}
