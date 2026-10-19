import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: process.env.FABI_DEBUG_URL || 'http://127.0.0.1:9226', defaultViewport: null });
const clients = [];
let page;
try {
    for (const p of await browser.pages()) { const client = await p.createCDPSession(); clients.push(client); await client.send('Emulation.setFocusEmulationEnabled', { enabled: true }); }
    page = (await browser.pages()).find(p => p.url().includes('/frontend/index.html'));
    await page.waitForFunction(() => !!window.theia?.container);
    const before = await page.evaluate(async () => {
        const c = window.theia.container, a = c.get([...c._bindingDictionary._map.keys()].find(k => k?.name === 'AssistContribution'));
        a.closeSurface();
        const t = await a.model.terminals.newTerminal({ title: 'Presence validation' });
        await t.start(); await a.model.terminals.open(t, { widgetOptions: { area: 'main' }, mode: 'activate' });
        await new Promise(resolve => setTimeout(resolve, 300));
        const originalService = a.model.service, originalBook = a.model.book, originalCooldown = a.invitationCooldown;
        const originalKnowledge = new Map(a.model.knowledge), originalNotebooks = new Map(a.notebooks);
        a.model.service = Object.create(originalService);
        const notebook = async () => a.model.book ?? { version: 1, project: '', concepts: [], turns: [] };
        Object.defineProperties(a.model.service, {
            updateLearning: { value: notebook }, notebook: { value: notebook },
            account: { value: async () => a.model.account }
        });
        window.presenceCheck = { t, a, originalService, originalBook, originalCooldown, originalKnowledge, originalNotebooks };
        return { cols: t.term.cols, rows: t.term.rows, pid: t.terminalId };
    });
    const invitation = await page.evaluate(() => {
        const { t, a } = window.presenceCheck;
        const originalRows = a.model.agents.rowsFor;
        const root = a.model.workspace.tryGetRoots()[0].resource;
        const empty = { version: 1, project: root.path.fsPath(), concepts: [], turns: [], invitations: [] };
        a.notebooks.set(root.toString(), empty);
        if (a.model.root?.isEqual(root)) a.model.book = empty;
        a.model.knowledge.set(root.toString(), { phase: 'ready', changes: [] });
        const key = 'presence-test-generation';
        a.workingSince.set(key, Date.now() - 7000);
        a.invitationCooldown = 0;
        a.model.agents.rowsFor = requested => requested.isEqual(root) ? [{ key, widgetId: t.id, state: 'working', observations: [{ at: Date.now(), phase: 'started', path: 'src/session.ts', tool: 'Read', sessionId: 'fixture', source: 'claude' }] }] : [];
        const active = document.activeElement;
        a.updatePresence();
        const capsule = t.node.querySelector('.fabi-terminal-assist');
        const result = { invited: !!capsule.dataset.invited, title: capsule.querySelector('strong').textContent, focusKept: active === document.activeElement };

        a.model.agents.rowsFor = originalRows;
        return result;
    });
    assert.equal(invitation.invited, true);
    assert.match(invitation.title, /session.ts/);
    assert.equal(invitation.focusKept, true);
    if (process.env.FABI_CAPTURE) { await new Promise(resolve => setTimeout(resolve, 250)); await page.screenshot({ path: '/tmp/fabi-presence-invitation.png' }); }
    assert.equal(await page.evaluate(() => {
        const { t, a } = window.presenceCheck;
        t.node.querySelector('[data-action=later]').click(); a.updatePresence();
        return !t.node.querySelector('.fabi-terminal-assist').dataset.invited && !a.surface;
    }), true);
    await page.hover('.lm-mod-current .fabi-terminal-assist').catch(() => page.hover('.terminal-container:not(.lm-mod-hidden) .fabi-terminal-assist'));
    if (process.env.FABI_CAPTURE) await page.screenshot({ path: '/tmp/fabi-presence-capsule.png' });
    await page.evaluate(() => {
        const { a, t } = window.presenceCheck;
        window.presenceCheck.originalAsk = a.model.ask;
        a.model.ask = async question => { window.presenceCheck.acceptedQuestion = question; };
        t.node.querySelector('[data-action=learn]').click();
    });
    await page.waitForFunction(() => !!window.presenceCheck.acceptedQuestion);
    assert.match(await page.evaluate(() => window.presenceCheck.acceptedQuestion), /src\/session.ts/);
    await page.evaluate(() => { const s = window.presenceCheck; s.a.model.ask = s.originalAsk; delete s.originalAsk; });
    await page.waitForSelector('.fabi-terminal-peek');
    await new Promise(resolve => setTimeout(resolve, 400));
    const full = await page.evaluate(() => {
        const { t } = window.presenceCheck, surface = t.node.querySelector('.fabi-assist-surface');
        return { cols: t.term.cols, rows: t.term.rows, pid: t.terminalId, surfaceHeight: surface.clientHeight, terminalHeight: t.node.clientHeight };
    });
    assert.deepEqual({ cols: full.cols, rows: full.rows, pid: full.pid }, before);
    assert.ok(Math.abs(full.surfaceHeight - full.terminalHeight) <= 2, 'Assist occupies the full tab');
    if (process.env.FABI_CAPTURE) await page.screenshot({ path: '/tmp/fabi-presence-full.png' });
    const eye = await page.$('.fabi-terminal-peek'), rect = await eye.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
    await page.waitForFunction(() => +getComputedStyle(document.querySelector('.fabi-assist-surface')).opacity < .05);
    if (process.env.FABI_CAPTURE) await page.screenshot({ path: '/tmp/fabi-presence-peek.png' });
    await page.mouse.up();
    await page.waitForFunction(() => +getComputedStyle(document.querySelector('.fabi-assist-surface')).opacity > .95);
    await eye.focus(); await page.keyboard.down('Space');
    assert.equal(await page.$eval('.fabi-assist-surface', el => el.classList.contains('fabi-assist-peeking')), true);
    await page.keyboard.up('Space');
    assert.equal(await page.$eval('.fabi-assist-surface', el => el.classList.contains('fabi-assist-peeking')), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.fabi-assist-surface'), null);
    assert.equal(await page.evaluate(() => window.presenceCheck.t.node.contains(document.activeElement)), true);
    console.log('PASS: observed-generation invitation, no focus theft, dismissal cooldown, capsule, full tab without resizing the PTY, hold-to-peek with mouse/keyboard, Escape and terminal focus.');
} finally {
    await page?.evaluate(() => { const s = window.presenceCheck; if (s) { if (s.originalAsk) s.a.model.ask = s.originalAsk; s.a.closeSurface(); s.a.model.service = s.originalService; s.a.model.book = s.originalBook; s.a.invitationCooldown = s.originalCooldown; s.a.model.knowledge.clear(); for (const [k,v] of s.originalKnowledge) s.a.model.knowledge.set(k,v); s.a.notebooks.clear(); for (const [k,v] of s.originalNotebooks) s.a.notebooks.set(k,v); s.t.dispose(); delete window.presenceCheck; } }).catch(() => {});
    for (const client of clients) { await client.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {}); await client.detach().catch(() => {}); }
    await browser.disconnect();
}
