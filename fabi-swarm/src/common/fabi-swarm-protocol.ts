// Protocole partagé frontend ⇄ backend pour le provider Fabi Swarm.
//
// Le swarm est un réseau P2P d'inférence (fork de Parallax). Le worker local
// (`parallax join`) rejoint le swarm = on contribue notre GPU/RAM ; le scheduler
// Fabi expose une API OpenAI-compatible pour consommer l'inférence distribuée.
//
// Le registry (un service HTTP sur le VPS) liste TOUS les swarms dispos (un par
// modèle). L'IDE le lit pour proposer la liste des modèles, et s'abonne à son
// flux SSE pour les mises à jour live (peers qui rejoignent/quittent). Choisir
// un modèle = quitter l'ancien swarm et rejoindre le sien (on contribue toujours
// au modèle qu'on consomme → la porte « contribuer = consommer » est satisfaite).

export const FABI_SWARM_SERVICE_PATH = '/services/fabi-swarm';
export const FabiSwarmService = Symbol('FabiSwarmService');
export const FabiSwarmClient = Symbol('FabiSwarmClient');

/** Registry Fabi (prod) — liste les swarms et expose le flux SSE. */
export const FABI_REGISTRY_URL = 'https://server.undefinedstudio.fr/fabi-registry';
/** Repli si le registry est injoignable : un scheduler unique connu. */
export const FABI_FALLBACK_SCHEDULER_URL = 'https://server.undefinedstudio.fr/fabi-scheduler';
export const FABI_FALLBACK_SCHEDULER_PEER = '12D3KooWKLCTHRAhMEafQfaGZTAEx8kJjeMqpXDDeyhBGVotuSfR';
/** Modèle de repli si rien n'est annoncé. */
export const FABI_FALLBACK_MODEL = 'Qwen/Qwen3-1.7B';
/** Id du provider tel qu'enregistré dans Theia AI. */
export const FABI_MODEL_ID = 'fabi-swarm';

/**
 * Un swarm tel qu'annoncé par le registry (`GET /v1/swarms`). Miroir fidèle du
 * type `SwarmEntry` côté fabi-registry — ne pas diverger.
 */
export interface SwarmEntry {
    id: string;
    name: string;
    schedulerUrl: string;
    schedulerPeer: string | null;
    model: string;
    status: 'online' | 'offline' | 'unknown';
    /** Statut applicatif Parallax : 'waiting' (pipeline incomplet) | 'available'. */
    schedulerStatus: string | null;
    peers: number;
    totalVramGb: number;
    maxContextTokens?: number;
    // État riche d'orchestration, poussé par le registry via SSE (pas de poll client).
    needMoreNodes?: boolean;
    initNodesNum?: number;
    lastBootstrapResult?: string | null;
    nodesActive?: number;
    nodesInitializing?: number;
    /** Une pipeline complète existe, même si elle n'est pas encore prête à router. */
    pipelineCount?: number;
    /** Nombre de pipelines dont tous les nœuds sont prêts côté worker. */
    pipelineReadyCount?: number;
    /** Vrai seulement si une requête peut être routée maintenant. */
    pipelineReady?: boolean;
    routingReady?: boolean;
    pipelineCapacityTotal?: number;
    pipelineCapacityCurrent?: number;
    lastSeen: string;
    containerName?: string;
}

export type WorkerKind = 'stopped' | 'starting' | 'running' | 'missing-binary' | 'error';

/** Étape du worker, dérivée des events `[FABI] {...}` émis sur stdout. */
export type WorkerStage =
    | 'handshake'        // peer id obtenu, on contacte le scheduler
    | 'joining'          // join du scheduler en cours
    | 'loading-weights'  // couches allouées, téléchargement/chargement des poids
    | 'ready'            // poids chargés, le nœud sert l'inférence
    | 'alloc-timeout';   // le scheduler n'a pas pu allouer de couches (300s)

export interface WorkerState {
    kind: WorkerKind;
    pid?: number;
    message?: string;
    /** Id du swarm auquel ce worker est rattaché. */
    swarmId?: string;
    /** Détails live (events parallax) pour l'UI. */
    stage?: WorkerStage;
    peerId?: string;
    startLayer?: number;
    endLayer?: number;
    weightsFilesDone?: number;
    weightsFilesTotal?: number;
    weightsCurrentFile?: string;
}

/** État de connexion dérivé (worker + état swarm du registry) — pilote l'écran de connexion. */
export type ConnectionReason =
    | 'ready'                  // prêt à servir → on peut coder
    | 'pick-model'             // aucun swarm choisi
    | 'worker-missing-binary'  // moteur pas installé
    | 'worker-starting'        // process en démarrage
    | 'worker-crashed'         // worker mort → auto-restart
    | 'alloc-timeout'          // scheduler n'a pas alloué de couches (300s)
    | 'scheduler-unreachable'  // scheduler injoignable
    | 'connecting'             // handshake / join / découverte
    | 'need-more-peers'        // pas assez de nœuds pour bootstrapper
    | 'insufficient-capacity'  // assez de nœuds mais pipeline impossible
    | 'contribution-pending'   // pipeline prêt, admission du compte en confirmation
    | 'contribution-required'  // aucun worker prêt de ce compte n'est reconnu
    | 'loading-model';         // chargement des poids / peers en init

/** Présentation dérivée poussée à l'UI (écran de connexion fidèle au CLI). */
export interface ConnectionInfo {
    reason: ConnectionReason;
    ready: boolean;
    /** Titre court (« Connexion au swarm »…). */
    headline: string;
    /** Action réelle en cours (« connexion P2P »…). */
    activity: string;
    /** Détail/erreur éventuel. */
    detail?: string;
    peersActive?: number;
    peersTotal?: number;
    peersInitializing?: number;
    layersAssigned?: number;
    weightsDone?: number;
    weightsTotal?: number;
}

// Accélérateur du runtime de contribution (worker) :
//   mlx  → Apple Silicon (backend MLX)
//   cuda → NVIDIA, Linux ET Windows natif (backend vLLM ; wheels vLLM-Windows,
//          sans WSL) — même VLLMExecutor partout
//   cpu  → pas d'accélérateur supporté pour contribuer (consommer reste possible)
export type Accel = 'mlx' | 'cuda' | 'cpu';

/** État du runtime moteur (Parallax) géré par l'app. */
export interface RuntimeStatus {
    installed: boolean;
    downloading: boolean;
    /** % de progression du téléchargement/install (0-100), si en cours. */
    progress?: number;
    /** Phase courante de l'install (download / verify / extract). */
    phase?: 'download' | 'verify' | 'extract' | 'done';
    location: 'bundled' | 'cached' | 'none';
    platform: string;   // ex "windows-x64-cuda"
    accel: Accel;
    version: string;
    binary?: string;
    message?: string;
}

/**
 * Client poussé par le backend vers le frontend (pattern RPC Theia : le backend
 * appelle ces méthodes pour pousser des mises à jour sans polling).
 */
export interface FabiSwarmClient {
    /** Nouvelle liste de swarms (registry / SSE). */
    onSwarmsChanged(swarms: SwarmEntry[]): void;
    /** Le worker local a changé d'état/étape. */
    onWorkerStateChanged(state: WorkerState): void;
    /** Le swarm actif (celui qu'on consomme) a changé → re-câbler le provider. */
    onActiveSwarmChanged(swarm: SwarmEntry | undefined): void;
    /** Progression de l'install du runtime. */
    onRuntimeStatusChanged(status: RuntimeStatus): void;
    /** État de connexion dérivé (worker + scheduler) → écran de connexion. */
    onConnectionChanged(info: ConnectionInfo): void;
    /** Métriques live de la machine + du worker (moniteur de perfs). */
    onMetricsChanged(metrics: FabiMetrics): void;
}

/** Un process (ou groupe de process de même nom) qui consomme. */
export interface FabiProcInfo {
    name: string;
    cpu: number;    // % normalisé sur le nombre de cœurs (0–100)
    memGb: number;
    /** True = c'est NOTRE worker (process parallax agrégés). */
    isWorker: boolean;
}

/** Un point d'historique (pour les sparklines). */
export interface FabiMetricSample {
    /** Horodatage epoch ms. */
    t: number;
    /** Charge CPU système globale (0–100). */
    cpu: number;
    /** RAM utilisée (0–100). */
    mem: number;
    /** Charge CPU du worker (0–100, normalisée sur le nombre de cœurs). */
    worker: number;
}

/**
 * Photo des perfs machine + worker, poussée en live au frontend (moniteur).
 * Tout est best-effort : un champ peut manquer si l'OS ne l'expose pas (p.ex.
 * l'usage GPU live sur Apple Silicon n'est pas accessible sans privilèges).
 */
export interface FabiMetrics {
    t: number;
    system: {
        cpu: number;          // % charge CPU globale (0–100)
        cpuCores: number;
        memUsedGb: number;
        memTotalGb: number;
        memPct: number;       // 0–100
        gpu?: {
            name: string;
            usage?: number;     // 0–100 si dispo
            memUsedMb?: number;
            memTotalMb?: number;
        };
    };
    /** Conso de NOTRE worker (arbre de process parallax). null = pas de worker. */
    worker: null | {
        running: boolean;
        cpu: number;          // % normalisé sur le nombre de cœurs (0–100)
        cpuRaw: number;       // % brut (peut dépasser 100 sur multi-cœurs)
        memGb: number;        // RSS total de l'arbre
        procCount: number;
    };
    /** Pics observés depuis le démarrage du moniteur. */
    peaks: { cpu: number; memPct: number; workerCpu: number; workerMemGb: number };
    /** État de pression dérivé (couleur du badge). */
    pressure: 'normal' | 'elevated' | 'critical';
    /** Historique glissant (ancien → récent) pour les sparklines. */
    history: FabiMetricSample[];
    /** Top consommateurs (RAM), worker agrégé en une entrée. Pour « qui bouffe ». */
    topProcs: FabiProcInfo[];
}

/**
 * Service backend (Node) : il seul peut spawn le worker Parallax (sous-process
 * Python), interroger le registry/scheduler et installer le runtime. Le frontend
 * l'appelle via RPC et reçoit les pushs via le FabiSwarmClient.
 */
export interface FabiSwarmService {
    /** Enregistre le client (appelé par le handler RPC à la connexion). */
    setClient(client: FabiSwarmClient | undefined): void;

    /** Liste des swarms dispos (cache alimenté par le registry + SSE). */
    listSwarms(): Promise<SwarmEntry[]>;
    /** Le swarm actuellement actif (worker connecté + provider câblé). */
    getActiveSwarm(): Promise<SwarmEntry | undefined>;
    /**
     * Connecte le swarm `swarmId` : arrête le worker courant, rejoint le
     * scheduler de ce modèle, et bascule le provider dessus. Idempotent si déjà
     * connecté à ce swarm.
     */
    connectSwarm(swarmId: string): Promise<WorkerState>;
    /** Quitte le swarm actif (arrête le worker). */
    disconnect(): Promise<WorkerState>;

    /** État courant du worker. */
    getWorkerState(): Promise<WorkerState>;
    /** État de connexion dérivé courant (worker + scheduler). */
    getConnection(): Promise<ConnectionInfo>;
    /**
     * Attend le prochain état réellement routable, sans polling. La promesse est
     * réveillée directement par les mêmes événements worker/registry qui pilotent
     * l'UI. Elle rejette à l'expiration ou si aucun modèle n'est sélectionné.
     */
    waitUntilReady(timeoutMs?: number): Promise<ConnectionInfo>;
    /** État du runtime moteur (installé / en cours / absent). */
    getRuntimeStatus(): Promise<RuntimeStatus>;
    /** Télécharge/prépare le runtime moteur si absent (idempotent). */
    installRuntime(): Promise<RuntimeStatus>;
    /**
     * Jeton de compte Fabi (identité worker+conso, partagée avec le CLI). Sert
     * d'apiKey vers le scheduler ET d'identité du worker pour la porte de
     * contribution (« tu contribues = tu consommes »).
     */
    getAccountToken(): Promise<string>;

    /** Dernière photo de métriques (pour l'affichage initial). */
    getMetrics(): Promise<FabiMetrics | undefined>;
}
