'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { prepareWorkerBootstrap } = require('../lib/node/fabi-worker-bootstrap');
const { buildWorkerEnv } = require('../lib/node/fabi-worker-tuning');

function rootBytes() {
    return Buffer.from(JSON.stringify({
        signed: { _type: 'root', version: 1 },
        signatures: [{ keyid: 'test', sig: '00' }]
    }));
}

function profile(rootSha256) {
    return {
        protocolVersion: 3,
        transport: 'iroh',
        relayUrl: 'https://relay.example:4443',
        enrollmentUrl: 'https://registry.example/v1/network/enroll',
        catalogDhtBootstraps: ['/dns4/bootstrap.example/tcp/19191/p2p/12D3KooWTest'],
        modelRegistry: {
            rootUrl: 'https://registry.example/tuf/1.root.json',
            rootSha256,
            metadataUrl: 'https://registry.example/tuf/metadata/',
            targetsUrl: 'https://registry.example/tuf/targets/'
        }
    };
}

test('prepares a pinned TUF root and a complete secret-free worker environment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fabi-worker-bootstrap-'));
    const bytes = rootBytes();
    const digest = createHash('sha256').update(bytes).digest('hex');
    const previousFetch = global.fetch;
    const previousToken = process.env.FABI_RELAY_TOKEN;
    const previousTokenFile = process.env.FABI_RELAY_TOKEN_FILE;
    let fetches = 0;
    global.fetch = async () => {
        fetches += 1;
        return new Response(bytes, {
            status: 200,
            headers: { 'content-length': String(bytes.length), 'content-type': 'application/json' }
        });
    };
    process.env.FABI_RELAY_TOKEN = 'legacy-secret-that-must-not-leak';
    process.env.FABI_RELAY_TOKEN_FILE = '/legacy/relay.env';
    try {
        const contract = profile(digest);
        const prepared = await prepareWorkerBootstrap(contract, {
            XDG_DATA_HOME: root,
            FABI_MODEL_REGISTRY_ROOT_SHA256: digest
        });
        assert.deepEqual(readFileSync(prepared.rootPath), bytes);
        if (process.platform !== 'win32') {
            assert.equal(statSync(prepared.rootPath).mode & 0o777, 0o600);
        }
        // Cached, already verified root avoids another network request.
        assert.deepEqual(
            await prepareWorkerBootstrap(contract, {
                XDG_DATA_HOME: root,
                FABI_MODEL_REGISTRY_ROOT_SHA256: digest
            }),
            prepared
        );
        assert.equal(fetches, 1);

        const env = buildWorkerEnv(contract, prepared, 'qwen/unsafe-id');
        assert.equal(env.FABI_NETWORK_TRANSPORT, 'iroh');
        assert.equal(env.FABI_RELAY_URL, contract.relayUrl);
        assert.equal(env.FABI_RELAY_ENROLLMENT_URL, contract.enrollmentUrl);
        assert.equal(env.FABI_CATALOG_DHT_MODE, 'client');
        assert.equal(env.FABI_SWARM_V3_MODE, 'active');
        assert.equal(env.FABI_SWARM_V3_PLACEMENT, 'autonomous');
        assert.match(env.FABI_SWARM_V3_STATE_DIR, /qwen_unsafe-id/);
        assert.equal(env.FABI_MODEL_REGISTRY_ROOT, prepared.rootPath);
        assert.equal(env.FABI_RELAY_TOKEN, undefined);
        assert.equal(env.FABI_RELAY_TOKEN_FILE, undefined);
    } finally {
        global.fetch = previousFetch;
        if (previousToken === undefined) delete process.env.FABI_RELAY_TOKEN;
        else process.env.FABI_RELAY_TOKEN = previousToken;
        if (previousTokenFile === undefined) delete process.env.FABI_RELAY_TOKEN_FILE;
        else process.env.FABI_RELAY_TOKEN_FILE = previousTokenFile;
        rmSync(root, { recursive: true, force: true });
    }
});

test('rejects a registry root not pinned by the IDE before downloading it', async () => {
    const contract = profile('ab'.repeat(32));
    await assert.rejects(
        prepareWorkerBootstrap(contract, { FABI_MODEL_REGISTRY_ROOT_SHA256: 'cd'.repeat(32) }),
        /non qualifiée/
    );
});
