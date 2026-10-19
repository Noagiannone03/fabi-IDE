// Full Electron startup benchmark with isolated Chromium/config/workspace state.
// `seed` saves one resumable terminal; subsequent runs compare the same profile.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import puppeteer from 'puppeteer';
const label=process.argv[2]||'before';
const home=process.env.FABI_STARTUP_BENCH_HOME||join(tmpdir(),'fabi-startup-benchmark');
await mkdir(join(home,'project'),{recursive:true});await mkdir(join(home,'profile'),{recursive:true});await mkdir(join(home,'config'),{recursive:true});
await writeFile(join(home,'project','README.md'),'# Startup measurement\nAn isolated local fixture.\n');
if(label==='seed') await writeFile(join(home,'profile','spaces.json'),JSON.stringify({version:1,activeId:'startup',spaces:[{id:'startup',name:'Startup measurement',emoji:'',color:'#0A84FF',workspacePath:join(home,'project'),lastActive:Date.now()}]}));
const logPath=join(home,label+'.log'),log=createWriteStream(logPath),started=Date.now();
const child=spawn(resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[resolve('electron-app'),'--user-data-dir='+join(home,'profile'),'--remote-debugging-port=9237','--plugins=local-dir:plugins'],{cwd:resolve('electron-app'),env:{...process.env,THEIA_CONFIG_DIR:join(home,'config'),FABI_NO_LAUNCHER:'1'},stdio:['ignore','pipe','pipe']});
child.stdout.pipe(log);child.stderr.pipe(log);let browser;
try{
 for(let i=0;i<300;i++){try{browser=await puppeteer.connect({browserURL:'http://127.0.0.1:9237',defaultViewport:null});break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!browser)throw Error('Electron did not start; inspect '+logPath);
 let page;for(let i=0;i<300;i++){page=(await browser.pages()).find(p=>p.url().includes('/frontend/index.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}
 if(!page)throw Error('No IDE page');
 if(label!=='seed')await page.evaluate(()=>{
  let seen=false;const observer=new MutationObserver(()=>{
   if(document.querySelector('.fabi-agent-boot'))seen=true;
   else if(seen){window.fabiBenchmarkRestoreFinished=true;observer.disconnect();}
  });observer.observe(document.body,{childList:true,subtree:true});
 });
 await page.waitForFunction(()=>{const c=window.theia?.container;const k=c&&[...c._bindingDictionary._map.keys()].find(k=>k?.name==='FrontendApplicationStateService');return k&&c.get(k).state==='ready';},{timeout:90000});
 const readyMs=Date.now()-started;
 const timing=await page.evaluate(()=>({pageMs:performance.now(),preload:!!document.querySelector('.theia-preload')}));
 if(label==='seed')await page.evaluate(async()=>{const c=window.theia.container;const get=n=>c.get([...c._bindingDictionary._map.keys()].find(k=>k?.name===n));const a=get('FabiAgentTerminals');await a.storage.setData('fabi.agentTerminals',{'fabi-agent-startup-benchmark':{cli:'codex',cwd:get('WorkspaceService').tryGetRoots()[0].resource.toString(),sessionId:'00000000-0000-0000-0000-000000000001',shellPid:-1,createdAt:Date.now()}});});
 console.log(JSON.stringify({label,readyMs,...timing,logPath}));
 // Let restoration expose its completion independently of the ready measurement.
 if(label!=='seed') {
  await page.waitForFunction(()=>window.fabiBenchmarkRestoreFinished,{timeout:25000});
  const restored=await page.evaluate(()=>{const c=window.theia.container;const key=[...c._bindingDictionary._map.keys()].find(k=>k?.name==='FabiAgentTerminals');const a=c.get(key);const binding=a.all().get('fabi-agent-startup-benchmark');return {terminal:!!a.terminals.getById('fabi-agent-startup-benchmark'),sessionId:binding?.sessionId};});
  if(!restored.terminal||restored.sessionId!=='00000000-0000-0000-0000-000000000001')throw Error('Restored terminal identity was lost');
  console.log(JSON.stringify({label,restorationMs:Date.now()-started,...restored}));
 }
}finally{if(browser){await browser.close().catch(()=>{});}if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);}log.end();}
