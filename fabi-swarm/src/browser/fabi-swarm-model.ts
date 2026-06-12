import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { OpenAiLanguageModelsManager } from '@theia/ai-openai/lib/common/openai-language-models-manager';
import { AgentService } from '@theia/ai-core/lib/common/agent-service';
import { AISettingsService } from '@theia/ai-core/lib/common/settings-service';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { SwarmEntry, FABI_MODEL_ID } from '../common/fabi-swarm-protocol';

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

    @inject(FabiSwarmFrontend)
    protected readonly frontend: FabiSwarmFrontend;

    /** Assignation faite une fois (le modèle a un id constant). */
    protected agentsAssigned = false;

    async onStart(): Promise<void> {
        // Re-câble dès que le swarm actif change (connexion / switch).
        this.frontend.onActiveChangedEvent(swarm => void this.wire(swarm));
        // État initial (le backend a pu pousser avant qu'on s'abonne).
        if (this.frontend.active) {
            void this.wire(this.frontend.active);
        } else {
            try {
                const active = await this.frontend.service.getActiveSwarm();
                if (active) {
                    void this.wire(active);
                }
            } catch {
                /* backend indispo → on câblera au prochain push */
            }
        }
    }

    protected async wire(swarm: SwarmEntry | undefined): Promise<void> {
        if (!swarm) {
            return; // déconnecté : on laisse le dernier modèle enregistré (inerte sans worker)
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
        } catch (e) {
            this.agentsAssigned = false; // on réessaiera au prochain câblage
            console.warn('[fabi-swarm] assignation du modèle aux agents échouée :', e);
        }
    }
}
