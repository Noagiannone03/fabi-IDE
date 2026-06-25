// Protocole partagé frontend ⇄ backend du tableau de bord « Maestro ».
//
// Maestro = la vue de SUPERVISION de tous les agents IA de l'IDE, affichée dans
// un Space dédié (cf. fabi-spaces, kind: 'maestro'). Elle agrège deux sources :
//   1. Les chats « Fabi AI » = les sessions du sidecar OpenCode (toutes workspaces
//      confondues), avec leur statut live (génère / en attente / au repos).
//   2. (Phase 2) Les agents CLI externes (Claude Code, Codex) tournant dans un
//      terminal, détectés par process + transcript.
//
// Le service backend (FabiMaestroService) tient un modèle agrégé en mémoire,
// alimenté par UN flux SSE global d'OpenCode + un polling de la liste de sessions,
// et le pousse au frontend (FabiMaestroClient) — zéro polling côté UI.

export const FABI_MAESTRO_SERVICE_PATH = '/services/fabi-maestro';
/** Endpoint sans callback client, utilisé par les reporters des workspaces. */
export const FABI_MAESTRO_REPORTER_PATH = '/services/fabi-maestro-reporter';
export const FabiMaestroService = Symbol('FabiMaestroService');
export const FabiMaestroClient = Symbol('FabiMaestroClient');

/** Origine d'un agent supervisé. */
export type MaestroSource = 'fabi' | 'claude' | 'codex';

/**
 * Statut normalisé d'un agent.
 *  - `generating` : produit une réponse (tour en cours).
 *  - `waiting`    : bloqué en attente d'une validation/permission de l'utilisateur.
 *  - `idle`       : au repos (dernier tour terminé, prêt).
 *  - `error`      : dernier tour en erreur.
 */
export type MaestroStatus = 'generating' | 'waiting' | 'idle' | 'error';
export type MaestroWaitingKind = 'permission' | 'input';

export interface MaestroHooksStatus {
    claude: boolean;
    codex: boolean;
    bridge: boolean;
}

/** Surface native réellement ouverte dans un frontend de Space. */
export interface MaestroSurface {
    /** Identifiant du frontend qui publie cette surface. */
    ownerId: string;
    /** Id du Space Electron, quand l'application tourne en mode Spaces. */
    spaceId?: string;
    /** Id du widget Theia à réactiver. */
    widgetId: string;
    kind: 'fabi-chat' | 'terminal';
    title: string;
    directory?: string;
    workspaceName?: string;
    active: boolean;
    updatedAt: number;
    /** Session Theia du widget de chat. */
    theiaSessionId?: string;
    /** Session OpenCode liée, absente tant que le premier prompt n'a pas été envoyé. */
    openCodeSessionId?: string;
    /** Informations du PTY pour rattacher Claude/Codex au bon terminal. */
    terminalId?: number;
    processId?: number;
    sourceHint?: 'claude' | 'codex';
}

/** Un agent supervisé (une ligne du tableau de bord). */
export interface MaestroAgent {
    /** Clé stable inter-sources : `${source}:${id}`. */
    key: string;
    source: MaestroSource;
    /** Id natif (session OpenCode `ses_…`, ou session uuid Claude/Codex). */
    id: string;
    /** Titre lisible (titre de session OpenCode, ou 1er prompt). */
    title: string;
    status: MaestroStatus;
    /** Dossier de travail (workspace) de la session. */
    directory?: string;
    /** Nom court lisible du dossier (basename) — pour grouper par espace. */
    workspaceName?: string;
    /** Aperçu du dernier extrait (texte assistant en cours / dernier message). */
    preview?: string;
    /** Modèle utilisé (si connu). */
    model?: string;
    /** Dernière activité (ms epoch) — tri par récence. */
    updatedAt: number;
    /** Détail de la permission en attente (commande shell, URL…) si status `waiting`. */
    pendingPermission?: string;
    /** Id de la permission OpenCode en attente, pour autoriser/refuser depuis Maestro. */
    pendingPermissionId?: string;
    /** Nature de l'attente remontée par les hooks CLI. */
    waitingKind?: MaestroWaitingKind;
    /** Résumé d'édition cumulé (fichiers/+/-), si fourni par OpenCode. */
    edits?: { files: number; additions: number; deletions: number };
    /** Surface native à ouvrir ou piloter. */
    surface?: MaestroSurface;
    /** Indique une association heuristique (transcript CLI ↔ terminal). */
    approximate?: boolean;
}

/** Référence courte d'un outil appelé dans un message (carte d'outil). */
export interface MaestroToolRef {
    name: string;
    title?: string;
    /** 'pending' | 'running' | 'completed' | 'error' */
    state?: string;
}

/** Un message rendu dans le détail d'une conversation. */
export interface MaestroMessage {
    id?: string;
    role: 'user' | 'assistant';
    /** Texte (markdown pour Fabi AI). */
    text: string;
    /** Outils appelés dans ce message. */
    tools?: MaestroToolRef[];
    /** Horodatage (ms epoch). */
    ts?: number;
}

/** État complet poussé au frontend à chaque changement (idempotent). */
export interface MaestroSnapshot {
    /** Cycle de vie du sidecar OpenCode (source des chats Fabi AI). */
    engine: 'starting' | 'ready' | 'error' | 'stopped';
    /** Tous les agents supervisés, triés du plus récemment actif au plus ancien. */
    agents: MaestroAgent[];
}

/** Client poussé par le backend vers le frontend. */
export interface FabiMaestroClient {
    /** Nouvel état agrégé (le widget réduit tout à partir de ça). */
    onSnapshot(snapshot: MaestroSnapshot): void;
}

/**
 * Service backend (Node) du tableau de bord Maestro. Le frontend l'appelle via
 * RPC et reçoit les pushs via FabiMaestroClient.
 */
export interface FabiMaestroService {
    /** Enregistre le client (appelé par le handler RPC à la connexion). */
    setClient(client: FabiMaestroClient | undefined): void;

    /**
     * Démarre la supervision (idempotent) — appelé quand le dashboard s'ouvre.
     * Retourne l'état courant pour l'amorçage immédiat.
     */
    start(): Promise<MaestroSnapshot>;

    /** État agrégé courant (amorçage / re-synchronisation). */
    getSnapshot(): Promise<MaestroSnapshot>;

    /**
     * Heartbeat d'un frontend de workspace. La liste remplace atomiquement le
     * précédent rapport de ce propriétaire. Une liste vide le retire.
     */
    reportOpenSurfaces(ownerId: string, surfaces: MaestroSurface[]): Promise<void>;

    /** Historique d'une conversation (pour le panneau de détail). */
    getConversation(key: string): Promise<MaestroMessage[]>;

    /**
     * Envoie un message à l'agent. Fabi AI → prompt OpenCode (la réponse arrive
     * en live via les snapshots) ; Claude/Codex → écrit dans le PTY (phase 2).
     */
    send(key: string, text: string): Promise<void>;

    /** Interrompt le tour en cours de l'agent. */
    abort(key: string): Promise<void>;

    /** Répond à une permission Fabi/OpenCode en attente. */
    replyPermission(key: string, allow: boolean): Promise<void>;

    /** État d'installation du bridge de hooks CLI. */
    getHooksStatus(): Promise<MaestroHooksStatus>;

    /**
     * Installe les hooks gérés dans ~/.claude et ~/.codex. Cette mutation globale
     * n'est exécutée qu'après une action explicite de l'utilisateur dans Maestro.
     */
    installHooks(): Promise<MaestroHooksStatus>;
}

/**
 * Canaux Electron dédiés au routage Maestro. Le preload n'expose que cette
 * petite surface, jamais ipcRenderer directement.
 */
export namespace MaestroHostIpc {
    export const CONTEXT = 'fabi-maestro:host-context';
    export const OPEN_SURFACE = 'fabi-maestro:open-surface';
    export const PREVIEW_SURFACE = 'fabi-maestro:preview-surface';
    export const CLEAR_PREVIEW = 'fabi-maestro:clear-preview';
    export const SEND_TO_SURFACE = 'fabi-maestro:send-to-surface';
    export const ACTIVATE_SURFACE = 'fabi-maestro:activate-surface';
    export const WRITE_TERMINAL = 'fabi-maestro:write-terminal';
}
