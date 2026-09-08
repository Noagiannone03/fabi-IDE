import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL:'http://127.0.0.1:9223',defaultViewport:null });
const page = (await browser.pages()).find(p=>p.url().includes('/frontend/index.html')&&!p.url().includes('maestro=1'));
const client=await page.createCDPSession();
try {
    await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    await page.evaluate(()=> { window.fabiDiagnosticReady=(async()=>{
        const c=window.theia.container;
        const key=[...c._bindingDictionary._map.keys()].find(k=>String(k)==='Symbol(TerminalService)');
        const service=c.get(key);
        const t=await service.newTerminal({title:'Diagnostic Claude'});
        window.fabiDiagnosticTerminal=t;
        window.fabiDiagnosticEvents=[];
        const dispose=t.dispose.bind(t);
        t.dispose=()=>{window.fabiDiagnosticEvents.push({exit:t.exitStatus,stack:new Error().stack});dispose();};
        await t.start();service.open(t,{widgetOptions:{area:'main'}});
        t.sendText('claude\n');
    })(); });
    await page.evaluate(()=>window.fabiDiagnosticReady);
    await new Promise(r=>setTimeout(r,8000));
    console.log(await page.evaluate(()=>{
        const t=window.fabiDiagnosticTerminal,b=t.term.buffer.active;
        return {disposed:t.isDisposed,exit:t.exitStatus,events:window.fabiDiagnosticEvents,
            text:Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString()).join('\n').slice(-6000)};
    }));
} finally {
    await page.evaluate(()=>{window.fabiDiagnosticTerminal?.dispose();delete window.fabiDiagnosticTerminal;delete window.fabiDiagnosticReady;delete window.fabiDiagnosticEvents;});
    await client.send('Emulation.setFocusEmulationEnabled',{enabled:false});await client.detach();browser.disconnect();
}
