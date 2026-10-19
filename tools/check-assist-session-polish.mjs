import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9226', defaultViewport: null });
const clients = []; let page;
try {
    for (const p of await browser.pages()) { const c = await p.createCDPSession(); clients.push(c); await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }); }
    page = (await browser.pages()).find(p => p.url().includes('/frontend/index.html'));
    await page.waitForFunction(() => { const c = window.theia?.container; const k = c && [...c._bindingDictionary._map.keys()].find(k => k?.name === 'FrontendApplicationStateService'); return k && c.get(k).state === 'ready'; });
    await page.evaluate(async () => {
        const c = window.theia.container, get = name => c.get([...c._bindingDictionary._map.keys()].find(k => k?.name === name));
        const contribution = get('AssistContribution'), m = contribution.contextModel, bindings = get('FabiAgentTerminals');
        const nav = m.shell.widgets.find(w => w.id === 'files');
        window.polish = { contribution, m, bindings, nav, filesOpen: nav.filesOpen, old: m.shell.currentWidget?.id,
            root: m.root, book: m.book, serial: m.replySerial, prepare: m.prepare, context: m.context, thread: m.thread, draft: m.draft };
        const f = window.polish;
        f.terminal = await bindings.open('fabi-agent-polish-test', { id: 'codex', label: 'Codex' }, { cli: 'codex', cwd: m.workspace.tryGetRoots()[0].resource.toString(), createdAt: Date.now() }, true);
        f.pid = await f.terminal.processId;
        nav.filesOpen = false; nav.update();
        f.terminal.close();
    });
    assert.equal(await page.evaluate(() => !window.polish.terminal.isDisposed && !window.polish.terminal.parent), true, 'Tab closure must retain the live PTY');
    await page.waitForSelector('.fabi-session-entry');
    await page.evaluate(async () => { const f = window.polish; const row = f.nav.agents.rows.find(r => r.widgetId === f.terminal.id); await f.nav.agents.open(row); });
    assert.equal(await page.evaluate(async () => { const f=window.polish; return !!f.terminal.parent && await f.terminal.processId === f.pid; }), true);
    // Native context menu, actual dialog, persistent custom name.
    await page.evaluate(() => { const f=window.polish; const row=f.nav.node.querySelectorAll('.fabi-session-entry'); const index=f.nav.agents.rowsFor(f.m.workspace.tryGetRoots()[0].resource).findIndex(r=>r.widgetId===f.terminal.id); row[index].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:180,clientY:300})); });
    await page.waitForSelector('.lm-Menu');
    assert.match(await page.$eval('.lm-Menu', e => e.textContent), /Renommer/);
    const rename = await page.evaluate(() => { const r=[...document.querySelectorAll('.lm-Menu-item')].find(e=>e.textContent.includes('Renommer')).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
    await page.mouse.click(rename.x, rename.y);
    await page.waitForSelector('.dialogBlock input');
    await page.$eval('.dialogBlock input', input => { input.value='Session de vérification'; input.dispatchEvent(new Event('input',{bubbles:true})); });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.polish.bindings.all().get(window.polish.terminal.id)?.title === 'Session de vérification');
    // No provider requests: render the actual shared answer component with a teaching fixture.
    await page.evaluate(async () => {
        const f=window.polish; f.m.root=f.m.workspace.tryGetRoots()[0].resource; f.m.prepare=async()=>{}; f.contribution.pointer={x:600,y:250}; await f.contribution.ask();
    });
    await page.waitForSelector('.fabi-fan-surface');
    assert.equal(await page.$$eval('.fabi-fan-material path', paths => paths.length), 1);
    await new Promise(r=>setTimeout(r,500));
    await page.screenshot({path:'/tmp/fabi-smooth-fan.png'});
    await page.evaluate(() => {
        const f=window.polish, m=f.m;
        m.book={...m.book,turns:[{id:'polish-fixture',at:Date.now(),mode:'explore',thread:m.thread,context:m.context,question:'Comment les conteneurs répondent-ils ?',reply:{title:'Du navigateur au serveur',sources:[],explanation:'Un **conteneur** fait tourner ton application dans un environnement isolé.\n\n### Observer ce qui tourne\nCette commande liste les conteneurs actifs :\n\n```bash\ndocker ps\n```\n\nTu verras leurs noms et leurs ports. Voici le trajet d’une requête :\n\n```mermaid\nflowchart LR\n  A[Navigateur] --> B[Serveur]\n  B --> C[Réponse]\n```\n\nLe serveur reçoit la demande, puis renvoie une réponse au navigateur.'}}]};
        m.replySerial++; m.changed.fire();
    });
    await page.waitForSelector('.fabi-code-block', {timeout:15000});
    await page.waitForSelector('.fabi-mermaid svg', {timeout:20000});
    assert.equal(await page.$$eval('.fabi-code-block', blocks=>blocks.length),2);
    assert.equal(await page.$eval('.fabi-code-block code', code=>code.textContent.trim().replace(/\u00a0/g,' ')),'docker ps');
    await page.$eval('.fabi-code-block', block => block.scrollIntoView({block:'start'}));
    await page.waitForFunction(() => { const c=document.querySelector('.fabi-petal-compose').getBoundingClientRect(); return c.bottom <= innerHeight && c.height > 0; });
    await page.screenshot({path:'/tmp/fabi-assist-visual-answer.png'});
    await page.evaluate(() => { const f=window.polish; f.bindings.close(f.terminal.id); });
    assert.equal(await page.evaluate(() => { const f=window.polish; return f.terminal.isDisposed && !f.bindings.all().has(f.terminal.id) && !f.nav.agents.rows.some(r=>r.widgetId===f.terminal.id); }),true);
    console.log('Passed: tab hide/reopen retains PID, native context menu and rename, session close removes row, continuous fan, fenced command and Mermaid SVG in shared answer renderer.');
} finally {
    if(page) await page.evaluate(async()=>{ const f=window.polish;if(!f)return; f.contribution.hide(); f.m.root=f.root;f.m.book=f.book;f.m.replySerial=f.serial;f.m.prepare=f.prepare;f.m.context=f.context;f.m.thread=f.thread;f.m.draft=f.draft;f.m.changed.fire();f.terminal?.dispose();f.nav.filesOpen=f.filesOpen;f.nav.update();if(f.old)await f.m.shell.activateWidget(f.old);delete window.polish; }).catch(()=>{});
    for(const c of clients){await c.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});await c.detach().catch(()=>{});}
    await browser.disconnect();
}
