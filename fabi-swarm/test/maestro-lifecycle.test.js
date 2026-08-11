const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MaestroHookBridge, maestroIpcEndpoint } = require('../lib/node/fabi-maestro-hooks');
const { FabiMaestroServiceImpl } = require('../lib/node/fabi-maestro-service');

const once = (emitter, event) => new Promise((resolve, reject) => {
    emitter.once(event, resolve);
    emitter.once('error', reject);
});

test('le bridge Maestro ferme les permissions, le serveur et son socket de façon idempotente', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-maestro-'));
    // Les Unix domain sockets ont une limite de chemin très courte (104/108
    // octets selon l'OS). Le Named Pipe Windows, lui, doit rester dérivé d'un
    // scope propre au test pour éviter toute collision avec l'app installée.
    const socketPath = process.platform === 'win32'
        ? maestroIpcEndpoint(directory)
        : path.join(directory, 'maestro.sock');
    let changed;
    const changedPromise = new Promise(resolve => { changed = resolve; });
    const bridge = new MaestroHookBridge(changed, socketPath);
    await bridge.start();

    const client = net.createConnection(socketPath);
    await once(client, 'connect');
    client.write(`${JSON.stringify({
        source: 'codex',
        payload: {
            session_id: 'test-session',
            hook_event_name: 'PermissionRequest',
            cwd: directory,
            tool_name: 'write_file'
        }
    })}\n`);
    await changedPromise;
    const closed = once(client, 'close');

    await bridge.stop();
    await closed;
    assert.equal(bridge.isRunning(), false);
    if (process.platform !== 'win32') {
        await assert.rejects(fs.stat(socketPath), error => error.code === 'ENOENT');
    }
    await bridge.stop();
    await fs.rm(directory, { recursive: true, force: true });
});

test('le bridge Maestro choisit un endpoint IPC natif et stable par utilisateur', () => {
    assert.equal(
        maestroIpcEndpoint('/Users/test', 'darwin'),
        path.join('/Users/test', 'Library', 'Application Support', 'Fabi', 'maestro.sock')
    );
    assert.equal(maestroIpcEndpoint('/home/test', 'linux'), path.join('/home/test', '.fabi', 'maestro.sock'));
    const first = maestroIpcEndpoint('C:\\Users\\Test', 'win32');
    assert.equal(first.startsWith('\\\\.\\pipe\\fabi-maestro-'), true);
    assert.match(first.slice('\\\\.\\pipe\\fabi-maestro-'.length), /^[a-f0-9]{20}$/);
    assert.equal(first, maestroIpcEndpoint('c:\\users\\test', 'win32'));
    assert.notEqual(first, maestroIpcEndpoint('C:\\Users\\Other', 'win32'));
});

test('le service Maestro libère toutes ses ressources longues à l’arrêt', async () => {
    const service = new FabiMaestroServiceImpl();
    service.logger = { warn() {}, debug() {} };
    let stopped = 0;
    service.hooks = { stop: async () => { stopped++; } };
    let timerFired = false;
    service.extTimer = setTimeout(() => { timerFired = true; }, 30);
    service.pollTimer = setTimeout(() => { timerFired = true; }, 30);
    service.refreshTimer = setTimeout(() => { timerFired = true; }, 30);
    service.pushTimer = setTimeout(() => { timerFired = true; }, 30);
    service.sseReconnectTimer = setTimeout(() => { timerFired = true; }, 30);
    service.sseAbort = new AbortController();

    await service.onStop();
    await service.onStop();
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(stopped, 1);
    assert.equal(timerFired, false);
    assert.equal(service.sseAbort, undefined);
    assert.equal(service.client, undefined);
});
