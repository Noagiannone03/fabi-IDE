'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { FabiModelStorage } = require('../lib/node/fabi-model-storage');

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'fabi-model-storage-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const primary = join(root, 'primary');
    const selected = join(root, 'external-volume');
    mkdirSync(primary, { recursive: true });
    mkdirSync(selected, { recursive: true });
    return {
        root,
        primary,
        selected,
        storage: new FabiModelStorage(join(root, 'config.json'), {
            FABI_MODEL_ARTIFACT_CACHE: primary,
            FABI_MODEL_CACHE_MIN_FREE_BYTES: '1234567'
        })
    };
}

test('authorizes only a dedicated Fabi subdirectory and reports exact volume policy', async t => {
    const { storage, primary, selected } = fixture(t);
    const snapshot = await storage.addParent(selected);
    const target = join(selected, 'Fabi', 'model-cache');

    assert.equal(existsSync(target), true);
    assert.deepEqual(storage.environment(), {
        primaryPath: realpathSync(primary),
        extraPaths: [realpathSync(target)]
    });
    assert.equal(snapshot.locations.length, 2);
    assert.equal(snapshot.locations[0].kind, 'primary');
    assert.equal(snapshot.locations[0].minimumFreeBytes, 1234567);
    assert.equal(snapshot.locations[1].available, true);
    assert.equal(snapshot.locations[1].writable, true);
});

test('deduplicates a selected cache root and never deletes it when authorization is removed', async t => {
    const { storage, selected } = fixture(t);
    const target = join(selected, 'Fabi', 'model-cache');
    await storage.addParent(selected);
    writeFileSync(join(target, 'keep.safetensors'), Buffer.alloc(64));
    await storage.addParent(target);
    assert.equal(storage.environment().extraPaths.length, 1);

    const snapshot = await storage.remove(target);
    assert.equal(storage.environment().extraPaths.length, 0);
    assert.equal(existsSync(join(target, 'keep.safetensors')), true);
    assert.equal(snapshot.locations.length, 1);
});

test('keeps an unplugged authorized volume visible but unavailable without recreating it', async t => {
    const { storage, selected } = fixture(t);
    const target = join(selected, 'Fabi', 'model-cache');
    await storage.addParent(selected);
    rmSync(selected, { recursive: true, force: true });

    const snapshot = await storage.snapshot();
    const extra = snapshot.locations.find(location => location.kind === 'extra');
    assert.equal(extra.available, false);
    assert.equal(existsSync(target), false);
});

test('exposes pending worker restart as state rather than a timeout', async t => {
    const { storage } = fixture(t);
    storage.setRestartPending(true);
    assert.equal((await storage.snapshot()).workerRestartPending, true);
    storage.setRestartPending(false);
    assert.equal((await storage.snapshot()).workerRestartPending, false);
});

test('rejects paths that did not come from an absolute native selection', async t => {
    const { storage } = fixture(t);
    await assert.rejects(storage.addParent('../relative'), /chemin absolu/);
});
