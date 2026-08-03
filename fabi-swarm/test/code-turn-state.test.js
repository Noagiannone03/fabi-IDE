const assert = require('node:assert/strict');
const test = require('node:test');

const { isOpenCodeTurnSettled } = require('../lib/node/fabi-code-turn-state');

test('reconciles accepted turns against OpenCode durable session status', () => {
    assert.equal(isOpenCodeTurnSettled({}, 'session-1'), true);
    assert.equal(isOpenCodeTurnSettled({ 'session-1': { type: 'idle' } }, 'session-1'), true);
    assert.equal(isOpenCodeTurnSettled({ 'session-1': { type: 'busy' } }, 'session-1'), false);
    assert.equal(isOpenCodeTurnSettled({ 'session-1': { type: 'retry' } }, 'session-1'), false);
    assert.equal(isOpenCodeTurnSettled({ 'session-1': { type: 'future-state' } }, 'session-1'), false);
});
