const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { JarvisProvider } = require('../lib/node/assist/jarvis-provider');
const { AssistService } = require('../lib/node/assist/assist-service');
const { recordLesson } = require('../lib/node/assist/assist-learning');
const { teachingState } = require('../lib/node/assist/assist-pedagogy');
const { projectDirectory, readNotebook, safeProjectFile, writeJson } = require('../lib/node/assist/assist-store');
const { assistPlacement, assistOrbitPlacement } = require('../lib/common/fabi-assist-placement');

async function fixture(t) {
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-assist-test-')));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const project = path.join(home, 'project');
    await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'counter.ts'), 'export const count = 1;\n');
    return { home, project };
}
const empty = project => ({ version: 1, project, concepts: [], turns: [] });
const request = project => ({ id: 'request-1', project, mode: 'learn', question: 'Explique ce code.', context: { path: 'counter.ts' } });
const lesson = () => ({ title: 'Une valeur partagée', explanation: 'La constante est exportée pour les autres modules.', sources: [{ path: 'counter.ts', line: 1 }],
    concepts: [{ id: 'modules', title: 'Modules', objective: 'Comprendre export', prerequisites: [] }],
    exercise: { id: 'modules-one', conceptId: 'modules', kind: 'explain', question: 'À quoi sert export ?', hint: 'Pense aux autres fichiers.' } });

test('pedagogical context isolates exercises by thread and proposes only due reviews in learning mode', () => {
    const thread = { id: 'code', kind: 'context', title: 'Code' };
    const other = { id: 'terminal', kind: 'terminal', title: 'Terminal' };
    const first = { ...request('/project'), thread };
    const book = recordLesson(empty('/project'), first, lesson(), 100);
    book.concepts[0].reviewAt = 200;
    book.concepts.push({ id: 'future', title: 'Plus tard', objective: 'Objectif', prerequisites: [], status: 'practicing', reviewAt: 400 });
    const feedback = teachingState({ ...first, answerTo: 'modules-one' }, book, 300);
    assert.equal(feedback.intent, 'feedback-on-attempt');
    assert.equal(feedback.activeExercise.id, 'modules-one');
    assert.deepEqual(feedback.reviewCandidates.map(item => item.id), ['modules']);
    const isolated = teachingState({ ...first, thread: other, answerTo: 'modules-one' }, book, 300);
    assert.equal(isolated.activeExercise, undefined);
    assert.equal(isolated.recentLearning.length, 0);
    const explore = teachingState({ ...first, mode: 'explore' }, book, 300);
    assert.equal(explore.intent, 'answer-directly');
    assert.deepEqual(explore.reviewCandidates, []);
    assert.equal(teachingState({ ...first, mode: 'brief' }, book).intent, 'prepare-development-request');
    assert.equal(teachingState({ ...first, mode: 'review' }, book).intent, 'review-observed-work');
});
test('learning evidence requires an answer, valid exercise and understood prerequisites', () => {
    let book = recordLesson(empty('/project'), request('/project'), lesson(), 100);
    assert.equal(book.concepts[0].status, 'practicing');
    const reply = { ...lesson(), exercise: undefined, assessment: { exerciseId: 'modules-one', result: 'understood', feedback: 'Exact.' } };
    assert.throws(() => recordLesson(book, { ...request('/project'), id: 'request-2' }, reply), /évaluation/);
    book = recordLesson(book, { ...request('/project'), id: 'request-2', answerTo: 'modules-one', question: 'Les autres fichiers peuvent importer cette valeur.' }, reply, 200);
    assert.equal(book.concepts[0].status, 'understood');
    assert.match(book.concepts[0].evidence, /importer/);
    assert.ok(book.concepts[0].reviewAt > 200);
    assert.throws(() => recordLesson(empty('/project'), request('/project'), { ...lesson(), concepts: [{ ...lesson().concepts[0], prerequisites: ['missing'] }] }), /prérequis/);
    assert.throws(() => recordLesson(empty('/project'), request('/project'), { ...lesson(), concepts: [
        { ...lesson().concepts[0], prerequisites: ['second'] }, { id: 'second', title: 'Second', objective: 'Second', prerequisites: ['modules'] }
    ] }), /boucle/);
});

test('project read boundary rejects secrets, directories and symlink escapes', async t => {
    const { home, project } = await fixture(t);
    await fs.writeFile(path.join(project, '.env.local'), 'SECRET');
    await fs.writeFile(path.join(home, 'outside.txt'), 'outside');
    await fs.symlink(path.join(home, 'outside.txt'), path.join(project, 'link.ts'));
    await assert.rejects(safeProjectFile(project, '.env.local'), /secrets/);
    await assert.rejects(safeProjectFile(project, 'link.ts'), /dehors/);
    await assert.rejects(safeProjectFile(project, '../outside.txt'), /dehors/);
    assert.equal(await safeProjectFile(project, 'counter.ts'), path.join(project, 'counter.ts'));
});

test('successful learning survives service recreation and never appears in another project', async t => {
    const { home, project } = await fixture(t);
    const provider = new JarvisProvider(home);
    const service = new AssistService(provider, { onProgress() {} }, home, async () => lesson());
    const book = await service.ask(request(project));
    assert.equal(book.turns.length, 1);
    const restored = new AssistService(provider, { onProgress() {} }, home, async () => lesson());
    assert.deepEqual(await restored.notebook(project), book);
    await fs.mkdir(path.join(home, 'other'));
    assert.equal((await restored.notebook(path.join(home, 'other'))).turns.length, 0);
    assert.equal((await restored.ask(request(project))).turns.length, 1, 'replayed successful request is idempotent');
});

test('cancellation and overlapping turns do not corrupt the saved notebook', async t => {
    const { home, project } = await fixture(t);
    const provider = new JarvisProvider(home);
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const service = new AssistService(provider, { onProgress() {} }, home, async (_provider, _request, _book, _memory, signal) => {
        started();
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
        return lesson();
    });
    const pending = service.ask(request(project));
    const rejected = assert.rejects(pending, /arrêtée/);
    await ready;
    await assert.rejects(service.ask({ ...request(project), id: 'another' }), /déjà/);
    await service.cancel('request-1');
    await rejected;
    assert.equal((await service.notebook(project)).turns.length, 0);
});

test('assistant placement stays visible at corners and small window sizes', () => {
    for (const [width, height] of [[1200, 800], [800, 600], [360, 480]]) {
        for (const [x, y] of [[0, 0], [width - 1, height - 1], [width / 2, height / 2]]) {
            for (const place of [assistPlacement, assistOrbitPlacement]) {
            const box = place(x, y, width, height);
            assert.ok(box.left >= 12 && box.top >= 12);
            assert.ok(box.left + box.width <= width - 12);
            assert.ok(box.top + box.maxHeight <= height - 12);
            }
        }
    }
});

test('folder, root, selection and terminal keep distinct authoritative contexts', async t => {
    const { home, project } = await fixture(t);
    await fs.mkdir(path.join(project, 'src'));
    await fs.writeFile(path.join(project, 'src/module.ts'), 'export const distinct = 79;');
    await fs.writeFile(path.join(project, '.env'), 'PRIVATE');
    const contexts = [];
    const service = new AssistService(new JarvisProvider(home), { onProgress() {} }, home, async (_p, request) => {
        contexts.push(request.context);
        return { title: 'Contexte', explanation: 'Contexte vérifié.', sources: [], concepts: [] };
    });
    const ask = (id, context) => service.ask({ id, project, mode: 'explore', question: 'Explique.', context });
    await ask('folder', { path: 'src', text: 'stale editor' });
    assert.deepEqual(contexts.at(-1), { kind: 'directory', path: 'src', text: 'src/module.ts' });
    await ask('root', { path: '.' });
    assert.match(contexts.at(-1).text, /src\//);
    assert.doesNotMatch(contexts.at(-1).text, /\.env/);
    await ask('selection', { path: 'counter.ts', kind: 'selection', text: 'unsaved selected value', startLine: 3, endLine: 4 });
    assert.equal(contexts.at(-1).text, 'unsaved selected value');
    await ask('terminal', { kind: 'terminal', path: 'counter.ts', text: 'ERR_PORT_4317', terminal: { id: 'term-1', title: 'CLI', selected: true } });
    assert.equal(contexts.at(-1).path, undefined);
    assert.equal(contexts.at(-1).text, 'ERR_PORT_4317');
});

test('a contextual explanation cannot be blocked by an unsolicited lesson prerequisite', async t => {
    const { home, project } = await fixture(t);
    const service = new AssistService(new JarvisProvider(home), { onProgress() {} }, home, async () => ({
        ...lesson(), concepts: [{ id: 'modules', title: 'Modules', objective: 'Comprendre', prerequisites: ['unknown'] }]
    }));
    const book = await service.ask({ ...request(project), mode: 'explore', context: { kind: 'selection', path: 'counter.ts', text: 'count',
        surrounding: { text: 'export const count = 1;', startLine: 1 } } });
    assert.match(book.turns[0].reply.explanation, /exportée/);
    assert.equal(book.turns[0].reply.exercise, undefined);
    assert.equal(book.concepts.length, 0);
    assert.match(book.turns[0].context.surrounding.text, /export/);
});

test('IDE snapshot and quoted reply reach the harness; external editor contents are excluded', async t => {
    const { home, project } = await fixture(t);
    await fs.writeFile(path.join(home, 'outside.ts'), 'outside-private-code');
    await fs.symlink(path.join(home, 'outside.ts'), path.join(project, 'outside-link.ts'));
    let observed;
    const service = new AssistService(new JarvisProvider(home), { onProgress() {} }, home, async (_provider, input) => {
        observed = input.context;
        return { title: 'Contexte', explanation: 'Explication.', sources: [], concepts: [] };
    });
    const ide = { capturedAt: 123, activeFile: 'counter.ts', openFiles: [{ path: 'counter.ts', dirty: true }],
        activeExcerpt: { path: 'counter.ts', text: 'export const count = 99;', startLine: 1 },
        events: [{ at: 100, kind: 'created', detail: 'src/new.ts' }], agents: [{ title: 'Codex', state: 'working' }], changes: [{ path: 'counter.ts', status: 'Modified' }] };
    await service.ask({ ...request(project), mode: 'explore', context: { path: 'counter.ts', ide, replyExcerpt: { title: 'Modules', text: 'Une valeur exportée.' } } });
    assert.equal(observed.ide.activeExcerpt.text, 'export const count = 99;');
    assert.equal(observed.ide.openFiles[0].dirty, true);
    assert.equal(observed.ide.events[0].kind, 'created');
    assert.equal(observed.replyExcerpt.text, 'Une valeur exportée.');
    await service.ask({ ...request(project), id: 'second-context', mode: 'explore', context: { path: 'counter.ts', ide: { ...ide, activeExcerpt: { path: 'outside-link.ts', text: 'outside-private-code', startLine: 1 } } } });
    assert.equal(observed.ide.activeExcerpt, undefined);
});

test('documentation URLs and invalid file citations do not discard a completed answer', async t => {
    const { home, project } = await fixture(t);
    const url = 'https://www.typescriptlang.org/docs/handbook/2/modules.html';
    const service = new AssistService(new JarvisProvider(home), { onProgress() {} }, home, async () => ({
        title: 'Export', explanation: 'export rend la constante accessible aux autres modules.', concepts: [],
        sources: [{ path: url, line: 1 }, { path: 'missing.ts', line: 1 }, { path: '../outside.txt', line: 1 }, { path: 'counter.ts', line: 1 }]
    }));
    const book = await service.ask({ ...request(project), mode: 'explore' });
    assert.equal(book.turns.length, 1);
    assert.deepEqual(book.turns[0].reply.sources.map(({ path, line }) => ({ path, line })), [{ path: 'counter.ts', line: 1 }]);
    assert.ok(book.turns[0].reply.sources[0].hash);
    assert.equal(book.turns[0].reply.webSources[0].url, url);
});

test('companion answers remember exposure without unsolicited exercises, mastery or CLI proposals', async t => {
    const { home, project } = await fixture(t);
    const service = new AssistService(new JarvisProvider(home), { onProgress() {} }, home,
        async () => ({ ...lesson(), intent: 'answer', developerPrompt: 'Do not send this unsolicited proposal' }));
    const book = await service.ask({ ...request(project), mode: 'assist' });
    assert.equal(book.turns[0].reply.intent, 'answer');
    assert.equal(book.turns[0].reply.exercise, undefined);
    assert.equal(book.turns[0].reply.developerPrompt, undefined);
    assert.equal(book.concepts[0].stage, 'explained');
    assert.equal(book.concepts[0].status, 'new');
});

test('automatic CLI reviews retain their origin across persistence and cannot create quizzes or new dispatches', async t => {
    const { home, project } = await fixture(t);
    const service = new AssistService({}, { onProgress() {} }, home, async () => ({ ...lesson(), developerPrompt: 'Change the project' }));
    const book = await service.ask({ ...request(project), mode: 'review', origin: 'cli-review' });
    assert.equal(book.turns[0].origin, 'cli-review');
    assert.equal(book.turns[0].reply.exercise, undefined);
    assert.equal(book.turns[0].reply.developerPrompt, undefined);
    assert.deepEqual(await service.notebook(project), book);
});
