import '../../src/browser/style/fabi-swarm.css';
import '../../src/browser/style/fabi-welcome.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';
import { AIActivationService } from '@theia/ai-core/lib/browser';
import { ChatWelcomeMessageProvider } from '@theia/ai-chat-ui/lib/browser/chat-tree-view';
import { ChatSessionsWelcomeMessageProvider } from '@theia/ai-ide/lib/browser/chat-sessions-welcome-message-provider';
import { FabiSwarmService } from '../common/fabi-swarm-protocol';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { FabiSwarmModelContribution } from './fabi-swarm-model';
import { FabiChatInputWidget } from './fabi-chat-input-widget';
import { FabiAIActivationService } from './fabi-ai-activation';
import { FabiWelcomeMessageProvider } from './fabi-welcome-provider';
import { FabiChatHeaderContribution } from './fabi-chat-header';

// Renomme le panneau IA « AI Chat » → « Fabi AI ». LABEL est le champ statique
// utilisé par ChatViewWidget pour son titre/caption ; on le change au chargement
// du module (avant toute création de widget).
ChatViewWidget.LABEL = 'Fabi AI';

// Ce module est chargé APRÈS @theia/ai-ide (déclaré en dépendance de fabi-swarm) :
// Theia ordonne les ContainerModule topologiquement → nos rebind/unbind passent
// par-dessus ceux d'ai-ide de façon déterministe.
export default new ContainerModule((bind, unbind, isBound, rebind) => {
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

    // --- IA toujours active (cf. fabi-ai-activation) ---
    // ai-ide rebinde déjà AIActivationService sur une impl pilotée par préférence
    // (désactivée par défaut). On repasse par-dessus avec la nôtre, toujours active.
    bind(FabiAIActivationService).toSelf().inSingletonScope();
    rebind(AIActivationService).toService(FabiAIActivationService);
    bind(FrontendApplicationContribution).toService(FabiAIActivationService);

    // --- Écran d'accueil du chat ---
    // ai-ide binde DEUX ChatWelcomeMessageProvider sur ce token (le robot +
    // « Recent Chats »), et la vue les EMPILE tous. On retire tout puis on
    // recompose : notre provider Fabi (illustration P2P + explication) À LA PLACE
    // du robot, et on re-binde « Recent Chats » tel quel (restylé en CSS).
    if (isBound(ChatWelcomeMessageProvider)) {
        unbind(ChatWelcomeMessageProvider);
    }
    bind(ChatWelcomeMessageProvider).to(FabiWelcomeMessageProvider).inSingletonScope();
    bind(ChatWelcomeMessageProvider).to(ChatSessionsWelcomeMessageProvider).inSingletonScope();

    // --- En-tête du panneau IA épuré (cf. fabi-chat-header) : ne garde que
    // « Nouveau chat » et « Historique ». Chargé après ai-chat-ui → unregister OK.
    bind(FabiChatHeaderContribution).toSelf().inSingletonScope();
    bind(TabBarToolbarContribution).toService(FabiChatHeaderContribution);
});
