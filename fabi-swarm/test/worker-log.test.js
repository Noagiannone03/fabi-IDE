const assert = require('node:assert/strict');
const test = require('node:test');
const { workerLogDirectory } = require('../lib/node/fabi-worker-log');

test('worker logs use the native state directory on every supported platform', () => {
    assert.equal(
        workerLogDirectory('darwin', {}, '/Users/fabi'),
        '/Users/fabi/Library/Logs/Fabi'
    );
    assert.equal(
        workerLogDirectory('win32', { LOCALAPPDATA: 'C:\\Users\\fabi\\AppData\\Local' }, 'C:\\Users\\fabi'),
        'C:\\Users\\fabi\\AppData\\Local\\Fabi\\logs'
    );
    assert.equal(
        workerLogDirectory('linux', { XDG_STATE_HOME: '/state' }, '/home/fabi'),
        '/state/fabi/logs'
    );
});

test('worker log paths have deterministic platform fallbacks', () => {
    assert.equal(
        workerLogDirectory('win32', {}, 'C:\\Users\\fabi'),
        'C:\\Users\\fabi\\AppData\\Local\\Fabi\\logs'
    );
    assert.equal(
        workerLogDirectory('linux', {}, '/home/fabi'),
        '/home/fabi/.local/state/fabi/logs'
    );
});
