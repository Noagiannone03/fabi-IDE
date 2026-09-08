// Inspect the running native app without emulating a browser viewport.
// Puppeteer's default 800x600 viewport corrupts WebContentsView composition.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9223',
    defaultViewport: null
});
try {
    const pages = await browser.pages();
    const topbar = pages.find(page => page.url().includes('/rail/topbar.html'));
    const workspace = pages.find(page => page.url().includes('/frontend/index.html'));
    assert.ok(topbar && workspace, 'Native chrome and workspace must be running');
    const chrome = await topbar.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.equal(chrome.height, 64, 'The Space selector must not inherit an emulated viewport');
    assert.equal(chrome.width, 208);
    const layout = await workspace.evaluate(() => {
        const bounds = element => {
            const r = element.getBoundingClientRect();
            return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        };
        return {
            width: innerWidth,
            height: innerHeight,
            dock: bounds(document.getElementById('fabi-workbench-dock')),
            tools: [...document.querySelectorAll('.fabi-dock-tool')].map(bounds),
            rightLauncher: !!document.querySelector('#theia-right-content-panel .theia-app-sidebar-container')
        };
    });
    assert.equal(layout.rightLauncher, false);
    assert.equal(layout.tools.length, 4);
    assert.ok(layout.dock.bottom <= layout.height);
    assert.ok(layout.tools.every(r => r.x >= 0 && r.right <= layout.width && r.y === layout.tools[0].y));
    console.log({ chrome, layout });
} finally {
    browser.disconnect();
}
