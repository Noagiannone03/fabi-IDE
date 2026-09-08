// Native smoke test: never resize WebContentsViews or invoke an AI provider.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const clients = [];
let workspace;
try {
    const pages = await browser.pages();
    workspace = pages.find(p => p.url().includes('/frontend/index.html') && !p.url().includes('maestro=1'));
    const chrome = pages.find(p => p.url().includes('/rail/topbar.html'));
    for (const page of pages) {
        const client = await page.createCDPSession();
        clients.push(client);
        await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    }
    const original = await chrome.$eval('[aria-current=page]', e => e.dataset.spaceId);
    const other = await chrome.$$eval('[data-space-id]', (nodes, id) => nodes.find(e => e.dataset.spaceId !== id)?.dataset.spaceId, original);
    if (other) {
        await chrome.evaluate(id => window.fabiSpaces.open(id), other);
        await chrome.waitForFunction(id => document.querySelector('[aria-current=page]')?.dataset.spaceId === id, {}, other);
        await chrome.evaluate(id => window.fabiSpaces.open(id), original);
        await chrome.waitForFunction(id => document.querySelector('[aria-current=page]')?.dataset.spaceId === id, {}, original);
        assert.equal(await chrome.$$eval('.desktop img', nodes => nodes.length), 0);
        assert.equal(await chrome.$eval('.desktop-name', e => getComputedStyle(e).writingMode), 'vertical-rl');
        await workspace.waitForFunction(() => !window.fabiSpaceOverlay?.isConnected);
        await chrome.screenshot({ path: '/tmp/fabi-motion-desktops.png' });
    }
    console.log('Connected Space tabs checked; creating a temporary terminal.');
    await workspace.evaluate(() => { window.fabiColorTestReady = (async () => {
        const container = window.theia.container;
        const key = [...container._bindingDictionary._map.keys()].find(k => String(k) === 'Symbol(TerminalService)');
        const service = container.get(key);
        const terminal = await service.newTerminal({ title: 'Vérification couleurs' });
        window.fabiColorTest = terminal;
        await terminal.start();
        service.open(terminal, { widgetOptions: { area: 'main' } });
        terminal.sendText("printf '\\nFABI_COLOR_ENV TERM=%s COLORTERM=%s NO_COLOR=%s\\n' \"$TERM\" \"$COLORTERM\" \"${NO_COLOR-unset}\"; printf '\\033[31mROUGE \\033[32mVERT \\033[34mBLEU \\033[38;2;190;150;230mTRUECOLOR\\033[0m\\n'\n");
    })(); });
    await workspace.evaluate(() => window.fabiColorTestReady);
    await workspace.waitForFunction(() => {
        const b = window.fabiColorTest.term.buffer.active;
        return Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString()).some(s => s.includes('FABI_COLOR_ENV TERM=xterm-256color COLORTERM=truecolor NO_COLOR=unset'));
    });
    const colors = await workspace.evaluate(() => {
        const terminal = window.fabiColorTest.term;
        const buffer = terminal.buffer.active;
        for (let i = 0; i < buffer.length; i++) {
            const line = buffer.getLine(i);
            if (line.translateToString().startsWith('ROUGE VERT BLEU TRUECOLOR')) {
                return [0, 6, 11, 16].map(x => line.getCell(x).getFgColor());
            }
        }
    });
    assert.deepEqual(colors, [1, 2, 4, 0xbe96e6]);
    await workspace.screenshot({ path: '/tmp/fabi-motion-terminal.png' });
    console.log('Native connected Space tabs, return transition cleanup, terminal environment, ANSI and RGB colors passed. Claude itself was not launched.');
} finally {
    if (workspace) await workspace.evaluate(() => { window.fabiColorTest?.dispose(); delete window.fabiColorTest; delete window.fabiColorTestReady; }).catch(() => {});
    for (const client of clients) {
        await client.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
        await client.detach().catch(() => {});
    }
    browser.disconnect();
}
