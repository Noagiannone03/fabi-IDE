import { SWARM_ENGINE_ENABLED } from '../common/fabi-product-features';
import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { AIActivationService, ENABLE_AI_CONTEXT_KEY } from '@theia/ai-core/lib/browser';

/** Legacy Theia/Swarm chat activation follows the build-time product policy.
 * Assist has its own contribution and does not depend on this activation key.
 */
@injectable()
export class FabiAIActivationService implements AIActivationService, FrontendApplicationContribution {

    @inject(ContextKeyService)
    protected readonly contextKeyService: ContextKeyService;

    readonly isActive = SWARM_ENGINE_ENABLED;
    readonly canRun = SWARM_ENGINE_ENABLED;

    // Émetteurs jamais déclenchés (l'état ne change jamais) mais requis par le contrat.
    protected readonly activeStatusEmitter = new Emitter<boolean>();
    protected readonly canRunEmitter = new Emitter<boolean>();

    get onDidChangeActiveStatus(): Event<boolean> {
        return this.activeStatusEmitter.event;
    }

    get onDidChangeCanRun(): Event<boolean> {
        return this.canRunEmitter.event;
    }

    initialize(): void {
        // La clé de contexte gouverne l'affichage de pans entiers de l'UI IA
        // (menus, vues). Assist reste indépendant de cette clé.
        this.contextKeyService.createKey(ENABLE_AI_CONTEXT_KEY, SWARM_ENGINE_ENABLED);
    }
}
