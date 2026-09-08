import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:9223',defaultViewport:null});
const page=(await browser.pages()).find(p=>p.url().includes('/frontend/index.html')&&!p.url().includes('maestro=1'));
const client=await page.createCDPSession();
try {
    await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    await page.waitForSelector('#fabi-workbench-dock');
    await page.evaluate(()=>{window.fabiFailureReady=(async()=>{
        const c=window.theia.container;
        const key=[...c._bindingDictionary._map.keys()].find(k=>String(k)==='Symbol(TerminalService)');
        const s=c.get(key), t=await s.newTerminal({title:'Test de sortie'});
        window.fabiFailureTerminal=t;
        await t.start();s.open(t,{widgetOptions:{area:'main'}});t.sendText('exit 7\n');
    })();});
    await page.evaluate(()=>window.fabiFailureReady);
    await page.waitForFunction(()=>window.fabiFailureTerminal?.exitStatus?.code===7);
    assert.equal(await page.evaluate(()=>window.fabiFailureTerminal.isDisposed),false);
    await page.waitForFunction(()=>{
        const b=window.fabiFailureTerminal.term.buffer.active;
        return Array.from({length:b.length},(_,i)=>b.getLine(i).translateToString()).some(s=>s.includes('code 7'));
    });
    await page.evaluate(()=>window.fabiFailureTerminal.close());
    await page.waitForFunction(()=>window.fabiFailureTerminal.isDisposed);
    console.log('Failed shell output retained with exit code; explicit close still disposes.');
} finally {
    await page.evaluate(()=>{window.fabiFailureTerminal?.dispose();delete window.fabiFailureTerminal;delete window.fabiFailureReady;});
    await client.send('Emulation.setFocusEmulationEnabled',{enabled:false});await client.detach();browser.disconnect();
}
