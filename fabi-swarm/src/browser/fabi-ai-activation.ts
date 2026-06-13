import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { AIActivationService, ENABLE_AI_CONTEXT_KEY } from '@theia/ai-core/lib/browser';

/**
 * Activation IA « toujours allumée » pour Fabi.
 *
 * Theia (`@theia/ai-ide`) rebinde `AIActivationService` sur une implémentation
 * pilotée par la préférence `ai-features.AiEnable.enableAI` — IA DÉSACTIVÉE par
 * défaut, à activer à la main. Côté produit Fabi, l'IA EST le produit : pas de
 * première activation, pas d'écran « AI Features are Disabled », pas de toggle
 * qui puisse l'éteindre.
 *
 * On rebinde donc par-dessus (cf. fabi-swarm-frontend-module — chargé APRÈS
 * ai-ide grâce à la dépendance déclarée) avec un service constant : `isActive`
 * et `canRun` valent toujours `true`. La confiance d'espace de travail est déjà
 * désactivée dans la config Theia de l'app, donc aucune restriction `canRun`.
 */
@injectable()
export class FabiAIActivationService implements AIActivationService, FrontendApplicationContribution {

    @inject(ContextKeyService)
    protected readonly contextKeyService: ContextKeyService;

    readonly isActive = true;
    readonly canRun = true;

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
        // (menus, vues). On la force et on la verrouille à true.
        this.contextKeyService.createKey(ENABLE_AI_CONTEXT_KEY, true);
    }
}
