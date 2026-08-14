const test = require('node:test');
const assert = require('node:assert/strict');
const {
    shouldRenderChatInput, canAcceptChatInput
} = require('../lib/common/fabi-chat-input-visibility');

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

test('does not call Theia chat rendering before its model is attached', () => {
    assert.equal(shouldRenderChatInput(true, false, true, false), false);
});

test('accepts another message while the machine-wide owner is active', () => {
    assert.equal(canAcceptChatInput(false, 1, true), true);
});

test('does not bypass first admission or invent capacity after the turn ends', () => {
    assert.equal(canAcceptChatInput(false, 1, false), false);
    assert.equal(canAcceptChatInput(false, 0, true), false);
    assert.equal(canAcceptChatInput(true, 0, false), true);
});
