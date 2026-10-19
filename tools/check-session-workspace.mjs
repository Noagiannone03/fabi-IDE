import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: process.env.FABI_DEBUG_URL || 'http://127.0.0.1:9226', defaultViewport: null });
let page;
const clients = [];
try {
    for (const view of await browser.pages()) { const client = await view.createCDPSession(); clients.push(client); await client.send('Emulation.setFocusEmulationEnabled', { enabled: true }); }
    page = (await browser.pages()).find(p => p.url().includes('/frontend/index.html'));
    await page.waitForFunction(() => {
        const c = window.theia?.container;
        const k = c && [...c._bindingDictionary._map.keys()].find(k => k?.name === 'FrontendApplicationStateService');
        return k && c.get(k).state === 'ready';
    }, { timeout: 30000 });
    await page.evaluate(() => {
        const c = window.theia.container;
        const key = [...c._bindingDictionary._map.keys()].find(k => k?.name === 'AssistContribution');
        const model = c.get(key).model;
        const nav = model.shell.widgets.find(w => w.id === 'files');
        window.sessionCheck = { model, nav, oldCurrent: model.shell.currentWidget?.id, filesOpen: nav.filesOpen,
            terminalIds: model.terminals.all.map(t => t.id), editorIds: model.editors.all.map(e => e.id), rowsFor: nav.agents.rowsFor };
        nav.filesOpen = false; nav.update();
    });
    await page.waitForFunction(() => document.querySelector('.fabi-workspace-browser')?.dataset.filesOpen === 'false');
    await page.waitForFunction(() => !document.querySelector('.theia-preload') || getComputedStyle(document.querySelector('.theia-preload')).display === 'none');
    assert.equal(await page.$eval('.fabi-workspace-browser', e => e.dataset.filesOpen), 'false', 'Sessions are primary on migration');
    await page.click('.fabi-project-code');
    await page.waitForSelector('.fabi-files-viewport:not([hidden]) .theia-TreeNode');
    const tree = await page.evaluate(async () => {
        const { nav, model } = window.sessionCheck;
        const root = model.workspace.tryGetRoots()[0].resource;
        const file = await nav.model.revealFile(root.resolve('package.json'));
        if (!file) throw new Error('Cannot reveal native file');
        nav.model.selectNode(file);
        const rows = [...nav.rows.values()];
        const row = rows.find(r => r.node.id === file.id);
        nav.view.list.scrollToIndex({ index: row.index, align: 'center' });
        return { nativeParent: !file.parent.id.includes('#code'), noFakeGroups: !rows.some(r => r.node.fabiSection), id: file.id };
    });
    assert.equal(tree.nativeParent, true); assert.equal(tree.noFakeGroups, true);
    const fileSelector = '#files .theia-TreeNode[title$="/package.json"]';
    await page.waitForSelector(fileSelector);
    await page.click(fileSelector, { clickCount: 2 });
    await page.waitForFunction(() => window.sessionCheck.model.editors.currentEditor?.editor.uri.path.base === 'package.json');
    await page.click(fileSelector, { button: 'right' });
    await page.waitForSelector('.lm-Menu');
    await page.keyboard.press('Escape');
    // Status refreshes do not change the native file tree or its scroll position.
    const scroll = await page.evaluate(async () => {
        const { nav } = window.sessionCheck;
        const area = nav.node.querySelector('[data-virtuoso-scroller]');
        area.scrollTop = area.scrollHeight;
        await new Promise(resolve => setTimeout(resolve, 180));
        const before = area.scrollTop;
        for (let i = 0; i < 3; i++) { nav.agents.changedEmitter.fire(); await new Promise(resolve => setTimeout(resolve, 80)); }
        return { before, after: area.scrollTop };
    });
    assert.ok(Math.abs(scroll.before - scroll.after) < 3, JSON.stringify(scroll));
    await page.click('.fabi-sessions-back');
    await page.evaluate(() => window.sessionCheck.nav.commandService.executeCommand('fabi.projects.showFiles'));
    await page.waitForSelector('.fabi-files-viewport:not([hidden])');
    // Three quick clicks must create three different editor-area terminals.
    await page.evaluate(() => { const button = document.querySelector('#fabi-workbench-dock [aria-label="Terminal"]'); for (let i = 0; i < 3; i++) button.click(); });
    await page.waitForFunction(() => {
        const f = window.sessionCheck;
        return f.model.terminals.all.filter(t => !f.terminalIds.includes(t.id) && f.model.shell.getAreaFor(t) === 'main').length === 3;
    }, { timeout: 30000 });
    const count = await page.evaluate(async () => {
        const f = window.sessionCheck;
        const terminals = f.model.terminals.all.filter(t => !f.terminalIds.includes(t.id));
        return { count: terminals.length, processes: new Set(await Promise.all(terminals.map(t => t.processId))).size };
    });
    assert.deepEqual(count, { count: 3, processes: 3 });
    // Visual fixtures only: no CLI request, no model call, no fake persisted activity.
    await page.evaluate(() => {
        const f = window.sessionCheck, root = f.model.workspace.tryGetRoots()[0].resource;
        const terminals = f.model.terminals.all.filter(t => !f.terminalIds.includes(t.id));
        f.rows = terminals.map((t, i) => ({ key: t.id, widgetId: t.id, kind: i === 2 ? 'claude' : 'codex',
            title: ['Comprendre le démarrage', 'Corriger le panneau des sessions', 'Vérifier les changements'][i],
            state: ['working', 'idle', 'permission'][i], unread: i === 2, updatedAt: Date.now(), folder: root.resolve(['fabi-swarm', 'fabi-branding', 'fabi-spaces'][i]) }));
        f.nav.agents.rowsFor = uri => root.isEqual(uri) ? f.rows : [];
        f.nav.filesOpen = false; f.nav.update();
    });
    await page.waitForFunction(() => document.querySelectorAll('.fabi-session-entry').length === 3);
    await page.waitForFunction(() => !!document.querySelector('.fabi-session-branches path')?.getAttribute('d'));
    const branches = await page.$eval('.fabi-project-sessions', group => ({
        paths: group.querySelectorAll('svg path').length,
        curves: (group.querySelector('path').getAttribute('d').match(/A/g) || []).length,
        cssStem: getComputedStyle(group.querySelector('button'), '::before').content,
        cssElbow: getComputedStyle(group.querySelector('button'), '::after').content
    }));
    assert.deepEqual(branches, { paths: 1, curves: 3, cssStem: 'none', cssElbow: 'none' });
    const labels = await page.$$eval('.fabi-session-entry', nodes => nodes.map(e => e.innerText));
    assert.match(labels[0], /Codex\s+1/); assert.match(labels[1], /Codex\s+2/);
    assert.match(labels[0], /fabi-swarm/); assert.match(labels[2], /À valider/);
    await new Promise(resolve => setTimeout(resolve, 250));
    await page.screenshot({ path: '/tmp/fabi-workspace-sessions.png' });
    await page.focus('.fabi-session-entry');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.sessionCheck.model.shell.currentWidget.id === window.sessionCheck.rows[0].widgetId, { timeout: 5000 });
    await page.click('.fabi-session-entry:last-child');
    assert.equal(await page.evaluate(() => window.sessionCheck.model.shell.currentWidget.id === window.sessionCheck.rows[2].widgetId), true);
    await page.click('.fabi-project-code');
    await page.waitForFunction(() => document.querySelector('.fabi-files-viewport').clientHeight > 100);
    await page.screenshot({ path: '/tmp/fabi-workspace-sessions-files.png' });
    console.log('Passed: sessions-first layout, folder metadata, duplicate CLI numbering, session activation, native file reveal/open/context menu, stable scroll, files shortcut, three rapid clicks => three real PTYs in editor tabs.');
} finally {
    if (page) await page.evaluate(async () => {
        const f = window.sessionCheck; if (!f) return;
        f.nav.agents.rowsFor = f.rowsFor; f.nav.filesOpen = f.filesOpen; f.nav.update();
        for (const t of [...f.model.terminals.all]) if (!f.terminalIds.includes(t.id)) t.dispose();
        for (const e of [...f.model.editors.all]) if (!f.editorIds.includes(e.id) && !e.saveable?.dirty) e.dispose();
        if (f.oldCurrent) await f.model.shell.activateWidget(f.oldCurrent);
        delete window.sessionCheck;
    }).catch(() => {});
    for (const client of clients) { await client.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {}); await client.detach().catch(() => {}); }
    await browser.disconnect();
}
