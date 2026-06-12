import '../../src/browser/style/fabi-swarm.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { FabiSwarmService } from '../common/fabi-swarm-protocol';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { FabiSwarmModelContribution } from './fabi-swarm-model';
import { FabiChatInputWidget } from './fabi-chat-input-widget';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    // Façade frontend : proxy RPC client-aware + Events. Singleton partagé.
    bind(FabiSwarmFrontend).toSelf().inSingletonScope();
    bind(FabiSwarmService).toDynamicValue(ctx => ctx.container.get(FabiSwarmFrontend).service).inSingletonScope();

    // Enregistrement dynamique du modèle OpenAI-compatible (swarm actif → chat IA).
    bind(FabiSwarmModelContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(FabiSwarmModelContribution);

    // Pas de panneau séparé : on intègre le sélecteur DANS l'input du chat IA.
    // On sous-classe AIChatInputWidget et on rebind → la WidgetFactory de Theia
    // (qui fait container.get(AIChatInputWidget)) instancie la nôtre.
    rebind(AIChatInputWidget).to(FabiChatInputWidget);
});
