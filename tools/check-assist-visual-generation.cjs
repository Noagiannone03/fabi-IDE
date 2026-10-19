// Opt-in live GPU check: only this synthetic fixture is sent to the tutor.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { AssistService } = require('../fabi-swarm/lib/node/assist/assist-service');
const { JarvisProvider } = require('../fabi-swarm/lib/node/assist/jarvis-provider');
const { stopAssistOpenCode } = require('../fabi-swarm/lib/node/assist/opencode-harness');
(async () => {
 const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'fabi-visual-live-')));
 const root = path.join(home,'project');
 const service = new AssistService(new JarvisProvider(), {onProgress:e=>console.log(e.phase,e.text)}, home);
 try {
  await fs.mkdir(root);
  await fs.writeFile(path.join(root,'reward.ts'), 'export function collectFuel(pour: (done: () => void) => void, removeMarker: () => void) {\n  const onRewardSettled = () => removeMarker();\n  pour(onRewardSettled);\n}\n');
  const book=await service.ask({id:'visual-sequence',project:root,mode:'explore',thread:{id:'visual-context',kind:'context',title:'Le carburant'},context:{path:'reward.ts'},question:'Explique simplement ce passage et son rôle dans le projet. Lis le contexte nécessaire. Je débute.'});
  const reply=book.turns.at(-1).reply;
  await fs.writeFile('/tmp/fabi-visual-live-reply.json',JSON.stringify(reply,null,2));
  assert.ok(reply.takeaway, 'A sequence needs a short orientation');
  assert.ok(reply.diagram?.steps.length>=2,'A sequence needs explorable steps');
  assert.ok(reply.sources.some(s=>s.path==='reward.ts'&&!s.stale),'Read the actual source');
  assert.ok(!reply.explanation.includes('\\n\\n'),'Structured output should contain real paragraph breaks');
  await fs.writeFile('/tmp/fabi-visual-live-reply.json',JSON.stringify(reply,null,2));
  console.log('PASS: real tutor generated visual orientation, sequence and verified source. Reply: /tmp/fabi-visual-live-reply.json');
 } finally {service.dispose();await stopAssistOpenCode();await fs.rm(home,{recursive:true,force:true});}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
