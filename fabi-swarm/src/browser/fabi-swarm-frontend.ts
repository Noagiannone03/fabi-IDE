import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import { RemoteConnectionProvider, ServiceConnectionProvider } from '@theia/core/lib/browser';
import {
    FabiSwarmService, FabiSwarmClient, FABI_SWARM_SERVICE_PATH,
    SwarmEntry, WorkerState, RuntimeStatus, ConnectionInfo
} from '../common/fabi-swarm-protocol';

/**
 * Façade frontend : détient le proxy RPC vers le service backend ET implémente
 * le FabiSwarmClient (le backend appelle ces méthodes pour pousser des updates).
 * Re-expose ces pushs en Events Theia auxquels le widget et le provider
 * s'abonnent → zéro polling côté UI.
 */
@injectable()
export class FabiSwarmFrontend implements FabiSwarmClient {

    readonly service: FabiSwarmService;

    protected readonly swarmsEmitter = new Emitter<SwarmEntry[]>();
    protected readonly workerEmitter = new Emitter<WorkerState>();
    protected readonly activeEmitter = new Emitter<SwarmEntry | undefined>();
    protected readonly runtimeEmitter = new Emitter<RuntimeStatus>();
    protected readonly connectionEmitter = new Emitter<ConnectionInfo>();

    /** Dernières valeurs poussées (pour un rendu immédiat à l'attache). */
    swarms: SwarmEntry[] = [];
    worker: WorkerState = { kind: 'stopped' };
    active: SwarmEntry | undefined;
    runtime: RuntimeStatus | undefined;
    connection: ConnectionInfo | undefined;

    readonly onSwarmsChangedEvent: Event<SwarmEntry[]> = this.swarmsEmitter.event;
    readonly onWorkerChangedEvent: Event<WorkerState> = this.workerEmitter.event;
    readonly onActiveChangedEvent: Event<SwarmEntry | undefined> = this.activeEmitter.event;
    readonly onRuntimeChangedEvent: Event<RuntimeStatus> = this.runtimeEmitter.event;
    readonly onConnectionChangedEvent: Event<ConnectionInfo> = this.connectionEmitter.event;

    constructor(
        @inject(RemoteConnectionProvider) connectionProvider: ServiceConnectionProvider
    ) {
        // `this` est le client : ses méthodes onXxx deviennent appelables par le backend.
        this.service = connectionProvider.createProxy<FabiSwarmService>(FABI_SWARM_SERVICE_PATH, this);
    }

    // ----- FabiSwarmClient (poussé par le backend) -----
    onSwarmsChanged(swarms: SwarmEntry[]): void {
        this.swarms = swarms;
        this.swarmsEmitter.fire(swarms);
    }
    onWorkerStateChanged(state: WorkerState): void {
        this.worker = state;
        this.workerEmitter.fire(state);
    }
    onActiveSwarmChanged(swarm: SwarmEntry | undefined): void {
        this.active = swarm;
        this.activeEmitter.fire(swarm);
    }
    onRuntimeStatusChanged(status: RuntimeStatus): void {
        this.runtime = status;
        this.runtimeEmitter.fire(status);
    }
    onConnectionChanged(info: ConnectionInfo): void {
        this.connection = info;
        this.connectionEmitter.fire(info);
    }
}
