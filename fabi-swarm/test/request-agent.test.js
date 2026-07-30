'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const {
    buildRequestAgentEnv,
    parseRequestAgentReady,
    requestAgentRestartDelay,
    spawnRequestAgent
} = require('../lib/node/fabi-request-agent');
const {
    RequestAgentPhaseTracker
} = require('../lib/node/fabi-request-agent-events');

const MODEL_SWARM_ID = '46e338001cbca3a457b8e513950d62cc10fc7866226529e7b27825a737797b57';
const profile = {
    protocolVersion: 3,
    transport: 'iroh',
    relayUrl: 'https://relay.example.test',
    enrollmentUrl: 'https://registry.example.test/v1/relay/enroll',
    catalogDhtBootstraps: ['/dns4/dht.example.test/tcp/443/wss/p2p/12D3KooWTest'],
    modelRegistry: {
        rootUrl: 'https://registry.example.test/root.json',
        rootSha256: '11'.repeat(32),
        metadataUrl: 'https://registry.example.test/metadata',
        targetsUrl: 'https://registry.example.test/targets'
    }
};

test('backs off explicit Request Agent process failures without unbounded delay', () => {
    assert.deepEqual(
        [1, 2, 3, 4, 5, 6, 20].map(requestAgentRestartDelay),
        [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]
    );
});

test('settles process closure once after a spawn error and close', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fabi-request-agent-test-'));
    const previous = process.env.FABI_ACCOUNT_TOKEN;
    process.env.FABI_ACCOUNT_TOKEN = '22'.repeat(32);
    try {
        const child = new EventEmitter();
        child.pid = 4312;
        child.exitCode = null;
        child.signalCode = null;
        child.stdout = undefined;
        child.stderr = undefined;
        const states = [];
        let spawned;
        const handle = spawnRequestAgent(
            { binary: '/missing/python', argsPrefix: ['-m', 'fabi.request_agent'] },
            {
                id: 'qwen3-4b-v3',
                name: 'Qwen3 4B',
                schedulerUrl: 'https://scheduler.example.test',
                modelSwarmId: MODEL_SWARM_ID,
                model: 'Qwen/Qwen3-4B',
                status: 'online',
                schedulerStatus: 'available',
                peers: 2,
                totalVramGb: 32,
                lastSeen: new Date(0).toISOString()
            },
            profile,
            {
                rootPath: '/data/trust/root.json',
                dataRoot: root
            },
            state => states.push(state),
            () => undefined,
            (binary, args) => {
                spawned = { binary, args };
                return child;
            }
        );
        assert.equal(spawned.binary, '/missing/python');
        assert.deepEqual(spawned.args.slice(0, 2), ['-m', 'fabi.request_agent']);
        assert.deepEqual(spawned.args.slice(2, 8), [
            '--host', '127.0.0.1', '--port', '0', '--ready-file',
            spawned.args[7]
        ]);
        const rejected = assert.rejects(handle.ready, /impossible à lancer: spawn failed/);
        child.emit('error', new Error('spawn failed'));
        child.exitCode = 1;
        child.emit('close', 1, null);
        await rejected;
        await handle.closed;
        assert.equal(states.filter(state => state.kind === 'error').length, 1);
        await new Promise(resolve => setImmediate(resolve));
    } finally {
        if (previous === undefined) {
            delete process.env.FABI_ACCOUNT_TOKEN;
        } else {
            process.env.FABI_ACCOUNT_TOKEN = previous;
        }
        rmSync(root, { recursive: true, force: true });
    }
});

test('does not hang IDE shutdown when close is missing after forced kill', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fabi-request-agent-test-'));
    const previousToken = process.env.FABI_ACCOUNT_TOKEN;
    const nativeSetTimeout = global.setTimeout;
    process.env.FABI_ACCOUNT_TOKEN = '22'.repeat(32);
    try {
        const child = new EventEmitter();
        child.pid = 2_000_000_000;
        child.exitCode = null;
        child.signalCode = null;
        child.stdout = undefined;
        child.stderr = undefined;
        const handle = spawnRequestAgent(
            { binary: '/runtime/python', argsPrefix: ['-m', 'fabi.request_agent'] },
            {
                id: 'qwen3-4b-v3',
                name: 'Qwen3 4B',
                schedulerUrl: 'https://scheduler.example.test',
                modelSwarmId: MODEL_SWARM_ID,
                model: 'Qwen/Qwen3-4B',
                status: 'online',
                schedulerStatus: 'available',
                peers: 2,
                totalVramGb: 32,
                lastSeen: new Date(0).toISOString()
            },
            profile,
            { rootPath: '/data/trust/root.json', dataRoot: root },
            () => undefined,
            () => undefined,
            () => child
        );
        const readyRejected = assert.rejects(handle.ready, /arrêté avant readiness/);
        global.setTimeout = (callback, delay, ...args) =>
            nativeSetTimeout(callback, Math.min(Number(delay), 1), ...args);
        await handle.stop();
        await readyRejected;
        await handle.closed;
    } finally {
        global.setTimeout = nativeSetTimeout;
        if (previousToken === undefined) {
            delete process.env.FABI_ACCOUNT_TOKEN;
        } else {
            process.env.FABI_ACCOUNT_TOKEN = previousToken;
        }
        rmSync(root, { recursive: true, force: true });
    }
});

test('accepts only the child readiness document bound to loopback', () => {
    assert.deepEqual(
        parseRequestAgentReady(JSON.stringify({
            schema_version: 1,
            pid: 4312,
            base_url: 'http://127.0.0.1:43127'
        }), 4312),
        {
            schema_version: 1,
            pid: 4312,
            base_url: 'http://127.0.0.1:43127'
        }
    );
    assert.throws(
        () => parseRequestAgentReady(JSON.stringify({
            schema_version: 1,
            pid: 9999,
            base_url: 'http://127.0.0.1:43127'
        }), 4312),
        /étrangère/
    );
    assert.throws(
        () => parseRequestAgentReady(JSON.stringify({
            schema_version: 1,
            pid: 4312,
            base_url: 'http://0.0.0.0:43127'
        }), 4312),
        /loopback/
    );
});

test('builds a separate persistent V3 identity for the local Request Agent', () => {
    const previous = process.env.FABI_ACCOUNT_TOKEN;
    process.env.FABI_ACCOUNT_TOKEN = '22'.repeat(32);
    try {
        const env = buildRequestAgentEnv({
            id: 'qwen3-4b-v3',
            name: 'Qwen3 4B',
            schedulerUrl: 'https://scheduler.example.test/',
            schedulerPeer: '33'.repeat(32),
            modelSwarmId: MODEL_SWARM_ID,
            model: 'Qwen/Qwen3-4B',
            status: 'online',
            schedulerStatus: 'available',
            peers: 2,
            totalVramGb: 32,
            lastSeen: new Date(0).toISOString()
        }, profile, {
            rootPath: '/data/trust/root.json',
            dataRoot: '/data/fabi'
        });

        assert.equal(env.FABI_REQUEST_AGENT_MODEL_SWARM_ID, MODEL_SWARM_ID);
        assert.equal(env.FABI_REQUEST_AGENT_AUTHORITY_URL, 'https://scheduler.example.test');
        assert.equal(env.FABI_CATALOG_DHT_MODE, 'client');
        assert.match(env.FABI_NETWORK_IDENTITY_PATH, /request-agent-qwen3-4b-v3\.key$/);
        assert.match(env.FABI_CATALOG_DHT_IDENTITY_PATH, /request-agent-catalog-qwen3-4b-v3\.key$/);
        assert.match(env.FABI_REQUEST_AGENT_STATE_DIR, /request-agent[/\\]qwen3-4b-v3$/);
        assert.equal(env.FABI_ACCOUNT_TOKEN, '22'.repeat(32));
    } finally {
        if (previous === undefined) {
            delete process.env.FABI_ACCOUNT_TOKEN;
        } else {
            process.env.FABI_ACCOUNT_TOKEN = previous;
        }
    }
});

test('refuses to start without the registry-provided model identity', () => {
    assert.throws(
        () => buildRequestAgentEnv({
            id: 'qwen3-4b-v3',
            name: 'Qwen3 4B',
            schedulerUrl: 'https://scheduler.example.test',
            schedulerPeer: '33'.repeat(32),
            model: 'Qwen/Qwen3-4B',
            status: 'online',
            schedulerStatus: 'available',
            peers: 2,
            totalVramGb: 32,
            lastSeen: new Date(0).toISOString()
        }, profile, {
            rootPath: '/data/trust/root.json',
            dataRoot: '/data/fabi'
        }),
        /modelSwarmId/
    );
});

test('rebuilds Request Agent phases from snapshot and monotonic SSE events', () => {
    const tracker = new RequestAgentPhaseTracker();
    assert.deepEqual(
        tracker.apply('snapshot', '0', JSON.stringify({
            last_event_id: 0,
            active_requests: []
        })),
        { lastEventId: 0, activeRequests: [], latest: undefined }
    );
    const planning = tracker.apply('request-phase', '1', JSON.stringify({
        event_id: 1,
        request_id: 'req-1',
        phase: 'planning',
        occurred_at_ms: 10
    }));
    assert.equal(planning.activeRequests[0].phase, 'planning');
    const recovering = tracker.apply('request-phase', '2', JSON.stringify({
        event_id: 2,
        request_id: 'req-1',
        phase: 'recovering',
        occurred_at_ms: 20,
        epoch: 2,
        route_id: 'route-b'
    }));
    assert.equal(recovering.latest.phase, 'recovering');
    assert.equal(recovering.activeRequests[0].epoch, 2);
    const completed = tracker.apply('request-phase', '3', JSON.stringify({
        event_id: 3,
        request_id: 'req-1',
        phase: 'completed',
        occurred_at_ms: 30
    }));
    assert.equal(completed.activeRequests.length, 0);
    assert.equal(completed.latest.phase, 'completed');
    assert.throws(
        () => tracker.apply('request-phase', '3', JSON.stringify({
            event_id: 3,
            request_id: 'req-2',
            phase: 'decoding',
            occurred_at_ms: 40
        })),
        /ordre/
    );
});
