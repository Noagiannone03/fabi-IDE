// Repeat with the same workspace, tabs and idle duration. RSS includes shared pages.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';
const exec = promisify(execFile);
const scan = async () => {
    const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,rss=,time=,comm=']);
    return stdout.trim().split('\n').map(line => {
        const [,pid,ppid,rss,time,comm] = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
        const parts = time.split(':').map(Number); let seconds=0; for(const n of parts) seconds=seconds*60+n;
        return {pid:+pid,ppid:+ppid,rssKiB:+rss,cpuSeconds:seconds,comm};
    });
};
const before=await scan();
const root=before.find(p=>p.comm.endsWith('/electron/dist/Electron.app/Contents/MacOS/Electron'));
if(!root) throw new Error('Fabi development Electron is not running');
const descendants=(rows)=>{const ids=new Set([root.pid]);let size;do{size=ids.size;for(const p of rows)if(ids.has(p.ppid))ids.add(p.pid);}while(ids.size!==size);return rows.filter(p=>ids.has(p.pid));};
const initial=descendants(before);const started=Date.now();
await new Promise(resolve=>setTimeout(resolve,10000));
const current=descendants(await scan());const elapsed=(Date.now()-started)/1000;
const cpu=current.reduce((sum,p)=>sum+Math.max(0,p.cpuSeconds-(initial.find(i=>i.pid===p.pid)?.cpuSeconds??p.cpuSeconds)),0);
const browser=await puppeteer.connect({browserURL:process.env.FABI_DEBUG_URL||'http://127.0.0.1:9226',defaultViewport:null});
const renderers=[];
try{for(const page of await browser.pages()){const client=await page.createCDPSession();await client.send('Performance.enable');const {metrics}=await client.send('Performance.getMetrics');const pick=name=>metrics.find(m=>m.name===name)?.value;renderers.push({page:page.url().includes('/frontend/index.html')?'IDE':new URL(page.url()).pathname.split('/').pop(),heapUsedMiB:Math.round((pick('JSHeapUsedSize')||0)/1048576),heapTotalMiB:Math.round((pick('JSHeapTotalSize')||0)/1048576),nodes:pick('Nodes'),listeners:pick('JSEventListeners')});await client.detach();}}finally{await browser.disconnect();}
const result={at:new Date().toISOString(),intervalSeconds:elapsed,processes:current.length,rssMiB:Math.round(current.reduce((n,p)=>n+p.rssKiB,0)/1024),cpuPercentOneCore:Math.round(cpu/elapsed*1000)/10,renderers,details:current.map(p=>({pid:p.pid,process:p.comm.split('/').pop(),rssMiB:Math.round(p.rssKiB/1024)}))};
if(process.argv[2])await fs.writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
