import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: process.env.FABI_DEBUG_URL || 'http://127.0.0.1:9226', defaultViewport: null });
try {
    const page = (await browser.pages()).find(page => page.url().includes('/frontend/index.html'));
    await page.waitForFunction(() => { const c = window.theia?.container, key = c && [...c._bindingDictionary._map.keys()].find(key => key?.name === 'FrontendApplicationStateService'); return key && c.get(key).state === 'ready'; });
    const result = await page.evaluate(async () => {
        const c = window.theia.container, a = c.get([...c._bindingDictionary._map.keys()].find(key => key?.name === 'AssistContribution'));
        const m = a.model, old = { root: m.root, book: m.book, context: m.context, thread: m.thread, selectedAgent: m.selectedAgent, completed: m.completed, previousState: m.previousState, dispatchedTo: m.dispatchedTo, dispatchStatus: m.dispatchStatus, ask: m.ask };
        const rows = m.agents.rowsFor, previous = m.shell.currentWidget?.id;
        const t = await m.terminals.newTerminal({ title: 'Session completion validation' });
        const wait = () => new Promise(resolve => setTimeout(resolve, 80));
        try {
            a.closeSurface(); await t.start(); await m.terminals.open(t, { widgetOptions: { area: 'main' }, mode: 'activate' });
            m.root = m.workspace.tryGetRoots()[0].resource;
            const row = { key: 'completion-fixture', widgetId: t.id, state: 'working', kind: 'Codex', title: 'Fixture', observations: [] };
            m.agents.rowsFor = root => [...rows.call(m.agents, root), ...(root.isEqual(m.root) ? [row] : [])];
            m.context = { terminal: { id: t.id, title: 'Fixture', selected: false } };
            m.newThread('terminal');
            const lesson = { id: 'reading-fixture', at: Date.now(), mode: 'learn', thread: m.thread, context: m.context, question: 'Suivre une valeur', reply: { title: 'Le cours en cours', explanation: 'Nous suivons une valeur.', sources: [] } };
            m.book = { version: 1, project: m.root.path.fsPath(), concepts: [], turns: [lesson] };
            let requests = 0, mode;
            m.ask = async (_question, requestedMode) => { requests++; mode = requestedMode; };
            await a.open(true, t);
            m.selectedAgent = row.key; m.dispatchedTo = t.id; m.previousState = undefined;
            m.agents.changedEmitter.fire();
            row.state = 'done'; m.agents.changedEmitter.fire(); await wait();
            const passive = { requests, lessonIntact: m.book.turns[0] === lesson, notice: document.querySelector('.fabi-session-notice')?.textContent, sameTerminal: !t.isDisposed };
            [...document.querySelectorAll('.fabi-session-notice button')].find(button => button.textContent === 'Comprendre le résultat')?.click();
            const explicit = { requests, mode };
            row.state = 'working'; m.agents.changedEmitter.fire(); await wait();
            return { passive, explicit, cleared: !document.querySelector('.fabi-session-notice') };
        } finally {
            a.closeSurface(); m.agents.rowsFor = rows; Object.assign(m, old); m.changed.fire(); t.dispose();
            if (previous) await m.shell.activateWidget(previous);
        }
    });
    assert.equal(result.passive.requests, 0, 'Completion must not request a new lesson');
    assert.ok(result.passive.lessonIntact && result.passive.sameTerminal);
    assert.match(result.passive.notice, /tour.*terminé/);
    assert.deepEqual(result.explicit, { requests: 1, mode: 'review' });
    assert.equal(result.cleared, true, 'New work clears the prior completion');
    console.log('PASS: agent completion preserves the current lesson, offers an explicit review and clears on new work.');
} finally { await browser.disconnect(); }
