// Static chrome only: no Theia backend, webpack, Electron or compiler.
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';

const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || await puppeteer.executablePath(),
    protocolTimeout: 10000,
    headless: true,
    args: ['--disable-gpu']
});
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => {
        window.chromeTestCalls = [];
        const record = (name, data) => window.chromeTestCalls.push({ name, data });
        window.fabiSpaces = {
            platform: 'darwin',
            onModalOpen: cb => { window.emitModal = cb; },
            onModalFolder: cb => { window.emitFolder = cb; },
            modalCreate: data => record('create', data),
            modalCancel: () => record('cancel'),
            modalPickFolder: () => record('folder'),
            onState: cb => { window.emitState = cb; },
            ready: () => record('ready'),
            open: data => record('open', data),
            create: () => record('new'),
            toggleSidebar: () => record('manage'),
            rename: (id, name) => record('rename', { id, name }),
            reorder: ids => record('reorder', ids),
            setColor: (id, color) => record('color', { id, color }),
            setEmoji: (id, icon) => record('icon', { id, icon }),
            close: id => record('close', id),
            windowControl: data => record('window', data)
        };
    });
    await page.goto(pathToFileURL(resolve(root, 'fabi-spaces/resources/rail/modal.html')).href);
    await page.evaluate(() => window.emitModal({ folder: '/Projects/interface', defaultName: 'Interface', color: '#5E5CE6' }));
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.$eval('#nameInput', el => document.activeElement === el), true);
    assert.equal(await page.$eval('.personalization', el => el.open), false);
    await page.keyboard.press('Tab');
    assert.equal(await page.$eval('#changeFolder', el => document.activeElement === el), true);
    await page.focus('#createBtn');
    await page.keyboard.press('Tab');
    assert.equal(await page.$eval('#nameInput', el => document.activeElement === el), true);
    await page.$eval('#nameInput', el => { el.value = '   '; el.dispatchEvent(new Event('input')); });
    await page.$eval('#createBtn', el => el.click());
    assert.equal(await page.$eval('#nameInput', el => el.getAttribute('aria-invalid')), 'true');
    assert.equal(await page.evaluate(() => window.chromeTestCalls.length), 0);
    await page.$eval('#nameInput', el => { el.value = 'Interface'; el.dispatchEvent(new Event('input')); });
    await page.$eval('summary', el => el.click());
    await page.$eval('.swatch:nth-child(4)', el => el.click());
    assert.equal(await page.$eval('.swatch:nth-child(4)', el => el.getAttribute('aria-pressed')), 'true');
    await page.setViewport({ width: 640, height: 400, deviceScaleFactor: 1 });
    assert.equal(await page.$eval('.card', el => {
        const r = el.getBoundingClientRect();
        return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    }), true);
    await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
    if (process.env.MODAL_SHOT) { await page.screenshot({ path: process.env.MODAL_SHOT }); }
    await page.$eval('#createBtn', el => el.click());
    await page.$eval('#createBtn', el => el.click());
    assert.equal(await page.evaluate(() => window.chromeTestCalls.filter(call => call.name === 'create').length), 1);
    await page.setViewport({ width: 208, height: 64, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(resolve(root, 'fabi-spaces/resources/rail/topbar.html')).href);
    await page.evaluate(() => window.emitState({ expanded: false, activeId: 'a', spaces: [
        { id: 'a', name: 'Interface', color: '#5E5CE6' }, { id: 'b', name: 'Backend', color: '#30D158' }
    ] }));
    await page.focus('#manage');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.chromeTestCalls.some(call => call.name === 'manage')), true);
    assert.equal(await page.$eval('#activeName', el => el.textContent), 'Interface');
    await page.evaluate(() => window.emitState({ expanded: true, activeId: 'b', spaces: [
        { id: 'a', name: 'Interface' }, { id: 'b', name: 'Backend' }
    ] }));
    assert.equal(await page.$eval('#manage', el => document.activeElement === el), true);
    assert.equal(await page.$eval('#activeName', el => el.textContent), 'Backend');
    assert.equal(await page.$eval('#manage', el => el.getAttribute('aria-expanded')), 'true');
    await page.setViewport({ width: 250, height: 540, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(resolve(root, 'fabi-spaces/resources/rail/rail.html')).href);
    await page.evaluate(() => window.emitState({ expanded: true, activeId: 'a', liveIds: ['a'], spaces: [
        { id: 'maestro', name: 'Maestro', kind: 'maestro', color: '#8E8E93' },
        { id: 'a', name: 'Interface', color: '#5E5CE6' }, { id: 'b', name: 'Backend', color: '#30D158' }
    ] }));
    assert.equal(await page.$eval('[data-id=maestro] .space-options', el => el.hidden), true);
    await page.$eval('[data-id=a] .space-options', el => el.click());
    assert.equal(await page.$eval('#ctxmenu', el => el.contains(document.activeElement)), true);
    await page.evaluate(() => [...document.querySelectorAll('.ctx-item')].find(el => el.textContent === 'Déplacer vers le bas').click());
    assert.deepEqual(await page.evaluate(() => window.chromeTestCalls.find(call => call.name === 'reorder').data), ['maestro', 'b', 'a']);
    await page.$eval('[data-id=a] .space-options', el => el.click());
    await page.$eval('.ctx-item', el => el.click());
    await page.$eval('.space-name-input', el => { el.value = ''; });
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.chromeTestCalls.filter(call => call.name === 'rename').length), 0);
    assert.equal(await page.$eval('[data-id=a] .space-name', el => el.textContent), 'Interface');
    await page.$eval('[data-id=a] .space-options', el => el.click());
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('[data-id=a] .space-options', el => document.activeElement === el), true);
    if (process.env.RAIL_SHOT) { await page.screenshot({ path: process.env.RAIL_SHOT }); }
    // Minimal native markup to test the actual stylesheet cascade, not shell behavior.
    await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
    const styles = ['fabi-type.css', 'index.css', 'fabi-ui-polish.css', 'fabi-explorer-type.css',
        'fabi-islands.css', 'fabi-activity-bar.css', 'fabi-space-accent.css', 'fabi-ui-icons.css', 'fabi-midnight.css', 'fabi-native-midnight.css', 'fabi-studio.css'];
    const nativeStyles = ['node_modules/@theia/preferences/src/browser/style/index.css', 'node_modules/@theia/messages/src/browser/style/notifications.css'];
    await page.setContent(nativeStyles.map(file => `<link rel="stylesheet" href="${pathToFileURL(resolve(root, file)).href}">`).join('') +
        styles.map(file => `<link rel="stylesheet" href="${pathToFileURL(resolve(root, 'fabi-branding/src/browser/style', file)).href}">`).join('') + `
        <div id="theia-main-content-panel"><div class="lm-TabBar theia-app-centers">
          <div id="test-tab" tabindex="0" class="lm-TabBar-tab lm-mod-current">editor.ts</div>
        </div></div>
        <div class="theia-Tree"><div tabindex="0" id="test-row" class="theia-TreeNode theia-mod-focus">File</div></div>
        <div class="lm-Widget dialogOverlay"><div class="dialogBlock" id="test-dialog"><div class="dialogTitle">Dialog</div></div></div>
        <div id="test-toast" class="theia-notifications-container theia-notification-toasts"><div class="theia-notification-list-item">Message</div></div>
        <div id="test-closed-toast" class="theia-notifications-container closed"></div>
        <div class="theia-settings-container"><div class="pref-description" id="test-description">Description</div></div>
    `, { waitUntil: 'load' });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('test-tab')).backgroundColor === 'rgb(43, 44, 50)');
    const actualStyles = await page.evaluate(() => {
        const tab = getComputedStyle(document.getElementById('test-tab'));
        const dialog = getComputedStyle(document.getElementById('test-dialog'));
        document.getElementById('test-row').focus();
        const row = getComputedStyle(document.getElementById('test-row'));
        return { tabMargin: tab.marginTop, tabRadius: tab.borderTopLeftRadius,
            tabBackground: tab.backgroundColor, dialogBackground: dialog.backgroundColor,
            rowOutline: row.outlineStyle, rowOutlineWidth: row.outlineWidth };
    });
    assert.deepEqual(actualStyles, { tabMargin: '0px', tabRadius: '8px', tabBackground: 'rgb(43, 44, 50)',
        dialogBackground: 'rgb(37, 38, 44)', rowOutline: 'solid', rowOutlineWidth: '1px' });
    await page.evaluate(() => document.body.classList.add('fabi-dock-enabled'));
    assert.equal(await page.$eval('#test-toast', el => getComputedStyle(el).bottom), '88px');
    assert.equal(await page.$eval('#test-closed-toast', el => getComputedStyle(el).display), 'none');
    assert.equal(await page.$eval('#test-description', el => getComputedStyle(el).color), 'rgb(153, 153, 167)');
    await page.setViewport({ width: 360, height: 500, deviceScaleFactor: 1 });
    assert.equal(await page.$eval('#test-toast', el => getComputedStyle(el).width), '328px');
    assert.deepEqual(errors, []);
    console.log('Static chrome and CSS cascade: validation, focus, compact layout, single submit, Space navigation, tabs, dialogs, settings and notifications passed. Native IPC and full shell not tested.');
} finally { await browser.close(); }
