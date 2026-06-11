import '../../src/browser/style/fabi-swarm.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import {
    WidgetFactory, FrontendApplicationContribution, bindViewContribution
} from '@theia/core/lib/browser';
import { FabiSwarmService } from '../common/fabi-swarm-protocol';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { FabiSwarmWidget } from './fabi-swarm-widget';
import { FabiSwarmViewContribution } from './fabi-swarm-view-contribution';
import { FabiSwarmModelContribution } from './fabi-swarm-model';

export default new ContainerModule(bind => {
    // Façade frontend : proxy RPC client-aware + Events. Singleton partagé.
    bind(FabiSwarmFrontend).toSelf().inSingletonScope();
    bind(FabiSwarmService).toDynamicValue(ctx => ctx.container.get(FabiSwarmFrontend).service).inSingletonScope();

    // Panneau Fabi Swarm.
    bind(FabiSwarmWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: FabiSwarmWidget.ID,
        createWidget: () => ctx.container.get(FabiSwarmWidget)
    })).inSingletonScope();

    bindViewContribution(bind, FabiSwarmViewContribution);
    bind(FrontendApplicationContribution).toService(FabiSwarmViewContribution);

    // Enregistrement dynamique du modèle OpenAI-compatible (swarm actif → chat IA).
    bind(FabiSwarmModelContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(FabiSwarmModelContribution);
});
