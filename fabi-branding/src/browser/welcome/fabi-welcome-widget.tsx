import * as React from '@theia/core/shared/react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell } from '@theia/core/lib/browser';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FOX_GRID, FOX_PALETTE, FOX_GRID_W, FOX_GRID_H } from '../../common/fox';

/**
 * Page d'accueil Fabi — widget autonome (pas un dérivé de @theia/getting-started,
 * pour ne dépendre d'aucun interne susceptible de bouger entre versions).
 * Affiche le renard, le wordmark FA·BI et des actions rapides câblées sur des
 * commandes Theia existantes.
 */
@injectable()
export class FabiWelcomeWidget extends ReactWidget {

    static readonly ID = 'fabi.welcome';
    static readonly LABEL = 'Bienvenue';

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @postConstruct()
    protected init(): void {
        this.id = FabiWelcomeWidget.ID;
        this.title.label = FabiWelcomeWidget.LABEL;
        this.title.caption = 'Fabi — Bienvenue';
        this.title.closable = true;
        this.title.iconClass = 'fabi-fox-tab-icon';
        this.node.classList.add('fabi-welcome');
        this.update();
    }

    /** Exécute la première commande qui réussit ; sinon prévient l'utilisateur
     *  (au lieu de ne rien faire en silence). `hint` explique l'indisponibilité. */
    protected async run(ids: string[], hint?: string): Promise<void> {
        for (const id of ids) {
            if (!this.commands.getCommand(id)) {
                continue; // commande non enregistrée → on tente la suivante
            }
            try {
                await this.commands.executeCommand(id);
                return;
            } catch {
                /* enregistrée mais sans handler actif ici → suivante */
            }
        }
        this.messageService.info(hint ?? 'Cette action n’est pas disponible dans ce contexte.');
    }

    /** Ouvre/active une vue (par son id de widget) — fiable pour les vues. */
    protected async openView(viewId: string): Promise<void> {
        try {
            await this.shell.activateWidget(viewId);
        } catch {
            this.messageService.info('Impossible d’ouvrir cette vue.');
        }
    }

    protected renderFox(): React.ReactNode {
        const rects: React.ReactNode[] = [];
        for (let y = 0; y < FOX_GRID_H; y++) {
            for (let x = 0; x < FOX_GRID_W; x++) {
                const color = FOX_PALETTE[FOX_GRID[y][x]];
                if (!color) {
                    continue;
                }
                rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={color} />);
            }
        }
        return (
            <svg className="fabi-welcome-fox" viewBox={`0 0 ${FOX_GRID_W} ${FOX_GRID_H}`} shapeRendering="crispEdges" aria-label="Fabi">
                {rects}
            </svg>
        );
    }

    protected renderAction(icon: string, title: string, subtitle: string, onClick: () => void): React.ReactNode {
        return (
            <button className="fabi-action" onClick={onClick} key={title}>
                <span className={`fabi-action-icon codicon ${icon}`} />
                <span className="fabi-action-text">
                    <span className="fabi-action-title">{title}</span>
                    <span className="fabi-action-sub">{subtitle}</span>
                </span>
            </button>
        );
    }

    protected render(): React.ReactNode {
        return (
            <div className="fabi-welcome-scroll">
                <div className="fabi-welcome-hero">
                    {this.renderFox()}
                    <h1 className="fabi-wordmark"><span className="fabi-wm-a">Fa</span><span className="fabi-wm-b">bi</span></h1>
                    <p className="fabi-tagline">Peer-to-peer AI for your code.</p>
                </div>

                <div className="fabi-section">
                    <h2>Démarrer</h2>
                    <div className="fabi-actions">
                        {this.renderAction('codicon-new-file', 'Nouveau fichier', 'Créer un fichier vierge', () => this.run(['workbench.action.files.newFile', 'workbench.action.files.newUntitledFile']))}
                        {this.renderAction('codicon-folder-opened', 'Ouvrir un dossier', 'Ouvrir un projet existant', () => this.run(['workspace:openWorkspace', 'workspace:open']))}
                        {this.renderAction('codicon-search', 'Palette de commandes', 'Tout faire au clavier (⇧⌘P)', () => this.run(['workbench.action.showCommands']))}
                        {this.renderAction('codicon-settings-gear', 'Préférences', 'Configurer Fabi', () => this.run(['preferences:open']))}
                        {this.renderAction('codicon-extensions', 'Extensions', 'Installer depuis Open VSX', () => this.run(['vsxExtensions.toggle', 'workbench.view.extensions']))}
                    </div>
                </div>

                <div className="fabi-section">
                    <h2>Aller plus loin</h2>
                    <div className="fabi-actions">
                        {this.renderAction('codicon-beaker', 'Tests', 'Ouvrir la vue de tests', () => this.openView('test-view-container'))}
                        {this.renderAction('codicon-remote', 'Connexion SSH', 'Développer à distance', () => this.run(['remote.ssh.connect'], 'Connexion SSH : disponible dans l’app desktop Fabi (Electron).'))}
                        {this.renderAction('codicon-vm', 'Dev Container', 'Rouvrir dans un conteneur Docker', () => this.run(['dev-container:reopen-in-container'], 'Dev Container : nécessite Docker et l’app desktop Fabi.'))}
                        {this.renderAction('codicon-notebook', 'Notebook', 'Créer un notebook (Jupyter)', () => this.run(['notebook.createNew', 'ipynb.newUntitledIpynb', 'jupyter.createnewnotebook'], 'Notebook : installe l’extension Jupyter depuis le panneau Extensions.'))}
                    </div>
                </div>

                <div className="fabi-section">
                    <h2>L’IA Fabi</h2>
                    <div className="fabi-actions">
                        {this.renderAction('codicon-broadcast', 'Fabi Swarm', 'Choisis un modèle, prête ton GPU, code avec', () => this.openView('fabi.swarm'))}
                        {this.renderAction('codicon-comment-discussion', 'Chat IA', 'Discuter avec le modèle du swarm', () => this.run(['aiChat:open', 'ai-chat-ui:open', 'workbench.action.chat.open'], 'Ouvre le chat IA depuis la barre latérale.'))}
                    </div>
                    <p className="fabi-next-note">Le swarm est un réseau pair-à-pair : ton worker fait tourner une part du modèle, et tu peux consommer le modèle complet réparti sur tous les contributeurs.</p>
                </div>

                <div className="fabi-footer">Fabi — basé sur Eclipse Theia · 🦊 Peer-to-peer AI</div>
            </div>
        );
    }
}
