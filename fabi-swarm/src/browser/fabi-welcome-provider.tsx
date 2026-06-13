import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { DisposableCollection, Emitter, Event } from '@theia/core';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { ChatWelcomeMessageProvider } from '@theia/ai-chat-ui/lib/browser/chat-tree-view';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { FabiWelcomeIllustration } from './fabi-welcome-illustration';

/**
 * Écran d'accueil du chat, version Fabi. Remplace le provider « robot » de
 * @theia/ai-ide (retiré dans le module au profit de celui-ci). On garde les
 * aides @agent / #contexte, on ajoute une illustration P2P animée et le pitch
 * « contribue = consomme ». Priorité haute → rendu en premier, AU-DESSUS de
 * « Recent Chats » (priorité 50), qui reste géré par son provider d'origine.
 *
 * L'IA étant toujours active chez Fabi (cf. FabiAIActivationService), les écrans
 * « AI désactivée » / « Configure a provider » ne sont jamais empruntés ; on
 * fournit quand même renderDisabledMessage en repli sur le même contenu.
 */
@injectable()
export class FabiWelcomeMessageProvider implements ChatWelcomeMessageProvider {

    readonly priority = 200;

    @inject(FabiSwarmFrontend)
    protected readonly swarm: FabiSwarmFrontend;

    protected readonly toDispose = new DisposableCollection();
    protected readonly onStateChangedEmitter = new Emitter<void>();
    get onStateChanged(): Event<void> {
        return this.onStateChangedEmitter.event;
    }

    @postConstruct()
    protected init(): void {
        // Le bandeau d'état (connecté / à connecter) reflète l'état réel : on
        // re-rend l'accueil quand le swarm actif ou la connexion changent.
        this.toDispose.push(this.swarm.onActiveChangedEvent(() => this.onStateChangedEmitter.fire()));
        this.toDispose.push(this.swarm.onConnectionChangedEvent(() => this.onStateChangedEmitter.fire()));
    }

    dispose(): void {
        this.toDispose.dispose();
        this.onStateChangedEmitter.dispose();
    }

    renderWelcomeMessage(): React.ReactNode {
        return this.renderWelcome();
    }

    renderDisabledMessage(): React.ReactNode {
        return this.renderWelcome();
    }

    protected renderWelcome(): React.ReactNode {
        const appName = FrontendApplicationConfigProvider.get().applicationName || 'Fabi';
        return (
            <div className="theia-WelcomeMessage fabi-ai-welcome" key="fabi-welcome">
                <FabiWelcomeIllustration />
                <h2 className="fabi-welcome-title">{appName} AI</h2>

                <p className="fabi-welcome-text">
                    Une IA sans limite, propulsée par un réseau de machines mises en commun —
                    tu partages un peu de puissance, tu utilises les modèles librement.
                </p>

                <div className="fabi-welcome-tips">
                    <div className="fabi-welcome-tip">
                        <span className="fabi-welcome-key">@</span>
                        <span>Parle à un agent spécialisé — <strong>@Coder</strong>, <strong>@Architect</strong>, <strong>@Universal</strong>.</span>
                    </div>
                    <div className="fabi-welcome-tip">
                        <span className="fabi-welcome-key">#</span>
                        <span>Donne du contexte — <strong>#file</strong>, <strong>#selection</strong>, ou le trombone pour joindre un fichier.</span>
                    </div>
                </div>
            </div>
        );
    }
}
