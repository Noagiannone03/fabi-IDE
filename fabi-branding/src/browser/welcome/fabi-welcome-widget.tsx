import * as React from '@theia/core/shared/react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { LabelProvider, OpenerService, open } from '@theia/core/lib/browser';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FabiRecentFiles } from './fabi-recent-files';
import { Disposable, DisposableCollection } from '@theia/core/lib/common';
import { ScmService } from '@theia/scm/lib/browser/scm-service';
import { ScmResource } from '@theia/scm/lib/browser/scm-provider';

/** Workspace home, backed by real files rather than sample activity. */
@injectable()
export class FabiWelcomeWidget extends ReactWidget {
    static readonly ID = 'fabi.welcome';
    static readonly LABEL = 'Accueil';

    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(LabelProvider) protected readonly labels: LabelProvider;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(FabiRecentFiles) protected readonly recents: FabiRecentFiles;
    @inject(ScmService) protected readonly scm: ScmService;
    protected fileView: 'recent' | 'changes' = 'recent';
    protected readonly repositoryListeners = new DisposableCollection();
    protected openingChanges = new Set<ScmResource>();
    protected opening = new Set<string>();
    protected fileErrors = new Map<string, string>();

    @postConstruct()
    protected init(): void {
        this.id = FabiWelcomeWidget.ID;
        this.title.label = FabiWelcomeWidget.LABEL;
        this.title.caption = 'Accueil du Space';
        this.title.closable = true;
        this.title.iconClass = 'fabi-fox-tab-icon';
        this.addClass('fabi-welcome');
        this.toDispose.push(this.recents.onDidChange(() => this.update()));
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => this.update()));
        this.toDispose.push(this.labels.onDidChange(() => this.update()));
        // The collection is reset when repositories change; retain the final cleanup.
        this.toDispose.push(Disposable.create(() => this.repositoryListeners.dispose()));
        this.toDispose.push(this.scm.onDidAddRepository(() => this.watchRepositories()));
        this.toDispose.push(this.scm.onDidRemoveRepository(() => this.watchRepositories()));
        this.watchRepositories();
        void this.workspace.ready.then(() => { if (!this.isDisposed) { this.update(); } });
        this.update();
    }

    protected watchRepositories(): void {
        this.repositoryListeners.dispose();
        for (const { provider } of this.scm.repositories) {
            this.repositoryListeners.push(provider.onDidChange(() => this.update()));
            if (provider.onDidChangeResources) {
                this.repositoryListeners.push(provider.onDidChangeResources(() => this.update()));
            }
        }
        this.update();
    }

    protected changedFiles(): ScmResource[] {
        const resources: ScmResource[] = [];
        for (const { provider } of this.scm.repositories) {
            for (const group of provider.groups) {
                // Keep staged and working-tree entries separate: each opens a different diff.
                resources.push(...group.resources.filter(resource => !!this.workspace.getWorkspaceRootUri(resource.sourceUri)));
            }
        }
        return resources;
    }

    protected async openChange(resource: ScmResource): Promise<void> {
        if (this.openingChanges.has(resource)) { return; }
        this.openingChanges.add(resource);
        this.update();
        try { await resource.open(); }
        catch (error) { void this.messages.error('Impossible d’ouvrir la comparaison : ' + String(error)); }
        finally {
            this.openingChanges.delete(resource);
            if (!this.isDisposed) { this.update(); }
        }
    }

    protected renderChanges(resources: ScmResource[]): React.ReactNode {
        if (!resources.length) {
            return <div className="fabi-home-empty"><span className="codicon codicon-git-compare" aria-hidden="true" />
                <p>{this.scm.repositories.length ? 'Aucun changement signalé.' : 'Aucun dépôt disponible pour le moment.'}
                    <span>Cette vue suit les changements fournis par le contrôle de version.</span></p>
            </div>;
        }
        return <>
            <ul className="fabi-home-files">{resources.slice(0, 12).map((resource, index) => {
                const uri = resource.sourceUri;
                const status = resource.decorations?.tooltip || resource.group.label;
                const relative = this.workspace.getWorkspaceRootUri(uri)?.path.relative(uri.path)?.toString() ?? this.labels.getLongName(uri);
                return <li className="fabi-home-file-row" key={resource.group.provider.rootUri + ':' + resource.group.id + ':' + uri.toString() + ':' + index}>
                    <button className="fabi-home-file fabi-home-change" title={this.labels.getLongName(uri) + ' — ' + status}
                        aria-label={this.labels.getName(uri) + ' — ' + status + ' — ' + resource.group.label}
                        disabled={this.openingChanges.has(resource)} onClick={() => void this.openChange(resource)}>
                        <span className={this.labels.getIcon(uri) || 'codicon codicon-file'} aria-hidden="true" />
                        <span className="fabi-home-file-name">{this.labels.getName(uri)}</span>
                        <span className="fabi-home-file-path">{relative}</span>
                        <span className="fabi-home-change-status">{resource.decorations?.letter && <span className="fabi-home-change-letter">{resource.decorations.letter}</span>}{resource.group.label}</span>
                    </button>
                </li>;
            })}</ul>
            {resources.length > 12 && <button className="fabi-home-text-button" onClick={() => void this.run(['scmView:toggle'])}>
                Voir les {resources.length} changements dans le contrôle de version
            </button>}
        </>;
    }

    protected async run(ids: string[]): Promise<void> {
        const id = ids.find(candidate => this.commands.getCommand(candidate) && this.commands.isEnabled(candidate));
        if (!id) {
            void this.messages.info('Cette action n’est pas disponible dans ce Space.');
            return;
        }
        try { await this.commands.executeCommand(id); }
        catch (error) { void this.messages.error('Impossible d’ouvrir cet outil : ' + String(error)); }
    }

    protected async openRecent(value: string): Promise<void> {
        if (this.opening.has(value)) { return; }
        this.opening.add(value);
        this.fileErrors.delete(value);
        this.update();
        try { await open(this.opener, new URI(value), { mode: 'activate' }); }
        catch { this.fileErrors.set(value, 'Fichier inaccessible. Vérifiez son emplacement ou la connexion au projet.'); }
        finally {
            this.opening.delete(value);
            if (!this.isDisposed) { this.update(); }
        }
    }

    protected renderAction(icon: string, label: string, detail: string, ids: string[]): React.ReactNode {
        return <button className="fabi-home-action" onClick={() => void this.run(ids)}>
            <span className={'codicon codicon-' + icon} aria-hidden="true" />
            <span><span className="fabi-home-action-label">{label}</span><span className="fabi-home-action-detail">{detail}</span></span>
            <span className="codicon codicon-arrow-right" aria-hidden="true" />
        </button>;
    }

    protected renderRecent(value: string): React.ReactNode {
        const uri = new URI(value);
        const root = this.workspace.getWorkspaceRootUri(uri);
        const relative = root?.path.relative(uri.path)?.toString() ?? this.labels.getLongName(uri);
        const error = this.fileErrors.get(value);
        return <li key={value} className="fabi-home-file-row">
            <div className="fabi-home-file-actions">
                <button className="fabi-home-file" title={this.labels.getLongName(uri)}
                    disabled={this.opening.has(value)} onClick={() => void this.openRecent(value)}>
                    <span className={this.labels.getIcon(uri) || 'codicon codicon-file'} aria-hidden="true" />
                    <span className="fabi-home-file-name">{this.labels.getName(uri)}</span>
                    <span className="fabi-home-file-path">{relative}</span>
                    <span className="codicon codicon-arrow-up-right" aria-hidden="true" />
                </button>
                <button className="fabi-home-forget" title="Retirer des récents — ne supprime pas le fichier"
                    aria-label={'Retirer ' + this.labels.getName(uri) + ' des fichiers récents'}
                    onClick={() => { this.fileErrors.delete(value); this.recents.forget(value); }}>
                    <span className="codicon codicon-close" aria-hidden="true" />
                </button>
            </div>
            {error && <p className="fabi-home-file-error" role="alert">{error}</p>}
        </li>;
    }

    protected render(): React.ReactNode {
        const resource = this.workspace.workspace?.resource;
        const name = resource ? this.labels.getName(resource) : 'Votre prochain projet';
        const changes = this.changedFiles();
        return <main className="fabi-home">
            <header className="fabi-home-header">
                <span className="fabi-home-eyebrow">Fabi / Space</span>
                <h1>{name}</h1>
                <p>{resource ? 'Reprenez là où vous en étiez.' : 'Ouvrez un dossier pour commencer à coder.'}</p>
            </header>
            <section className="fabi-home-start" aria-label="Actions du projet">
                {resource
                    ? this.renderAction('go-to-file', 'Trouver un fichier', 'Rechercher dans ce projet', ['file-search.openFile'])
                    : this.renderAction('folder-opened', 'Ouvrir un dossier', 'Choisir un projet sur cet ordinateur', ['workspace:openWorkspace', 'workspace:open'])}
                {this.renderAction('new-file', 'Nouveau fichier', 'Un éditeur vide, prêt à écrire', ['workbench.action.files.newFile', 'workbench.action.files.newUntitledFile'])}
            </section>
            <section className="fabi-home-recents" aria-labelledby="fabi-home-recents-title">
                <div className="fabi-home-section-heading">
                    <h2 id="fabi-home-recents-title">Fichiers du projet</h2>
                    {resource && <button className="fabi-home-text-button" onClick={() => void this.run(['fileNavigator:toggle'])}>Arborescence <span aria-hidden="true">↗</span></button>}
                </div>
                <div className="fabi-home-file-switch" role="group" aria-label="Vue des fichiers">
                    <button aria-pressed={this.fileView === 'recent'} onClick={() => { this.fileView = 'recent'; this.update(); }}>Récents</button>
                    <button aria-pressed={this.fileView === 'changes'} onClick={() => { this.fileView = 'changes'; this.update(); }}>
                        Changements{changes.length > 0 && <span className="fabi-home-change-count">{changes.length}</span>}
                    </button>
                </div>
                {this.fileView === 'changes' ? this.renderChanges(changes) : this.recents.files.length
                    ? <ul className="fabi-home-files">{this.recents.files.slice(0, 8).map(value => this.renderRecent(value))}</ul>
                    : <div className="fabi-home-empty"><span className="codicon codicon-history" aria-hidden="true" />
                        <p>Aucun fichier récent pour ce projet.<span>Les fichiers que vous ouvrez apparaîtront ici.</span></p>
                    </div>}
            </section>
            <footer className="fabi-home-footer">
                <button className="fabi-home-text-button" onClick={() => void this.run(['scmView:toggle'])}><span className="codicon codicon-git-compare" aria-hidden="true" /> Voir les changements</button>
                <button className="fabi-home-text-button" onClick={() => void this.run(['workbench.action.showCommands'])}>Toutes les commandes <span className="codicon codicon-arrow-right" aria-hidden="true" /></button>
            </footer>
        </main>;
    }
}
