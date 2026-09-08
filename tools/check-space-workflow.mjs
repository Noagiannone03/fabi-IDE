// Actual native focus, pointer clicks and an existing file. No viewport/focus emulation.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.connect({browserURL:'http://127.0.0.1:9223',defaultViewport:null});
let chrome;
let active;
let page;
try {
    const pages=await browser.pages();
    chrome=pages.find(p=>p.url().includes('topbar.html'));
    assert.ok(chrome, 'The native Spaces rail must be available');
    active=await chrome.$eval('[aria-current=page]',e=>e.dataset.spaceId);
    for(const candidate of pages.filter(p=>p.url().includes('/frontend/index.html'))){
        if(await candidate.evaluate(id=>window.fabiMaestroHost.getContext().spaceId===id,active)){page=candidate;break;}
    }
    assert.ok(page);
    await page.waitForSelector('.theia-TreeNodeSegment',{timeout:25000});
    await page.evaluate(()=>{
        const c=window.theia.container;
        const key=[...c._bindingDictionary._map.keys()].find(k=>k.name==='ApplicationShell');
        window.fabiWorkflowShell=c.get(key);
    });
    const file=(await page.$$('.theia-TreeNodeSegment'));
    let readme;
    for(const candidate of file){if(await candidate.evaluate(e=>e.textContent==='README.md')){readme=candidate;break;}}
    assert.ok(readme,'Existing README must be visible in the explorer');
    await readme.click();
    await page.waitForFunction(()=>window.fabiWorkflowShell.getWidgets('main').some(w=>w.isVisible&&w.title.label==='README.md'),{polling:50,timeout:10000});
    await page.click('.fabi-dock-tool[aria-label="Agents"]');
    await page.waitForFunction(()=>window.fabiWorkflowShell.getWidgets('main').some(w=>w.isVisible&&(w.id==='chat-view-widget'||w.id.startsWith('fabi-chat-instance:'))),{polling:50,timeout:10000});
    await page.waitForFunction(()=>document.querySelector('.fabi-dock-tools').getAttribute('aria-busy')==='false',{polling:50,timeout:10000});
    await readme.click();
    await page.waitForFunction(()=>window.fabiWorkflowShell.getWidgets('main').some(w=>w.isVisible&&w.title.label==='README.md'),{polling:50,timeout:10000});
    assert.equal(await chrome.$('#manage'),null);
    const editorId=await page.evaluate(()=>window.fabiWorkflowShell.getWidgets('main').find(w=>w.isVisible&&w.title.label==='README.md').id);
    const other=await chrome.$$eval('.desktop', (nodes, id)=>nodes.find(e=>e.dataset.spaceId!==id&&e.dataset.kind!=='maestro')?.dataset.spaceId,active);
    if(other){
        await chrome.evaluate(id=>window.fabiSpaces.open(id),other);
        await chrome.waitForFunction(id=>document.querySelector('[aria-current=page]')?.dataset.spaceId===id,{polling:50},other);
        await chrome.evaluate(id=>window.fabiSpaces.open(id),active);
        await chrome.waitForFunction(id=>document.querySelector('[aria-current=page]')?.dataset.spaceId===id,{polling:50},active);
        assert.equal(await page.evaluate(id=>window.fabiWorkflowShell.getWidgets('main').some(w=>w.id===id&&w.isVisible),editorId),true);
    }
    console.log('Native README → Agent → README and Space round-trip passed without focus emulation.');
} finally {
    try {
        if (chrome && active && !chrome.isClosed()) {
            await chrome.evaluate(id=>window.fabiSpaces.open(id),active);
            await chrome.waitForFunction(id=>document.querySelector('[aria-current=page]')?.dataset.spaceId===id,{polling:50,timeout:10000},active);
        }
        if (page && !page.isClosed()) {
            await page.evaluate(()=>delete window.fabiWorkflowShell);
        }
    } finally {
        browser.disconnect();
    }
}
