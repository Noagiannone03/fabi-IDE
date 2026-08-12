const test = require('node:test');
const assert = require('node:assert/strict');
const {
    FABI_CODE_MODES, normalizeFabiCodeMode, openCodeAgentForFabiMode,
    openCodeVariantForFabiMode
} = require('../lib/common/fabi-code-mode');

test('exposes build and plan through the native Theia chat-mode contract', () => {
    assert.deepEqual(FABI_CODE_MODES, [
        { id: 'build', name: 'Agent', isDefault: true },
        { id: 'plan', name: 'Ask' },
        { id: 'goal', name: 'Goal' }
    ]);
});

test('forwards only supported OpenCode primary agents', () => {
    assert.equal(normalizeFabiCodeMode('plan'), 'plan');
    assert.equal(normalizeFabiCodeMode('build'), 'build');
    assert.equal(normalizeFabiCodeMode('goal'), 'goal');
    assert.equal(normalizeFabiCodeMode('anything-else'), 'build');
    assert.equal(normalizeFabiCodeMode(undefined), 'build');
});

test('layers Goal on the build agent with a trusted variant', () => {
    assert.equal(openCodeAgentForFabiMode('goal'), 'build');
    assert.equal(openCodeVariantForFabiMode('goal'), 'fabi-goal');
    assert.equal(openCodeVariantForFabiMode('build'), undefined);
    assert.equal(openCodeAgentForFabiMode('plan'), 'plan');
});
