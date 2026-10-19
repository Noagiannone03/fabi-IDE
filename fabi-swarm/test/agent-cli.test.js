require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FabiAgentCliServiceImpl } = require('../lib/node/fabi-agent-cli-service');

test('CLI discovery loads interactive shell configuration and ignores startup chatter', { skip: process.platform !== 'darwin' }, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-cli-test-'));
    const previous = { SHELL: process.env.SHELL, ZDOTDIR: process.env.ZDOTDIR, PATH: process.env.PATH };
    try {
        await fs.mkdir(path.join(dir, 'bin'));
        for (const id of ['codex', 'opencode']) {
            await fs.writeFile(path.join(dir, 'bin', id), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        }
        await fs.writeFile(path.join(dir, '.zshrc'), `export PATH='${dir}/bin:/usr/bin:/bin'\necho 'claude gemini'\n`);
        process.env.SHELL = '/bin/zsh'; process.env.ZDOTDIR = dir; process.env.PATH = '/usr/bin:/bin';
        assert.deepEqual(await new FabiAgentCliServiceImpl().installed(), ['codex', 'opencode']);
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('CLI discovery only accepts exact probe markers', async () => {
    const service = new FabiAgentCliServiceImpl();
    service.runAgent = async () => ({ code: 0, stdout: 'codex\n__FABI_CLI_opencode__\r\nnoise __FABI_CLI_gemini__\n', stderr: '' });
    assert.deepEqual(await service.installed(), ['opencode']);
});

test('commit context isolates staged changes and gives each source file a bounded excerpt', async () => {
    const service = new FabiAgentCliServiceImpl();
    const calls = [];
    service.git = async (_cwd, args) => {
        calls.push(args);
        if (args.includes('--name-only')) return 'a.ts\0b.ts\0yarn.lock\0';
        if (args.includes('--stat')) return 'a.ts | 1000\nb.ts | 1\nyarn.lock | 5000';
        if (args[0] === 'log') return 'fix: previous change';
        assert.ok(args.includes('--cached'));
        return args.at(-1) === 'a.ts' ? 'A'.repeat(60000) : 'SMALL_FILE_CHANGE';
    };
    const prompt = await service.prompt('/test');
    assert.ok(prompt.length < 30000);
    assert.match(prompt, /SMALL_FILE_CHANGE/);
    assert.match(prompt, /staged changes ONLY/);
    assert.ok(!calls.some(args => args.at(-1) === 'yarn.lock'));
});

test('commit cancellation interrupts the CLI and prevents fallback', async () => {
    const service = new FabiAgentCliServiceImpl();
    service.prompt = async () => 'fixture';
    let ready;
    const started = new Promise(resolve => { ready = resolve; });
    service.withClaude = async (_prompt, signal) => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason)); ready(); });
    service.withCodex = async () => { assert.fail('must not start after cancellation'); };
    const result = service.commitMessage('/test', 'cancel-test');
    await started;
    await service.cancelCommitMessage('cancel-test');
    await assert.rejects(result, /annulée/);
    assert.equal(service.commits.size, 0);
});

test('expired Claude auth falls back once and reports failure clearly', async () => {
    const service = new FabiAgentCliServiceImpl();
    service.prompt = async () => 'fixture';
    service.withClaude = async () => { throw new Error('OAuth session expired'); };
    service.withCodex = async () => 'fix: explain changes';
    assert.equal(await service.commitMessage('/test'), 'fix: explain changes');
    service.withCodex = async () => { throw new Error('Codex unavailable'); };
    await assert.rejects(service.commitMessage('/test'), /connexion expirée.*Codex unavailable/);
});

test('aborting a CLI run settles promptly and stops its process', { skip: process.platform === 'win32' }, async () => {
    const service = new FabiAgentCliServiceImpl();
    const controller = new AbortController();
    const promise = service.runAgent('sleep 30', '', controller.signal);
    setTimeout(() => controller.abort(new Error('cancelled-test')), 50);
    await assert.rejects(promise, /cancelled-test/);
});
