const assert = require('node:assert/strict');
const test = require('node:test');

const {
    classifyOpenCodeTurnStatus,
    hasNewCompletedAssistantMessage,
    snapshotAssistantMessageIds
} = require('../lib/node/fabi-code-turn-state');

test('does not mistake the prompt_async acknowledgement gap for an idle turn', () => {
    assert.equal(classifyOpenCodeTurnStatus({}, 'session-1', false), 'unobserved');
    assert.equal(classifyOpenCodeTurnStatus({}, 'session-1', true), 'settled');
    assert.equal(classifyOpenCodeTurnStatus({ 'session-1': { type: 'idle' } }, 'session-1', false), 'unobserved');
    assert.equal(classifyOpenCodeTurnStatus({ 'session-1': { type: 'idle' } }, 'session-1', true), 'settled');
    assert.equal(classifyOpenCodeTurnStatus({ 'session-1': { type: 'busy' } }, 'session-1', false), 'active');
    assert.equal(classifyOpenCodeTurnStatus({ 'session-1': { type: 'retry' } }, 'session-1', false), 'active');
    assert.equal(classifyOpenCodeTurnStatus({ 'session-1': { type: 'future-state' } }, 'session-1', false), 'active');
});

test('reconciles a fully missed turn from durable assistant history', () => {
    const before = [
        { info: { id: 'user-old', role: 'user' } },
        { info: { id: 'assistant-old', role: 'assistant', finish: 'stop' } }
    ];
    const baseline = snapshotAssistantMessageIds(before);
    assert.deepEqual([...baseline], ['assistant-old']);
    assert.equal(hasNewCompletedAssistantMessage([
        ...before,
        { info: { id: 'user-new', role: 'user' } },
        { info: { id: 'assistant-new', role: 'assistant' } }
    ], baseline), false);
    assert.equal(hasNewCompletedAssistantMessage([
        ...before,
        { info: { id: 'assistant-new', role: 'assistant', finish: 'length' } }
    ], baseline), true);
    assert.equal(hasNewCompletedAssistantMessage([
        ...before,
        { info: { id: 'assistant-new', role: 'assistant', error: { name: 'ProviderError' } } }
    ], baseline), true);
});
