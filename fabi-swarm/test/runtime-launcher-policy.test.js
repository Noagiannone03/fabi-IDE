'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    LauncherSurfaceHandoff,
    shouldGateRuntime
} = require('../lib/common/fabi-runtime-launcher-policy');

test('keeps the launcher alive until the next surface explicitly takes over', () => {
    const events = [];
    const handoff = new LauncherSurfaceHandoff();
    handoff.hold(() => events.push('launcher-closed'));

    assert.equal(handoff.active, true);
    assert.deepEqual(events, []);
    assert.throws(() => handoff.hold(() => undefined), /already active/);

    events.push('surface-ready');
    assert.equal(handoff.release(), true);
    assert.deepEqual(events, ['surface-ready', 'launcher-closed']);
    assert.equal(handoff.active, false);
    assert.equal(handoff.release(), false);
});

test('a packaged app cannot bypass an incompatible runtime with a dev flag', () => {
    assert.equal(shouldGateRuntime({
        packaged: true,
        forcedInDevelopment: false,
        disabledInDevelopment: true,
        runtimeQualified: false,
        acceleratorSupported: true
    }), true);
});

test('a qualified packaged runtime opens without the installer', () => {
    assert.equal(shouldGateRuntime({
        packaged: true,
        forcedInDevelopment: false,
        disabledInDevelopment: false,
        runtimeQualified: true,
        acceleratorSupported: true
    }), false);
});

test('development remains opt-in and can explicitly disable the launcher', () => {
    const base = {
        packaged: false,
        runtimeQualified: false,
        acceleratorSupported: true
    };
    assert.equal(shouldGateRuntime({
        ...base,
        forcedInDevelopment: false,
        disabledInDevelopment: false
    }), false);
    assert.equal(shouldGateRuntime({
        ...base,
        forcedInDevelopment: true,
        disabledInDevelopment: false
    }), true);
    assert.equal(shouldGateRuntime({
        ...base,
        forcedInDevelopment: true,
        disabledInDevelopment: true
    }), false);
});

test('a machine without a supported accelerator is not trapped in the worker installer', () => {
    assert.equal(shouldGateRuntime({
        packaged: true,
        forcedInDevelopment: false,
        disabledInDevelopment: false,
        runtimeQualified: false,
        acceleratorSupported: false
    }), false);
});
