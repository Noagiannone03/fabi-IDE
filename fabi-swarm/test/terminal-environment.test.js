const assert = require('node:assert/strict');
const test = require('node:test');
const { initializeTerminalEnvironment } = require('../lib/common/fabi-terminal-environment');

test('backend defaults remove inherited automation color policy, independent of desktop launcher', () => {
    const env = { TERM: 'dumb', NO_COLOR: '1', FORCE_COLOR: '0', COLORTERM: '', PATH: '/bin', SSH_AUTH_SOCK: '/agent', KEEP: 'value' };
    initializeTerminalEnvironment(env);
    assert.deepEqual(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor', PATH: '/bin', SSH_AUTH_SOCK: '/agent', KEEP: 'value' });
    initializeTerminalEnvironment(env);
    assert.equal(env.COLORTERM, 'truecolor');
});
