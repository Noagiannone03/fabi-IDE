import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: process.env.FABI_DEBUG_URL || 'http://127.0.0.1:9226', defaultViewport: null });
const clients = [];
let page;
try {
    for (const p of await browser.pages()) { const c = await p.createCDPSession(); clients.push(c); await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }); }
    page = (await browser.pages()).find(p => p.url().includes('/frontend/index.html'));
    await page.evaluate(async () => {
        const c = window.theia.container;
        const m = c.get([...c._bindingDictionary._map.keys()].find(k => k?.name === 'AssistContribution')).model;
        const nav = m.shell.widgets.find(w => w.id === 'files');
        const ws = nav.workspaceService, base = ws.tryGetRoots()[0].resource;
        window.projectCheck = { nav, ws, root: nav.model.root, roots: ws.tryGetRoots, active: nav.activeProject, files: nav.filesOpen };
        // Real file trees, temporary workspace roots: never save or mutate the user's workspace.
        const roots = await Promise.all(['fabi-swarm', 'fabi-branding'].map(name => nav.model.fileService.resolve(base.resolve(name))));
        const root = { id: 'WorkspaceNodeId', name: 'Test multi-root', visible: false, selected: false, children: [] };
        root.children = await Promise.all(roots.map(stat => nav.model.tree.createWorkspaceRoot(stat, root)));
        ws.tryGetRoots = () => roots;
        nav.model.root = root;
        await Promise.all(root.children.map(node => nav.model.expandNode(node)));
        nav.selectProject(roots[0].resource); nav.showFiles();
    });
    await page.waitForSelector('.fabi-files-viewport .theia-TreeNode');
    const first = await page.evaluate(() => [...window.projectCheck.nav.rows.values()].map(r => r.node.uri?.toString()));
    assert.ok(first.length > 1); assert.ok(first.every(uri => uri.includes('/fabi-swarm')));
    await page.click('.fabi-sessions-back');
    await page.waitForSelector('.fabi-session-list:not([hidden])');
    assert.equal(await page.$$eval('.fabi-folder-group', nodes => nodes.length), 2);
    // Collapse and restore the first project without hiding other projects.
    await page.click('.fabi-folder-group:first-child .fabi-folder-disclosure');
    await page.waitForFunction(() => document.querySelector('.fabi-folder-group:first-child .fabi-project-sessions').hidden);
    await page.click('.fabi-folder-group:first-child .fabi-folder-disclosure');
    await new Promise(resolve => setTimeout(resolve, 250));
    await page.screenshot({ path: '/tmp/fabi-project-switcher.png' });
    await page.click('.fabi-folder-group:last-child .fabi-project-code');
    await page.waitForFunction(() => document.querySelector('.fabi-code-location').textContent === 'fabi-branding' && document.querySelector('.fabi-workspace-browser').dataset.filesOpen === 'true');
    const next = await page.evaluate(() => {
        const n = window.projectCheck.nav;
        const rows = [...n.rows.values()];
        return { uris: rows.map(r => r.node.uri?.toString()), nextAfterLast: n.model.getNextSelectableNode(rows.at(-1).node)?.id,
            stored: n.storeState().fabiActiveProject, height: n.node.querySelector('.fabi-files-viewport').clientHeight,
            top: n.node.querySelector('.fabi-code-navigation').getBoundingClientRect().top - n.node.getBoundingClientRect().top };
    });
    assert.ok(next.uris.length > 1); assert.ok(next.uris.every(uri => uri.includes('/fabi-branding')));
    assert.equal(next.nextAfterLast, undefined); assert.ok(next.stored.endsWith('/fabi-branding'));
    assert.ok(next.height > 250); assert.ok(next.top < 150);
    await new Promise(resolve => setTimeout(resolve, 250));
    await page.screenshot({ path: '/tmp/fabi-project-code.png' });
    await page.click('.fabi-sessions-back');
    await page.waitForFunction(() => document.activeElement?.classList.contains('fabi-project-code')); 
    // Exercise the same input class as the extension search, plus tree and dock focus.
    const focus = await page.evaluate(() => {
        const input = document.createElement('input'); input.className = 'theia-input'; document.body.append(input); input.focus();
        const style = getComputedStyle(input), body = getComputedStyle(document.body);
        const result = { outline: style.outlineStyle, shadow: style.boxShadow, token: body.getPropertyValue('--theia-focusBorder').trim() };
        input.remove(); return result;
    });
    assert.equal(focus.outline, 'none'); assert.equal(focus.shadow, 'none'); assert.equal(focus.token, 'transparent');
    console.log('Passed: two real project trees, isolated file rows, keyboard boundary, persisted project, full-height code drill-in, folder collapse and keyboard return, focus tokens/input ring removed.');
} finally {
    if (page) await page.evaluate(() => { const f = window.projectCheck; if (!f) return; f.ws.tryGetRoots = f.roots; f.nav.activeProject = f.active; f.nav.filesOpen = f.files; f.nav.model.root = f.root; f.nav.doUpdateRows(); delete window.projectCheck; }).catch(() => {});
    for (const c of clients) { await c.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {}); await c.detach().catch(() => {}); }
    await browser.disconnect();
}
