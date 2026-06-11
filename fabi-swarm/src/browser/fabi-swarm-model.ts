import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { OpenAiLanguageModelsManager } from '@theia/ai-openai/lib/common/openai-language-models-manager';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { SwarmEntry, FABI_MODEL_ID } from '../common/fabi-swarm-protocol';

/**
 * Câble le swarm ACTIF comme modèle OpenAI-compatible dans Theia AI. Le provider
 * suit le swarm choisi : changer de modèle dans le panel → ré-enregistre le
 * provider sur le scheduler/v1 + le modèle du nouveau swarm. apiKey = jeton de
 * compte → la porte « contribuer = consommer » du scheduler s'applique.
 */
@injectable()
export class FabiSwarmModelContribution implements FrontendApplicationContribution {

    @inject(OpenAiLanguageModelsManager)
    protected readonly openai: OpenAiLanguageModelsManager;

    @inject(FabiSwarmFrontend)
    protected readonly frontend: FabiSwarmFrontend;

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
        } catch (e) {
            console.warn('[fabi-swarm] enregistrement du modèle échoué :', e);
        }
    }
}
