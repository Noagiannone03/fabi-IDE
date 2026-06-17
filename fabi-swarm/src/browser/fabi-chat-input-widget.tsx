import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
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
     * Active l'input UNIQUEMENT quand le swarm peut réellement servir une requête.
     *
     * Le parent appelle `setEnabled(aiActivationService.canRun)` — un signal qui
     * n'a aucun sens pour Fabi (l'IA n'est jamais « désactivée »). La vraie
     * condition produit, c'est : « le swarm peut-il répondre MAINTENANT ? » =
     * `connection.ready` (vérité scheduler : pipeline prête à router + worker en
     * cours + assez de peers — cf. deriveConnection). On ignore donc l'argument du
     * parent et on lit `connection.ready`.
     *
     * Sans ça, on pouvait taper + envoyer un message dans le vide et se manger un
     * `500 "Server is not ready"` / `503` côté scheduler. Le parent ne bloque que
     * l'ENVOI quand disabled ; on bloque AUSSI la saisie (éditeur en lecture seule)
     * pour que l'input soit franchement inerte tant que le swarm n'est pas prêt.
     * Le « pourquoi » détaillé (pas assez de contributeurs, chargement…) est affiché
     * juste au-dessus par FabiSwarmSelector.
     */
    override setEnabled(_enabled: boolean): void {
        const ready = this.swarm.connection?.ready === true;
        super.setEnabled(ready);
        this.editor?.getControl().updateOptions({ readOnly: !ready });
    }

    /**
     * Le parent règle l'état d'activation une seule fois à l'init. Or notre
     * condition (`connection.ready`) évolue en continu (pipeline qui se forme,
     * worker qui charge, peer qui part…). On se réabonne donc aux changements de
     * connexion pour ré-évaluer l'activation à chaque fois, et on ré-applique
     * l'état une fois l'éditeur Monaco prêt (le `readOnly` ne « prend » qu'après
     * sa création).
     */
    @postConstruct()
    protected override init(): void {
        super.init();
        this.toDispose.push(this.swarm.onConnectionChangedEvent(() => this.setEnabled(false)));
        this.editorReady.promise.then(() => this.setEnabled(false));
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
