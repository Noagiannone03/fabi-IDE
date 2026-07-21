'use strict';

const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const {
    QUALIFIED_OPENCODE_COMMIT,
    QUALIFIED_PARALLAX_COMMIT,
    QUALIFIED_RUNTIME_VERSION,
    parseRuntimeManifest,
    relocateBundledRuntime,
    validateRuntimeManifest
} = require('../lib/node/fabi-runtime-install');
const {
    resolveCudaSystemReserveGb,
    resolveConfiguredWorkerLimits,
    resolveHostSystemReserveGb,
    resolveMemoryReserveEnv,
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

test('relocates only the exact files declared by the runtime manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'fabi-runtime-contract-'));
    try {
        const runtime = join(root, 'runtime');
        const scripts = join(runtime, 'parallax-venv', 'Scripts');
        mkdirSync(scripts, { recursive: true });
        writeFileSync(join(runtime, 'relocation-manifest.txt'), [
            'runtime/pyvenv.cfg',
            'runtime/parallax-venv/Scripts/parallax.exe.launcher',
            ''
        ].join('\n'));
        writeFileSync(join(runtime, 'pyvenv.cfg'), 'home=__FABI_INSTALL_ROOT__\n');
        writeFileSync(join(scripts, 'parallax.exe.launcher'), 'root=__FABI_INSTALL_ROOT__\n');

        assert.equal(relocateBundledRuntime(root, 'C:\\Fabi Runtime'), 2);
        assert.equal(readFileSync(join(runtime, 'pyvenv.cfg'), 'utf8'), 'home=C:\\Fabi Runtime\n');
        assert.equal(readFileSync(join(scripts, 'parallax.exe.launcher'), 'utf8'), 'root=C:\\Fabi Runtime\n');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('rejects traversal and undeclared relocation inputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'fabi-runtime-contract-'));
    try {
        const runtime = join(root, 'runtime');
        mkdirSync(runtime, { recursive: true });
        writeFileSync(join(runtime, 'relocation-manifest.txt'), 'runtime/../escape.txt\n');
        assert.throws(() => relocateBundledRuntime(root, '/opt/fabi'), /invalide/);

        writeFileSync(join(runtime, 'relocation-manifest.txt'), 'runtime/missing.txt\n');
        assert.throws(() => relocateBundledRuntime(root, '/opt/fabi'), /absent/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
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

test('applies the same live-memory reserve policy on macOS, Windows and Linux', () => {
    assert.equal(resolveHostSystemReserveGb(16), 3.2);
    assert.equal(resolveHostSystemReserveGb(32), 6.4);
    assert.equal(resolveHostSystemReserveGb(48), 9.6);
    assert.equal(resolveHostSystemReserveGb(128), 12);
    assert.equal(resolveCudaSystemReserveGb(8), 2);
    assert.equal(resolveCudaSystemReserveGb(16), 1.5);

    assert.deepEqual(
        resolveMemoryReserveEnv({ accelerator: 'apple-silicon', ramGb: 16 }),
        {}
    );
    assert.deepEqual(
        resolveMemoryReserveEnv({ accelerator: 'generic', ramGb: 32 }),
        {}
    );
    assert.deepEqual(
        resolveMemoryReserveEnv({ accelerator: 'cuda', ramGb: 32, vramGb: 16 }),
        {
            PARALLAX_CUDA_SYSTEM_RESERVE_GB: '1.5'
        }
    );
});
