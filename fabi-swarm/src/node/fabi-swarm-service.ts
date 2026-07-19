import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import {
    FabiSwarmService, FabiSwarmClient, SwarmEntry, WorkerState, RuntimeStatus,
    ConnectionInfo, FABI_REGISTRY_URL
} from '../common/fabi-swarm-protocol';
import { spawnWorker, fetchSchedulerPeer, WorkerHandle } from './fabi-swarm-worker';
import { FabiRuntimeManager } from './fabi-runtime-manager';
import { RegistryFeed } from './fabi-registry';
import { deriveConnection, requireContribution } from './fabi-connection';
import { getAccountToken } from './fabi-account-token';
import { FabiMetricsCollector } from './fabi-metrics';
import { FabiMetrics } from '../common/fabi-swarm-protocol';

const SWARM_STATE_PATH = join(homedir(), '.config', 'fabi', 'swarm-state.json');

interface PersistedSwarmState {
    activeSwarmId?: string;
}

interface ReadyWaiter {
    resolve: (connection: ConnectionInfo) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface ContributionAccess {
    allowed: boolean;
    reason: string;
    eligibleWorkers: number;
    activeRequests: number;
    maxConcurrentRequests: number;
}

const UNKNOWN_CONTRIBUTION: ContributionAccess = {
    allowed: false,
    reason: 'unchecked',
    eligibleWorkers: 0,
    activeRequests: 0,
    maxConcurrentRequests: 0
};
const CONTRIBUTION_RETRY_MS = 1_000;
const CONTRIBUTION_REVALIDATE_MS = 5_000;
const CONTRIBUTION_MAX_ATTEMPTS = 35;

/**
 * Implémentation backend : pilote le worker Parallax (rejoindre/quitter un
 * swarm), suit la liste des swarms via le registry+SSE, et dérive l'état de
 * connexion (assez de peers ? chargement ? prêt ?) à partir de DEUX flux PUSH —
 * l'entrée swarm poussée par SSE (état partagé : peers, capacité, statut) et les
 * events `[FABI]` du worker (état local : étape, couches, poids). AUCUN poll
 * côté client : le registry scanne les schedulers une fois et fan-out à tous.
 */
@injectable()
export class FabiSwarmServiceImpl implements FabiSwarmService, BackendApplicationContribution {

    protected client: FabiSwarmClient | undefined;
    protected readonly runtime = new FabiRuntimeManager();
    protected feed: RegistryFeed | undefined;

    protected handle: WorkerHandle | undefined;
    protected workerState: WorkerState = { kind: 'stopped' };
    protected activeSwarm: SwarmEntry | undefined;
    protected switching = false;
    protected autoReconnectInFlight = false;
    protected autoReconnectSettled = false;
    protected connection: ConnectionInfo = deriveConnection(undefined, { kind: 'stopped' });
    protected readonly readyWaiters = new Set<ReadyWaiter>();
    protected contribution: ContributionAccess = { ...UNKNOWN_CONTRIBUTION };
    protected contributionCheckInFlight = false;
    protected contributionCheckAttempts = 0;
    protected contributionRetry: ReturnType<typeof setTimeout> | undefined;
    protected contributionEpoch = 0;

    protected metrics: FabiMetricsCollector | undefined;

    setClient(client: FabiSwarmClient | undefined): void {
        this.client = client;
        if (client) {
            this.ensureFeed();
            this.ensureMetrics();
            client.onSwarmsChanged(this.feed?.snapshot() ?? []);
            client.onWorkerStateChanged(this.workerState);
            client.onActiveSwarmChanged(this.activeSwarm);
            client.onRuntimeStatusChanged(this.runtime.status());
            client.onConnectionChanged(this.connection);
            const m = this.metrics?.getLatest();
            if (m) {
                client.onMetricsChanged(m);
            }
            this.tryAutoReconnect(this.feed?.snapshot() ?? []);
        }
    }

    /** Démarre le moniteur de perfs (machine + worker) une fois, à la connexion
     *  du frontend. Pousse chaque échantillon via onMetricsChanged (zéro polling
     *  côté client). isWorkerRunning gate la sonde process (la plus lourde). */
    protected ensureMetrics(): void {
        if (this.metrics) {
            return;
        }
        this.metrics = new FabiMetricsCollector(
            m => this.client?.onMetricsChanged(m),
            () => this.workerState.kind === 'running'
        );
        this.metrics.start();
    }

    async getMetrics(): Promise<FabiMetrics | undefined> {
        this.ensureMetrics();
        return this.metrics?.getLatest();
    }

    protected ensureFeed(): void {
        if (this.feed) {
            return;
        }
        this.feed = new RegistryFeed(FABI_REGISTRY_URL, swarms => {
            this.client?.onSwarmsChanged(swarms);
            // L'entrée du swarm actif a peut-être bougé (peers, statut, capacité)
            // → on rafraîchit la copie et on recalcule l'état de connexion. C'est
            // CE flux SSE qui remplace le polling du scheduler.
            if (this.activeSwarm) {
                const updated = swarms.find(s => s.id === this.activeSwarm!.id);
                if (updated) {
                    this.activeSwarm = updated;
                    this.client?.onActiveSwarmChanged(updated);
                    this.recomputeConnection();
                }
            }
            this.tryAutoReconnect(swarms);
        });
        this.feed.start();
    }

    async listSwarms(): Promise<SwarmEntry[]> {
        this.ensureFeed();
        return this.feed?.snapshot() ?? [];
    }

    async getActiveSwarm(): Promise<SwarmEntry | undefined> {
        return this.activeSwarm;
    }

    async getWorkerState(): Promise<WorkerState> {
        return this.workerState;
    }

    async getConnection(): Promise<ConnectionInfo> {
        return this.connection;
    }

    async waitUntilReady(timeoutMs = 120_000): Promise<ConnectionInfo> {
        if (this.connection.ready) {
            return this.connection;
        }
        if (!this.activeSwarm && this.connection.reason === 'pick-model') {
            throw new Error('Aucun modèle Fabi sélectionné: choisis un swarm avant de lancer le chat.');
        }
        const boundedTimeout = Math.max(1_000, Math.min(timeoutMs, 300_000));
        return new Promise<ConnectionInfo>((resolve, reject) => {
            const waiter: ReadyWaiter = {
                resolve,
                reject,
                timer: setTimeout(() => {
                    this.readyWaiters.delete(waiter);
                    reject(new Error(
                        `Le swarm Fabi n'est pas prêt après ${Math.round(boundedTimeout / 1000)} s: `
                        + `${this.connection.headline}: ${this.connection.activity}`
                    ));
                }, boundedTimeout)
            };
            waiter.timer.unref?.();
            this.readyWaiters.add(waiter);
            // Ferme la course entre le test initial et l'inscription du waiter.
            if (this.connection.ready) {
                this.resolveReadyWaiters();
            }
        });
    }

    async getRuntimeStatus(): Promise<RuntimeStatus> {
        return this.runtime.status();
    }

    async getAccountToken(): Promise<string> {
        return getAccountToken();
    }

    async installRuntime(): Promise<RuntimeStatus> {
        return this.runtime.ensureRuntime(s => this.client?.onRuntimeStatusChanged(s));
    }

    // ----- dérivation + push de l'état de connexion (worker + SSE) -----

    protected recomputeConnection(): void {
        const transport = deriveConnection(this.activeSwarm, this.workerState);
        if (transport.ready && !this.contribution.allowed) {
            this.connection = requireContribution(
                transport,
                this.contribution,
                this.contributionCheckAttempts >= CONTRIBUTION_MAX_ATTEMPTS
            );
            this.ensureContributionCheck();
        } else {
            this.connection = transport;
            if (!transport.ready) {
                this.cancelContributionCheck();
            }
        }
        this.client?.onConnectionChanged(this.connection);
        if (this.connection.ready) {
            this.resolveReadyWaiters();
        }
    }

    protected cancelContributionCheck(reset = false): void {
        if (this.contributionRetry) {
            clearTimeout(this.contributionRetry);
            this.contributionRetry = undefined;
        }
        if (reset) {
            this.contributionEpoch += 1;
            this.contribution = { ...UNKNOWN_CONTRIBUTION };
            this.contributionCheckAttempts = 0;
        }
    }

    protected ensureContributionCheck(revalidate = false): void {
        if (this.contributionCheckInFlight || this.contributionRetry
            || (this.contribution.allowed && !revalidate)
            || this.contributionCheckAttempts >= CONTRIBUTION_MAX_ATTEMPTS
            || !deriveConnection(this.activeSwarm, this.workerState).ready) {
            return;
        }
        const epoch = this.contributionEpoch;
        this.contributionCheckInFlight = true;
        this.contributionCheckAttempts += 1;
        void this.fetchContributionAccess().then(access => {
            if (epoch === this.contributionEpoch) {
                this.contribution = access;
            }
        }).catch(() => {
            if (epoch === this.contributionEpoch) {
                this.contribution = { ...UNKNOWN_CONTRIBUTION, reason: 'status_unavailable' };
            }
        }).finally(() => {
            this.contributionCheckInFlight = false;
            if (epoch !== this.contributionEpoch) {
                this.recomputeConnection();
                return;
            }
            if (deriveConnection(this.activeSwarm, this.workerState).ready
                && (this.contribution.allowed
                    || this.contributionCheckAttempts < CONTRIBUTION_MAX_ATTEMPTS)) {
                const revalidate = this.contribution.allowed;
                if (revalidate) {
                    this.contributionCheckAttempts = 0;
                }
                this.contributionRetry = setTimeout(() => {
                    this.contributionRetry = undefined;
                    this.ensureContributionCheck(revalidate);
                }, revalidate ? CONTRIBUTION_REVALIDATE_MS : CONTRIBUTION_RETRY_MS);
                this.contributionRetry.unref?.();
            }
            this.recomputeConnection();
        });
    }

    protected async fetchContributionAccess(): Promise<ContributionAccess> {
        const swarm = this.activeSwarm;
        if (!swarm?.schedulerUrl) {
            return { ...UNKNOWN_CONTRIBUTION, reason: 'no_scheduler' };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        timer.unref?.();
        try {
            const response = await fetch(`${swarm.schedulerUrl.replace(/\/+$/, '')}/v1/contribution/status`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${getAccountToken()}` },
                signal: controller.signal
            });
            if (!response.ok) {
                throw new Error(`contribution status HTTP ${response.status}`);
            }
            const raw = await response.json() as Record<string, unknown>;
            const numberField = (name: string): number => {
                const value = raw[name];
                return typeof value === 'number' && Number.isFinite(value) ? value : 0;
            };
            return {
                allowed: raw.allowed === true,
                reason: typeof raw.reason === 'string' ? raw.reason : 'invalid_response',
                eligibleWorkers: numberField('eligible_workers'),
                activeRequests: numberField('active_requests'),
                maxConcurrentRequests: numberField('max_concurrent_requests')
            };
        } finally {
            clearTimeout(timer);
        }
    }

    protected resolveReadyWaiters(): void {
        for (const waiter of this.readyWaiters) {
            clearTimeout(waiter.timer);
            waiter.resolve(this.connection);
        }
        this.readyWaiters.clear();
    }

    protected setWorkerState(state: WorkerState): void {
        const identityChanged = state.swarmId !== this.workerState.swarmId
            || state.kind !== this.workerState.kind
            || state.stage !== this.workerState.stage;
        this.workerState = state;
        if (identityChanged) {
            this.cancelContributionCheck(true);
        }
        this.client?.onWorkerStateChanged(state);
        this.recomputeConnection();
    }

    protected setActiveSwarm(swarm: SwarmEntry | undefined): void {
        if (swarm?.id !== this.activeSwarm?.id) {
            this.cancelContributionCheck(true);
        }
        this.activeSwarm = swarm;
        this.client?.onActiveSwarmChanged(swarm);
        this.recomputeConnection();
    }

    protected readPersistedSwarmId(): string | undefined {
        try {
            if (!existsSync(SWARM_STATE_PATH)) {
                return undefined;
            }
            const parsed = JSON.parse(readFileSync(SWARM_STATE_PATH, 'utf-8')) as PersistedSwarmState;
            const id = typeof parsed.activeSwarmId === 'string' ? parsed.activeSwarmId.trim() : '';
            return id || undefined;
        } catch {
            return undefined;
        }
    }

    protected persistSwarmId(swarmId: string): void {
        try {
            mkdirSync(dirname(SWARM_STATE_PATH), { recursive: true });
            writeFileSync(SWARM_STATE_PATH, JSON.stringify({ activeSwarmId: swarmId }, undefined, 2) + '\n', 'utf-8');
            try {
                chmodSync(SWARM_STATE_PATH, 0o600);
            } catch {
                /* chmod best-effort (Windows/NTFS). */
            }
        } catch {
            /* Un état non persisté ne doit jamais empêcher la connexion. */
        }
    }

    protected clearPersistedSwarmId(): void {
        try {
            rmSync(SWARM_STATE_PATH, { force: true });
        } catch {
            /* best-effort */
        }
    }

    protected tryAutoReconnect(swarms: SwarmEntry[]): void {
        if (this.autoReconnectSettled || this.autoReconnectInFlight || this.switching
            || this.activeSwarm || this.workerState.kind !== 'stopped' || swarms.length === 0) {
            return;
        }
        this.autoReconnectInFlight = true;
        try {
            const swarmId = this.readPersistedSwarmId();
            if (!swarmId) {
                this.autoReconnectSettled = true;
                return;
            }
            if (!swarms.some(s => s.id === swarmId)) {
                return;
            }
            this.autoReconnectSettled = true;
            void this.connectSwarm(swarmId).catch(e => {
                this.setWorkerState({ kind: 'error', swarmId, message: e instanceof Error ? e.message : String(e) });
            });
        } finally {
            this.autoReconnectInFlight = false;
        }
    }

    // ----- connexion / déconnexion -----

    async connectSwarm(swarmId: string): Promise<WorkerState> {
        if (this.switching) {
            return this.workerState;
        }
        if (this.activeSwarm?.id === swarmId
            && (this.workerState.kind === 'running' || this.workerState.kind === 'starting')) {
            this.persistSwarmId(swarmId);
            this.autoReconnectSettled = true;
            return this.workerState;
        }

        const swarms = await this.listSwarms();
        const swarm = swarms.find(s => s.id === swarmId);
        if (!swarm) {
            this.setWorkerState({ kind: 'error', message: `swarm "${swarmId}" introuvable dans le registry` });
            return this.workerState;
        }

        this.persistSwarmId(swarm.id);
        this.autoReconnectSettled = true;

        const found = this.runtime.findParallax();
        if (!found) {
            this.setActiveSwarm(swarm);
            this.setWorkerState({
                kind: 'missing-binary', swarmId,
                message: 'Moteur Fabi non installé. Clique « Installer le moteur ».'
            });
            return this.workerState;
        }

        this.switching = true;
        try {
            if (this.handle) {
                await this.handle.stop();
                this.handle = undefined;
            }
            this.setActiveSwarm(swarm);
            this.setWorkerState({ kind: 'starting', swarmId });

            // Peer du scheduler : registry > status_json live (appel ponctuel, pas un poll).
            let peer = swarm.schedulerPeer ?? undefined;
            if (!peer) {
                peer = await fetchSchedulerPeer(swarm.schedulerUrl);
            }
            if (!peer) {
                this.setWorkerState({ kind: 'error', swarmId, message: 'aucun peer scheduler pour ce swarm' });
                return this.workerState;
            }

            // Le worker pilote ensuite son propre état (running → étapes → crash/restart).
            this.handle = spawnWorker(found.binary, peer, swarmId, s => this.setWorkerState(s));
        } catch (e) {
            this.setWorkerState({ kind: 'error', swarmId, message: e instanceof Error ? e.message : String(e) });
        } finally {
            this.switching = false;
        }
        return this.workerState;
    }

    async disconnect(): Promise<WorkerState> {
        this.autoReconnectSettled = true;
        this.clearPersistedSwarmId();
        if (this.handle) {
            await this.handle.stop();
            this.handle = undefined;
        }
        this.setActiveSwarm(undefined);
        this.setWorkerState({ kind: 'stopped' });
        return this.workerState;
    }

    /**
     * Arrêt PROPRE quand l'IDE se ferme (BackendApplicationContribution.onStop).
     *
     * Theia capte SIGINT/SIGTERM, puis dans sa séquence d'arrêt il **attend** les
     * `onStop()` des contributions AVANT d'appeler `terminateProcessTree()` qui
     * tue tout l'arbre de process (dont notre worker, enfant par PPID — `detached`
     * ne change que le groupe, pas le lien parent). Sans ce hook, le worker se
     * ferait SIGKILL par l'arbre avant d'avoir envoyé son `node_leave` → nœud
     * fantôme (rattrapé seulement ~25 s plus tard par l'éviction heartbeat).
     *
     * En attendant `handle.stop()` ici, on garantit que le worker reçoit SIGTERM
     * et termine son `node_leave` (dans la fenêtre de grâce) AVANT que Theia ne
     * coupe l'arbre → déconnexion propre du swarm à chaque fermeture de l'IDE.
     * (`process.on('exit')` côté worker reste le dernier filet pour les cas durs.)
     */
    async onStop(): Promise<void> {
        this.cancelContributionCheck();
        this.metrics?.stop();
        for (const waiter of this.readyWaiters) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error('Fabi IDE est en cours de fermeture.'));
        }
        this.readyWaiters.clear();
        if (this.handle) {
            try {
                await this.handle.stop();
            } catch {
                /* arrêt best-effort : on ne bloque jamais la fermeture de l'IDE */
            }
            this.handle = undefined;
        }
    }
}
