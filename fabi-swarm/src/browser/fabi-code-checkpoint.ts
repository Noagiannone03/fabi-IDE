// Checkpoints / revert — UI façon Cursor.
//
// Chaque message utilisateur envoyé porte (via request.data) l'id du message
// OpenCode du tour (capté par FabiCodeAgent). On REMPLACE le crayon d'édition
// par une FLÈCHE de restauration : au clic, un dialogue propose
//   • « Message + code » → POST /session/{id}/revert (restaure les fichiers à ce
//     point ET tronque la conversation OpenCode au prochain prompt ; Undo possible),
//   • « Message seul »   → DELETE du message + sa réponse, SANS toucher au code.
//
// Limite connue : la conversation affichée par Theia n'est pas tronquée
// visuellement (pas d'API publique) ; le code, lui, est bien restauré (visible
// dans l'éditeur) et la session OpenCode (le cerveau) est la source de vérité.

import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, MessageService } from '@theia/core';
import { AbstractDialog, DialogProps } from '@theia/core/lib/browser/dialogs';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import {
    ChatNodeToolbarAction,
    DefaultChatNodeToolbarActionContribution
} from '@theia/ai-chat-ui/lib/browser/chat-node-toolbar-action-contribution';
import {
    RequestNode, ResponseNode, isRequestNode
} from '@theia/ai-chat-ui/lib/browser/chat-tree-view/chat-view-tree-widget';
import { EditableChatRequestModel } from '@theia/ai-chat/lib/common/chat-model';
import { FabiCodeFrontend } from './fabi-code-frontend';
import { FabiCodeCheckpoint, FABI_CODE_CHECKPOINT_KEY } from './fabi-code-agent';

export const FABI_CODE_REVERT_COMMAND: Command = {
    id: 'fabi-code.revert-checkpoint',
    label: 'Fabi : restaurer ce point'
};

export type RestoreChoice = 'code' | 'message';

/** Dialogue 3-choix : « Message + code » / « Message seul » / Annuler. */
export class RestoreChoiceDialog extends AbstractDialog<RestoreChoice | undefined> {
    protected choice: RestoreChoice | undefined;

    constructor() {
        super({ title: 'Restaurer ce point' } as DialogProps);
        const p = document.createElement('p');
        p.textContent = 'Que veux-tu restaurer à partir de ce message ?';
        this.contentNode.appendChild(p);

        const codeBtn = this.appendButton('Message + code', true);
        codeBtn.title = 'Restaure les fichiers à cet état et reprend la conversation à partir d\'ici';
        this.addAction(codeBtn, () => { this.choice = 'code'; this.accept(); }, 'click');

        const msgBtn = this.appendButton('Message seul', false);
        msgBtn.title = 'Supprime ce message et sa réponse, sans toucher au code';
        this.addAction(msgBtn, () => { this.choice = 'message'; this.accept(); }, 'click');

        this.appendCloseButton('Annuler');
    }

    get value(): RestoreChoice | undefined {
        return this.choice;
    }
}

/**
 * Remplace l'action « éditer » (crayon) par « restaurer » (flèche) sur les
 * messages utilisateur qui portent un checkpoint. Le reste (réponses, édition
 * en cours) garde le comportement par défaut.
 */
@injectable()
export class FabiCodeRevertToolbarContribution extends DefaultChatNodeToolbarActionContribution {
    override getToolbarActions(node: RequestNode | ResponseNode): ChatNodeToolbarAction[] {
        if (isRequestNode(node)
            && !EditableChatRequestModel.isEditing(node.request)
            && !!node.request.data?.[FABI_CODE_CHECKPOINT_KEY]) {
            return [{
                commandId: FABI_CODE_REVERT_COMMAND.id,
                icon: 'codicon codicon-discard',
                tooltip: 'Restaurer ce point (message / code)',
                priority: 0
            }];
        }
        return super.getToolbarActions(node);
    }
}

/** Commande exécutée au clic sur la flèche : dialogue puis revert/delete. */
@injectable()
export class FabiCodeCheckpointCommands implements CommandContribution {

    @inject(FabiCodeFrontend) protected readonly engine: FabiCodeFrontend;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MessageService) protected readonly messages: MessageService;

    protected dir(): string | undefined {
        const root = this.workspace.tryGetRoots()[0];
        return root ? root.resource.path.toString() : undefined;
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(FABI_CODE_REVERT_COMMAND, {
            isVisible: (node?: unknown) => this.checkpointOf(node) !== undefined,
            execute: (node?: unknown) => this.run(node)
        });
    }

    protected checkpointOf(node: unknown): FabiCodeCheckpoint | undefined {
        if (node && isRequestNode(node as RequestNode)) {
            return (node as RequestNode).request.data?.[FABI_CODE_CHECKPOINT_KEY] as FabiCodeCheckpoint | undefined;
        }
        return undefined;
    }

    protected async run(node: unknown): Promise<void> {
        const cp = this.checkpointOf(node);
        if (!cp) {
            return;
        }
        const choice = await new RestoreChoiceDialog().open();
        if (!choice) {
            return;
        }
        const dir = this.dir();
        try {
            if (choice === 'code') {
                await this.engine.service.revert(cp.sessionId, cp.messageId, dir);
                this.messages.info('Point restauré (fichiers + conversation). Modifie le message et renvoie-le.');
            } else {
                await this.engine.service.deleteTurn(cp.sessionId, cp.messageId, dir);
                this.messages.info('Message restauré pour ré-édition (code inchangé).');
            }
        } catch (err) {
            this.messages.error(`Restauration impossible : ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        // Ré-édition : on repasse le message en mode édition → son texte revient
        // dans l'input. Au renvoi, Theia crée une nouvelle branche → les messages
        // suivants sont dégagés de la vue (et OpenCode a déjà tronqué sa session).
        const req = (node as RequestNode).request;
        if (EditableChatRequestModel.is(req) && !req.isEditing) {
            req.enableEdit();
        }
    }
}
