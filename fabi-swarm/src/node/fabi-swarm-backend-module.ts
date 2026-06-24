import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
    FabiSwarmService, FabiSwarmClient, FABI_SWARM_SERVICE_PATH
} from '../common/fabi-swarm-protocol';
import {
    FabiCodeService, FabiCodeClient, FABI_CODE_SERVICE_PATH
} from '../common/fabi-code-protocol';
import { FabiSwarmServiceImpl } from './fabi-swarm-service';
import { FabiCodeServiceImpl } from './fabi-code-service';

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

    // --- Moteur d'agent IA fabi-code (sidecar OpenCode) ---
    // Tout le cerveau IA (agents, prompts, modèles, contexte, outils) vit dans
    // OpenCode, lancé en sidecar par ce service. onStart spawn le serveur,
    // onStop le tue proprement (Theia attend ce onStop avant process.exit).
    bind(FabiCodeServiceImpl).toSelf().inSingletonScope();
    bind(FabiCodeService).toService(FabiCodeServiceImpl);
    bind(BackendApplicationContribution).toService(FabiCodeServiceImpl);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler<FabiCodeClient>(FABI_CODE_SERVICE_PATH, client => {
            const service = ctx.container.get<FabiCodeServiceImpl>(FabiCodeService);
            service.setClient(client);
            return service;
        })
    ).inSingletonScope();
});
