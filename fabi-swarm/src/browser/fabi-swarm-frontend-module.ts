import { SWARM_ENGINE_ENABLED } from '../common/fabi-product-features';
import '../../src/browser/style/fabi-swarm.css';
import '../../src/browser/style/fabi-welcome.css';
import '../../src/browser/style/fabi-agent-midnight.css';
import '../../src/browser/style/fabi-projects.css';
import '../../src/browser/style/fabi-scm.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { FrontendApplicationContribution, RemoteConnectionProvider, ServiceConnectionProvider, WidgetFactory } from '@theia/core/lib/browser';
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
import { FabiChatInputWidget } from './fabi-chat-input-widget';
import { FabiAIActivationService } from './fabi-ai-activation';
import { FabiWelcomeMessageProvider } from './fabi-welcome-provider';
import { FabiChatHeaderContribution } from './fabi-chat-header';
import { FabiAIChatContribution } from './fabi-ai-chat-contribution';
import { FabiTerminalFrontendContribution } from './fabi-terminal-contribution';
import { FabiTerminalWidget } from './fabi-terminal-widget';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { FabiPanelDockContribution } from './fabi-panel-dock';
import { FabiEditorActionsContribution, FABI_CHAT_INSTANCE_FACTORY_ID } from './fabi-editor-actions';
import { FabiTabRenameContribution } from './fabi-tab-rename';
import { FabiMetricsStatusBar } from './fabi-metrics-statusbar';
import { FabiChatInstanceWidget } from './fabi-chat-instance-widget';
import { Agent } from '@theia/ai-core/lib/common/agent';
import { ChatAgent } from '@theia/ai-chat/lib/common/chat-agents';
import { DefaultChatAgentId } from '@theia/ai-chat/lib/common/chat-agent-service';
import { ChatSessionNamingService } from '@theia/ai-chat/lib/common/chat-session-naming-service';
import { DefaultChatNodeToolbarActionContribution } from '@theia/ai-chat-ui/lib/browser/chat-node-toolbar-action-contribution';
import { FabiCodeFrontend } from './fabi-code-frontend';
import { FabiCodeAgent, FABI_CODE_AGENT_ID } from './fabi-code-agent';
import { FabiChatSessionNamingService } from './fabi-chat-session-naming-service';
import { FabiCodeEditorBridge } from './fabi-code-editor-bridge';
import { FabiCodeRevertToolbarContribution, FabiCodeCheckpointCommands } from './fabi-code-checkpoint';
import { ChatResponsePartRenderer } from '@theia/ai-chat-ui/lib/browser/chat-response-part-renderer';
import { FabiToolPartRenderer, FabiThinkingPartRenderer } from './fabi-code-tool-renderer';
import { FabiMaestroFrontend } from './maestro/fabi-maestro-frontend';
import { MaestroSurfaceReporter } from './maestro/maestro-surface-reporter';
import { AIConfigurationContainerWidget } from '@theia/ai-ide/lib/browser/ai-configuration/ai-configuration-widget';
import { FabiAIConfigurationContainerWidget } from './fabi-ai-configuration-widget';
import { FabiModelStorageSettingsWidget } from './fabi-model-storage-settings';
import { ChatService } from '@theia/ai-chat/lib/common/chat-service';
import { FabiChatService } from './fabi-chat-service';
import { createFileTreeContainer } from '@theia/filesystem/lib/browser';
import { FileNavigatorWidget } from '@theia/navigator/lib/browser/navigator-widget';
import { FileNavigatorTree } from '@theia/navigator/lib/browser/navigator-tree';
import { FileNavigatorModel } from '@theia/navigator/lib/browser/navigator-model';
import { FILE_NAVIGATOR_PROPS } from '@theia/navigator/lib/browser/navigator-container';
import { NavigatorDecoratorService } from '@theia/navigator/lib/browser/navigator-decorator-service';
import { EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS } from '@theia/navigator/lib/browser/navigator-widget-factory';
import { FabiAgentTerminals } from './agents/fabi-agent-terminals';
import { FabiAgentsModel } from './agents/fabi-agents-model';
import { FabiAgentPicker } from './agents/fabi-agent-picker';
import { FabiProjectsLayout } from './agents/fabi-projects-layout';
import { FabiNavigatorModel, FabiNavigatorTree, FabiNavigatorWidget } from './agents/fabi-project-tree';
import { ScmCommitWidget } from '@theia/scm/lib/browser/scm-commit-widget';
import { FabiScmCommitWidget } from './fabi-scm-commit-widget';
import { FabiAgentCliService, FABI_AGENT_CLI_PATH } from '../common/fabi-agent-cli-protocol';

// Renomme le panneau IA « AI Chat » → « Fabi AI ». LABEL est le champ statique
// utilisé par ChatViewWidget pour son titre/caption ; on le change au chargement
// du module (avant toute création de widget).
ChatViewWidget.LABEL = 'Fabi AI';

// Le panneau de gauche n'est plus un explorateur de fichiers mais la barre
// « Espace » (sessions IA et volet fichiers), cf. agents/fabi-project-tree.
EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS.label = 'Espace';

// Ce module est chargé APRÈS @theia/ai-ide (déclaré en dépendance de fabi-swarm) :
// Theia ordonne les ContainerModule topologiquement → nos rebind/unbind passent
// par-dessus ceux d'ai-ide de façon déterministe.
import '../../src/browser/style/fabi-assist.css';
import { KeybindingContribution } from '@theia/core/lib/browser';
import { AssistModel, ContextAssistModel, AssistConnection } from './assist/assist-model';
import { AssistIdeObserver } from './assist/assist-ide-context';
import { AssistContribution, AssistWidget, ASSIST_WIDGET } from './assist/assist-contribution';

export default new ContainerModule((bind, unbind, isBound, rebind) => {
    bind(AssistConnection).toSelf().inSingletonScope();
    bind(AssistModel).toSelf().inSingletonScope();
    bind<AssistModel>(ContextAssistModel).to(AssistModel).inSingletonScope().onActivation((_ctx, model) => { model.surface = 'context'; return model; });
    bind(AssistIdeObserver).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AssistIdeObserver);
    bind(AssistWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: ASSIST_WIDGET, createWidget: () => ctx.container.get(AssistWidget) })).inSingletonScope();
    bind(AssistContribution).toSelf().inSingletonScope();
    [CommandContribution, MenuContribution, KeybindingContribution, TabBarToolbarContribution, FrontendApplicationContribution]
        .forEach(contribution => bind(contribution).toService(AssistContribution));

    // Façade frontend : proxy RPC client-aware + Events. Singleton partagé.
    bind(FabiSwarmFrontend).toSelf().inSingletonScope();
    bind(FabiSwarmService).toDynamicValue(ctx => ctx.container.get(FabiSwarmFrontend).service).inSingletonScope();

    // Onglet produit « Fabi » dans les paramètres IA existants. On étend le
    // conteneur Theia au lieu d'ouvrir une modale parallèle ou de refaire sa DA.
    bind(FabiModelStorageSettingsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: FabiModelStorageSettingsWidget.ID,
        createWidget: () => ctx.container.get(FabiModelStorageSettingsWidget)
    })).inSingletonScope();
    if (SWARM_ENGINE_ENABLED) { rebind(AIConfigurationContainerWidget).to(FabiAIConfigurationContainerWidget); }

    // === CERVEAU IA = OPENCODE, RENDU DANS LE CHAT THEIA (relais) ===
    // FabiCodeAgent est un ChatAgent Theia qui ne porte aucun modèle/prompt :
    // il relaie le message vers le sidecar OpenCode et re-streame sa sortie
    // (texte/raisonnement/cartes d'outils) dans le chat Theia existant. Tout le
    // cerveau (agents, prompts, modèle, contexte, outils) vit dans OpenCode.
    bind(FabiCodeFrontend).toSelf().inSingletonScope();
    bind(FabiCodeAgent).toSelf().inSingletonScope();
    if (SWARM_ENGINE_ENABLED) {
        bind(Agent).toService(FabiCodeAgent);
        bind(ChatAgent).toService(FabiCodeAgent);
    }
    // Conserve les nouveaux messages pendant un tour actif. Le service Theia
    // standard annule sinon le tour précédent avant même d'invoquer l'agent.
    bind(FabiChatService).toSelf().inSingletonScope();
    rebind(ChatService).toService(FabiChatService);
    // Theia's stock naming agent requires a Theia LanguageModel. Fabi does not
    // register one by design, so preserve the request-derived title without a
    // doomed background inference and its misleading error log.
    rebind(ChatSessionNamingService).to(FabiChatSessionNamingService).inSingletonScope();
    // Agent par défaut du chat = fabi-code (FabiSwarmModelContribution le met
    // aussi en tête de PREFERRED_DEFAULT_AGENTS).
    if (isBound(DefaultChatAgentId)) {
        rebind(DefaultChatAgentId).toConstantValue({ id: FABI_CODE_AGENT_ID });
    } else {
        bind(DefaultChatAgentId).toConstantValue({ id: FABI_CODE_AGENT_ID });
    }
    // Pont éditeur : fichiers édités par OpenCode → ouverts/scrollés dans l'éditeur.
    bind(FabiCodeEditorBridge).toSelf().inSingletonScope();
    if (SWARM_ENGINE_ENABLED) { bind(FrontendApplicationContribution).toService(FabiCodeEditorBridge); }
    // Checkpoints : remplace le crayon « éditer » par une flèche « restaurer »
    // (dialogue « message + code » / « message seul ») sur les messages utilisateur.
    rebind(DefaultChatNodeToolbarActionContribution).to(FabiCodeRevertToolbarContribution).inSingletonScope();
    bind(FabiCodeCheckpointCommands).toSelf().inSingletonScope();
    bind(CommandContribution).toService(FabiCodeCheckpointCommands);
    // Rendu façon Cursor des appels d'outils + du raisonnement (prennent le
    // dessus sur les renderers Theia par défaut via canHandle plus élevé).
    bind(ChatResponsePartRenderer).to(FabiToolPartRenderer).inSingletonScope();
    bind(ChatResponsePartRenderer).to(FabiThinkingPartRenderer).inSingletonScope();

    // Moniteur de perfs (status bar bas-droite + modale détaillée).
    bind(FabiMetricsStatusBar).toSelf().inSingletonScope();
    if (SWARM_ENGINE_ENABLED) { bind(FrontendApplicationContribution).toService(FabiMetricsStatusBar); }

    // Important : on n'enregistre PAS le swarm comme LanguageModel Theia global.
    // Le seul chemin IA produit est FabiCodeAgent → OpenCode. Sinon Theia lance
    // des appels parasites (ex: génération de titre de session) directement sur
    // le scheduler P2P, ce qui crée des 429 et masque les vrais tours utilisateur.

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
    // Le chat IA et les terminaux s'ouvrent à côté du code (droite / bas),
    // sans déplacer les vues restaurées. On sous-classe les deux
    // contributions d'origine et on rebind : tous les tokens qui pointaient vers
    // elles (CommandContribution, FrontendApplicationContribution, TerminalService…)
    // résolvent désormais nos versions. Modules chargés avant fabi-swarm (dépendances
    // déclarées) → les rebind passent par-dessus de façon déterministe.
    rebind(AIChatContribution).to(FabiAIChatContribution).inSingletonScope();
    rebind(TerminalFrontendContribution).to(FabiTerminalFrontendContribution).inSingletonScope();
    rebind(TerminalWidget).to(FabiTerminalWidget).inTransientScope();

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
    if (SWARM_ENGINE_ENABLED) {
        bind(CommandContribution).toService(FabiEditorActionsContribution);
        bind(TabBarToolbarContribution).toService(FabiEditorActionsContribution);
    }

    // Renommage des onglets (terminaux + chats IA) au clic droit.
    bind(FabiTabRenameContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(FabiTabRenameContribution);
    bind(MenuContribution).toService(FabiTabRenameContribution);

    // === Supervision des agents IA (statuts poussés par le backend) ===
    // Snapshots des agents + publication des surfaces (onglets) de CE frontend.
    bind(FabiMaestroFrontend).toSelf().inSingletonScope();
    bind(MaestroSurfaceReporter).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MaestroSurfaceReporter);

    // === Espace : sessions IA au premier plan, fichiers natifs à la demande ===
    // Terminaux d'agents (lancement Claude/Codex…, reprise de conversation) et
    // modèle des agents par dossier (statut, non lu, notifications).
    bind(FabiAgentPicker).toSelf().inSingletonScope();
    bind(FabiProjectsLayout).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(FabiProjectsLayout);
    bind(CommandContribution).toService(FabiProjectsLayout);
    bind(FabiAgentTerminals).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(FabiAgentTerminals);
    bind(CommandContribution).toService(FabiAgentTerminals);
    bind(FabiAgentsModel).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(FabiAgentsModel);
    // L'explorateur de Theia, recâblé avec nos sous-classes (même conteneur que
    // `createFileNavigatorContainer`, seules les trois classes changent).
    rebind(FileNavigatorWidget).toDynamicValue(ctx => {
        const child = createFileTreeContainer(ctx.container, {
            tree: FabiNavigatorTree,
            model: FabiNavigatorModel,
            widget: FabiNavigatorWidget,
            decoratorService: NavigatorDecoratorService,
            props: FILE_NAVIGATOR_PROPS
        });
        child.bind(FileNavigatorTree).toService(FabiNavigatorTree);
        child.bind(FileNavigatorModel).toService(FabiNavigatorModel);
        child.bind(FileNavigatorWidget).toService(FabiNavigatorWidget);
        return child.get(FabiNavigatorWidget);
    });

    // === CLI d'agents : détection (sélecteur) + message de commit par l'IA (✨ du champ Git) ===
    bind(FabiAgentCliService).toDynamicValue(ctx =>
        ctx.container.get<ServiceConnectionProvider>(RemoteConnectionProvider).createProxy(FABI_AGENT_CLI_PATH)
    ).inSingletonScope();
    rebind(ScmCommitWidget).to(FabiScmCommitWidget);
});
