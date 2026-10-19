import { ContainerModule, inject, injectable } from '@theia/core/shared/inversify';
import { DisposableCollection, MessageService, URI } from '@theia/core';
import { NewWindowOptions } from '@theia/core/lib/common/window';
import { ElectronWindowService } from '@theia/core/lib/electron-browser/window/electron-window-service';
import { WindowService, WindowReloadOptions } from '@theia/core/lib/browser/window/window-service';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { RemoteSSHContribution } from '@theia/remote/lib/electron-browser/remote-ssh-contribution';
import { RemoteService } from '@theia/remote/lib/electron-browser/remote-service';
import { RemoteStatusService } from '@theia/remote/lib/electron-common/remote-status-service';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { RemoteSpace } from '../common/space-types';

type SpaceBridge = {
    getRemote(): Promise<(RemoteSpace & { workspacePath: string }) | undefined>;
    connectRemote(port: number): Promise<boolean>;
    createRemote(remote: RemoteSpace, port: number): Promise<boolean>;
    workspaceChanged(path: string): void;
    setRemoteWorkspace(path: string): Promise<boolean>;
    onConnectRequest(callback: () => void): { dispose(): void };
};
const spaceBridge = () => (window as Window & { fabiSpaceHost?: SpaceBridge }).fabiSpaceHost;

/** All host/config selection, authentication and setup come from Theia Remote.
 * Only its window destination is adapted to our native Space compositor. */
@injectable()
export class SpaceSSHContribution extends RemoteSSHContribution {
    @inject(RemoteStatusService) protected readonly status: RemoteStatusService;
    private readonly identities = new Map<string, RemoteSpace>();

    async reconnectSpace(host: string, user: string): Promise<string> {
        return super.sendSSHConnect(host, user);
    }

    override async sendSSHConnect(host: string, user: string): Promise<string> {
        const port = await super.sendSSHConnect(host, user);
        this.identities.set(port, { host, user });
        return port;
    }

    protected override openRemote(port: string, newWindow: boolean, workspace?: string): void {
        const bridge = spaceBridge();
        const remote = this.identities.get(port);
        this.identities.delete(port);
        if (!bridge || !remote) { super.openRemote(port, newWindow, workspace); return; }
        void bridge.createRemote(remote, Number(port)).then(accepted => {
            if (!accepted) { throw new Error('Impossible d’ouvrir cet espace SSH.'); }
        }).catch(async error => {
            await this.status.connectionClosed(Number(port));
            await this.messageService.error(String(error));
        });
    }
}

@injectable()
export class RemoteSpaceContribution implements FrontendApplicationContribution {
    @inject(RemoteSSHContribution) protected readonly ssh: SpaceSSHContribution;
    @inject(RemoteStatusService) protected readonly status: RemoteStatusService;
    @inject(RemoteService) protected readonly remoteService: RemoteService;
    @inject(FrontendApplicationStateService) protected readonly state: FrontendApplicationStateService;
    @inject(FileDialogService) protected readonly dialogs: FileDialogService;
    @inject(FileService) protected readonly files: FileService;
    @inject(EnvVariablesServer) protected readonly environment: EnvVariablesServer;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MessageService) protected readonly messages: MessageService;
    private connecting = false;
    private readonly toDispose = new DisposableCollection();

    onStart(): void {
        const bridge = spaceBridge();
        if (bridge) { this.toDispose.push(bridge.onConnectRequest(() => {
            void this.state.reachedState('ready').then(() => this.ssh.connect(true));
        })); }
        void this.state.reachedState('ready').then(() => this.initializeRemoteSpace()).catch(error => this.messages.error(String(error)));
    }

    onStop(): void { this.toDispose.dispose(); }

    protected async initializeRemoteSpace(): Promise<void> {
        const bridge = spaceBridge();
        if (!bridge) { return; }
        const remote = await bridge.getRemote();
        if (!remote) { return; }
        const params = new URLSearchParams(location.search);
        if (params.has('localPort')) {
            const port = Number(params.get('port'));
            (window as Window & { fabiDisconnectRemote?: () => Promise<void> }).fabiDisconnectRemote =
                () => this.status.connectionClosed(port);
            // Never show a local OS picker for an SSH Space, including failed connections.
            if (!this.remoteService.isConnected()) { throw new Error('La connexion SSH n’est plus active.'); }
            this.toDispose.push(this.workspace.onWorkspaceChanged(() => this.reportWorkspace()));
            this.reportWorkspace();
            if (!remote.workspacePath && this.workspace.workspace?.resource.scheme !== 'file') {
                const home = await this.files.resolve(new URI(await this.environment.getHomeDirUri()));
                const folder = await this.dialogs.showOpenDialog({ title: `Ouvrir un dossier sur ${remote.host}`,
                    canSelectFolders: true, canSelectFiles: false, canSelectMany: false }, home);
                if (folder?.scheme === 'file') {
                    // Acknowledge the choice before WorkspaceService reloads the renderer.
                    // onWorkspaceChanged runs in the next document, which is too late here.
                    if (!await bridge.setRemoteWorkspace(folder.path.toString())) {
                        throw new Error('Impossible de mémoriser le dossier distant.');
                    }
                    await this.workspace.openWorkspace(folder, { preserveWindow: true });
                }
            }
            return;
        }
        if (params.has('disconnected')) {
            const action = await this.messages.info(`SSH déconnecté · ${remote.host}`, 'Reconnecter');
            if (action !== 'Reconnecter') { return; }
        }
        await this.reconnect(remote);
    }

    protected reportWorkspace(): void {
        const resource = this.workspace.workspace?.resource;
        if (resource?.scheme === 'file') { spaceBridge()?.workspaceChanged(resource.path.toString()); }
    }

    protected async reconnect(remote: RemoteSpace): Promise<void> {
        if (this.connecting) { return; }
        this.connecting = true;
        try {
            const port = Number(await this.ssh.reconnectSpace(remote.host, remote.user));
            if (!await spaceBridge()!.connectRemote(port)) { await this.status.connectionClosed(port); }
        } catch (error) {
            this.connecting = false;
            const action = await this.messages.error(`SSH · ${remote.host} : ${error instanceof Error ? error.message : error}`, 'Réessayer');
            if (action === 'Réessayer') { await this.reconnect(remote); }
        } finally { this.connecting = false; }
    }
}

/** Theia's folder opening/reload behavior, with its native window redirected to the current Space. */
@injectable()
export class SpaceWindowService extends ElectronWindowService {
    override reload(options?: WindowReloadOptions): void {
        if (spaceBridge() && !options) {
            // WorkspaceService sets location.hash then requests a reload without URL.
            // Send the renderer's current URL explicitly: the main process may still
            // see the previous hash when its IPC handler receives that request.
            window.electronTheiaCore.requestReload(location.href);
            return;
        }
        super.reload(options);
    }

    override openNewWindow(url: string, options: NewWindowOptions = {}): undefined {
        if (spaceBridge() && !options.external) {
            const target = new URL(url, location.href);
            if (target.protocol === location.protocol && target.pathname === location.pathname) {
                this.reload({ hash: target.hash.slice(1), search: Object.fromEntries(target.searchParams) });
                return undefined;
            }
        }
        return super.openNewWindow(url, options);
    }
    override async openNewDefaultWindow(options?: WindowReloadOptions): Promise<number> {
        if (spaceBridge()) { this.reload(options); return -1; }
        return super.openNewDefaultWindow(options);
    }
}

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    rebind(RemoteSSHContribution).to(SpaceSSHContribution).inSingletonScope();
    rebind(WindowService).to(SpaceWindowService).inSingletonScope();
    bind(RemoteSpaceContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(RemoteSpaceContribution);
});
