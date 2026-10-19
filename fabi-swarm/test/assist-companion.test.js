const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { refreshProjectIndex, retrieveProjectKnowledge } = require('../lib/node/assist/assist-project-index');
const { AssistService } = require('../lib/node/assist/assist-service');
const { lockMemory, projectDirectory } = require('../lib/node/assist/assist-store');
const { learningOpportunities } = require('../lib/common/fabi-learning-opportunity');
async function fixture(t) {
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-mechanics-')));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const root = path.join(home, 'project'); await fs.mkdir(path.join(root, 'src'), { recursive: true });
    return { home, root };
}
test('compiler graph resolves aliases and tracks dependency/relationship evolution without runtime claims', async t => {
    const { home, root } = await fixture(t);
    await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19' } }));
    await fs.writeFile(path.join(root, 'src', 'store.ts'), 'export function findUser(id: string): string { return id; }');
    await fs.writeFile(path.join(root, 'src', 'session.ts'), "import { findUser } from '@/store';\nexport function recognize(id: string) { const result = findUser(id); return result; }");
    const index = await refreshProjectIndex(root, home);
    assert.ok(index.graph.edges.some(edge => edge.from === 'src/session.ts' && edge.to === 'src/store.ts'));
    assert.deepEqual(index.files.find(f => f.path === 'src/session.ts').calls[0], { caller: 'recognize', target: 'findUser', line: 2 });
    const found = await retrieveProjectKnowledge(root, 'recognize', home);
    assert.ok(found.relations.some(edge => edge.to === 'src/store.ts'));
    const again = await refreshProjectIndex(root, home); assert.equal(again.revision, index.revision);
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19', zod: '4' } }));
    await fs.writeFile(path.join(root, 'src', 'session.ts'), 'export const recognize = () => "guest";');
    const changed = await refreshProjectIndex(root, home);
    assert.notEqual(changed.revision, index.revision);
    assert.deepEqual(changed.changes.find(c => c.path === 'package.json').dependenciesAdded, ['zod']);
    assert.deepEqual(changed.changes.find(c => c.path === 'src/session.ts').importsRemoved, ['@/store']);
    assert.equal(changed.graph.edges.length, 0);
});
test('notebook lease rejects a competing backend process and releases reliably', async t => {
    const { home, root } = await fixture(t), { memory } = await projectDirectory(root, home);
    const lease = await lockMemory(memory, 'notebook');
    try {
        const indexLease = await lockMemory(memory, 'index');
        await indexLease.release();
        await new Promise(resolve => setTimeout(resolve, 5200));
        lease.assertOwned();
        const module = require.resolve('../lib/node/assist/assist-store');
        const result = await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(module)}).lockMemory(${JSON.stringify(memory)},'notebook').then(l=>l.release().then(()=>process.exit(2))).catch(()=>process.exit(0))`], { stdio: 'ignore' });
            child.once('error', reject); child.once('exit', resolve);
        });
        assert.equal(result, 0);
    } finally { await lease.release(); }
    const next = await lockMemory(memory, 'notebook'); next.assertOwned(); await next.release();
});
test('sources invalidate during inference and after reopening; learner controls persist without mastery', async t => {
    const { home, root } = await fixture(t);
    const file = path.join(root, 'src', 'session.ts'); await fs.writeFile(file, 'export const value = 1;');
    const run = async () => {
        await fs.writeFile(file, 'export const value = 2;');
        return { title: 'Valeurs', explanation: 'Une valeur.', sources: [{ path: 'src/session.ts', line: 1 }],
            concepts: [{ id: 'values', title: 'Valeurs', objective: 'Lire une valeur', prerequisites: [] }, { id: 'exports', title: 'Exports', objective: 'Relier les modules', prerequisites: ['values'] }],
            coveredConceptIds: ['values'], journey: { title: 'Du fichier au module', scope: 'project', steps: [{ title: 'Lire', conceptId: 'values' }, { title: 'Relier', conceptId: 'exports' }] } };
    };
    const service = new AssistService({}, { onProgress() {} }, home, run);
    const first = await service.ask({ id: 'journey', project: root, mode: 'learn', question: 'Construire un parcours', context: { path: 'src/session.ts' } });
    assert.equal(first.turns[0].reply.sources[0].stale, true);
    assert.equal(first.concepts[0].stage, 'explained'); assert.equal(first.concepts[1].stage, 'discovered');
    await service.updateLearning(root, { kind: 'journey', id: 'journey', action: 'next' });
    await service.updateLearning(root, { kind: 'journey', id: 'journey', action: 'pause' });
    await service.updateLearning(root, { kind: 'preferences', value: { depth: 'concise', minutes: 2, invitations: false } });
    const restored = await new AssistService({}, { onProgress() {} }, home, run).notebook(root);
    assert.equal(restored.journeys[0].cursor, 1); assert.equal(restored.journeys[0].paused, true);
    assert.equal(restored.preferences.invitations, false); assert.ok(restored.concepts.every(c => c.status === 'new'));
    assert.equal(restored.turns[0].reply.sources[0].stale, true);
});
test('opportunities join real changes, native observations, learner difficulty and durable dismissals', () => {
    const now = Date.now();
    const knowledge = { phase: 'ready', changes: [{ path: 'package.json', kind: 'modified', dependenciesAdded: ['zod'], at: now }, { path: 'src/session.ts', kind: 'modified', at: now }] };
    const book = { turns: [], concepts: [{ id: 'zod', title: 'Zod', prerequisites: [], objective: 'Valider les données', stage: 'reinforce', reviewAt: now - 1000 }] };
    const ranked = learningOpportunities(knowledge, book, now);
    assert.equal(ranked[0].reason, 'review'); assert.equal(ranked[1].reason, 'dependency');
    book.invitations = [{ id: ranked[0].id, at: now, outcome: 'dismissed' }];
    assert.equal(learningOpportunities(knowledge, book, now)[0].reason, 'dependency');
    book.preferences = { depth: 'guided', minutes: 5, invitations: false };
    assert.deepEqual(learningOpportunities(knowledge, book, now), []);
});

test('deep project discovery caches module summaries and rejects changed evidence', async t => {
    const { home, root } = await fixture(t);
    const { discoverProjectUnderstanding, retrieveUnderstanding, understandingStatus, inspectUnderstanding } = require('../lib/node/assist/assist-project-understanding');
    await fs.writeFile(path.join(root, 'src', 'session.ts'), 'export const value = 1;');
    let calls = 0;
    const analyze = async () => { calls++; return { title: 'Sessions', explanation: 'Le module contient une valeur exportée.', sources: [{ path: 'src/session.ts', line: 1 }], concepts: [], readFiles: ['src/session.ts'] }; };
    await discoverProjectUnderstanding(root, home, analyze, new AbortController().signal);
    assert.equal(calls, 1);
    assert.equal((await understandingStatus(root, home)).reviewedFiles, 1);
    await discoverProjectUnderstanding(root, home, analyze, new AbortController().signal);
    assert.equal(calls, 1, 'Reopening does not request another LLM summary');
    assert.equal((await retrieveUnderstanding(root, 'sessions', home)).length, 1);
    await fs.writeFile(path.join(root, 'src', 'session.ts'), 'export const value = 2;');
    assert.equal((await retrieveUnderstanding(root, 'sessions', home)).length, 0, 'On-disk evidence wins over the stored explanation');
    assert.equal((await inspectUnderstanding(root, home))[0].stale, true, 'Inspection refreshes evidence after an offline edit');
    assert.equal((await understandingStatus(root, home)).phase, 'partial');
    assert.equal((await understandingStatus(root, home)).completed, 0);
    await discoverProjectUnderstanding(root, home, analyze, new AbortController().signal);
    assert.equal(calls, 2);
});

test('Codex native records expose tools without leaking arguments or attributing unseen results', () => {
    const { codexObservations } = require('../lib/node/fabi-agent-observations');
    const rows = [
        { type: 'response_item', timestamp: '2026-10-16T09:00:00Z', payload: { type: 'custom_tool_call', call_id: 'patch-1', name: 'apply_patch', input: '*** Update File: src/session.ts\n+SECRET=hidden\n*** Update File: .env\n+KEY=private' } },
        { type: 'response_item', timestamp: '2026-10-16T09:00:01Z', payload: { type: 'custom_tool_call_output', call_id: 'patch-1', output: '{"exit_code":0}' } },
        { type: 'response_item', timestamp: '2026-10-16T09:00:02Z', payload: { type: 'function_call_output', call_id: 'unseen', output: 'success' } },
        { type: 'response_item', timestamp: '2026-10-16T09:00:03Z', payload: { type: 'reasoning', text: 'private-reasoning' } }
    ];
    const events = codexObservations(rows, 'session-one', '/project');
    assert.equal(events.length, 2);
    assert.ok(events.every(event => event.path === 'src/session.ts' && event.sessionId === 'session-one'));
    assert.deepEqual(events.map(event => event.phase), ['started', 'completed']);
    assert.doesNotMatch(JSON.stringify(events), /hidden|private|\.env|unseen/);
});

test('a simple acknowledgement never advances knowledge; spaced evidence adapts the review interval', () => {
    const { recordLesson } = require('../lib/node/assist/assist-learning');
    const concept = { id: 'values', title: 'Valeurs', objective: 'Lire une valeur', prerequisites: [], status: 'practicing', stage: 'explained' };
    const book = { version: 1, project: '/project', concepts: [concept], turns: [{ id: 'question', at: 1, context: {}, reply: { sources: [], exercise: { id: 'example', conceptId: 'values', kind: 'explain', question: 'Pourquoi ?', hint: '' } } }] };
    const reply = () => ({ title: 'Feedback', explanation: 'Réponse', sources: [], concepts: [], assessment: { exerciseId: 'example', result: 'understood', feedback: 'Correct' } });
    const request = { id: 'attempt', project: '/project', context: {}, mode: 'learn', question: 'compris', answerTo: 'example' };
    const acknowledged = recordLesson(book, request, reply(), 100);
    assert.equal(acknowledged.concepts[0].status, 'practicing');
    assert.equal(acknowledged.turns.at(-1).reply.assessment, undefined);
    const first = recordLesson(book, { ...request, question: 'Cette variable conserve la valeur reçue.' }, reply(), 100);
    const second = recordLesson(first, { ...request, id: 'later', question: 'La valeur reste disponible pour la fonction suivante.' }, reply(), 4 * 86400000);
    assert.equal(second.concepts[0].stage, 'partial');
    assert.equal(second.concepts[0].reviewAt - 4 * 86400000, 6 * 86400000);
});

test('selection snapshots preserve exact ranges and detect unsaved content lost between sessions', async t => {
    const { home, root } = await fixture(t);
    await fs.writeFile(path.join(root, 'src', 'selection.ts'), 'const value = 1;\n');
    const service = new AssistService({}, { onProgress() {} }, home, async () => ({ title: 'Valeur', explanation: 'Valeur éditée.', sources: [], concepts: [] }));
    await service.ask({ id: 'selected', project: root, mode: 'explore', question: 'Explique cette valeur.', context: { path: 'src/selection.ts', kind: 'selection', text: '2', startLine: 1, endLine: 1,
        snapshot: { version: 3, dirty: true, range: { start: { line: 0, character: 14 }, end: { line: 0, character: 15 } } } } });
    const restored = await service.notebook(root);
    assert.equal(restored.turns[0].context.snapshot.stale, true);
    assert.equal(restored.turns[0].context.snapshot.version, 3);
});

test('source readers redact recognizable secrets while preserving line positions', async t => {
    const { home, root } = await fixture(t);
    const { readProjectFile } = require('../lib/node/assist/assist-store');
    await fs.writeFile(path.join(root, 'src', 'config.ts'), 'const API_KEY = "sk-abcdefghijklmnopqrstuv";\nexport const port = 3000;\n');
    const text = await readProjectFile(root, 'src/config.ts');
    assert.doesNotMatch(text, /abcdefghijklmnopqrstuv/);
    assert.match(text, /2: export const port/);
    await fs.writeFile(path.join(root, '.npmrc'), '//registry/:_authToken=private-token');
    const index = await refreshProjectIndex(root, home);
    assert.ok(!index.files.some(file => file.path === '.npmrc'));
});


test('hierarchical discovery separates documented claims, hypotheses and user corrections', async t => {
    const { home, root } = await fixture(t);
    const { discoverProjectUnderstanding, inspectUnderstanding, correctUnderstanding } = require('../lib/node/assist/assist-project-understanding');
    await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export const value = 1;');
    await fs.writeFile(path.join(root, 'README.md'), '# Architecture\nLe module exporte une valeur.');
    await fs.mkdir(path.join(root, 'assets'));
    await fs.writeFile(path.join(root, 'assets', 'binary.bin'), Buffer.from([0, 1, 2]));
    const questions = [];
    await discoverProjectUnderstanding(root, home, async question => {
        questions.push(question);
        return { title: 'Architecture', explanation: 'Une valeur exportée, documentée dans le README.', concepts: [],
            sources: [{ path: 'src/index.ts', line: 1 }, { path: 'README.md', line: 2 }],
            knowledge: { claims: [
                { text: 'Une valeur est exportée.', kind: 'code', sources: [{ path: 'src/index.ts', line: 1 }] },
                { text: 'Le README décrit cette valeur.', kind: 'documentation', sources: [{ path: 'README.md', line: 2 }] },
                { text: 'Motivation historique non prouvée.', kind: 'historical-decision', sources: [{ path: 'src/index.ts', line: 1 }] },
                { text: 'Peut servir d’exemple.', kind: 'hypothesis', sources: [] }
            ], uncertainties: ['Le rôle métier n’est pas documenté.'] } };
    }, new AbortController().signal);
    assert.equal(questions.length, 3, 'Two text modules then one overview; binary-only folders need no inference');
    assert.match(questions.at(-1), /Vue globale/);
    const notes = await inspectUnderstanding(root, home);
    assert.ok(notes.some(note => note.path === '@project'));
    assert.ok(notes.every(note => note.claims.length === 3 && !note.stale));
    await correctUnderstanding(root, 'src', 'Ceci est un exemple pédagogique.', home);
    assert.equal((await inspectUnderstanding(root, home)).find(note => note.path === 'src').correction, 'Ceci est un exemple pédagogique.');
});


test('learning invitations target a changed callable rather than only its filename', async t => {
    const { home, root } = await fixture(t);
    const file = path.join(root, 'src/session.ts');
    await fs.writeFile(file, 'export function recognizeUser(id: string) { return id; }\nexport function unrelated() { return 1; }');
    await refreshProjectIndex(root, home);
    await fs.writeFile(file, 'export function recognizeUser(id: string) { return id || "guest"; }\nexport function unrelated() { return 1; }');
    const next = await refreshProjectIndex(root, home);
    const change = next.changes.at(-1);
    assert.deepEqual(change.symbolsChanged, ['recognizeUser']);
    const [invitation] = learningOpportunities({ phase: 'ready', changes: [change] }, { turns: [], concepts: [] });
    assert.match(invitation.title, /recognizeUser/);
    assert.match(invitation.question, /paramètres/);
    assert.ok(!invitation.question.includes('unrelated'));
});
