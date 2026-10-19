// Protocole frontend ⇄ backend de la supervision des agents IA.
//
// Le service backend (FabiMaestroService) agrège deux sources et pousse l'état
// à chaque frontend de Space (barre « Projets ») — zéro polling côté UI :
//   1. Les chats « Fabi AI » = les sessions du sidecar OpenCode (flux SSE global) ;
//   2. Les agents CLI (Claude Code, Codex) tournant dans un terminal, rattachés
//      via les hooks de ces CLI + l'arbre de process du terminal.

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
export interface MaestroToolObservation {
    at: number; sessionId: string; source: 'claude' | 'codex';
    origin?: 'hook' | 'rollout' | 'app-server'; eventId?: string;
    phase: 'started' | 'completed' | 'failed'; tool: string; path?: string;
}
export interface MaestroAgent {
    /** Timestamp of an explicit native turn lifecycle event (not file mtime). */
    activityAt?: number;
    turnStartedAt?: number;
    observations?: MaestroToolObservation[];
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
    /** Nature de l'attente remontée par les hooks CLI. */
    waitingKind?: MaestroWaitingKind;
    /** Résumé d'édition cumulé (fichiers/+/-), si fourni par OpenCode. */
    edits?: { files: number; additions: number; deletions: number };
    /** Surface native à ouvrir ou piloter. */
    surface?: MaestroSurface;
    /** Indique une association heuristique (transcript CLI ↔ terminal). */
    approximate?: boolean;
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
     * Heartbeat d'un frontend de workspace. La liste remplace atomiquement le
     * précédent rapport de ce propriétaire. Une liste vide le retire.
     */
    reportOpenSurfaces(ownerId: string, surfaces: MaestroSurface[]): Promise<void>;
}

/** Canal Electron (frontend de Space → main) : id du Space qui héberge ce frontend. */
export namespace MaestroHostIpc {
    export const CONTEXT = 'fabi-maestro:host-context';
}
