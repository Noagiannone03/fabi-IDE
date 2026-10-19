require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { prepareRemoteInstall, parseRemoteSystem } = require('../lib/electron-node/remote-bootstrap');
const { SpaceRemoteSetup } = require('../lib/electron-node/remote-space-backend-module');
const { RemoteNodeSetupService } = require('@theia/remote/lib/electron-node/setup/remote-node-setup-service');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-ssh-'));
    // Exercise shell quoting, including the home directory in nested shell commands.
    const home = path.join(root, "home ' $(false)");
    await fs.mkdir(home);
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return home;
}
async function nodeAt(home, release, name) {
    const dir = path.join(home, release, name, 'bin');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}
async function backendAt(home, release) {
    const dir = path.join(home, release, 'lib/backend');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'main.js'), '');
}
const run = command => exec('/bin/sh', ['-c', command]);

test('system discovery ignores shell banners and normalizes supported architectures', () => {
    assert.deepEqual(parseRemoteSystem('Hello\n__FABI_SYSTEM__\tLinux\taarch64\t/home/noa\r\n'), { os: 'linux', arch: 'arm64', home: '/home/noa' });
    assert.deepEqual(parseRemoteSystem('__FABI_SYSTEM__\tDarwin\tx86_64\t/Users/noa\n'), { os: 'darwin', arch: 'x64', home: '/Users/noa' });
    assert.equal(parseRemoteSystem('uname: command not found'), undefined);
});

test('an installed release is reused, and an interrupted backend installation is retried', async t => {
    const home = await fixture(t), name = 'node-v22.20.0-darwin-arm64';
    await nodeAt(home, '.fabi-1-remote', name); await backendAt(home, '.fabi-1-remote');
    const command = prepareRemoteInstall(home, 'fabi', 'fabi-1-remote', name);
    const { stdout } = await run(command);
    assert.ok(stdout.includes(`__FABI_NODE__\t${home}/.fabi-1-remote/${name}`));
    assert.match(stdout, /__FABI_BACKEND_READY__/);
    await fs.writeFile(path.join(home, '.fabi-1-remote/.fabi-installing'), '');
    assert.doesNotMatch((await run(command)).stdout, /__FABI_BACKEND_READY__/);
});

test('a new Fabi version reuses identical Node without touching the old release', async t => {
    const home = await fixture(t), name = 'node-v22.20.0-darwin-arm64';
    await nodeAt(home, '.fabi-1-remote', name);
    const command = prepareRemoteInstall(home, 'fabi', 'fabi-2-remote', name);
    const { stdout } = await run(command);
    assert.ok(stdout.includes(`__FABI_NODE__\t${home}/.fabi-runtimes/${name}`));
    assert.doesNotMatch(stdout, /__FABI_BACKEND_READY__/);
    await fs.access(path.join(home, '.fabi-1-remote', name, 'bin/node'));
    await fs.rm(path.join(home, '.fabi-1-remote'), { recursive: true });
    assert.ok((await run(command)).stdout.includes('__FABI_NODE__'));
    assert.doesNotMatch((await run(prepareRemoteInstall(home, 'fabi', 'fabi-3-remote', 'node-v99-linux-x64'))).stdout, /__FABI_NODE__/);
});

test('warm setup uses two SSH probes and never downloads or transfers dependencies', async t => {
    const home = await fixture(t);
    const service = new SpaceRemoteSetup();
    service.applicationPackage = { pck: { name: 'fabi', version: '1' } };
    service.nodeSetupService = new RemoteNodeSetupService();
    const platform = { os: os.platform() === 'darwin' ? 'OS X' : 'Linux', arch: os.arch() };
    // OS.Type values come from Theia, not Node names.
    const { OS } = require('@theia/core');
    platform.os = os.platform() === 'darwin' ? OS.Type.OSX : OS.Type.Linux;
    const name = service.nodeSetupService.getNodeDirectoryName(platform);
    await nodeAt(home, '.fabi-1-remote', name); await backendAt(home, '.fabi-1-remote');
    service.nodeSetupService.downloadNode = () => assert.fail('warm setup must not download Node');
    service.copyService = { copyToRemote: () => assert.fail('warm setup must not transfer backend') };
    let probes = 0, starts = 0;
    const connection = {
        exec: async command => { probes++; return exec('/bin/sh', ['-c', command], { env: { ...process.env, HOME: home } }); },
        copy: () => assert.fail('warm setup must not copy files')
    };
    service.startApplication = async (_connection, _platform, app, node) => {
        starts++; assert.equal(app, path.join(home, '.fabi-1-remote'));
        assert.equal(node, path.join(app, name)); return 12345;
    };
    const result = await service.setup({ connection, report() {} });
    assert.equal(probes, 2); assert.equal(starts, 1); assert.equal(connection.remotePort, 12345);
    assert.equal(result.applicationDirectory, path.join(home, '.fabi-1-remote/lib'));
});

test('simultaneous connection requests share one setup and failures can be retried', async () => {
    const { SpaceSSHProvider } = require('../lib/electron-node/remote-space-backend-module');
    const service = new SpaceSSHProvider();
    const options = { host: 'example.test', user: 'noa' };
    let attempts = 0, release;
    service.messageService = { showProgress: async () => ({ report() {}, cancel() {} }) };
    service.establishSSHConnection = async () => { attempts++; return { onDidDisconnect() {}, forwardOut() {} }; };
    service.remoteSetup = { setup: () => new Promise(resolve => { release = resolve; }) };
    service.remoteConnectionService = { register: () => ({ dispose() {} }) };
    service.serverProvider = { getProxyServer: async () => ({ address: () => ({ port: 12345 }), close() {} }) };
    const first = service.establishConnection(options), second = service.establishConnection(options);
    assert.equal(first, second);
    await new Promise(resolve => setImmediate(resolve)); release();
    assert.equal(await first, '12345'); assert.equal(attempts, 1);
    service.remoteSetup.setup = async () => { throw new Error('connection lost'); };
    await assert.rejects(service.establishConnection(options), /connection lost/);
    service.remoteSetup.setup = async () => undefined;
    assert.equal(await service.establishConnection(options), '12345');
    assert.equal(attempts, 3);
});
