import * as React from '@theia/core/shared/react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { URI } from '@theia/core';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { CHAT_VIEW_LANGUAGE_EXTENSION } from '@theia/ai-chat-ui/lib/browser/chat-view-language-contribution';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { FabiSwarmSelector } from './fabi-swarm-selector';

/**
 * Sous-classe de l'input du chat IA de Theia. On NE forke PAS le paquet : on
 * étend la classe et on rebind (cf. fabi-swarm-frontend-module) → la WidgetFactory
 * de Theia instancie automatiquement la nôtre. `render()` est protégé : on
 * réutilise tel quel le rendu parent (éditeur, options, envoi…) et on ajoute
 * juste, AU-DESSUS, notre sélecteur de swarm. Upgrade-safe.
 */
@injectable()
export class FabiChatInputWidget extends AIChatInputWidget {

    @inject(FabiSwarmFrontend)
    protected readonly swarm: FabiSwarmFrontend;

    /**
     * URI de la ressource Monaco de l'input, UNIQUE par instance.
     *
     * Le parent enregistre, dans son `@postConstruct`, une ressource en mémoire à
     * une URI FIXE (`ai-chat:/input.aichatviewlanguage`). Dès qu'on ouvre un 2ᵉ chat,
     * cette URI entre en collision → « Cannot add already existing in-memory
     * resource » → l'instance échoue → pas de 2ᵉ onglet. On donne donc à chaque
     * input sa propre URI (en gardant l'extension `.aichatviewlanguage` pour que le
     * langage/coloration s'appliquent) → multi-chat possible. URI mémoïsée : stable
     * pour toute la vie du widget.
     */
    protected static fabiInputSeq = 0;
    protected fabiResourceUri?: URI;

    protected override getResourceUri(): URI {
        if (!this.fabiResourceUri) {
            const seq = ++FabiChatInputWidget.fabiInputSeq;
            this.fabiResourceUri = new URI(`ai-chat:/input-${seq}.${CHAT_VIEW_LANGUAGE_EXTENSION}`);
        }
        return this.fabiResourceUri;
    }

    /**
     * Fabi AI EST le produit : l'input n'est JAMAIS désactivé. Le parent appelle
     * `setEnabled(aiActivationService.canRun)` à l'init puis sur chaque changement
     * de `canRun` (préférence `enableAI`, confiance d'espace de travail…). On
     * intercepte ici, à la source, et on force toujours `true` — peu importe ce
     * que renvoie le service. Plus de placeholder « AI features are disabled », plus
     * de champ grisé : c'est la décision produit, encodée dans NOTRE widget, pas un
     * contournement caché. (cf. aussi FabiAIActivationService pour les clés de contexte.)
     */
    override setEnabled(_enabled: boolean): void {
        super.setEnabled(true);
    }

    protected override render(): React.ReactNode {
        // IMPORTANT : pas de div wrapper — un conteneur (flex/block) casse le
        // calcul de largeur de l'éditeur Monaco interne (il s'étale/déborde). Un
        // Fragment n'ajoute AUCUNE boîte : la pill et l'input restent enfants
        // directs du node du widget, le layout d'origine est préservé.
        return (
            <React.Fragment>
                <FabiSwarmSelector frontend={this.swarm} />
                {super.render()}
            </React.Fragment>
        );
    }
}
