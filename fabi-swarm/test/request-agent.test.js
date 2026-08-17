'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const {
    buildRequestAgentEnv,
    parseRequestAgentReady,
    requestAgentContractFingerprint,
    requestAgentRestartDelay,
    spawnRequestAgent
} = require('../lib/node/fabi-request-agent');
const {
    RequestAgentPhaseTracker
} = require('../lib/node/fabi-request-agent-events');
const { FabiSwarmServiceImpl } = require('../lib/node/fabi-swarm-service');

const MODEL_SWARM_ID = '46e338001cbca3a457b8e513950d62cc10fc7866226529e7b27825a737797b57';
const profile = {
    protocolVersion: 3,
    catalogSchemaVersion: 3,
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

const requestAgentSwarm = (overrides = {}) => ({
    id: 'qwen3-4b-v3',
    name: 'Qwen3 4B',
    schedulerUrl: 'https://scheduler.example.test',
    schedulerPeer: '33'.repeat(32),
    modelSwarmId: MODEL_SWARM_ID,
    workerConnection: profile,
    model: 'Qwen/Qwen3-4B',
    status: 'online',
    schedulerStatus: 'available',
    peers: 2,
    totalVramGb: 32,
    lastSeen: new Date(0).toISOString(),
    ...overrides
});

test('backs off explicit Request Agent process failures without unbounded delay', () => {
    assert.deepEqual(
        [1, 2, 3, 4, 5, 6, 20].map(requestAgentRestartDelay),
        [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]
    );
});

test('fingerprints only the stable Request Agent launch contract', () => {
    const baseline = requestAgentContractFingerprint(requestAgentSwarm());
    assert.ok(baseline);
    assert.equal(
        requestAgentContractFingerprint(requestAgentSwarm({
            peers: 99,
            schedulerStatus: 'waiting',
            lastSeen: new Date(10_000).toISOString()
        })),
        baseline
    );
    assert.equal(
        requestAgentContractFingerprint(requestAgentSwarm({ modelSwarmId: undefined })),
        undefined
    );
    assert.notEqual(
        requestAgentContractFingerprint(requestAgentSwarm({ modelSwarmId: '44'.repeat(32) })),
        baseline
    );
    assert.notEqual(
        requestAgentContractFingerprint(requestAgentSwarm({
            workerConnection: { ...profile, relayUrl: 'https://new-relay.example.test' }
        })),
        baseline
    );
});

test('reconciles a newly complete registry contract with the latest swarm snapshot', async () => {
    class ServiceHarness extends FabiSwarmServiceImpl {
        constructor() {
            super();
            this.restarts = [];
            this.requestAgentGeneration = 7;
            this.requestAgentState = { kind: 'error', swarmId: 'qwen3-4b-v3' };
        }

        reconcile(previous, updated) {
            this.activeSwarm = updated;
            this.reconcileRequestAgentContract(previous, updated);
        }

        async restartRequestAgent(swarmId, generation) {
            this.restarts.push({
                swarmId,
                generation,
                modelSwarmId: this.activeSwarm?.modelSwarmId
            });
        }
    }

    const service = new ServiceHarness();
    const incomplete = requestAgentSwarm({ modelSwarmId: undefined, peers: 0 });
    const complete = requestAgentSwarm({ peers: 1 });
    service.reconcile(incomplete, complete);
    await Promise.resolve();
    assert.deepEqual(service.restarts, [{
        swarmId: 'qwen3-4b-v3',
        generation: 7,
        modelSwarmId: MODEL_SWARM_ID
    }]);

    service.reconcile(complete, requestAgentSwarm({ peers: 2 }));
    await Promise.resolve();
    assert.equal(service.restarts.length, 1, 'peer counters must not restart the data plane');
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
            (binary, args, options) => {
                spawned = { binary, args, options };
                return child;
            }
        );
        assert.equal(spawned.binary, '/missing/python');
        assert.deepEqual(spawned.args.slice(0, 2), ['-m', 'fabi.request_agent']);
        assert.deepEqual(spawned.args.slice(2, 8), [
            '--host', '127.0.0.1', '--port', '0', '--ready-file',
            spawned.args[7]
        ]);
        const launchId = spawned.args[7].match(/ready-([0-9a-f-]+)\.json$/)?.[1];
        assert.ok(launchId);
        assert.equal(spawned.options.env.FABI_REQUEST_AGENT_LAUNCH_ID, launchId);
        const rejected = assert.rejects(handle.ready, /impossible à lancer: spawn failed/);
        child.emit('error', new Error('spawn failed'));
        child.exitCode = 1;
        child.emit('close', 1, null);
        await rejected;
        await handle.closed;
        assert.equal(states.filter(state => state.kind === 'error').length, 1);
        assert.match(
            readFileSync(join(root, 'logs', 'request-agent-qwen3-4b-v3.log'), 'utf8'),
            /\[launcher\] error: Request Agent impossible à lancer: spawn failed/
        );
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

test('accepts only launch-bound readiness on loopback across a Windows venv wrapper', () => {
    const launchId = 'b3432c02-0493-43a5-838c-b793617c6753';
    assert.deepEqual(
        parseRequestAgentReady(JSON.stringify({
            schema_version: 2,
            launch_id: launchId,
            pid: 740,
            base_url: 'http://127.0.0.1:43127'
        }), launchId),
        {
            schema_version: 2,
            launch_id: launchId,
            pid: 740,
            base_url: 'http://127.0.0.1:43127'
        }
    );
    assert.throws(
        () => parseRequestAgentReady(JSON.stringify({
            schema_version: 2,
            launch_id: '605b99fd-a67a-4ea8-9e4a-cf9291aeff23',
            pid: 740,
            base_url: 'http://127.0.0.1:43127'
        }), launchId),
        /étrangère/
    );
    assert.throws(
        () => parseRequestAgentReady(JSON.stringify({
            schema_version: 2,
            launch_id: launchId,
            pid: 740,
            base_url: 'http://0.0.0.0:43127'
        }), launchId),
        /loopback/
    );
    assert.throws(
        () => parseRequestAgentReady(JSON.stringify({
            schema_version: 2,
            launch_id: launchId,
            pid: 0,
            base_url: 'http://127.0.0.1:43127'
        }), launchId),
        /PID/
    );
});

test('accepts the real server PID behind a Windows venv launcher process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fabi-request-agent-test-'));
    const previousToken = process.env.FABI_ACCOUNT_TOKEN;
    process.env.FABI_ACCOUNT_TOKEN = '22'.repeat(32);
    try {
        const child = new EventEmitter();
        child.pid = 1012;
        child.exitCode = null;
        child.signalCode = null;
        child.stdout = undefined;
        child.stderr = undefined;
        const states = [];
        const handle = spawnRequestAgent(
            { binary: 'C:\\runtime\\venv\\Scripts\\python.exe', argsPrefix: ['-m', 'fabi.request_agent'] },
            requestAgentSwarm(),
            profile,
            { rootPath: 'C:\\runtime\\trust\\root.json', dataRoot: root },
            state => states.push(state),
            () => undefined,
            (_binary, args, options) => {
                writeFileSync(args[7], JSON.stringify({
                    schema_version: 2,
                    launch_id: options.env.FABI_REQUEST_AGENT_LAUNCH_ID,
                    pid: 740,
                    base_url: 'http://127.0.0.1:43127'
                }));
                return child;
            }
        );

        assert.deepEqual(await handle.ready, {
            kind: 'ready',
            swarmId: 'qwen3-4b-v3',
            pid: 740,
            baseUrl: 'http://127.0.0.1:43127'
        });
        assert.equal(states.filter(state => state.kind === 'ready').length, 1);

        const stopped = handle.stop();
        child.exitCode = 0;
        child.emit('close', 0, null);
        await stopped;
    } finally {
        if (previousToken === undefined) {
            delete process.env.FABI_ACCOUNT_TOKEN;
        } else {
            process.env.FABI_ACCOUNT_TOKEN = previousToken;
        }
        rmSync(root, { recursive: true, force: true });
    }
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
