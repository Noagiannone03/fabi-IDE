const test = require('node:test');
const assert = require('node:assert/strict');
const { FabiSwarmServiceImpl } = require('../lib/node/fabi-swarm-service');
const { FabiRuntimeManager } = require('../lib/node/fabi-runtime-manager');
const { installRuntime } = require('../lib/node/fabi-runtime-install');
const { FabiCodeServiceImpl } = require('../lib/node/fabi-code-service');
const { FabiMaestroServiceImpl } = require('../lib/node/fabi-maestro-service');

test('connecting multiple Spaces creates no Swarm feed, sampler, or storage scan', async () => {
    const service = new FabiSwarmServiceImpl();
    service.publishModelStorage = () => { throw Error('Unexpected storage scan'); };
    const states = [];
    const client = new Proxy({}, {get: (_, key) => value => { if (key === 'onRuntimeStatusChanged') states.push(value); }});
    service.addClient(client);
    service.addClient(client);
    assert.equal(service.feed, undefined);
    assert.equal(service.metrics, undefined);
    assert.equal(await service.getMetrics(), undefined);
    assert.deepEqual(await service.listSwarms(), []);
    assert.ok(states.every(state => state.disabled && !state.downloading));
    await assert.rejects(service.connectSwarm('previously-saved-swarm'), /désactivé/);
    await assert.rejects(service.waitUntilReady(), /désactivé/);
    await assert.rejects(service.waitForRequestAgent(), /désactivé/);
    await service.onStop();
});

test('direct installer and legacy sidecar cannot bypass product policy', async () => {
    const manager = new FabiRuntimeManager();
    assert.equal(manager.findParallax(), undefined);
    assert.equal(manager.findRequestAgent(), undefined);
    assert.equal(manager.status().disabled, true);
    await assert.rejects(manager.ensureRuntime(), /désactivé/);
    await assert.rejects(installRuntime(() => { throw Error('Unexpected download'); }), /désactivé/);
    const service = new FabiCodeServiceImpl();
    await assert.rejects(service.launch(), /désactivé/);
    await assert.rejects(service.ensureCurrentServer(), /désactivé/);
});

test('Maestro keeps external agent observation without waiting for the Swarm sidecar', async () => {
    const service = new FabiMaestroServiceImpl();
    let scans = 0;
    service.ensureHooks = async () => {};
    service.scanExternal = async () => { scans++; };
    service.ensureBaseUrl = async () => { throw Error('Unexpected sidecar wait'); };
    await service.run();
    try {
        assert.equal(scans, 1);
        assert.ok(service.extTimer);
        assert.equal(service.pollTimer, undefined);
        await service.refreshSessions();
    } finally { clearInterval(service.extTimer); }
});
