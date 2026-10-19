const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { JarvisProvider } = require('../lib/node/assist/jarvis-provider');
const { AssistService } = require('../lib/node/assist/assist-service');
const { writeJson, projectDirectory } = require('../lib/node/assist/assist-store');

async function fixture(t) {
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-jarvis-test-')));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const project = path.join(home, 'project');
    await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'counter.ts'), 'export const count = 42;\n');
    return { home, project };
}
const key = 'inference-fixture-private';
const model = 'jarvis-heretic-122b';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('Jarvis reports the actual loaded model and never exposes credentials to the renderer', async t => {
    const { home } = await fixture(t);
    const file = path.join(home, 'jarvis-provider.json');
    let calls = 0;
    const provider = new JarvisProvider(home, async (url, init) => {
        calls++; assert.equal(url, 'https://gpu.example/v1/models');
        assert.equal(init.headers.Authorization, `Bearer ${key}`);
        return json({ data: [{ id: model }] });
    });
    assert.equal((await provider.account()).connected, false);
    await writeJson(file, { apiKey: key, model, pausedReason: 'Le GPU attend la recharge RunPod.' });
    assert.match((await provider.account()).detail, /recharge/);
    assert.equal(calls, 0, 'A paused deployment must not call a deleted pod');
    await writeJson(file, { apiKey: key, model, baseURL: 'https://gpu.example/v1/' });
    const account = await provider.account();
    assert.equal(account.connected, true);
    assert.equal(account.selectedModel, model);
    assert.equal(JSON.stringify(account).includes(key), false);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    for (const status of [401, 429, 502, 503]) {
        const unavailable = new JarvisProvider(home, async () => json({ leaked: key }, status));
        const result = await unavailable.account();
        assert.equal(result.connected, false);
        assert.equal(JSON.stringify(result).includes(key), false);
    }
    const wrong = new JarvisProvider(home, async () => json({ data: [{ id: 'other' }] }));
    assert.match((await wrong.account()).detail, /pas chargé/);
});

test('GPU transport errors redact server content and cancellation reaches the HTTP request', async t => {
    const { home } = await fixture(t);
    await writeJson(path.join(home, 'jarvis-provider.json'), { apiKey: key, baseURL: 'https://gpu.example/v1' });
    const failed = new JarvisProvider(home, async () => json({ error: key }, 503));
    await assert.rejects((await failed.model(new AbortController().signal)).invoke('hello'), error => !error.message.includes(key) && /arrêté|démarre/.test(error.message));
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const controller = new AbortController();
    const slow = new JarvisProvider(home, async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); started();
    }));
    const pending = (await slow.model(controller.signal)).invoke('hello');
    const rejection = assert.rejects(pending);
    await ready; controller.abort(); await rejection;
});


test('OpenCode exposes its completion tool, reads code and persists a structured answer', { timeout: 60000 }, async t => {
    const { stopAssistOpenCode } = require('../lib/node/assist/opencode-harness');
    const { home, project } = await fixture(t);
    await fs.writeFile(path.join(project, '.env'), 'PRIVATE_MARKER_MUST_NOT_REACH_MODEL');
    const calls = [];
    let failure;
    let service;
    const lesson = { title: 'Une constante', explanation: 'count vaut 42.', sources: [{ path: 'counter.ts', line: 1 }], concepts: [], knowledge: { claims: [{ text: 'count vaut 42.', kind: 'code', sources: [{ path: 'counter.ts', line: 1 }] }], uncertainties: [] } };
    let scratchSession;
    const server = http.createServer(async (req, res) => {
        try {
            let body = ''; for await (const part of req) body += part;
            const request = JSON.parse(body);
            const tools = request.tools?.map(tool => tool.function.name) ?? [];
            if (tools.length) assert.equal(request.chat_template_kwargs?.enable_thinking, false, 'The GPU should not spend the response budget on hidden reasoning');
            const teacher = tools.length > 0;
            if (teacher) {
                calls.push(request);
                assert.equal(request.tool_choice, 'auto', 'Jarvis must avoid slow required-tool grammar decoding');
                if (calls.length === 1) assert.ok(['fabi_read', 'websearch', 'webfetch', 'fabi_context', 'StructuredOutput'].every(name => tools.includes(name)), 'Available research tools: ' + tools.join(', '));
                assert.equal(request.max_tokens, 2048, 'The HTTP request must bound actual GPU generation');
                if (calls.length > 1) assert.ok(tools.includes('StructuredOutput'), 'Read-only permissions must allow the native completion tool');
                if (calls.length > 1 && calls.length < 8) assert.ok(tools.includes('websearch') && tools.includes('webfetch') && tools.includes('fabi_read'));
                assert.ok(!tools.includes('bash') && !tools.includes('edit') && !tools.includes('read') && !tools.includes('grep'));
                assert.ok(!JSON.stringify(request).includes('PRIVATE_MARKER_MUST_NOT_REACH_MODEL'));
                assert.ok(calls.length <= 9);
                if (calls.length === 8) assert.deepEqual(tools, ['StructuredOutput'], 'Repair only the output contract, not the research');
                if (calls.length === 6) assert.ok(tools.includes('fabi_read'), 'Research tools remain available after four calls');
            }
            const name = calls.length === 1 ? 'fabi_context' : calls.length < 7 ? 'fabi_read' : 'StructuredOutput';
            const args = name === 'fabi_context' ? {} : name === 'fabi_read' ? { path: calls.length === 3 ? '.env' : 'counter.ts' } : calls.length === 7 ? { ...lesson, title: undefined } : lesson;
            if (teacher && calls.length === 2) assert.ok(request.messages.some(m => m.role === 'tool' && JSON.stringify(m.content).includes('capturedAt')));
            if (teacher && calls.length === 9) {
                const { memory } = await projectDirectory(project, home);
                scratchSession = JSON.parse(await fs.readFile(path.join(memory, 'opencode-sessions.json'), 'utf8'))['knowledge-fixture'];
            }
            res.setHeader('content-type', 'text/event-stream');
            const chunk = delta => ({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: null }] });
            res.write('data: ' + JSON.stringify(chunk(teacher ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + calls.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: 'Une constante' })) + '\n\n');
            res.write('data: ' + JSON.stringify({ ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: teacher ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }) + '\n\n');
            res.end('data: [DONE]\n\n');
        } catch (error) { if (!failure) console.error(error.message); failure = error; void service?.cancel('native-tools'); res.writeHead(500); res.end('{}'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { await stopAssistOpenCode(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    await writeJson(path.join(home, 'jarvis-provider.json'), { apiKey: key, model, baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    service = new AssistService(new JarvisProvider(home), { onProgress() {} }, home);
    let book;
    try { book = await service.ask({ id: 'native-tools', project, question: 'Explique.', mode: 'explore', context: { path: 'counter.ts' } }); }
    catch (error) { throw failure || error; }
    assert.equal(calls.length, 8);
    assert.equal(book.turns[0].reply.title, lesson.title);
    assert.equal(book.turns[0].reply.verification, undefined, 'A verified code reading needs no unrelated web warning');
    assert.equal((await service.notebook(project)).turns.length, 1);
    assert.equal(await fs.readFile(path.join(project, 'counter.ts'), 'utf8'), 'export const count = 42;\n');
    const { memory } = await projectDirectory(project, home);
    const originalSessions = JSON.parse(await fs.readFile(path.join(memory, 'opencode-sessions.json'), 'utf8'));
    const { assistHome } = require('../lib/node/assist/assist-store');
    await assert.rejects(fs.access(path.join(assistHome(), 'opencode/contexts', originalSessions.legacy + '.json')));
    await service.ask({ id: 'native-discovery', project, question: 'Découvre ce module.', mode: 'explore', thread: { id: 'knowledge-fixture', kind: 'context', title: 'Découverte' }, context: { path: 'counter.ts' } });
    assert.equal(calls.length, 9);
    assert.ok(scratchSession);
    const sessions = JSON.parse(await fs.readFile(path.join(memory, 'opencode-sessions.json'), 'utf8'));
    assert.equal(sessions['knowledge-fixture'], undefined);
    assert.equal(sessions.legacy, originalSessions.legacy, 'Keep the actual teaching conversation');
    await assert.rejects(fs.access(path.join(assistHome(), 'opencode/contexts', scratchSession + '.json')));

});

test('Qwen citation variants preserve the explanation without importing a curriculum into context chat', () => {
    const { normalizeTutorOutput } = require('../lib/node/assist/opencode-harness');
    const { lessonSchema } = require('../lib/node/assist/assist-learning');
    const result = normalizeTutorOutput({ title: 'Export', explanation: 'La constante est accessible depuis un autre module.',
        sources: [{ url: 'https://www.typescriptlang.org/docs/', title: 'TypeScript' }, { path: 'counter.ts', line: 1 }],
        exercise: { invalid: true } }, 'explore');
    assert.equal(lessonSchema.safeParse(result).success, true);
    assert.deepEqual(result.concepts, []);
    assert.equal(result.exercise, undefined);
    assert.deepEqual(result.sources, [{ path: 'counter.ts', line: 1 }]);
    assert.equal(result.webSources[0].title, 'TypeScript');
    const journey = { title: 'Découvrir', scope: 'general', steps: [{ title: 'Lire', conceptId: 'value' }, { title: 'Appliquer', conceptId: 'value' }] };
    const wrapped = normalizeTutorOutput({ title: 'Valeurs', explanation: 'Un exemple.', sources: [], concepts: [], journey: JSON.stringify(journey), coveredConceptIds: '["value"]', knowledge: null }, 'learn');
    assert.deepEqual(wrapped.journey, journey); assert.deepEqual(wrapped.coveredConceptIds, ['value']); assert.equal(wrapped.knowledge, undefined);
    // Learning mode still validates the actual teaching contract.
    assert.equal(lessonSchema.safeParse(normalizeTutorOutput({ title: 'Cours', explanation: 'Cours', sources: [], exercise: { conceptId: 'unknown' } }, 'learn')).success, false);
});


test('web verification requires usable evidence, preserves citations and redacts failures', () => {
    const { webEvidence, toolFailure } = require('../lib/node/assist/opencode-harness');
    const part = (tool, output, status = 'completed') => ({ tool, state: { status, output, input: { url: 'https://example.com/docs' } } });
    assert.deepEqual(webEvidence([part('websearch', 'No search results found'), part('webfetch', ''), part('webfetch', 'content', 'error')]), []);
    assert.deepEqual(webEvidence([part('websearch', 'Title: Documentation\nURL: https://example.com/docs\nText'), part('webfetch', 'Official content')]), ['https://example.com/docs']);
    assert.equal(toolFailure('Search request timed out private-query'), 'timeout');
    assert.equal(toolFailure('Request failed with status code: 403 private-url'), 'forbidden');
});

test('native tutor repairs a general journey with unknown concepts before persisting it', { timeout: 30000 }, async t => {
    const { stopAssistOpenCode } = require('../lib/node/assist/opencode-harness');
    const { home, project } = await fixture(t);
    let calls = 0;
    let repairPrompt = false;
    const lesson = { title: 'Découvrir le mobile', explanation: 'Un écran est créé puis peut être suspendu.', sources: [], concepts: [],
        journey: { title: 'Le cycle de vie', scope: 'general', steps: [{ title: 'Afficher', conceptId: 'screen-life' }, { title: 'Reprendre', conceptId: 'screen-life' }] } };
    const server = http.createServer(async (req, res) => {
        let body = ''; for await (const part of req) body += part;
        const request = JSON.parse(body), teacher = request.tools?.length > 0;
        if (teacher) { calls++; repairPrompt ||= JSON.stringify(request.messages).includes('screen-life') && JSON.stringify(request.messages).includes('manquantes'); }
        const answer = calls === 1 ? lesson : { ...lesson, concepts: [{ id: 'screen-life', title: 'Cycle de vie', objective: 'Expliquer une suspension', prerequisites: [] }], coveredConceptIds: ['screen-life'] };
        const delta = teacher ? { role: 'assistant', tool_calls: [{ index: 0, id: 'goal-' + calls, type: 'function', function: { name: 'StructuredOutput', arguments: JSON.stringify(answer) } }] } : { role: 'assistant', content: 'Mobile' };
        const chunk = { id: 'general-fixture', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: null }] };
        res.setHeader('content-type', 'text/event-stream');
        res.write('data: ' + JSON.stringify(chunk) + '\n\n');
        res.write('data: ' + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: teacher ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }) + '\n\n');
        res.end('data: [DONE]\n\n');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { await stopAssistOpenCode(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    await writeJson(path.join(home, 'jarvis-provider.json'), { apiKey: key, model, baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    const service = new AssistService(new JarvisProvider(home), { onProgress() {} }, home);
    t.after(() => service.dispose());
    const book = await service.ask({ id: 'native-goal', project, question: 'Construis un parcours mobile indépendant du projet.', mode: 'learn', context: {} });
    assert.equal(calls, 2);
    assert.equal(repairPrompt, true);
    assert.equal(book.journeys[0].scope, 'general');
    assert.equal(book.concepts[0].stage, 'explained');
    assert.equal(book.concepts[0].status, 'new');
    assert.equal((await service.notebook(project)).journeys[0].id, 'native-goal');
});
