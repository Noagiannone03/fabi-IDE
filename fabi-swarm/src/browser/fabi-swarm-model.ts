import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { OpenAiLanguageModelsManager } from '@theia/ai-openai/lib/common/openai-language-models-manager';
import { AgentService } from '@theia/ai-core/lib/common/agent-service';
import { AISettingsService } from '@theia/ai-core/lib/common/settings-service';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { ConnectionInfo, SwarmEntry, FABI_MODEL_ID } from '../common/fabi-swarm-protocol';

/** Préférence Theia AI : l'agent (par id) qui traite un message du chat quand
 *  aucun @agent n'est mentionné. Sans elle (ni mention, ni fallback) le chat
 *  répond « No agent was found to handle this request ». Clé stable de
 *  @theia/ai-chat (ai-chat-preferences) — codée en dur pour éviter une dépendance. */
const DEFAULT_CHAT_AGENT_PREF = 'ai-features.chat.defaultChatAgent';
/** Ordre de préférence pour le défaut (par id ou nom). `Universal` d'abord :
 *  chat direct, prompt léger, AUCUN appel de routage — bien plus rapide que
 *  l'Orchestrator (qui fait un LLM call de routage avant de répondre). */
const PREFERRED_DEFAULT_AGENTS = ['Universal', 'Coder', 'Orchestrator'];

/**
 * Câble le swarm ACTIF comme modèle OpenAI-compatible dans Theia AI ET l'assigne
 * à TOUS les agents (Coder, etc.). Enregistrer le modèle ne suffit pas : un agent
 * résout son modèle via ses `languageModelRequirements` (identifier) ; sans
 * assignation il renvoie « Couldn't find a ready language model ». On pointe donc
 * chaque agent sur `fabi-swarm` via AISettingsService. apiKey = jeton de compte →
 * la porte « contribuer = consommer » s'applique.
 */
@injectable()
export class FabiSwarmModelContribution implements FrontendApplicationContribution {

    @inject(OpenAiLanguageModelsManager)
    protected readonly openai: OpenAiLanguageModelsManager;

    @inject(AgentService)
    protected readonly agentService: AgentService;

    @inject(AISettingsService)
    protected readonly aiSettings: AISettingsService;

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    @inject(FabiSwarmFrontend)
    protected readonly frontend: FabiSwarmFrontend;

    /** Assignation faite une fois (le modèle a un id constant). */
    protected agentsAssigned = false;

    async onStart(): Promise<void> {
        // Agent par défaut dès le boot (indépendant du swarm) → le chat sait
        // toujours qui traite un message sans @mention.
        this.ensureDefaultChatAgent();
        // Re-câble uniquement quand le swarm est réellement consommable. Un
        // swarm sélectionné peut encore être en bootstrap/chargement ; l'exposer
        // trop tôt à Theia provoque des requêtes "Routing pipelines not ready".
        this.frontend.onActiveChangedEvent(() => void this.syncModelRegistration());
        this.frontend.onConnectionChangedEvent(() => void this.syncModelRegistration());
        // État initial (le backend a pu pousser avant qu'on s'abonne).
        try {
            const [active, connection] = await Promise.all([
                this.frontend.service.getActiveSwarm(),
                this.frontend.service.getConnection()
            ]);
            this.frontend.active = active;
            this.frontend.connection = connection;
            void this.syncModelRegistration();
        } catch {
            /* backend indispo -> on câblera au prochain push */
        }
    }

    protected async syncModelRegistration(): Promise<void> {
        const swarm = this.frontend.active;
        const connection = this.frontend.connection;
        if (!swarm || !connection?.ready) {
            this.openai.removeLanguageModels(FABI_MODEL_ID);
            return;
        }
        await this.wire(swarm, connection);
    }

    protected async wire(swarm: SwarmEntry | undefined, connection?: ConnectionInfo): Promise<void> {
        if (!swarm) {
            return;
        }
        if (connection && !connection.ready) {
            this.openai.removeLanguageModels(FABI_MODEL_ID);
            return;
        }
        let apiKey = 'fabi-no-auth';
        try {
            const token = await this.frontend.service.getAccountToken();
            if (token) {
                apiKey = token;
            }
        } catch {
            /* repli */
        }
        try {
            await this.openai.createOrUpdateLanguageModels({
                id: FABI_MODEL_ID,
                model: swarm.model,
                url: `${swarm.schedulerUrl.replace(/\/+$/, '')}/v1`,
                apiKey,
                apiVersion: undefined,
                maxRetries: 3,
                enableStreaming: true,
                supportsStructuredOutput: false,
                developerMessageSettings: 'system'
            });
            await this.assignToAgents();
        } catch (e) {
            console.warn('[fabi-swarm] enregistrement du modèle échoué :', e);
        }
    }

    /**
     * Pointe tous les agents Theia AI sur le modèle `fabi-swarm` (pour chaque
     * purpose qu'ils déclarent), une seule fois. Sans ça, les agents (Coder…)
     * n'ont aucun modèle « ready » assigné et échouent. Idempotent ; on respecte
     * un choix manuel ultérieur de l'utilisateur (assignation unique par session).
     */
    protected async assignToAgents(): Promise<void> {
        if (this.agentsAssigned) {
            return;
        }
        this.agentsAssigned = true;
        try {
            for (const agent of this.agentService.getAllAgents()) {
                const purposes = (agent.languageModelRequirements ?? []).map(r => r.purpose);
                if (purposes.length === 0) {
                    purposes.push('chat');
                }
                const requirements = purposes.map(purpose => ({ purpose, identifier: FABI_MODEL_ID }));
                await this.aiSettings.updateAgentSettings(agent.id, { languageModelRequirements: requirements });
            }
            // Au cas où les agents n'étaient pas prêts au boot.
            this.ensureDefaultChatAgent();
        } catch (e) {
            this.agentsAssigned = false; // on réessaiera au prochain câblage
            console.warn('[fabi-swarm] assignation du modèle aux agents échouée :', e);
        }
    }

    /**
     * Configure l'agent de chat par défaut (préférence Theia) si l'utilisateur
     * n'en a pas choisi. Sans ça, un message sans `@agent` n'est routé vers
     * personne → « No agent was found to handle this request ». On prend un agent
     * généraliste ACTIVÉ (Orchestrator > Universal > Coder > 1er dispo). On
     * respecte un choix existant (on n'écrase pas).
     */
    protected ensureDefaultChatAgent(): void {
        try {
            const agents = this.agentService.getAllAgents();
            if (agents.length === 0) {
                return; // pas encore prêts → on réessaiera depuis assignToAgents
            }
            const enabled = (a: { id: string }) => this.agentService.isEnabled(a.id);
            const byKey = (key: string) => agents.find(a => (a.id === key || a.name === key) && enabled(a));
            const current = this.preferences.get<string>(DEFAULT_CHAT_AGENT_PREF, '');
            // Si l'utilisateur a explicitement choisi un agent HORS de notre liste,
            // on le respecte. Sinon (vide, ou un défaut qu'on avait posé nous-même
            // comme Orchestrator) on (ré)applique le meilleur = Universal (rapide).
            const currentIsCustom = !!current && !PREFERRED_DEFAULT_AGENTS.some(k => byKey(k)?.id === current);
            if (currentIsCustom) {
                return;
            }
            const pick = PREFERRED_DEFAULT_AGENTS.map(byKey).find(Boolean)
                ?? agents.find(enabled)
                ?? agents[0];
            if (pick && pick.id !== current) {
                void this.preferences.set(DEFAULT_CHAT_AGENT_PREF, pick.id, PreferenceScope.User);
            }
        } catch (e) {
            console.warn('[fabi-swarm] configuration de l\'agent par défaut échouée :', e);
        }
    }
}
