'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { enforceMandatoryUpdate } = require('../lib/common/fabi-update-gate');

test('continues when the current signed app is already latest', async () => {
    let blocked = false;
    await enforceMandatoryUpdate(
        async () => undefined,
        async () => { blocked = true; return new Promise(() => undefined); }
    );
    assert.equal(blocked, false);
});

test('keeps the old signed app usable when discovery is unavailable', async () => {
    const failure = new Error('cdn unavailable');
    let observed;
    await enforceMandatoryUpdate(
        async () => { throw failure; },
        async () => new Promise(() => undefined),
        error => { observed = error; }
    );
    assert.equal(observed, failure);
});

test('hands control permanently to the mandatory surface after discovery', async () => {
    const update = { version: '1.2.0' };
    const blocked = new Error('blocked by update UI');
    await assert.rejects(
        enforceMandatoryUpdate(
            async () => update,
            async value => {
                assert.equal(value, update);
                throw blocked;
            }
        ),
        blocked
    );
});
