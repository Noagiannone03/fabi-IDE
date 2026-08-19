'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { detectRegistryMetadataExpiry, FabiWorkerEventStream } = require('../lib/node/fabi-swarm-worker');

test('frames split V3 worker events from stdout', () => {
    const state = { kind: 'running', pid: 42, swarmId: 'qwen3-32b-v3' };
    const snapshots = [];
    const stream = new FabiWorkerEventStream(state, () => snapshots.push({ ...state }));

    stream.ingest('[FABI] {"event":"allocated","start_layer":15,');
    stream.ingest('"end_layer":28}\r\n[FABI] {"event":"weights_load_');
    stream.ingest('done","files_total":37}\n');

    assert.equal(snapshots.length, 2);
    assert.deepEqual(snapshots[0], {
        kind: 'running',
        pid: 42,
        swarmId: 'qwen3-32b-v3',
        stage: 'loading-weights',
        startLayer: 15,
        endLayer: 28
    });
    assert.deepEqual(snapshots[1], {
        kind: 'running',
        pid: 42,
        swarmId: 'qwen3-32b-v3',
        stage: 'ready',
        startLayer: 15,
        endLayer: 28,
        weightsFilesTotal: 37,
        weightsFilesDone: 37,
        weightsCurrentFile: undefined
    });
});

test('flushes the last event even without a trailing newline', () => {
    const state = { kind: 'running', pid: 7, swarmId: 'qwen3-32b-v3' };
    const snapshots = [];
    const stream = new FabiWorkerEventStream(state, () => snapshots.push({ ...state }));

    stream.ingest('[FABI] {"event":"peer_id","peer_id":"worker-endpoint"}');
    assert.equal(snapshots.length, 0);
    stream.flush();

    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].peerId, 'worker-endpoint');
    assert.equal(snapshots[0].stage, 'handshake');
});

test('keeps measured file progress when the ready event omits counters', () => {
    const state = { kind: 'running', pid: 68, swarmId: 'qwen3-32b-v3' };
    const snapshots = [];
    const stream = new FabiWorkerEventStream(state, () => snapshots.push({ ...state }));

    stream.ingest('[FABI] {"event":"weights_load_start"}\n');
    stream.ingest('[FABI] {"event":"weights_load_progress","files_done":16,"files_total":37}\n');
    stream.ingest('[FABI] {"event":"weights_load_done"}\n');

    assert.equal(snapshots.length, 3);
    assert.equal(snapshots[1].stage, 'loading-weights');
    assert.equal(snapshots[1].weightsFilesDone, 16);
    assert.equal(snapshots[1].weightsFilesTotal, 37);
    assert.equal(snapshots[2].stage, 'ready');
    assert.equal(snapshots[2].weightsFilesDone, 37);
    assert.equal(snapshots[2].weightsFilesTotal, 37);
});

test('reduces expired TUF stderr to a bounded public worker failure', () => {
    assert.deepEqual(
        detectRegistryMetadataExpiry('tuf.api.exceptions.ExpiredMetadataError: snapshot.json is expired'),
        {
            failureCode: 'registry-metadata-expired',
            failureRole: 'snapshot',
            message: 'métadonnée TUF snapshot.json expirée'
        }
    );
    assert.equal(detectRegistryMetadataExpiry('authorization=secret-value'), undefined);
});

test('clears a previous registry expiry as soon as a retry publishes progress', () => {
    const state = {
        kind: 'running',
        failureCode: 'registry-metadata-expired',
        failureRole: 'timestamp',
        message: 'métadonnée TUF timestamp.json expirée'
    };
    let progressed = false;
    const stream = new FabiWorkerEventStream(state, () => undefined, () => { progressed = true; });

    stream.ingest('[FABI] {"event":"joining_scheduler"}\n');

    assert.equal(progressed, true);
    assert.equal(state.failureCode, undefined);
    assert.equal(state.failureRole, undefined);
    assert.equal(state.message, undefined);
    assert.equal(state.stage, 'joining');
});
