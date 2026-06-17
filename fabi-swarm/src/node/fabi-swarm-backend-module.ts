import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
    FabiSwarmService, FabiSwarmClient, FABI_SWARM_SERVICE_PATH
} from '../common/fabi-swarm-protocol';
import { FabiSwarmServiceImpl } from './fabi-swarm-service';

export default new ContainerModule(bind => {
    bind(FabiSwarmServiceImpl).toSelf().inSingletonScope();
    bind(FabiSwarmService).toService(FabiSwarmServiceImpl);
    // Arrêt propre à la fermeture de l'IDE : Theia ATTEND ce onStop() avant de
    // tuer l'arbre de process → le worker a le temps d'envoyer son node_leave
    // (cf. FabiSwarmServiceImpl.onStop). Évite les nœuds fantômes au quit.
    bind(BackendApplicationContribution).toService(FabiSwarmServiceImpl);
    // Handler RPC client-aware : le frontend fournit un FabiSwarmClient que le
    // backend appelle pour pousser swarms/worker/runtime (sans polling).
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler<FabiSwarmClient>(FABI_SWARM_SERVICE_PATH, client => {
            const service = ctx.container.get<FabiSwarmServiceImpl>(FabiSwarmService);
            service.setClient(client);
            return service;
        })
    ).inSingletonScope();
});
