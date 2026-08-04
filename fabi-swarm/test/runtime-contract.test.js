'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const {
    existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} = require('node:fs');
const http = require('node:http');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Writable } = require('node:stream');
const test = require('node:test');
const {
    QUALIFIED_NATIVE_NETWORK_VERSION,
    QUALIFIED_OPENCODE_COMMIT,
    QUALIFIED_PARALLAX_COMMIT,
    QUALIFIED_RUNTIME_VERSION,
    activateManagedRuntime,
    createDownloadProgressReporter,
    downloadResumable,
    fetchRuntimeMetadata,
    managedRuntimePathsIn,
    installedRuntimeProblem,
    parallaxCommandIn,
    parseRuntimeManifest,
    pruneManagedRuntimeBackups,
    relocateBundledRuntime,
    requestAgentCommandIn,
    writeWithBackpressure,
    zstdHelperArtifactFor,
    validateRuntimeManifest
} = require('../lib/node/fabi-runtime-install');
const {
    isParallaxWorkerCommand,
    resolveConfiguredWorkerLimits,
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
        nativeNetwork: QUALIFIED_NATIVE_NETWORK_VERSION,
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
        `native_network_version=${values.nativeNetwork}`,
        'built_at=2026-07-19T12:00:00Z',
        ''
    ].join('\n');
}

const contract = {
    version: QUALIFIED_RUNTIME_VERSION,
    target: 'bun-darwin-arm64',
    accel: 'mlx',
    opencodeRevision: QUALIFIED_OPENCODE_COMMIT,
    parallaxRevision: QUALIFIED_PARALLAX_COMMIT,
    nativeNetworkVersion: QUALIFIED_NATIVE_NETWORK_VERSION
};

test('accepts only the exact qualified release manifest', () => {
    const parsed = validateRuntimeManifest(manifest(), contract);
    assert.equal(parsed.version, QUALIFIED_RUNTIME_VERSION);
    assert.equal(parsed.values.parallax_revision, QUALIFIED_PARALLAX_COMMIT);
    assert.equal(parsed.values.native_network_version, QUALIFIED_NATIVE_NETWORK_VERSION);
});

test('selects the release-scoped standalone decompressor for every OS', () => {
    assert.equal(zstdHelperArtifactFor({
        os: 'darwin',
        arch: 'arm64',
        accel: 'mlx',
        tag: 'darwin-arm64-mlx',
        artifact: 'fabi-darwin-arm64-mlx.tar.zst'
    }), 'fabi-unzstd-darwin-arm64-mlx');
    assert.equal(zstdHelperArtifactFor({
        os: 'windows',
        arch: 'x64',
        accel: 'cuda',
        tag: 'windows-x64-cuda',
        artifact: 'fabi-windows-x64-cuda.tar.zst'
    }), 'fabi-unzstd-windows-x64-cuda.exe');
});

test('bounds runtime download memory with Node writable backpressure', async () => {
    let flushed = false;
    const destination = new Writable({
        highWaterMark: 1,
        write(_chunk, _encoding, callback) {
            setTimeout(() => {
                flushed = true;
                callback();
            }, 5);
        }
    });
    await writeWithBackpressure(destination, Buffer.alloc(64 * 1024));
    assert.equal(flushed, true);
    destination.end();

    const broken = new Writable({
        highWaterMark: 1,
        write(_chunk, _encoding, callback) {
            callback(new Error('disk full'));
        }
    });
    await assert.rejects(
        writeWithBackpressure(broken, Buffer.alloc(64 * 1024)),
        /disk full/
    );
});

test('deduplicates runtime download progress without a polling timer', () => {
    const updates = [];
    const report = createDownloadProgressReporter(update => updates.push(update));
    report(0.1);
    report(0.2);
    report(0.9);
    report(1.1);
    report(1.4);
    report(100, 'préparation');
    report(100, 'préparation');
    assert.deepEqual(updates, [
        { phase: 'download', percent: 0, message: undefined },
        { phase: 'download', percent: 1, message: undefined },
        { phase: 'download', percent: 100, message: 'préparation' }
    ]);
});

test('resumes an interrupted runtime download only with the same strong ETag', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fabi-runtime-download-'));
    const destination = join(root, 'runtime.tar.zst');
    const payload = Buffer.alloc(256 * 1024, 0x5a);
    const requests = [];
    const server = http.createServer((request, response) => {
        requests.push({
            range: request.headers.range,
            ifRange: request.headers['if-range']
        });
        if (requests.length === 1) {
            response.writeHead(200, {
                ETag: '"release-v1"',
                'Content-Length': String(payload.length)
            });
            response.write(payload.subarray(0, 64 * 1024));
            setTimeout(() => response.destroy(), 5);
            return;
        }
        const match = /^bytes=([0-9]+)-$/.exec(request.headers.range ?? '');
        const start = Number(match?.[1] ?? -1);
        assert.ok(start > 0 && start < payload.length);
        assert.equal(request.headers['if-range'], '"release-v1"');
        response.writeHead(206, {
            ETag: '"release-v1"',
            'Content-Length': String(payload.length - start),
            'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}`
        });
        response.end(payload.subarray(start));
    });
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        await downloadResumable(
            `http://127.0.0.1:${address.port}/runtime`,
            destination,
            () => undefined,
            { attempts: 2, delayMs: () => 0 }
        );
        assert.deepEqual(readFileSync(destination), payload);
        assert.equal(requests.length, 2);
    } finally {
        await new Promise(resolve => server.close(resolve));
        rmSync(root, { recursive: true, force: true });
    }
});

test('does not retry a deterministic runtime download failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fabi-runtime-download-'));
    const destination = join(root, 'runtime.tar.zst');
    let requests = 0;
    const server = http.createServer((_request, response) => {
        requests++;
        response.writeHead(404);
        response.end('missing');
    });
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        await assert.rejects(
            downloadResumable(
                `http://127.0.0.1:${address.port}/runtime`,
                destination,
                () => undefined,
                { attempts: 3, delayMs: () => 0 }
            ),
            /404/
        );
        assert.equal(requests, 1);
    } finally {
        await new Promise(resolve => server.close(resolve));
        rmSync(root, { recursive: true, force: true });
    }
});

test('retries transient runtime metadata failures but not a missing asset', async () => {
    let transientRequests = 0;
    let missingRequests = 0;
    const server = http.createServer((request, response) => {
        if (request.url === '/transient') {
            transientRequests++;
            if (transientRequests < 3) {
                response.writeHead(500);
                response.end('temporary');
                return;
            }
            response.writeHead(200, { 'Content-Type': 'text/plain' });
            response.end('verified');
            return;
        }
        missingRequests++;
        response.writeHead(404);
        response.end('missing');
    });
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const origin = `http://127.0.0.1:${address.port}`;
        const recovered = await fetchRuntimeMetadata(
            `${origin}/transient`,
            { attempts: 3, delayMs: () => 0 }
        );
        assert.equal(recovered.status, 200);
        assert.equal(await recovered.text(), 'verified');
        assert.equal(transientRequests, 3);

        const missing = await fetchRuntimeMetadata(
            `${origin}/missing`,
            { attempts: 3, delayMs: () => 0 }
        );
        assert.equal(missing.status, 404);
        assert.equal(missingRequests, 1);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

test('rejects a runtime built from a different engine revision', () => {
    assert.throws(
        () => validateRuntimeManifest(manifest({ parallax: '0'.repeat(40) }), contract),
        /parallax_revision/
    );
});

test('explains a present but unqualified runtime instead of reporting it absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'fabi-runtime-diagnostic-'));
    const previousInstall = process.env.FABI_INSTALL;
    try {
        process.env.FABI_INSTALL = root;
        const bin = join(root, 'bin');
        const venv = join(root, 'runtime', 'parallax-venv', 'bin');
        mkdirSync(bin, { recursive: true });
        mkdirSync(venv, { recursive: true });
        writeFileSync(join(bin, 'fabi'), '');
        writeFileSync(join(venv, 'parallax'), '');
        writeFileSync(join(venv, 'fabi-request-agent'), '');
        writeFileSync(join(root, 'MANIFEST'), manifest({ parallax: '0'.repeat(40) }));
        assert.match(installedRuntimeProblem(), /mise à jour du moteur requise/);
        assert.match(installedRuntimeProblem(), /parallax_revision/);
    } finally {
        if (previousInstall === undefined) {
            delete process.env.FABI_INSTALL;
        } else {
            process.env.FABI_INSTALL = previousInstall;
        }
        rmSync(root, { recursive: true, force: true });
    }
});

test('rejects a runtime without the qualified native V3 transport', () => {
    assert.throws(
        () => validateRuntimeManifest(manifest({ nativeNetwork: 'not-bundled' }), contract),
        /native_network_version/
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

test('uses relocatable Python module commands on Windows', () => {
    const root = mkdtempSync(join(tmpdir(), 'fabi-runtime-command-'));
    try {
        const scripts = join(root, 'runtime', 'parallax-venv', 'Scripts');
        mkdirSync(scripts, { recursive: true });
        writeFileSync(join(scripts, 'python.exe'), '');
        assert.deepEqual(parallaxCommandIn(root, 'win32'), {
            binary: join(scripts, 'python.exe'),
            argsPrefix: ['-m', 'parallax.cli']
        });
        assert.deepEqual(requestAgentCommandIn(root, 'win32'), {
            binary: join(scripts, 'python.exe'),
            argsPrefix: ['-m', 'backend.server.request_agent_frontend']
        });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('activates only managed runtime paths and rolls back atomically', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fabi-runtime-activation-'));
    const install = join(root, 'install');
    const makeStaging = version => {
        const staging = join(root, `staging-${version}`);
        mkdirSync(join(staging, 'bin'), { recursive: true });
        mkdirSync(join(staging, 'runtime'), { recursive: true });
        writeFileSync(join(staging, 'bin', 'fabi'), version);
        writeFileSync(join(staging, 'runtime', 'version'), version);
        writeFileSync(join(staging, 'MANIFEST'), `fabi ${version}\n`);
        writeFileSync(
            join(staging, '.fabi-managed-paths'),
            'bin\nruntime\nMANIFEST\n.fabi-managed-paths\n'
        );
        return staging;
    };
    try {
        const first = makeStaging('first');
        assert.deepEqual(managedRuntimePathsIn(first), [
            'bin', 'runtime', 'MANIFEST', '.fabi-managed-paths'
        ]);
        await activateManagedRuntime(first, install, async () => undefined);
        mkdirSync(join(install, 'network'), { recursive: true });
        writeFileSync(join(install, 'network', 'identity.key'), 'persistent');

        const second = makeStaging('second');
        const firstBackup = await activateManagedRuntime(second, install, async () => undefined);
        assert.ok(firstBackup);
        assert.equal(readFileSync(join(install, 'runtime', 'version'), 'utf8'), 'second');
        assert.equal(
            readFileSync(join(install, 'network', 'identity.key'), 'utf8'),
            'persistent'
        );

        const third = makeStaging('third');
        const secondBackup = await activateManagedRuntime(third, install, async () => undefined);
        assert.ok(secondBackup);
        assert.notEqual(secondBackup, firstBackup);
        assert.equal(readFileSync(join(install, 'runtime', 'version'), 'utf8'), 'third');
        assert.equal(readFileSync(join(secondBackup, 'runtime', 'version'), 'utf8'), 'second');
        assert.equal(existsSync(firstBackup), false);
        assert.deepEqual(pruneManagedRuntimeBackups(install, secondBackup), []);

        const broken = makeStaging('broken');
        await assert.rejects(
            activateManagedRuntime(broken, install, async () => {
                throw new Error('import failed');
            }),
            /import failed/
        );
        assert.equal(readFileSync(join(install, 'runtime', 'version'), 'utf8'), 'third');
        assert.equal(
            readFileSync(join(install, 'network', 'identity.key'), 'utf8'),
            'persistent'
        );
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

test('delegates live RAM and VRAM admission to the initialized runtime on every OS', () => {
    assert.deepEqual(
        resolveMemoryReserveEnv({ accelerator: 'apple-silicon', ramGb: 16 }),
        {}
    );
    assert.deepEqual(
        resolveMemoryReserveEnv({ accelerator: 'generic', ramGb: 32 }),
        {}
    );
    assert.deepEqual(
        resolveMemoryReserveEnv({ accelerator: 'cuda', ramGb: 16, vramGb: 8 }),
        {}
    );
    assert.deepEqual(
        resolveMemoryReserveEnv({ accelerator: 'cuda', ramGb: 32, vramGb: 16 }),
        {}
    );
});

test('orphan cleanup targets worker roots without killing the Request Agent', () => {
    const unixRoot = '/Users/fabi/.local/share/fabi/runtime';
    assert.equal(isParallaxWorkerCommand(
        `${unixRoot}/parallax-venv/bin/parallax join -s scheduler`, unixRoot
    ), true);
    assert.equal(isParallaxWorkerCommand(
        `${unixRoot}/parallax-venv/bin/python ${unixRoot}/parallax-src/src/parallax/launch.py --scheduler-addr peer`,
        unixRoot
    ), true);
    assert.equal(isParallaxWorkerCommand(
        `${unixRoot}/parallax-venv/bin/fabi-request-agent --host 127.0.0.1`, unixRoot
    ), false);

    const windowsRoot = 'C:\\Users\\fabi\\AppData\\Local\\fabi\\runtime';
    assert.equal(isParallaxWorkerCommand(
        `${windowsRoot}\\python-base\\python.exe -m parallax.cli join -s scheduler`, windowsRoot
    ), true);
    assert.equal(isParallaxWorkerCommand(
        `${windowsRoot}\\python-base\\python.exe -m backend.server.request_agent_frontend --host 127.0.0.1`,
        windowsRoot
    ), false);
});
