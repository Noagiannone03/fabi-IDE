import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import { RemoteConnectionProvider, ServiceConnectionProvider } from '@theia/core/lib/browser';
import {
    FabiMaestroService, FabiMaestroClient, FABI_MAESTRO_SERVICE_PATH, MaestroSnapshot
} from '../../common/fabi-maestro-protocol';

/**
 * Façade frontend du tableau de bord Maestro : détient le proxy RPC vers le
 * service backend ET implémente FabiMaestroClient (le backend pousse les snapshots
 * agrégés). Ré-expose en Event Theia → le widget s'y abonne, zéro polling.
 *
 * Injectée UNIQUEMENT par le widget Maestro → la connexion RPC (et donc l'attache
 * du client + le démarrage de la supervision) n'a lieu que dans le Space Maestro.
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
