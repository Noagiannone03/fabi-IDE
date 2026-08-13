'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { FabiSwarmServiceImpl } = require('../lib/node/fabi-swarm-service');

class ServiceHarness extends FabiSwarmServiceImpl {
    ensureFeed() { /* no network in this contract test */ }
    ensureMetrics() { /* no process sampler in this contract test */ }
    async publishModelStorage() { return { locations: [], workerRestartPending: false }; }
    tryAutoReconnect() { /* no persisted state in this contract test */ }

    publishConnection(connection) {
        this.connection = connection;
        this.broadcast(client => client.onConnectionChanged(connection));
    }
}

const client = () => {
    const connections = [];
    return {
        connections,
        onSwarmsChanged() {},
        onWorkerStateChanged() {},
        onRequestAgentStateChanged() {},
        onRequestAgentActivityChanged() {},
        onActiveSwarmChanged() {},
        onRuntimeStatusChanged() {},
        onConnectionChanged(value) { connections.push(value); },
        onMetricsChanged() {},
        onModelStorageChanged() {}
    };
};

test('fans swarm readiness changes out to every connected Space', () => {
    const service = new ServiceHarness();
    const first = client();
    const second = client();
    service.addClient(first);
    service.addClient(second);

    const rebuilding = {
        reason: 'need-more-peers',
        ready: false,
        headline: 'Route en reconstruction',
        activity: '1 worker prêt — attente d’un chemin complet'
    };
    service.publishConnection(rebuilding);

    assert.deepEqual(first.connections.at(-1), rebuilding);
    assert.deepEqual(second.connections.at(-1), rebuilding);
});

test('removes only the renderer whose RPC connection closed', () => {
    const service = new ServiceHarness();
    const first = client();
    const second = client();
    service.addClient(first);
    service.addClient(second);
    service.removeClient(first);
    const firstCount = first.connections.length;

    const ready = {
        reason: 'ready',
        ready: true,
        headline: 'Connecté',
        activity: 'prêt — tu contribues'
    };
    service.publishConnection(ready);

    assert.equal(first.connections.length, firstCount);
    assert.deepEqual(second.connections.at(-1), ready);
});
