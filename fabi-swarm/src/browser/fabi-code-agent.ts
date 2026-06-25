// FabiCodeAgent — le TUYAU entre l'UI de chat Theia et le moteur OpenCode.
//
// Ce n'est PAS un cerveau : pas de LanguageModel, pas de prompt, pas d'outil,
// pas de contexte construit ici. Il implémente l'interface ChatAgent de Theia
// (pour que l'UI de chat Fabi l'utilise) et, dans invoke(), il :
//   1. sauvegarde les buffers modifiés (pour qu'OpenCode lise l'état à jour),
//   2. mappe la session de chat Theia → une session OpenCode (créée à la volée),
//   3. envoie le texte de l'utilisateur au sidecar (service.prompt),
//   4. s'abonne aux fragments streamés (onPart) filtrés sur la session et les
//      traduit en ChatResponseContent Theia RICHES :
//        - texte → deltas de texte,
//        - raisonnement → bloc markdown,
//        - outils → vraies cartes ToolCall (nom/args/résultat/statut, dépliables),
//   5. termine la réponse à la fin du tour (onTurnDone) ou sur annulation.
//
// Tout le reste — agents/multi-agents, prompts, modèle, compaction, outils —
// est géré par OpenCode dans son process.

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger, CommandService } from '@theia/core';
import { CommonCommands } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ChatAgent, ChatAgentLocation } from '@theia/ai-chat/lib/common/chat-agents';
import { MutableChatRequestModel } from '@theia/ai-chat/lib/common/chat-model';
import {
    TextChatResponseContentImpl,
    MarkdownChatResponseContentImpl,
    ToolCallChatResponseContentImpl,
    ThinkingChatResponseContentImpl
} from '@theia/ai-chat/lib/common';
import { LanguageModelRequirement } from '@theia/ai-core';
import { AgentSpecificVariables, PromptVariantSet } from '@theia/ai-core/lib/common/agent';
import { FabiCodeFrontend } from './fabi-code-frontend';
import { FabiCodeState } from './fabi-code-state';
import { FabiCodePart } from '../common/fabi-code-protocol';

/** Id stable du provider/agent Fabi (référencé par DefaultChatAgentId). */
export const FABI_CODE_AGENT_ID = 'fabi-code';

/** Clé de données portée par une requête de chat → infos checkpoint OpenCode. */
export interface FabiCodeCheckpoint {
    sessionId: string;
    messageId: string;
}
export const FABI_CODE_CHECKPOINT_KEY = 'fabiCodeCheckpoint';

@injectable()
export class FabiCodeAgent implements ChatAgent {

    @inject(FabiCodeFrontend) protected readonly engine: FabiCodeFrontend;
    @inject(FabiCodeState) protected readonly state: FabiCodeState;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(ILogger) protected readonly logger: ILogger;

    // ---- Identité (interface Agent) — tout est neutre : aucun cerveau Theia ----
    readonly id = FABI_CODE_AGENT_ID;
    readonly name = 'Fabi';
    readonly description = 'Agent de code Fabi — propulsé par le moteur OpenCode sur le swarm Fabi.';
    readonly variables: string[] = [];
    readonly prompts: PromptVariantSet[] = [];
    readonly languageModelRequirements: LanguageModelRequirement[] = [];
    readonly agentSpecificVariables: AgentSpecificVariables[] = [];
    readonly functions: string[] = [];
    readonly tags: string[] = ['Chat'];

    // ---- ChatAgent ----
    locations: ChatAgentLocation[] = ChatAgentLocation.ALL;
    iconClass = 'codicon codicon-copilot';

    /** Map session de chat Theia → session OpenCode (`ses_…`). */
    protected readonly sessions = new Map<string, string>();
    /** Créations en cours (évite les doublons sur invocations concurrentes). */
    protected readonly creating = new Map<string, Promise<string>>();

    /** Session OpenCode déjà créée pour une session Theia ouverte. */
    getOpenCodeSessionId(theiaSessionId: string): string | undefined {
        return this.sessions.get(theiaSessionId);
    }

    protected workspaceDir(): string | undefined {
        const roots = this.workspace.tryGetRoots();
        const root = roots[0];
        return root ? root.resource.path.toString() : undefined;
    }

    /** Récupère (ou crée) la session OpenCode liée à cette session de chat Theia. */
    protected async ensureSession(theiaSessionId: string, dir: string | undefined): Promise<string> {
        const existing = this.sessions.get(theiaSessionId);
        if (existing) {
            return existing;
        }
        let pending = this.creating.get(theiaSessionId);
        if (!pending) {
            pending = this.engine.service.createSession(dir).then(id => {
                this.sessions.set(theiaSessionId, id);
                this.creating.delete(theiaSessionId);
                return id;
            }).catch(err => {
                this.creating.delete(theiaSessionId);
                throw err;
            });
            this.creating.set(theiaSessionId, pending);
        }
        return pending;
    }

    /**
     * Note de contexte : les @fichiers/variables attachés dans le chat Theia
     * sont signalés à OpenCode par leur référence (il les LIT lui-même via ses
     * outils — pas de dump de contenu, on garde le contexte léger).
     */
    protected contextNote(request: MutableChatRequestModel): string {
        try {
            const vars = request.context?.variables ?? [];
            const refs = vars.map(v => v.arg).filter((a): a is string => !!a && a.length > 0);
            if (refs.length === 0) {
                return '';
            }
            return `\n\n[Contexte fourni par l'utilisateur — lis ces éléments si pertinent : ${refs.join(', ')}]`;
        } catch {
            return '';
        }
    }

    protected safeJson(value: unknown): string {
        if (value === undefined) {
            return '';
        }
        if (typeof value === 'string') {
            return value;
        }
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    async invoke(request: MutableChatRequestModel): Promise<void> {
        const response = request.response;
        // Le contenu se pousse sur le ChatResponseImpl interne (response.response) ;
        // complete()/error()/cancellationToken sont sur le MutableChatResponseModel.
        const out = response.response;
        const dir = this.workspaceDir();
        const userText = (request.request.text ?? '') + this.contextNote(request);

        // Sauvegarde les buffers modifiés AVANT le tour : les outils d'OpenCode
        // lisent les fichiers sur le disque → ils doivent voir l'état courant.
        try {
            await this.commands.executeCommand(CommonCommands.SAVE_ALL.id);
        } catch {
            /* best-effort */
        }

        let ocSession: string;
        try {
            ocSession = await this.ensureSession(request.session.id, dir);
        } catch (err) {
            response.error(err instanceof Error ? err : new Error(String(err)));
            return;
        }

        const token = response.cancellationToken;

        return new Promise<void>(resolve => {
            // Texte/raisonnement cumulatif par part → on n'ajoute que le delta
            // (OpenCode renvoie le texte complet de la part à chaque update).
            const lastText = new Map<string, string>();
            let settled = false;
            // Id du message UTILISATEUR de ce tour : ses parts (l'écho du prompt)
            // ne doivent PAS être rendues dans la réponse de l'assistant.
            let userMessageId: string | undefined;

            const finish = (error?: string): void => {
                if (settled) {
                    return;
                }
                settled = true;
                partSub.dispose();
                doneSub.dispose();
                cancelSub.dispose();
                permSub.dispose();
                userMsgSub.dispose();
                if (error) {
                    response.error(new Error(error));
                } else {
                    response.complete();
                }
                resolve();
            };

            const renderTextDelta = (part: FabiCodePart, asMarkdown: boolean): void => {
                if (typeof part.text !== 'string') {
                    return;
                }
                const prev = lastText.get(part.partId) ?? '';
                const full = part.text;
                if (full.length >= prev.length && full.startsWith(prev)) {
                    const delta = full.slice(prev.length);
                    if (delta) {
                        out.addContent(asMarkdown
                            ? new MarkdownChatResponseContentImpl(delta)
                            : new TextChatResponseContentImpl(delta));
                    }
                } else {
                    out.addContent(asMarkdown
                        ? new MarkdownChatResponseContentImpl(full)
                        : new TextChatResponseContentImpl(full));
                }
                lastText.set(part.partId, full);
            };

            // Raisonnement (« thinking ») → contenu Thinking natif de Theia, rendu
            // en bloc repliable atténué, distinct de la réponse.
            const renderThinking = (part: FabiCodePart): void => {
                if (typeof part.text !== 'string') {
                    return;
                }
                const prev = lastText.get(part.partId) ?? '';
                const full = part.text;
                const delta = (full.length >= prev.length && full.startsWith(prev)) ? full.slice(prev.length) : full;
                if (delta) {
                    out.addContent(new ThinkingChatResponseContentImpl(delta, ''));
                }
                lastText.set(part.partId, full);
            };

            const renderTool = (part: FabiCodePart): void => {
                if (!part.tool) {
                    return;
                }
                const finished = part.state === 'completed' || part.state === 'error';
                const result = part.state === 'error'
                    ? (part.error ?? 'Erreur de l\'outil')
                    : (part.state === 'completed' ? (part.output ?? '') : undefined);
                // addContent fusionne par id (partId) : ré-émettre une carte fraîche
                // à chaque update → Theia met à jour la carte existante (merge).
                out.addContent(new ToolCallChatResponseContentImpl(
                    part.partId,
                    part.tool,
                    this.safeJson(part.input),
                    finished,
                    result
                ));
            };

            const partSub = this.engine.onPartEvent(part => {
                if (part.sessionId !== ocSession || settled) {
                    return;
                }
                // Ne pas réafficher l'écho du message utilisateur dans la réponse.
                if (part.messageId && part.messageId === userMessageId) {
                    return;
                }
                switch (part.type) {
                    case 'text':
                        // Rendu en MARKDOWN (gras, listes, `code`, blocs ```), pas en brut.
                        renderTextDelta(part, true);
                        break;
                    case 'reasoning':
                        renderThinking(part);
                        break;
                    case 'tool':
                        renderTool(part);
                        break;
                    default:
                        // step-start / step-finish / autres → pas de rendu.
                        break;
                }
            });

            const doneSub = this.engine.onTurnDoneEvent(e => {
                if (e.sessionId === ocSession) {
                    finish(e.error);
                }
            });

            const cancelSub = token.onCancellationRequested(() => {
                void this.engine.service.abort(ocSession).catch(() => undefined);
                finish();
            });

            // Demande de permission (commande shell, fetch web…) → carte
            // « Autoriser / Refuser » dans le chat, façon Cursor. On utilise la
            // confirmation native de la carte ToolCall de Theia : on attend le
            // choix de l'utilisateur, puis on répond à OpenCode.
            const permSub = this.engine.onPermissionAskedEvent(async p => {
                if (p.sessionId !== ocSession || settled) {
                    return;
                }
                const card = new ToolCallChatResponseContentImpl(
                    `perm:${p.id}`,
                    p.title,
                    p.detail ?? '',
                    false
                );
                out.addContent(card);
                card.requestUserConfirmation();
                let allowed = false;
                try {
                    allowed = await card.confirmed;
                } catch {
                    allowed = false;
                }
                try {
                    await this.engine.service.replyPermission(p.id, allowed ? 'once' : 'reject', dir);
                } catch {
                    /* best-effort : si la réponse échoue, OpenCode finira par timeouter */
                }
                card.complete(allowed ? 'Autorisé' : 'Refusé');
            });

            // Capte l'id du message utilisateur de CE tour (1er message.updated
            // role:user) → stocké sur la requête pour les checkpoints (revert/delete).
            const userMsgSub = this.engine.onUserMessageEvent(e => {
                if (e.sessionId !== ocSession) {
                    return;
                }
                // Mémorise l'id du message utilisateur → on filtre son écho (cf. partSub).
                userMessageId = e.messageId;
                if (!request.getDataByKey(FABI_CODE_CHECKPOINT_KEY)) {
                    const checkpoint: FabiCodeCheckpoint = { sessionId: ocSession, messageId: e.messageId };
                    request.addData(FABI_CODE_CHECKPOINT_KEY, checkpoint);
                }
            });

            // Lance le tour avec le mode courant ('build' = Agent / 'plan' = Ask).
            this.engine.service.prompt(ocSession, userText, dir, this.state.mode).catch(err => {
                finish(err instanceof Error ? err.message : String(err));
            });
        });
    }
}
