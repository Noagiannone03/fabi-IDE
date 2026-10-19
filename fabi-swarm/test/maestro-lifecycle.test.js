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

test('tool observations remain session scoped; folder-only binding stays uncertain', () => {
    const bridge = new MaestroHookBridge(() => {});
    const socket = { end() {} };
    for (const [id, terminal, file] of [['one', 'terminal-one', '/project/a.ts'], ['two', 'terminal-two', '/project/b.ts']]) {
        bridge.handle({ source: 'claude', runtime: { terminal }, payload: { session_id: id, cwd: '/project', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: file } } }, socket);
    }
    const agents = bridge.apply(['one', 'two'].map(id => ({ key: id, id: 'scan-' + id, source: 'claude', directory: '/project', surface: { widgetId: 'terminal-' + id } })));
    assert.deepEqual(agents.map(a => a.observations[0].path), ['a.ts', 'b.ts']);
    assert.ok(agents.every(a => !a.approximate));
    bridge.handle({ source: 'codex', payload: { session_id: 'unknown', cwd: '/project', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/project/.env' } } }, socket);
    const uncertain = bridge.apply([{ id: 'scan', source: 'codex', directory: '/project' }])[0];
    assert.equal(uncertain.approximate, true);
    assert.equal(uncertain.observations[0].path, undefined);
    assert.equal(uncertain.observations[0].phase, 'started');
});

test('a folder guess cannot override the exact terminal hook of another parallel agent', () => {
    const bridge = new MaestroHookBridge(() => {});
    for (const [id, terminal, file] of [['one', 'terminal-one', 'a.ts'], ['two', 'terminal-two', 'b.ts']]) {
        bridge.handle({ source: 'codex', runtime: { terminal }, payload: { session_id: id, cwd: '/project', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: file } } }, { end() {} });
    }
    const result = bridge.apply([{ id: 'one', key: 'guess', source: 'codex', directory: '/project', approximate: true, surface: { widgetId: 'terminal-two' } }])[0];
    assert.equal(result.id, 'two');
    assert.equal(result.observations[0].path, 'b.ts');
    assert.equal(result.approximate, false);
});

test('hook process ancestry binds parallel terminals exactly without inherited terminal env', () => {
    const bridge = new MaestroHookBridge(() => {});
    for (const [id, pid] of [['one', 100], ['two', 200]]) {
        bridge.handle({ source: 'codex', runtime: { ancestors: [pid + 1, pid, 50] }, payload: { session_id: id, cwd: '/project', hook_event_name: 'UserPromptSubmit' } }, { end() {} });
    }
    const agents = [100, 200].map((processId, i) => ({ key: 'guess', id: i ? 'one' : 'two', source: 'codex', directory: '/project', approximate: true, surface: { widgetId: 'terminal-' + processId, processId } }));
    const result = bridge.apply(agents);
    assert.deepEqual(result.map(a => a.id), ['one', 'two']);
    assert.ok(result.every(a => !a.approximate && a.status === 'generating'));
    bridge.handle({ source: 'codex', runtime: { ancestors: [201, 200, 50] }, payload: { session_id: 'two', cwd: '/project', hook_event_name: 'Stop' } }, { end() {} });
    assert.deepEqual(bridge.apply(agents).map(a => a.status), ['generating', 'waiting']);
});

test('distributed hook helper reports actual process ancestry without terminal env', async t => {
    if (process.platform === 'win32') return t.skip('POSIX process tree');
    const { HOOK_CLIENT_SOURCE } = require('../lib/node/fabi-maestro-hooks');
    const { spawn } = require('node:child_process');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-hook-'));
    const socketPath = path.join(directory, 'hook.sock');
    let received;
    const bridge = new MaestroHookBridge(() => { received = [...bridge.sessions.values()][0]; }, socketPath);
    await bridge.start();
    try {
        const helper = path.join(directory, 'helper.cjs'); await fs.writeFile(helper, HOOK_CLIENT_SOURCE);
        const env = { ...process.env, FABI_MAESTRO_SOCKET: socketPath }; delete env.FABI_AGENT_TERMINAL;
        const child = spawn(process.execPath, [helper, '--source', 'codex'], { env, stdio: ['pipe', 'ignore', 'pipe'] });
        let error = ''; child.stderr.on('data', data => error += data);
        child.stdin.end(JSON.stringify({ session_id: 'helper', hook_event_name: 'UserPromptSubmit', cwd: directory }));
        const code = await new Promise(resolve => child.once('exit', resolve));
        assert.equal(code, 0, error);
        assert.ok(received?.ancestors.includes(process.pid));
        assert.equal(received.terminal, undefined);
    } finally { await bridge.stop(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('native Codex turn boundaries override an older stop hook, without trusting file mtime', () => {
    const { codexLifecycle } = require('../lib/node/fabi-agent-observations');
    const now = Date.now();
    const event = (type, at) => ({ type: 'event_msg', timestamp: new Date(at).toISOString(), payload: { type } });
    const start = codexLifecycle([event('task_complete', now - 1000), event('task_started', now)]);
    assert.equal(start.status, 'generating');
    assert.equal(codexLifecycle([event('task_started', now), event('task_complete', now + 1)]).status, 'waiting');
    assert.equal(codexLifecycle([event('turn_aborted', now)]).status, 'waiting');
    assert.equal(codexLifecycle([{ type: 'response_item', timestamp: new Date(now).toISOString(), payload: { type: 'message' } }]), undefined);
    const bridge = new MaestroHookBridge(() => {});
    bridge.handle({ source: 'codex', runtime: { terminal: 'terminal', receivedAt: now - 1000 }, payload: { session_id: 'session', hook_event_name: 'Stop' } }, { end() {} });
    const agent = { key: 'codex:session', id: 'session', source: 'codex', ...start, surface: { widgetId: 'terminal' } };
    assert.equal(bridge.apply([agent])[0].status, 'generating');
    bridge.handle({ source: 'codex', runtime: { terminal: 'terminal', receivedAt: now + 1000 }, payload: { session_id: 'session', hook_event_name: 'Stop' } }, { end() {} });
    assert.equal(bridge.apply([agent])[0].status, 'waiting');
});
