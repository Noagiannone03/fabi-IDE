// Packaged smoke test with isolated workspace/preferences; never opens an agent CLI.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const home = await mkdtemp(join(tmpdir(), 'fabi-no-swarm-'));
for (const dir of ['project','profile','config']) await mkdir(join(home, dir));
await writeFile(join(home,'project','README.md'), '# Isolated smoke test\n');
await writeFile(join(home,'profile','spaces.json'), JSON.stringify({version:1,activeId:'smoke',spaces:[{id:'smoke',name:'Smoke test',emoji:'',color:'#0A84FF',workspacePath:join(home,'project'),lastActive:Date.now()}]}));
const log = createWriteStream(join(home,'electron.log'));
const child = spawn(resolve('electron-app/dist/mac-arm64/Fabi.app/Contents/MacOS/Fabi'), ['--user-data-dir='+join(home,'profile'),'--remote-debugging-port=9238'], {env:{...process.env,THEIA_CONFIG_DIR:join(home,'config')},stdio:['ignore','pipe','pipe']});
child.stdout.pipe(log); child.stderr.pipe(log);
let browser;
const pause = () => new Promise(r=>setTimeout(r,200));
try {
 for(let i=0;i<150;i++){try{browser=await puppeteer.connect({browserURL:'http://127.0.0.1:9238',defaultViewport:null});break;}catch{await pause();}}
 assert.ok(browser,'Packaged app did not start: '+home);
 let page;
 for(let i=0;i<300;i++){page=(await browser.pages()).find(p=>p.url().includes('/frontend/index.html'));if(page)break;await pause();}
 assert.ok(page,'No IDE page: '+home);
 await page.waitForFunction(()=>{const c=window.theia?.container;const key=c&&[...c._bindingDictionary._map.keys()].find(k=>k?.name==='FrontendApplicationStateService');return key&&c.get(key).state==='ready';},{timeout:60000});
 const result=await page.evaluate(async()=>{
  const c=window.theia.container;
  const get=name=>c.get([...c._bindingDictionary._map.keys()].find(k=>k?.name===name));
  const plugins=get('HostedPluginSupport');
  await plugins.didStart;
  const authoring=plugins.plugins.find(plugin=>plugin.model.id==='vscode.extension-editing');
  if(!authoring || !plugins.managers.size) throw Error('Extension Authoring host missing');
  await plugins.activatePlugin(authoring.model.id);
  const swarm=get('FabiSwarmFrontend').service;
  return {runtime:await swarm.getRuntimeStatus(),swarms:await swarm.listSwarms(),metrics:await swarm.getMetrics(),legacyAI:get('FabiAIActivationService').isActive,assistAvailable:!!get('AssistContribution'),agentsAvailable:!!get('FabiAgentTerminals')};
 });
 assert.equal(result.runtime.disabled,true); assert.equal(result.runtime.downloading,false);
 assert.deepEqual(result.swarms,[]); assert.equal(result.metrics,undefined);
 assert.equal(result.legacyAI,false); assert.equal(result.assistAvailable,true); assert.equal(result.agentsAvailable,true);
 await new Promise(resolve=>setTimeout(resolve,500));
 const output=await readFile(join(home,'electron.log'),'utf8');
 assert.doesNotMatch(output, /Activating plugin 'Extension Authoring[^\n]*failed|product\.json not found/);
 console.log(JSON.stringify({home,pid:child.pid,extensionAuthoring:'activation requested without error',...result},null,2));
} finally {
 if(browser) await browser.close().catch(()=>{});
 if(child.exitCode===null) child.kill('SIGTERM');
 log.end();
}
