'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    QUALIFIED_OPENCODE_COMMIT,
    QUALIFIED_PARALLAX_COMMIT,
    QUALIFIED_RUNTIME_VERSION,
    parseRuntimeManifest,
    validateRuntimeManifest
} = require('../lib/node/fabi-runtime-install');
const {
    resolveConfiguredWorkerLimits,
    resolveWorkerLimits
} = require('../lib/node/fabi-worker-tuning');

function manifest(overrides = {}) {
    const values = {
        version: QUALIFIED_RUNTIME_VERSION,
        target: 'bun-darwin-arm64',
        accel: 'mlx',
        opencode: QUALIFIED_OPENCODE_COMMIT,
        parallax: QUALIFIED_PARALLAX_COMMIT,
        ...overrides
    };
    return [
        `fabi ${values.version}`,
        `target=${values.target}`,
        'arch=aarch64-apple-darwin',
        `accel=${values.accel}`,
        'python=3.12.9',
        `opencode_revision=${values.opencode}`,
        `parallax_revision=${values.parallax}`,
        'built_at=2026-07-19T12:00:00Z',
        ''
    ].join('\n');
}

const contract = {
    version: QUALIFIED_RUNTIME_VERSION,
    target: 'bun-darwin-arm64',
    accel: 'mlx',
    opencodeRevision: QUALIFIED_OPENCODE_COMMIT,
    parallaxRevision: QUALIFIED_PARALLAX_COMMIT
};

test('accepts only the exact qualified release manifest', () => {
    const parsed = validateRuntimeManifest(manifest(), contract);
    assert.equal(parsed.version, QUALIFIED_RUNTIME_VERSION);
    assert.equal(parsed.values.parallax_revision, QUALIFIED_PARALLAX_COMMIT);
});

test('rejects a runtime built from a different engine revision', () => {
    assert.throws(
        () => validateRuntimeManifest(manifest({ parallax: '0'.repeat(40) }), contract),
        /parallax_revision/
    );
});

test('rejects malformed or ambiguous manifests', () => {
    assert.throws(() => parseRuntimeManifest('not-fabi\naccel=mlx\n'), /en-tête/);
    assert.throws(() => parseRuntimeManifest('fabi v1\naccel=mlx\naccel=cuda\n'), /dupliquée/);
});

test('uses the qualified 32k window and keeps explicit lab overrides', () => {
    const hardware = { accelerator: 'cuda', ramGb: 64, vramGb: 16 };
    assert.equal(resolveWorkerLimits(hardware).maxSequenceLength, '32768');
    assert.deepEqual(
        resolveConfiguredWorkerLimits(hardware, {
            PARALLAX_MAX_SEQUENCE_LENGTH: '65536',
            PARALLAX_KV_BLOCK_SIZE: '16'
        }),
        {
            maxBatchSize: '1',
            maxSequenceLength: '65536',
            maxNumTokensPerBatch: '8192',
            kvBlockSize: '16'
        }
    );
});
