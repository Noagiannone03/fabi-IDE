'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildFabiCodeConfig,
    FABI_CODE_DEFAULT_CONTEXT_TOKENS,
    recommendedOutputTokens
} = require('../lib/node/fabi-code-config');
const { buildFabiCodeServerArgs } = require('../lib/node/fabi-code-server');

function modelLimit(result, model = 'Qwen/Qwen3-1.7B') {
    return result.config.provider['fabi-swarm'].models[model].limit;
}

test('uses the scheduler context contract instead of a fictitious IDE window', () => {
    const built = buildFabiCodeConfig({
        baseURL: 'https://scheduler.test/v1/',
        model: 'Qwen/Qwen3-1.7B',
        apiKey: 'secret-token',
        maxContextTokens: 32768
    });
    assert.deepEqual(modelLimit(built), { context: 32768, output: 4096 });
    assert.equal(built.config.provider['fabi-swarm'].options.baseURL, 'https://scheduler.test/v1');
    assert.equal(JSON.stringify(built.config).includes('262144'), false);
});

test('derives the OpenCode output reserve from the qualified route window', () => {
    const built = buildFabiCodeConfig({
        baseURL: 'https://scheduler.test/v1',
        model: 'Qwen/Qwen3-1.7B',
        maxContextTokens: 16384
    });
    assert.deepEqual(modelLimit(built), { context: 16384, output: 2048 });
    assert.equal(recommendedOutputTokens(32768), 4096);
    assert.equal(recommendedOutputTokens(65536), 4096);
});

test('keeps an explicit output override for qualified experiments', () => {
    const built = buildFabiCodeConfig({
        baseURL: 'https://scheduler.test/v1',
        model: 'Qwen/Qwen3-1.7B',
        maxContextTokens: 16384,
        maxOutputTokens: 1024
    });
    assert.deepEqual(modelLimit(built), { context: 16384, output: 1024 });
});

test('falls back to the qualified window and never exposes credentials in the restart key', () => {
    const base = {
        baseURL: 'https://scheduler.test/v1',
        model: 'Qwen/Qwen3-1.7B',
        apiKey: 'do-not-leak',
        maxContextTokens: 0
    };
    const built = buildFabiCodeConfig(base);
    assert.equal(modelLimit(built).context, FABI_CODE_DEFAULT_CONTEXT_TOKENS);
    assert.equal(built.key.includes('do-not-leak'), false);
    assert.notEqual(built.key, buildFabiCodeConfig({ ...base, apiKey: 'rotated' }).key);
});

test('caps output to the real context window', () => {
    const built = buildFabiCodeConfig({
        baseURL: 'http://127.0.0.1:8000/v1',
        model: 'tiny',
        maxContextTokens: 2048,
        maxOutputTokens: 4096
    });
    assert.deepEqual(modelLimit(built, 'tiny'), { context: 2048, output: 2048 });
});

test('starts the IDE OpenCode sidecar without a competing Parallax worker', () => {
    assert.deepEqual(buildFabiCodeServerArgs('127.0.0.1', 42123), [
        'serve',
        '--no-parallax',
        '--hostname=127.0.0.1',
        '--port=42123'
    ]);
});
