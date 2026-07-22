const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldRenderChatInput } = require('../lib/common/fabi-chat-input-visibility');

test('renders the input when the swarm accepts a new request', () => {
    assert.equal(shouldRenderChatInput(true, false, false), true);
});

test('keeps native cancellation mounted while the only slot is occupied', () => {
    assert.equal(shouldRenderChatInput(false, true, false), true);
});

test('keeps the editor identity after its first scheduler admission', () => {
    assert.equal(shouldRenderChatInput(false, false, true), true);
});

test('does not expose the input before its first scheduler admission', () => {
    assert.equal(shouldRenderChatInput(false, false, false), false);
});
