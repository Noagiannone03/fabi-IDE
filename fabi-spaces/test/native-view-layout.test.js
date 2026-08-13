const assert = require('node:assert/strict');
const test = require('node:test');

const {
    attachNativeView,
    reattachNativeView,
} = require('../lib/electron-main/native-view-layout');

const bounds = { x: 51, y: 35, width: 1329, height: 780 };

function fixture() {
    const calls = [];
    const view = {
        setBounds(value) {
            calls.push(['setBounds', value]);
        },
    };
    const parent = {
        addChildView(value) {
            assert.equal(value, view);
            calls.push(['addChildView']);
        },
        removeChildView(value) {
            assert.equal(value, view);
            calls.push(['removeChildView']);
        },
    };
    return { calls, parent, view };
}

test('attaches before applying bounds so attachment cannot reset the viewport', () => {
    const { calls, parent, view } = fixture();

    attachNativeView(parent, view, bounds);

    assert.deepEqual(calls, [
        ['addChildView'],
        ['setBounds', bounds],
    ]);
});

test('reattaches before reapplying bounds', () => {
    const { calls, parent, view } = fixture();

    reattachNativeView(parent, view, bounds);

    assert.deepEqual(calls, [
        ['removeChildView'],
        ['addChildView'],
        ['setBounds', bounds],
    ]);
});
