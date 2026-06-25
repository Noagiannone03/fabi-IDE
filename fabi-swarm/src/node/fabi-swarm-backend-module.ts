import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
    FabiSwarmService, FabiSwarmClient, FABI_SWARM_SERVICE_PATH
} from '../common/fabi-swarm-protocol';
import {
    FabiCodeService, FabiCodeClient, FABI_CODE_SERVICE_PATH
} from '../common/fabi-code-protocol';
import {
    FabiMaestroService, FabiMaestroClient, FABI_MAESTRO_SERVICE_PATH, FABI_MAESTRO_REPORTER_PATH
} from '../common/fabi-maestro-protocol';
import { FabiSwarmServiceImpl } from './fabi-swarm-service';
import { FabiCodeServiceImpl } from './fabi-code-service';
import { FabiMaestroServiceImpl } from './fabi-maestro-service';

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

    // --- Tableau de bord Maestro (supervision des agents IA) ---
    // Service singleton qui agrège l'état de tous les chats (sidecar OpenCode) et
    // le pousse au frontend du Space Maestro. Se branche en LECTURE sur le sidecar
    // via FabiCodeService (mêmes baseUrl/sessions) sans toucher au chemin de chat.
    bind(FabiMaestroServiceImpl).toSelf().inSingletonScope();
    bind(FabiMaestroService).toService(FabiMaestroServiceImpl);
    // Démarrage backend : installe les hooks Claude/Codex automatiquement.
    bind(BackendApplicationContribution).toService(FabiMaestroServiceImpl);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler<FabiMaestroClient>(FABI_MAESTRO_SERVICE_PATH, client => {
            const service = ctx.container.get<FabiMaestroServiceImpl>(FabiMaestroService);
            service.setClient(client);
            return service;
        })
    ).inSingletonScope();
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(FABI_MAESTRO_REPORTER_PATH, () =>
            ctx.container.get<FabiMaestroServiceImpl>(FabiMaestroService)
        )
    ).inSingletonScope();
});
