// Opt-in GPU check for an independent learning goal, using only a temporary fixture.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { AssistService } = require('../fabi-swarm/lib/node/assist/assist-service');
const { JarvisProvider } = require('../fabi-swarm/lib/node/assist/jarvis-provider');
const { stopAssistOpenCode } = require('../fabi-swarm/lib/node/assist/opencode-harness');
(async () => {
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-general-goal-')));
    const root = path.join(home, 'project');
    const service = new AssistService(new JarvisProvider(), { onProgress: event => console.log(event.phase, event.text) }, home);
    try {
        await fs.mkdir(root);
        await fs.writeFile(path.join(root, 'README.md'), '# Petit projet web\nCe projet ne contient pas encore de code mobile.\n');
        const book = await service.ask({ id: 'general-mobile', project: root, mode: 'learn', context: {},
            thread: { id: 'mobile-goal', kind: 'context', title: 'Découvrir le mobile' },
            question: 'Je viens du développement web et je veux comprendre le fonctionnement d’une application mobile, indépendamment de ce dépôt. Propose un parcours de trois étapes, puis commence par une seule idée : le cycle de vie d’un écran. Pas de choix de produit, de version ni de code à installer pour le moment. Ne considère pas les notions comme acquises.' });
        const journey = book.journeys?.find(item => item.scope === 'general');
        assert.ok(journey, 'A general learning journey must be saved');
        assert.ok(journey.steps.length >= 2);
        assert.ok(book.concepts.every(concept => concept.status !== 'understood'));
        assert.ok(!book.turns.at(-1).reply.developerPrompt);
        const reloaded = await service.notebook(root);
        assert.equal(reloaded.journeys[0].id, journey.id);
        console.log('PASS: real GPU general learning goal, persistent steps, no code dispatch and no inferred mastery.');
    } finally { service.dispose(); await stopAssistOpenCode(); await fs.rm(home, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
