import '../../src/browser/style/fabi-swarm.css';
import '../../src/browser/style/fabi-welcome.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';
import { AIChatContribution } from '@theia/ai-chat-ui/lib/browser/ai-chat-ui-contribution';
import { AIActivationService } from '@theia/ai-core/lib/browser';
import { ChatWelcomeMessageProvider } from '@theia/ai-chat-ui/lib/browser/chat-tree-view';
import { ChatSessionsWelcomeMessageProvider } from '@theia/ai-ide/lib/browser/chat-sessions-welcome-message-provider';
import { TerminalFrontendContribution } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { FabiSwarmService } from '../common/fabi-swarm-protocol';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { FabiSwarmModelContribution } from './fabi-swarm-model';
import { FabiChatInputWidget } from './fabi-chat-input-widget';
import { FabiAIActivationService } from './fabi-ai-activation';
import { FabiWelcomeMessageProvider } from './fabi-welcome-provider';
import { FabiChatHeaderContribution } from './fabi-chat-header';
import { FabiAIChatContribution } from './fabi-ai-chat-contribution';
import { FabiTerminalFrontendContribution } from './fabi-terminal-contribution';
import { FabiPanelDockContribution } from './fabi-panel-dock';
import { FabiEditorActionsContribution, FABI_CHAT_INSTANCE_FACTORY_ID } from './fabi-editor-actions';
import { FabiTabRenameContribution } from './fabi-tab-rename';
import { FabiMetricsStatusBar } from './fabi-metrics-statusbar';
import { FabiChatInstanceWidget } from './fabi-chat-instance-widget';

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

    // Moniteur de perfs (status bar bas-droite + modale détaillée).
    bind(FabiMetricsStatusBar).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(FabiMetricsStatusBar);

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

    // --- Panneaux en onglet de la zone de code par défaut ---
    // Le chat IA et les terminaux s'ouvrent en onglet de la zone d'édition (main)
    // plutôt qu'en dock (sidebar droite / panneau bas). On sous-classe les deux
    // contributions d'origine et on rebind : tous les tokens qui pointaient vers
    // elles (CommandContribution, FrontendApplicationContribution, TerminalService…)
    // résolvent désormais nos versions. Modules chargés avant fabi-swarm (dépendances
    // déclarées) → les rebind passent par-dessus de façon déterministe.
    rebind(AIChatContribution).to(FabiAIChatContribution).inSingletonScope();
    rebind(TerminalFrontendContribution).to(FabiTerminalFrontendContribution).inSingletonScope();

    // Bouton d'onglet « ancrer dans la sidebar / le panneau » ←→ « zone de code ».
    bind(FabiPanelDockContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(FabiPanelDockContribution);
    bind(TabBarToolbarContribution).toService(FabiPanelDockContribution);

    // --- Multi-instances (chat + terminal) ---
    // Factory de chats Fabi multi-instances : ChatViewWidget (+ son arbre et son
    // input FabiChatInputWidget) sont transient → chaque appel produit une vue de
    // chat indépendante. On lui donne un id unique pour cohabiter en zone d'édition.
    // Widget de chat épinglé (session indépendante) — transient → instance neuve à chaque get.
    bind(FabiChatInstanceWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: FABI_CHAT_INSTANCE_FACTORY_ID,
        createWidget: (options: { uid: number }) => {
            const widget = ctx.container.get(FabiChatInstanceWidget);
            widget.id = `${FABI_CHAT_INSTANCE_FACTORY_ID}:${options.uid}`;
            // Titre numéroté → les instances sont distinctes à l'œil dans la barre
            // d'onglets (deux chats vides étaient indiscernables). Renommable ensuite.
            const label = `Fabi AI ${options.uid}`;
            widget.title.label = label;
            widget.title.caption = label;
            widget.title.closable = true;
            return widget;
        }
    })).inSingletonScope();

    // Bouton « Fabi AI » (îlot) à droite de la barre d'onglets + nettoyage de la
    // sidebar droite au démarrage (onDidInitializeLayout).
    bind(FabiEditorActionsContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(FabiEditorActionsContribution);
    bind(TabBarToolbarContribution).toService(FabiEditorActionsContribution);
    bind(FrontendApplicationContribution).toService(FabiEditorActionsContribution);

    // Renommage des onglets (terminaux + chats IA) au clic droit.
    bind(FabiTabRenameContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(FabiTabRenameContribution);
    bind(MenuContribution).toService(FabiTabRenameContribution);
});
