'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldStartMachineWorker } = require('../lib/common/fabi-worker-host-policy');

test('the Electron backend owns the machine-local worker', () => {
    assert.equal(shouldStartMachineWorker({
        electronBackend: true,
        browserWorkerExplicitlyEnabled: false
    }), true);
});

test('a browser UI preview cannot start a competing worker by default', () => {
    assert.equal(shouldStartMachineWorker({
        electronBackend: false,
        browserWorkerExplicitlyEnabled: false
    }), false);
});

test('a deliberate browser-hosted worker remains available for lab use', () => {
    assert.equal(shouldStartMachineWorker({
        electronBackend: false,
        browserWorkerExplicitlyEnabled: true
    }), true);
});

