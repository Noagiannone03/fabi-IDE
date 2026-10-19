import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: process.env.FABI_DEBUG_URL || 'http://127.0.0.1:9226', defaultViewport: null });
let page;
try {
    page = (await browser.pages()).find(p => p.url().includes('/frontend/index.html'));
    assert.ok(page);
    await page.waitForFunction(() => window.theia?.container, { timeout: 30000 });
    await page.waitForFunction(() => { const c = window.theia?.container; if (!c) return false; const key = [...c._bindingDictionary._map.keys()].find(k => k?.name === 'FrontendApplicationStateService'); return key && c.get(key).state === 'ready'; }, { timeout: 60000 });
    await page.evaluate(async () => {
        const c = window.theia.container;
        const contribution = c.get([...c._bindingDictionary._map.keys()].find(k => k?.name === 'AssistContribution'));
        const model = contribution.model;
        const terminal = await model.terminals.newTerminal({ title: 'Assist UI fixture', location: 'editor' });
        await terminal.start(); await model.terminals.open(terminal, { widgetOptions: { area: 'main' }, mode: 'activate' });
        const row = { key: terminal.id, widgetId: terminal.id, kind: 'codex', sessionId: 'fixture', title: 'Codex', state: 'idle', unread: false, updatedAt: Date.now() };
        const original = { prepare: model.prepare, service: model.service, sendText: terminal.sendText, refreshCliContext: model.refreshCliContext };
        const sent = [];
        model.service = { ...model.service, assertCliProcess: async () => {} };
        terminal.sendText = text => sent.push(text);
        Object.defineProperty(model, 'agent', { configurable: true, get: () => row });
        model.prepare = async () => {
            model.root = model.workspace.tryGetRoots()[0]?.resource;
            model.book = { version: 1, project: model.root?.path.toString(), concepts: [], turns: [] };
            model.context = { kind: 'terminal', terminal: { id: terminal.id, title: 'Codex', selected: false } };
            model.newThread('terminal'); model.account = { connected: true, models: [] }; model.changed.fire();
        };
        const switchRect = terminal.node.querySelector('.fabi-terminal-assist').getBoundingClientRect();
        window.controlFixture = { contribution, model, terminal, row, original, sent, terminalRight: switchRect.right };
        await contribution.open(false, terminal);
    });
    await page.waitForSelector('.fabi-assist-invitation');
    const ready = await page.evaluate(() => {
        const { terminalRight } = window.controlFixture;
        return { sameRight: Math.abs(document.querySelector('.fabi-assist-topline .fabi-assist-segments').getBoundingClientRect().right - terminalRight) < 3,
            noMarketing: !document.querySelector('.fabi-assist-invitation').textContent.includes('ensemble'),
            logo: document.querySelector('.fabi-assist-welcome-mark').getBoundingClientRect().width };
    });
    assert.equal(ready.sameRight, true); assert.equal(ready.noMarketing, true); assert.ok(ready.logo >= 80);
    await page.screenshot({ path: '/tmp/fabi-assist-control-ready.png' });
    await page.evaluate(() => { const { model } = window.controlFixture; model.draft = 'Ajoute un filtre'; model.prepareDispatch(); });
    await page.waitForSelector('.fabi-dispatch-review');
    assert.equal(await page.evaluate(() => window.controlFixture.sent.length), 0, 'Preparing never sends');
    await page.screenshot({ path: '/tmp/fabi-assist-control-proposal.png' });
    const sent = await page.evaluate(async () => {
        const { model, row, sent } = window.controlFixture;
        row.state = 'working'; await model.dispatch(); const blocked = sent.length === 0;
        row.state = 'idle'; await model.dispatch(); await model.dispatch();
        row.state = 'working'; row.preview = 'Lecture du composant et des tests existants'; model.changed.fire();
        return { blocked, count: sent.length, bracketed: sent[0]?.startsWith('\x1b[200~'), submitted: sent[0]?.endsWith('\x1b[201~\r') };
    });
    assert.deepEqual(sent, { blocked: true, count: 1, bracketed: true, submitted: true });
    await page.waitForSelector('.fabi-cli-progress[data-working=true]');
    await page.screenshot({ path: '/tmp/fabi-assist-control-working.png' });
    await page.evaluate(async () => {
        const f = window.controlFixture, { model } = f;
        model.refreshCliContext = async () => {};
        model.service.ask = request => new Promise((resolve, reject) => { f.request = request; f.resolve = resolve; f.reject = reject; });
        model.service.account = async () => model.account;
        model.draft = 'Explique le résultat simplement';
        f.asking = model.ask(model.draft, 'assist');
    });
    await page.waitForSelector('.fabi-pending-turn .fabi-user-question');
    assert.equal(await page.$eval('textarea[aria-label="Ta question"]', node => node.value), '');
    assert.equal(await page.$eval('.fabi-pending-turn .fabi-user-question', node => node.textContent), 'Explique le résultat simplement');
    await page.evaluate(() => {
        const { model } = window.controlFixture;
        model.draft = 'Et ensuite ?';
        model.onProgress({ id: model.busy, text: 'Lecture des fichiers', phase: 'tool', tool: 'read' });
    });
    await page.waitForSelector('.fabi-activity[data-phase="tool"]');
    await page.waitForFunction(() => { const e = document.querySelector('.fabi-activity'); const area = document.querySelector('.fabi-assist-reading-space'); return e && Number(getComputedStyle(e).opacity) > .99 && e.getBoundingClientRect().bottom <= area.getBoundingClientRect().bottom + 1; });
    await page.screenshot({ path: '/tmp/fabi-assist-control-chat-loading.png' });
    await page.evaluate(async () => {
        const f = window.controlFixture, { model } = f;
        f.resolve({ ...model.book, turns: [{ ...f.request, at: Date.now(), reply: { title: 'Le résultat', explanation: 'Le compteur passe de 3 à 4 : la fonction ajoute un au nombre reçu.', sources: [] } }] });
        await f.asking;
    });
    await page.waitForSelector('.fabi-assist-response');
    assert.equal(await page.$eval('textarea[aria-label="Ta question"]', node => node.value), 'Et ensuite ?');
    assert.equal((await page.$$('.fabi-user-question')).length, 1, 'No duplicate optimistic message');
    await page.evaluate(async () => {
        const f = window.controlFixture, { model } = f;
        f.asking = model.ask('Instruction interne du bilan', 'review');
        await Promise.resolve(); await Promise.resolve();
        f.resolve({ ...model.book, turns: [...model.book.turns, { ...f.request, at: Date.now(), reply: { title: 'Ce que Codex a répondu', explanation: 'Le projet contient un compteur. Codex a identifié sa fonction et son dossier.', sources: [] } }] });
        await f.asking;
    });
    assert.equal((await page.$$('.fabi-user-question')).length, 1, 'Automatic review is not a user message');
    assert.equal(await page.$eval('textarea[aria-label="Ta question"]', node => node.value), 'Et ensuite ?');
    await page.waitForFunction(() => { const e = [...document.querySelectorAll('.fabi-conversation-turn')].at(-1); const area = document.querySelector('.fabi-assist-reading-space'); return e && Number(getComputedStyle(e).opacity) > .99 && e.getBoundingClientRect().bottom <= area.getBoundingClientRect().bottom + 1; });
    await page.screenshot({ path: '/tmp/fabi-assist-control-chat-result.png' });
    await page.evaluate(async () => {
        const f = window.controlFixture, { model } = f;
        f.asking = model.ask('Question à conserver', 'assist');
        await Promise.resolve(); await Promise.resolve();
        f.reject(new Error('Échec de test')); await f.asking;
    });
    await page.waitForSelector('.fabi-retry-message');
    assert.equal(await page.$eval('.fabi-pending-turn .fabi-user-question', node => node.textContent), 'Question à conserver');
    console.log('Passed: optimistic message, immediate input clearing, new draft preserved, tool activity, no duplicate reply, automatic review separated, failed message retry.');
    console.log('Passed: stable right toggle, minimal welcome, editable confirmation, no implicit dispatch, busy CLI blocked, single native terminal write, visible work status. Transport is mocked; no developer session was prompted.');
} finally {
    if (page) await page.evaluate(() => {
        const f = window.controlFixture; if (!f) return;
        f.contribution.closeSurface(); f.model.prepare = f.original.prepare; f.model.service = f.original.service; f.model.refreshCliContext = f.original.refreshCliContext; f.model.pendingMessage = undefined; f.model.busy = undefined;
        delete f.model.agent; f.terminal.sendText = f.original.sendText; f.terminal.dispose(); delete window.controlFixture;
    }).catch(() => {});
    await browser.disconnect();
}
