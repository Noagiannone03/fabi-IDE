'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { deriveConnection, requireContribution } = require('../lib/node/fabi-connection');

const swarm = (overrides = {}) => ({
    id: 'qwen',
    name: 'Qwen',
    schedulerUrl: 'https://scheduler.test',
    schedulerPeer: 'peer-scheduler',
    model: 'Qwen/Qwen3-1.7B',
    status: 'online',
    schedulerStatus: 'waiting',
    peers: 2,
    totalVramGb: 20,
    lastSeen: '2026-07-19T12:00:00Z',
    ...overrides
});

test('asks for a model before starting any worker', () => {
    const state = deriveConnection(undefined, { kind: 'stopped' });
    assert.equal(state.reason, 'pick-model');
    assert.equal(state.ready, false);
});

test('reports the real join and automatic layer allocation stage', () => {
    const state = deriveConnection(swarm(), { kind: 'running', stage: 'joining' });
    assert.equal(state.reason, 'connecting');
    assert.match(state.activity, /allocation des couches/);
});

test('does not claim readiness while an allocated pipeline still loads', () => {
    const state = deriveConnection(
        swarm({ schedulerStatus: 'available', pipelineCount: 1, pipelineReadyCount: 0, pipelineReady: false, nodesInitializing: 1 }),
        { kind: 'running', stage: 'ready', startLayer: 2, endLayer: 28 }
    );
    assert.equal(state.reason, 'loading-model');
    assert.equal(state.ready, false);
    assert.equal(state.layersAssigned, 26);
});

test('becomes ready only with a routable pipeline and a running local worker', () => {
    const state = deriveConnection(
        swarm({ schedulerStatus: 'available', pipelineCount: 1, pipelineReadyCount: 1, pipelineReady: true, nodesActive: 2 }),
        { kind: 'running', stage: 'ready', startLayer: 2, endLayer: 28 }
    );
    assert.equal(state.reason, 'ready');
    assert.equal(state.ready, true);
    assert.equal(state.layersAssigned, 26);
});

test('surfaces capacity, scheduler and worker failures instead of optimistic states', () => {
    assert.equal(
        deriveConnection(swarm({ lastBootstrapResult: 'failed_capacity' }), { kind: 'running', stage: 'loading-weights' }).reason,
        'insufficient-capacity'
    );
    assert.equal(
        deriveConnection(swarm({ status: 'offline' }), { kind: 'running', stage: 'ready' }).reason,
        'scheduler-unreachable'
    );
    assert.equal(
        deriveConnection(swarm(), { kind: 'error', message: 'worker exited' }).reason,
        'worker-crashed'
    );
});

test('keeps the prompt locked until contribution is authorized', () => {
    const transport = deriveConnection(
        swarm({ schedulerStatus: 'available', pipelineReady: true, nodesActive: 2 }),
        { kind: 'running', stage: 'ready' }
    );
    assert.equal(transport.ready, true);

    const pending = requireContribution(transport, { allowed: false, reason: 'no_eligible_worker' });
    assert.equal(pending.ready, false);
    assert.equal(pending.reason, 'contribution-pending');

    const denied = requireContribution(
        transport,
        { allowed: false, reason: 'no_eligible_worker' },
        true
    );
    assert.equal(denied.ready, false);
    assert.equal(denied.reason, 'contribution-required');
    const busy = requireContribution(transport, { allowed: false, reason: 'capacity_reached' }, true);
    assert.equal(busy.ready, false);
    assert.equal(busy.reason, 'contribution-pending');
    assert.match(busy.headline, /déjà utilisée/);
    assert.equal(requireContribution(transport, { allowed: true, reason: 'eligible' }), transport);
});
