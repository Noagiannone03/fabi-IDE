import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopEnvironment } from './desktop-environment.mjs';

test('desktop launch isolates terminal colors from the parent automation environment', () => {
    const source = { TERM: 'dumb', COLORTERM: '', NO_COLOR: '1', FORCE_COLOR: '0', PATH: '/bin', HOME: '/home/test' };
    const env = desktopEnvironment(source);
    assert.equal(env.TERM, 'xterm-256color');
    assert.equal(env.COLORTERM, 'truecolor');
    assert.equal('NO_COLOR' in env, false);
    assert.equal('FORCE_COLOR' in env, false);
    assert.equal(env.PATH, source.PATH);
    assert.equal(env.HOME, source.HOME);
    assert.equal(source.NO_COLOR, '1');
});
