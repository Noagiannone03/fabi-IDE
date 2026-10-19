// *****************************************************************************
// Copyright (C) 2023 TypeFox and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// startApplication adapts Eclipse Theia 1.72.2 RemoteSetupService to loopback binding.

import { ContainerModule, injectable } from '@theia/core/shared/inversify';
import { OS } from '@theia/core';
import { RemotePlatform } from '@theia/core/lib/node/remote/remote-cli-contribution';
import { RemoteSetupOptions, RemoteSetupResult, RemoteSetupService } from '@theia/remote/lib/electron-node/setup/remote-setup-service';
import { RemoteProxyServerProvider } from '@theia/remote/lib/electron-node/remote-proxy-server-provider';
import { RemoteConnection } from '@theia/remote/lib/electron-node/remote-types';
import * as net from 'net';
import * as ssh2 from 'ssh2';
import { generateUuid } from '@theia/core/lib/common/uuid';
import { SSHHandshakeDeadline } from './ssh-handshake-deadline';
import { DISCOVER_REMOTE, parseRemoteSystem, prepareRemoteInstall, shellQuote } from './remote-bootstrap';
import { RemoteSSHConnectionProviderOptions } from '@theia/remote/lib/electron-common/remote-ssh-connection-provider';
import { MainCopyContribution } from '@theia/remote/lib/electron-node/setup/main-copy-contribution';
import { RemoteCopyRegistry } from '@theia/core/lib/node/remote/remote-copy-contribution';
import { RemoteSSHConnectionProviderImpl, RemoteSSHConnection } from '@theia/remote/lib/electron-node/ssh/remote-ssh-connection-provider';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';

/** Same Theia server and native dependency installer; the UI already runs on the desktop. */
@injectable()
export class SpaceRemoteFiles extends MainCopyContribution {
    override async copy(registry: RemoteCopyRegistry): Promise<void> {
        registry.file('package.json');
        await registry.glob('lib/backend/**/*.js');
        await registry.directory('lib/webview');
    }
}

/** Use ssh2's supported concurrent SFTP upload instead of a serial write stream. */
@injectable()
export class SpaceSSHProvider extends RemoteSSHConnectionProviderImpl {
    private readonly pending = new Map<string, Promise<string>>();

    override establishConnection(options: RemoteSSHConnectionProviderOptions): Promise<string> {
        const key = JSON.stringify([options.host, options.user, options.customConfigFile, options.nodeDownloadTemplate]);
        const existing = this.pending.get(key);
        if (existing) { return existing; }
        const started = Date.now();
        const attempt = super.establishConnection(options).finally(() => {
            this.pending.delete(key);
            console.info(`[fabi-ssh] connection total ${Date.now() - started}ms (includes authentication)`);
        });
        this.pending.set(key, attempt);
        return attempt;
    }

    override async establishSSHConnection(host: string, user: string, config?: string): Promise<RemoteSSHConnection> {
        const started = Date.now();
        const connection = await this.connectWithInteractiveDeadline(host, user, config);
        console.info(`[fabi-ssh] authentication ${Date.now() - started}ms`);
        const originalCopy = connection.copy.bind(connection);
        connection.copy = (local, remote) => new Promise<void>((resolve, reject) => {
            connection.client.sftp((error, sftp) => {
                if (error) { reject(error); return; }
                sftp.fastPut(local, remote, { concurrency: 32 }, uploadError => {
                    sftp.end();
                    // Some non-OpenSSH SFTP servers do not implement parallel writes.
                    if (uploadError) { originalCopy(local, remote).then(resolve, reject); }
                    else { resolve(); }
                });
            });
        });
        return connection;
    }

    /** Adapted from Theia 1.72.2 establishSSHConnection (EPL-2.0, attribution above).
     * ssh2's readyTimeout includes interactive authentication. Its default 20s
     * expires while a person is still entering a key passphrase. Bound network
     * waits, but pause that deadline while the upstream auth handler asks for input. */
    protected async connectWithInteractiveDeadline(host: string, user: string, config?: string): Promise<RemoteSSHConnection> {
        const sshConfig = await this.matchSSHConfigHost(host, user, config);
        const identityFiles = sshConfig?.identityfile;
        const identities = await this.identityFileCollector.gatherIdentityFiles(undefined, typeof identityFiles === 'string' ? [identityFiles] : identityFiles);
        let algorithms: ssh2.ConnectConfig['algorithms'];
        if (sshConfig) {
            if (!user && sshConfig.user) { user = sshConfig.user as string; }
            if (sshConfig.hostname) { host = `${sshConfig.hostname}:${sshConfig.port || '22'}`; }
            else if (sshConfig.port) { host = `${sshConfig.host}:${sshConfig.port}`; }
            if (String(sshConfig.compression).toLowerCase() === 'yes') { algorithms = { compress: ['zlib@openssh.com', 'zlib'] }; }
        }
        const address = new URL(`ssh://${host}`);
        const authenticate = this.getAuthHandler(user, address.hostname, identities);
        return new Promise<RemoteSSHConnection>((resolve, reject) => {
            const client = new ssh2.Client();
            let settled = false;
            const fail = (error: Error) => {
                if (settled) { return; }
                settled = true;
                deadline.stop();
                client.destroy();
                reject(error);
            };
            const deadline = new SSHHandshakeDeadline(20000,
                () => fail(new Error('Le serveur SSH ne répond pas à la négociation réseau (20 s).')));
            deadline.resume();
            client.on('error', fail).on('close', () => fail(new Error('La connexion SSH a été fermée avant son initialisation.')));
            client.on('ready', async () => {
                const remote = new RemoteSSHConnection({ client, id: generateUuid(), name: address.hostname, type: 'SSH' });
                try {
                    await this.testConnection(remote);
                    if (settled) { remote.dispose(); return; }
                    settled = true;
                    deadline.stop();
                    resolve(remote);
                } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
            });
            client.connect({
                host: address.hostname,
                port: address.port ? Number(address.port) : undefined,
                username: user,
                algorithms,
                readyTimeout: 0,
                keepaliveInterval: 15000,
                keepaliveCountMax: 3,
                authHandler: (methods, partial, callback) => {
                    deadline.pause();
                    Promise.resolve().then(() => authenticate(methods, partial, result => {
                        if (settled) { return; }
                        deadline.resume();
                        callback(result);
                    })).catch(error => fail(error instanceof Error ? error : new Error(String(error))));
                    return undefined;
                }
            });
        });
    }

}


/** The backend contains filesystem/terminal APIs: only the SSH tunnel may reach it. */
@injectable()
export class SpaceRemoteSetup extends RemoteSetupService {
    override async setup(options: RemoteSetupOptions): Promise<RemoteSetupResult> {
        const { connection } = options;
        let last = Date.now();
        const report = (message: string) => {
            console.info(`[fabi-ssh] previous phase ${Date.now() - last}ms; ${message}`);
            last = Date.now();
            options.report(message);
        };
        report('Identification du serveur…');
        const system = parseRemoteSystem((await connection.exec(DISCOVER_REMOTE)).stdout);
        // Windows retains Theia's platform-specific scripts and dependency installer.
        if (!system) { return super.setup({ ...options, report }); }
        const platform = { os: system.os === 'darwin' ? OS.Type.OSX : OS.Type.Linux, arch: system.arch };
        const appName = this.cleanupDirectoryName(this.applicationPackage.pck.name || 'theia');
        const release = this.getRemoteAppName();
        const app = `${system.home}/.${release}`;
        const runtimeRoot = `${system.home}/.${appName}-runtimes`;
        const nodeName = this.nodeSetupService.getNodeDirectoryName(platform);
        report('Vérification de l’installation existante…');
        const state = (await connection.exec(prepareRemoteInstall(system.home, appName, release, nodeName))).stdout;
        let node = state.split(/\r?\n/).find(line => line.startsWith('__FABI_NODE__\t'))?.slice('__FABI_NODE__\t'.length);
        if (!node) {
            report('Installation initiale du runtime Node…');
            const archive = await this.nodeSetupService.downloadNode(platform, options.nodeDownloadTemplate);
            const destination = `${runtimeRoot}/${this.nodeSetupService.getNodeFileName(platform)}`;
            await connection.copy(archive, destination);
            await this.unzipRemote(connection, platform, destination, runtimeRoot);
            node = `${runtimeRoot}/${nodeName}`;
        }
        if (!state.split(/\r?\n/).includes('__FABI_BACKEND_READY__')) {
            report('Mise à jour du backend Fabi…');
            const marker = `${app}/.fabi-installing`;
            await connection.exec(`touch ${shellQuote(marker)}`);
            const archive = `${app}/${release}.tar`;
            await this.copyService.copyToRemote(connection, platform, archive);
            await this.unzipRemote(connection, platform, archive, app);
            const installed = await connection.exec(`test -f ${shellQuote(`${app}/lib/backend/main.js`)} && rm -f ${shellQuote(marker)} && printf '__FABI_INSTALLED__'`);
            if (!installed.stdout.includes('__FABI_INSTALLED__')) {
                throw new Error('Installation distante incomplète ; elle sera reprise à la prochaine connexion.');
            }
        }
        report('Démarrage du backend distant…');
        connection.remotePort = await this.startApplication(connection, platform, app, node);
        report('Backend distant prêt.');
        return { applicationDirectory: `${app}/lib`, nodeDirectory: node };
    }

    protected override async startApplication(connection: RemoteConnection, platform: RemotePlatform,
        remotePath: string, nodeDir: string): Promise<number> {
        const node = this.scriptService.joinPath(platform, nodeDir,
            ...(platform.os === OS.Type.Windows ? ['node.exe'] : ['bin', 'node']));
        const main = this.scriptService.joinPath(platform, remotePath, 'lib', 'backend', 'main.js');
        const args = ['--hostname=127.0.0.1', '--port=0', '--remote'];
        for (const contribution of this.cliContributions.getContributions()) {
            args.push(...await contribution.enhanceArgs({ platform, directory: remotePath }));
        }
        const prefix = platform.os === OS.Type.Windows ? this.scriptService.exec(platform) + ' ' : '';
        const ready = /listening on http:\/\/127\.0\.0\.1:(\d+)/;
        const result = await connection.execPartial(platform.os === OS.Type.Windows ? `${prefix}cd "${remotePath}";${node}` : `cd ${shellQuote(remotePath)} && ${shellQuote(node)}`,
            output => ready.test(output), [main, ...args]);
        const match = ready.exec(result.stdout);
        if (!match) { throw new Error('Remote backend failed to start: ' + result.stderr); }
        return Number(match[1]);
    }
}

@injectable()
export class SpaceRemoteProxy extends RemoteProxyServerProvider {
    override getProxyServer(callback?: (socket: net.Socket) => void): Promise<net.Server> {
        return new Promise((resolve, reject) => {
            const server = net.createServer(callback);
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                server.removeListener('error', reject);
                resolve(server);
            });
        });
    }
}

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    rebind(MainCopyContribution).to(SpaceRemoteFiles).inSingletonScope();
    bind(ConnectionContainerModule).toConstantValue(ConnectionContainerModule.create(({ rebind: rebindConnection }) => {
        rebindConnection(RemoteSSHConnectionProviderImpl).to(SpaceSSHProvider).inSingletonScope();
    }));
    rebind(RemoteSetupService).to(SpaceRemoteSetup).inSingletonScope();
    rebind(RemoteProxyServerProvider).to(SpaceRemoteProxy).inSingletonScope();
});
