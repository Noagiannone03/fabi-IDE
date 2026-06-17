import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
    FabiSwarmService, FabiSwarmClient, SwarmEntry, WorkerState, RuntimeStatus,
    ConnectionInfo, FABI_REGISTRY_URL
} from '../common/fabi-swarm-protocol';
import { spawnWorker, fetchSchedulerPeer, WorkerHandle } from './fabi-swarm-worker';
import { FabiRuntimeManager } from './fabi-runtime-manager';
import { RegistryFeed } from './fabi-registry';
import { deriveConnection } from './fabi-connection';
import { getAccountToken } from './fabi-account-token';

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
    protected connection: ConnectionInfo = deriveConnection(undefined, { kind: 'stopped' });

    setClient(client: FabiSwarmClient | undefined): void {
        this.client = client;
        if (client) {
            this.ensureFeed();
            client.onSwarmsChanged(this.feed?.snapshot() ?? []);
            client.onWorkerStateChanged(this.workerState);
            client.onActiveSwarmChanged(this.activeSwarm);
            client.onRuntimeStatusChanged(this.runtime.status());
            client.onConnectionChanged(this.connection);
        }
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
        this.connection = deriveConnection(this.activeSwarm, this.workerState);
        this.client?.onConnectionChanged(this.connection);
    }

    protected setWorkerState(state: WorkerState): void {
        this.workerState = state;
        this.client?.onWorkerStateChanged(state);
        this.recomputeConnection();
    }

    protected setActiveSwarm(swarm: SwarmEntry | undefined): void {
        this.activeSwarm = swarm;
        this.client?.onActiveSwarmChanged(swarm);
        this.recomputeConnection();
    }

    // ----- connexion / déconnexion -----

    async connectSwarm(swarmId: string): Promise<WorkerState> {
        if (this.switching) {
            return this.workerState;
        }
        if (this.activeSwarm?.id === swarmId
            && (this.workerState.kind === 'running' || this.workerState.kind === 'starting')) {
            return this.workerState;
        }

        const swarms = await this.listSwarms();
        const swarm = swarms.find(s => s.id === swarmId);
        if (!swarm) {
            this.setWorkerState({ kind: 'error', message: `swarm "${swarmId}" introuvable dans le registry` });
            return this.workerState;
        }

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
