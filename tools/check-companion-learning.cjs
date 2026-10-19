// Opt-in live inference validation. Only a temporary synthetic project is sent.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { AssistService } = require('../fabi-swarm/lib/node/assist/assist-service');
const { JarvisProvider } = require('../fabi-swarm/lib/node/assist/jarvis-provider');
const { stopAssistOpenCode } = require('../fabi-swarm/lib/node/assist/opencode-harness');
(async () => {
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-companion-live-')));
    const root = path.join(home, 'project');
    const service = new AssistService(new JarvisProvider(), { onProgress: event => console.log(event.phase, event.text) }, home);
    try {
        await fs.mkdir(root);
        await fs.writeFile(path.join(root, 'store.ts'), 'export const users = new Map<string, string>();\nexport function findUser(id: string) { return users.get(id); }\n');
        await fs.writeFile(path.join(root, 'session.ts'), "import { findUser } from './store';\nexport function recognizeUser(sessionId: string) { return findUser(sessionId) ?? 'guest'; }\n");
        const knowledge = await service.refreshKnowledge(root);
        assert.equal(knowledge.relations, 1);
        const thread = { id: 'live-project', kind: 'context', title: 'Comprendre les sessions' };
        const first = await service.ask({ id: 'live-flow', project: root, mode: 'explore', thread, context: { path: 'session.ts' }, question: 'Explique comment recognizeUser retrouve un utilisateur dans ce projet. Lis aussi sa dépendance. Ne confonds pas ce petit exemple avec une vraie authentification sécurisée.' });
        const response = first.turns.at(-1).reply;
        console.log('Fixture explanation:', JSON.stringify({ explanation: response.explanation, sources: response.sources }));
        assert.ok(response.sources.some(source => source.path === 'session.ts'));
        assert.ok(response.sources.some(source => source.path === 'store.ts'));
        assert.ok(response.sources.every(source => source.hash && !source.stale));
        console.log('Grounded sources:', response.sources.map(source => source.path).join(', '));
        const learned = await service.ask({ id: 'live-journey', project: root, mode: 'learn', thread, context: { path: 'session.ts' }, question: 'Construis un parcours de deux étapes pour comprendre ce mécanisme réel : chercher une valeur dans une Map puis suivre recognizeUser. Retourne journey, les concepts et leurs prérequis, mais explique seulement la première étape avec un petit exemple. Ne considère rien acquis.' });
        assert.ok(learned.journeys?.length);
        assert.ok(learned.journeys[0].steps.length >= 2);
        assert.ok(learned.concepts.every(concept => concept.status !== 'understood'));
        await service.updateLearning(root, { kind: 'journey', id: learned.journeys[0].id, action: 'pause' });
        await fs.writeFile(path.join(root, 'store.ts'), 'export function findUser(id: string) { return "changed"; }\n');
        const reopened = await new AssistService(new JarvisProvider(), { onProgress() {} }, home).notebook(root);
        assert.equal(reopened.journeys[0].paused, true);
        assert.ok(reopened.turns[0].reply.sources.some(source => source.path === 'store.ts' && source.stale));
        await service.refreshKnowledge(root, true);
        const discovery = await service.knowledge(root);
        assert.ok(discovery.understanding?.completed > 0);
        assert.equal(discovery.understanding?.failed, 0);
        const notes = await service.understandings(root);
        assert.ok(notes.some(note => note.claims?.length), 'Structured project claims are inspectable');
        assert.ok(notes.every(note => !note.stale));
        console.log('PASS: live source-grounded explanation, generated persistent journey, no automatic mastery, pause and offline source invalidation.');
    } finally { service.dispose(); await stopAssistOpenCode(); await fs.rm(home, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
