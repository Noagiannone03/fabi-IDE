'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { FabiCodeTurnEventGate } = require('../lib/common/fabi-code-turn-event-gate');

test('renders events only for the globally active ticket even within one OpenCode session', () => {
    const first = new FabiCodeTurnEventGate('turn-a', 'session-shared');
    const second = new FabiCodeTurnEventGate('turn-b', 'session-shared');

    assert.equal(first.update({
        turnId: 'turn-a', sessionId: 'session-shared', state: 'active', position: 0
    }), true);
    assert.equal(second.update({
        turnId: 'turn-a', sessionId: 'session-shared', state: 'active', position: 0
    }), false);
    assert.equal(first.accepts('session-shared'), true);
    assert.equal(second.accepts('session-shared'), false);

    first.update({ turnId: 'turn-a', sessionId: 'session-shared', state: 'released', position: -1 });
    second.update({ turnId: 'turn-b', sessionId: 'session-shared', state: 'active', position: 0 });
    assert.equal(first.accepts('session-shared'), false);
    assert.equal(second.accepts('session-shared'), true);
    assert.equal(second.accepts('another-session'), false);
});

test('a queued or released ticket cannot consume session events', () => {
    const gate = new FabiCodeTurnEventGate('turn-a', 'session-a');
    gate.update({ turnId: 'turn-a', sessionId: 'session-a', state: 'queued', position: 2 });
    assert.equal(gate.accepts('session-a'), false);
    gate.update({ turnId: 'turn-a', sessionId: 'session-a', state: 'active', position: 0 });
    assert.equal(gate.accepts('session-a'), true);
    gate.update({ turnId: 'turn-a', sessionId: 'session-a', state: 'released', position: -1 });
    assert.equal(gate.accepts('session-a'), false);
});
