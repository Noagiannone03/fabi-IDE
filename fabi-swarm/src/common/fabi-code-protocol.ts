// Protocole partagé frontend ⇄ backend pour le moteur d'agent IA « fabi-code ».
//
// ARCHITECTURE — on a SORTI tout le cerveau IA de Theia. Le cerveau (agents,
// multi-agents, prompts, modèles, build de contexte, compaction, outils) vit
// désormais ENTIÈREMENT dans OpenCode, lancé comme sidecar headless (`opencode
// serve`) par le backend Node. Le frontend ne fait QUE de l'affichage :
//   - `FabiCodeAgent` (un ChatAgent Theia) est un simple TUYAU : il prend le
//     texte de l'utilisateur, le pousse à OpenCode via ce service RPC, et
//     re-streame la sortie d'OpenCode dans l'UI de chat Fabi existante.
//   - aucun LanguageModel Theia, aucun prompt Theia, aucun outil Theia.
//
// Le backend tient UNE connexion SSE persistante vers `/event` d'OpenCode et
// pousse les « parts » normalisés au frontend via FabiCodeClient (zéro polling).

export const FABI_CODE_SERVICE_PATH = '/services/fabi-code';
export const FabiCodeService = Symbol('FabiCodeService');
export const FabiCodeClient = Symbol('FabiCodeClient');

/** Id du provider OpenAI-compatible injecté dans la config OpenCode (→ swarm). */
export const FABI_CODE_PROVIDER_ID = 'fabi-swarm';

/** Cycle de vie du sidecar OpenCode. */
export type FabiCodeServerStatus = 'starting' | 'ready' | 'error' | 'stopped';

export interface FabiCodeServerInfo {
    status: FabiCodeServerStatus;
    /** URL locale du serveur (http://127.0.0.1:PORT) une fois prêt. */
    url?: string;
    detail?: string;
    /** Nombre de tours réellement en cours dans OpenCode (0 hors génération). */
    activeTurns: number;
    /** Phase agrégée des tours, distincte du cycle de vie du sidecar. */
    activity: 'idle' | 'preparing' | 'generating';
}

/**
 * Un fragment de réponse streamé par OpenCode, normalisé pour le relais UI.
 * Miroir simplifié d'un `message.part.updated` d'OpenCode — on ne garde que ce
 * qu'il faut pour rendre du texte, du raisonnement et des appels d'outils.
 */
export interface FabiCodePart {
    sessionId: string;
    messageId: string;
    partId: string;
    /** 'text' | 'reasoning' | 'tool' | 'step-start' | 'step-finish' | … */
    type: string;
    /** Texte cumulatif (OpenCode renvoie le texte complet de la part à chaque update). */
    text?: string;
    // --- champs d'outil (type === 'tool') ---
    tool?: string;
    callId?: string;
    /** 'pending' | 'running' | 'completed' | 'error' */
    state?: string;
    /** Entrée de l'outil (args), best-effort. */
    input?: unknown;
    /** Sortie/texte de résultat de l'outil. */
    output?: string;
    /** Titre court présenté par OpenCode pour l'outil (ex. chemin du fichier lu). */
    title?: string;
    /** Erreur éventuelle de l'outil. */
    error?: string;
}

/**
 * Demande de permission émise par OpenCode avant un outil sensible (commande
 * shell, fetch web…). L'UI affiche une carte « Autoriser / Refuser » et la
 * réponse repart via FabiCodeService.replyPermission. C'est l'équivalent de
 * l'approbation de commande de Cursor/Cline.
 */
export interface FabiCodePermission {
    /** Id de la demande (à renvoyer dans replyPermission). */
    id: string;
    sessionId: string;
    /** Libellé court (nom de l'outil / type de permission). */
    title: string;
    /** Détail (ex. la commande shell à lancer), best-effort. */
    detail?: string;
    /** callID de l'outil concerné (corrélation éventuelle avec sa carte). */
    callId?: string;
}

/** Réponse à une demande de permission. */
export type FabiCodePermissionReply = 'once' | 'always' | 'reject';

/**
 * Event OpenCode BRUT relayé tel quel au frontend (le widget de chat est un
 * miroir fidèle de la session OpenCode). `properties` est la charge utile
 * d'origine ({sessionID, part|info|status|…}). Le store frontend le réduit.
 */
export interface FabiCodeEvent {
    sessionId: string;
    type: string;
    properties: Record<string, unknown>;
}

/**
 * Client poussé par le backend vers le frontend (pattern RPC Theia client-aware).
 */
export interface FabiCodeClient {
    /** Le sidecar a changé d'état (démarrage / prêt / erreur / arrêté). */
    onServerStatus(info: FabiCodeServerInfo): void;
    /** Nouveau fragment de réponse pour une session (texte/outil incrémental). */
    onPart(part: FabiCodePart): void;
    /** Fin de tour pour une session (le modèle a fini, ou erreur fatale). */
    onTurnDone(sessionId: string, error?: string): void;
    /** Un fichier a été édité par un outil OpenCode (pont éditeur). */
    onFileEdited(sessionId: string, path: string): void;
    /** OpenCode demande l'autorisation de lancer un outil sensible. */
    onPermissionAsked(permission: FabiCodePermission): void;
    /** Id du message utilisateur d'un tour (capté en début de tour) → checkpoint. */
    onUserMessage(sessionId: string, messageId: string): void;
    /** Event OpenCode brut (pour le widget de chat qui mirroite la session). */
    onEngineEvent(event: FabiCodeEvent): void;
}

/**
 * Service backend (Node) : seul à pouvoir spawn le sidecar OpenCode et parler à
 * son API HTTP/SSE locale. Le frontend l'appelle via RPC et reçoit les pushs
 * via FabiCodeClient.
 */
export interface FabiCodeService {
    /** Enregistre le client (appelé par le handler RPC à la connexion). */
    setClient(client: FabiCodeClient | undefined): void;

    /** État courant du sidecar (pour l'affichage initial). */
    getServerInfo(): Promise<FabiCodeServerInfo>;

    /**
     * Crée une session OpenCode rattachée à `directory` (racine du workspace).
     * Retourne l'id de session OpenCode (`ses_…`). Idempotent côté appelant :
     * le frontend mappe une session de chat Theia → une session OpenCode.
     */
    createSession(directory?: string): Promise<string>;

    /**
     * Envoie un message utilisateur dans la session. Les fragments arrivent en
     * live via `onPart`; la promesse se résout quand le tour est terminé
     * (`onTurnDone` est aussi émis). `directory` cible le workspace.
     * `agent` choisit le mode OpenCode : 'build' (édite) | 'plan' (lecture seule).
     */
    prompt(sessionId: string, text: string, directory?: string, agent?: string): Promise<void>;

    /** Interrompt le tour en cours dans le même scope workspace que le prompt. */
    abort(sessionId: string, directory?: string): Promise<void>;

    /**
     * Historique complet d'une session (JSON brut d'OpenCode : `[{info, parts}]`)
     * pour l'amorçage du widget avant que le SSE prenne le relais.
     */
    getMessages(sessionId: string, directory?: string): Promise<string>;

    /**
     * Répond à une demande de permission (carte Autoriser/Refuser). `once` =
     * autorise cet appel, `always` = autorise et mémorise la règle, `reject` =
     * refuse.
     */
    replyPermission(requestId: string, reply: FabiCodePermissionReply, directory?: string): Promise<void>;

    /**
     * Checkpoint « message + code » : restaure les fichiers à l'état du message
     * et tronque la conversation à partir de là (effectif au prochain prompt).
     * Annulable via `unrevert` tant qu'aucun nouveau prompt n'a été envoyé.
     */
    revert(sessionId: string, messageId: string, directory?: string): Promise<void>;
    /** Annule un revert (restaure messages + fichiers). */
    unrevert(sessionId: string, directory?: string): Promise<void>;
    /**
     * Checkpoint « message seul » : supprime le message utilisateur ET sa réponse
     * assistant, SANS toucher au code.
     */
    deleteTurn(sessionId: string, messageId: string, directory?: string): Promise<void>;
}
