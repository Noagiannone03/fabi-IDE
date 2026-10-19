const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { build } = require('esbuild');

test('bundled backend loads standalone teacher tools without sibling source files or node_modules', { timeout: 30000 }, async t => {
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-bundled-assist-')));
    const runtime = path.join(home, 'runtime'), project = path.join(home, 'project');
    await fs.mkdir(runtime); await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'counter.ts'), 'export const count = 42;\n');
    await fs.copyFile(path.join(__dirname, '../lib/assist-tools.mjs'), path.join(runtime, 'assist-tools.mjs'));
    const executable = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
    const binary = process.platform === 'win32'
        ? path.join(path.dirname(require.resolve(`opencode-windows-${process.arch}/package.json`)), 'bin', executable)
        : path.join(path.dirname(require.resolve('opencode-ai/package.json')), 'bin', '.opencode');
    const launcher = path.join(runtime, executable);
    await fs.copyFile(binary, launcher); await fs.chmod(launcher, 0o755);
    const previous = process.env.FABI_ASSIST_OPENCODE_BIN;
    process.env.FABI_ASSIST_OPENCODE_BIN = launcher;
    let bundled;
    t.after(async () => {
        await bundled?.stopAssistOpenCode();
        if (previous === undefined) delete process.env.FABI_ASSIST_OPENCODE_BIN; else process.env.FABI_ASSIST_OPENCODE_BIN = previous;
        await fs.rm(home, { recursive: true, force: true });
    });
    await build({ stdin: { contents: "export { AssistService } from './assist-service'; export { stopAssistOpenCode } from './opencode-harness';", resolveDir: path.join(__dirname, '../src/node/assist'), loader: 'ts' },
        outfile: path.join(home, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' });
    bundled = require(path.join(home, 'main.cjs'));
    let calls = 0, failure, service;
    const server = http.createServer(async (req, res) => {
        try {
            let body = ''; for await (const part of req) body += part;
            const request = JSON.parse(body), teacher = request.tools?.length > 0;
            if (teacher) {
                calls++;
                assert.ok(request.tools.some(tool => tool.function.name === 'fabi_read'), 'Packaged plugin must be loaded');
                assert.equal(request.tool_choice, 'auto');
                if (calls === 2) assert.ok(request.messages.some(message => message.role === 'tool' && JSON.stringify(message.content).includes('count = 42')));
            }
            const name = calls === 1 ? 'fabi_read' : 'StructuredOutput';
            const args = name === 'fabi_read' ? { path: 'counter.ts' } : { title: 'Une valeur', explanation: 'count vaut 42.', sources: [{ path: 'counter.ts', line: 1 }], concepts: [] };
            const delta = teacher ? { role: 'assistant', tool_calls: [{ index: 0, id: 'packaged-' + calls, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: 'Une valeur' };
            const chunk = { id: 'bundle-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] };
            res.setHeader('content-type', 'text/event-stream');
            res.write('data: ' + JSON.stringify(chunk) + '\n\n');
            res.write('data: ' + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: teacher ? 'tool_calls' : 'stop' }] }) + '\n\n');
            res.end('data: [DONE]\n\n');
        } catch (error) { failure = error; void service?.cancel('bundle-test'); res.writeHead(500); res.end('{}'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const provider = { config: async () => ({ apiKey: 'test-only', model: 'fixture', baseURL: `http://127.0.0.1:${server.address().port}/v1` }) };
    service = new bundled.AssistService(provider, { onProgress() {} }, home);
    t.after(() => service.dispose());
    let book;
    try { book = await service.ask({ id: 'bundle-test', project, mode: 'explore', question: 'Explique count.', context: { path: 'counter.ts' } }); }
    catch (error) { throw failure || error; }
    assert.equal(calls, 2);
    assert.equal(book.turns[0].reply.sources[0].path, 'counter.ts');
    assert.equal(book.turns[0].reply.sources[0].stale, false);
});
