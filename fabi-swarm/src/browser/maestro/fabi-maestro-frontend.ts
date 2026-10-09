import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import { RemoteConnectionProvider, ServiceConnectionProvider } from '@theia/core/lib/browser';
import {
    FabiMaestroService, FabiMaestroClient, FABI_MAESTRO_SERVICE_PATH, MaestroSnapshot
} from '../../common/fabi-maestro-protocol';

/**
 * Façade frontend de la supervision des agents : implémente FabiMaestroClient
 * (le backend pousse les snapshots agrégés) et les ré-expose en Event Theia.
 * La barre « Projets » s'y abonne — zéro polling.
 */
@injectable()
export class FabiMaestroFrontend implements FabiMaestroClient {

    readonly service: FabiMaestroService;

    protected readonly snapshotEmitter = new Emitter<MaestroSnapshot>();
    readonly onSnapshotEvent: Event<MaestroSnapshot> = this.snapshotEmitter.event;

    /** Dernier snapshot reçu (rendu immédiat). */
    last: MaestroSnapshot = { engine: 'starting', agents: [] };

    constructor(
        @inject(RemoteConnectionProvider) connectionProvider: ServiceConnectionProvider
    ) {
        this.service = connectionProvider.createProxy<FabiMaestroService>(FABI_MAESTRO_SERVICE_PATH, this);
    }

    onSnapshot(snapshot: MaestroSnapshot): void {
        this.last = snapshot;
        this.snapshotEmitter.fire(snapshot);
    }
}
