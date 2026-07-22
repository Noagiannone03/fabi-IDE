const test = require('node:test');
const assert = require('node:assert/strict');
const { FABI_CODE_MODES, normalizeFabiCodeMode } = require('../lib/common/fabi-code-mode');

test('exposes build and plan through the native Theia chat-mode contract', () => {
    assert.deepEqual(FABI_CODE_MODES, [
        { id: 'build', name: 'Agent', isDefault: true },
        { id: 'plan', name: 'Ask' }
    ]);
});

test('forwards only supported OpenCode primary agents', () => {
    assert.equal(normalizeFabiCodeMode('plan'), 'plan');
    assert.equal(normalizeFabiCodeMode('build'), 'build');
    assert.equal(normalizeFabiCodeMode('anything-else'), 'build');
    assert.equal(normalizeFabiCodeMode(undefined), 'build');
});
