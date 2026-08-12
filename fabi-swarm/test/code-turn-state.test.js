const assert = require('node:assert/strict');
const test = require('node:test');

const {
    classifyFabiGoalTurnStatus,
    classifyOpenCodeTurnStatus,
    hasNewCompletedAssistantMessage,
    reduceFabiGoalTurn,
    snapshotAssistantMessageIds
} = require('../lib/node/fabi-code-turn-state');

test('keeps Goal alive across continuations and settles only stable states', () => {
    assert.equal(classifyFabiGoalTurnStatus('active'), 'active');
    assert.equal(classifyFabiGoalTurnStatus('future-running-state'), 'active');
    assert.equal(classifyFabiGoalTurnStatus('complete'), 'settled');
    assert.equal(classifyFabiGoalTurnStatus('paused'), 'settled');
    assert.equal(classifyFabiGoalTurnStatus('budgetLimited'), 'settled');
    assert.equal(classifyFabiGoalTurnStatus(null), 'missing');
});

test('does not settle Goal on duplicate idle before an automatic continuation becomes busy', () => {
    const dispatched = reduceFabiGoalTurn('active', 'continued', false, false);
    assert.deepEqual(dispatched, {
        state: 'active', continuationPending: true, continuationObservedActive: false
    });
    assert.equal(reduceFabiGoalTurn('active', 'settled', true, false).state, 'active');
    assert.equal(reduceFabiGoalTurn('complete', 'settled', true, true).state, 'settled');
});

test('waits for the final wrap-up turn when a Goal reaches its budget', () => {
    assert.equal(reduceFabiGoalTurn('budgetLimited', 'wrapup', false, false).state, 'active');
    assert.equal(reduceFabiGoalTurn('budgetLimited', 'settled', true, false).state, 'active');
    assert.equal(reduceFabiGoalTurn('budgetLimited', 'settled', true, true).state, 'settled');
});

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
