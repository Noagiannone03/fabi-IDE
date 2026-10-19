// Explicit live GPU integration test. All project and learning data is temporary.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JarvisProvider } = require('../fabi-swarm/lib/node/assist/jarvis-provider');
const { stopAssistOpenCode } = require('../fabi-swarm/lib/node/assist/opencode-harness');
const { projectDirectory, readJson } = require('../fabi-swarm/lib/node/assist/assist-store');
const { AssistService } = require('../fabi-swarm/lib/node/assist/assist-service');
process.once('SIGINT', async () => { await stopAssistOpenCode(); process.exit(130); });
(async () => {
 const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-live-')));
 const project = path.join(home, 'project');
 const provider = new JarvisProvider();
 try {
   await fs.mkdir(path.join(project, 'src'), { recursive: true });
   await fs.writeFile(path.join(project, 'src/counter.ts'), 'export const count = 79;\nexport function increment(n: number) { return n + 1; }\n');
   await fs.writeFile(path.join(project, 'src/render.ts'), "import { count } from './counter';\nexport const label = `Count: ${count}`;\n");
   const service = new AssistService(provider, { onProgress() {} }, home);
   const { memory } = await projectDirectory(project, home);
   const cases = [
     ['file', { path: 'src/counter.ts' }, 'À quoi sert ce fichier ?'],
     ['selection', { kind: 'selection', path: 'src/counter.ts', text: 'export function increment(n: number) { return n + 1; }', startLine: 2, endLine: 2 }, 'Explique ce passage.'],
     ['folder', { path: 'src' }, 'Trouve les fichiers de ce dossier, puis lis-les et explique comment ils sont liés.'],
     ['terminal', { kind: 'terminal', terminal: { id: 'fixture', title: 'Serveur', selected: true }, text: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:4317' }, 'Explique cette erreur du terminal et comment vérifier sa cause.'],
     ['question', { path: 'src/counter.ts', kind: 'file' }, 'Que veut dire return dans cette fonction ? Je veux comprendre, ne demande rien au CLI.'],
     ['relay', { kind: 'terminal', activity: { title: 'Codex', status: 'idle' }, cli: { source: 'codex', sessionId: 'fixture-session', status: 'empty', truncated: false, messages: [] } }, 'demande lui comment ça va'],
     ['feature', { kind: 'terminal', activity: { title: 'Codex', status: 'idle' }, cli: { source: 'codex', sessionId: 'fixture-session', status: 'empty', truncated: false, messages: [] } }, 'J’aimerais que la fonction increment dans src/counter.ts refuse les nombres négatifs avec une erreur.'],
     ['review', { kind: 'terminal', activity: { title: 'Codex', status: 'done' }, cli: { source: 'codex', sessionId: 'fixture-session', status: 'available', truncated: false, messages: [{ role: 'user', text: 'Dans quel dossier travailles-tu et à quoi sert ce projet ?' }, { role: 'assistant', text: 'Je suis dans /workspace/mini-compteur. Le projet Mini Compteur affiche un nombre et permet de l’augmenter avec un bouton. src/counter.ts calcule le nombre suivant et src/render.ts prépare son affichage. Je n’ai pas modifié de fichier.' }] } }, 'Explique la réponse du dernier tour du CLI à ma demande.'],
     ['session', { kind: 'terminal', cli: { source: 'codex', sessionId: 'fixture-session', status: 'available', truncated: false, messages: [{ role: 'user', text: 'Ajouter un filtre aux compteurs négatifs.' }, { role: 'assistant', text: 'Je vais lire la fonction increment et tester les valeurs négatives avant de proposer un filtre.' }] } }, 'Appelle fabi_context pour retrouver le travail de cette session, puis explique brièvement son objectif.'],
     ['learn', { path: 'src/counter.ts' }, 'Apprends-moi les bases de ce code avec un petit exercice, commence par une notion sans prérequis.']
   ];
   const activeCases = process.env.FABI_ASSIST_CASES ? cases.filter(item => process.env.FABI_ASSIST_CASES.split(',').includes(item[0])) : cases;
   let book;
   for (const [id, context, question] of activeCases) {
     const start = Date.now();
     book = await service.ask({ id, project, mode: ['relay', 'feature', 'question'].includes(id) ? 'assist' : id === 'learn' ? 'learn' : id === 'review' ? 'review' : 'explore', question, context });
     const reply = book.turns.at(-1).reply;
     assert.ok(reply.explanation.length > (id === 'relay' ? 10 : 30));
     if (id === 'review') { assert.match(reply.explanation, /mini.compteur/i); assert.match(reply.explanation, /bouton|augment|nombre/i); assert.ok(reply.explanation.length < 2200); assert.equal(reply.exercise, undefined); assert.equal(reply.developerPrompt, undefined); }
     if (id === 'question') { assert.equal(reply.intent, 'answer'); assert.equal(reply.developerPrompt, undefined); assert.equal(reply.exercise, undefined); }
     if (['relay', 'feature'].includes(id)) {
       assert.equal(reply.intent, id === 'relay' ? 'relay' : 'develop');
       assert.ok(reply.developerPrompt?.trim()); assert.equal(reply.exercise, undefined); assert.equal(reply.verification, undefined);
       assert.ok(reply.explanation.length < 450, 'Coordination should not become a lecture');
       if (id === 'relay') assert.match(reply.developerPrompt, /comment.*va/i);
     }
     const trace = await readJson(path.join(memory, 'last-tools.json'));
     assert.ok(trace.tools.some(t => t.tool === 'StructuredOutput' && t.status === 'completed'));
     if (id === 'session') { assert.ok(trace.tools.some(t => t.tool === 'fabi_context' && t.status === 'completed')); assert.match(reply.explanation, /filtr|négati/i); }
     if (id === 'terminal') assert.match(reply.explanation, /4317|EADDRINUSE/);
     console.log(JSON.stringify({ case: id, milliseconds: Date.now()-start, tools: trace.tools, title: reply.title, sources: reply.sources, webSources: reply.webSources, verification: reply.verification, explanation: reply.explanation, intent: reply.intent, developerPrompt: reply.developerPrompt }));
   }
   if (!activeCases.some(item => item[0] === 'learn')) return;
   const exercise = book.turns.at(-1).reply.exercise;
   assert.ok(exercise, 'Learning mode must offer an exercise');

   book = await service.ask({ id: 'answer', project, mode: 'learn', context: { path: 'src/counter.ts' }, answerTo: exercise.id,
     question: 'Une constante garde une valeur, ici 79. export permet aux autres fichiers de l’importer. increment est une fonction qui reçoit un nombre n et renvoie n + 1.' });
   assert.equal(book.turns.at(-1).reply.assessment?.exerciseId, exercise.id);
   assert.equal((await service.notebook(project)).turns.length, activeCases.length + 1);
   console.log(JSON.stringify({ case: 'answer', assessment: book.turns.at(-1).reply.assessment?.result, persistedTurns: activeCases.length + 1 }));
 } finally { await stopAssistOpenCode(); await fs.rm(home, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
