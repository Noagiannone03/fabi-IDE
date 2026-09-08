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
    const focus = await page.createCDPSession();
    await focus.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => {
        window.chromeTestCalls = [];
        const record = (name, data) => window.chromeTestCalls.push({ name, data });
        window.fabiSpaces = {
            platform: 'darwin',
            onEdit: cb => { window.emitEdit = cb; },
            dismissMenu: () => record('dismiss'),
            close: id => record('close', id),
            contextMenu: id => record('context', id),
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
    assert.equal(await page.$('.swatch'), null);
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
    await page.setViewport({ width: 52, height: 700, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(resolve(root, 'fabi-spaces/resources/rail/topbar.html')).href);
    await page.evaluate(() => window.emitState({ expanded: false, activeId: 'a', spaces: [
        { id: 'a', name: 'Interface', color: '#5E5CE6' }, { id: 'b', name: 'Backend', color: '#30D158' }
    ] }));
    assert.equal(await page.$('#manage'), null);
    await page.$eval('[data-space-id=a]', el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    assert.equal(await page.evaluate(() => window.chromeTestCalls.some(call => call.name === 'context' && call.data === 'a')), true);
    assert.equal(await page.$eval('.desktop[aria-current=page] .desktop-name', el => el.textContent), 'Interface');
    await page.focus('[data-space-id=a]');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.chromeTestCalls.some(call => call.name === 'open' && call.data === 'b')), true);
    await page.evaluate(() => window.emitState({ expanded: true, activeId: 'b', spaces: [
        { id: 'a', name: 'Interface' }, { id: 'b', name: 'Backend' }
    ] }));
    assert.equal(await page.$eval('[data-space-id=b]', el => document.activeElement === el), true);
    assert.equal(await page.$eval('.desktop[aria-current=page] .desktop-name', el => el.textContent), 'Backend');
    // Commit only on drop; drag cancellation must not persist an order.
    await page.evaluate(() => {
        const a=document.querySelector('[data-space-id=a]'), b=document.querySelector('[data-space-id=b]');
        const dataTransfer=new DataTransfer();
        a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));
        b.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer,clientY:b.getBoundingClientRect().bottom-1}));
        b.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer}));
        a.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));
    });
    assert.deepEqual(await page.evaluate(()=>window.chromeTestCalls.find(c=>c.name==='reorder').data), ['b','a']);
    await page.setViewport({ width:250,height:188,deviceScaleFactor:1 });
    await page.goto(pathToFileURL(resolve(root,'fabi-spaces/resources/rail/rail.html')).href);
    await page.evaluate(()=>window.emitEdit({id:'a',name:'Interface'}));
    assert.equal(await page.$eval('#space-name',el=>document.activeElement===el),true);
    await page.$eval('#space-name',el=>{el.value='   ';});
    await page.$eval('form',el=>el.requestSubmit());
    assert.equal(await page.evaluate(()=>window.chromeTestCalls.filter(c=>c.name==='rename').length),0);
    await page.$eval('#space-name',el=>{el.value='Nouveau nom';});
    await page.$eval('form',el=>el.requestSubmit());
    assert.deepEqual(await page.evaluate(()=>window.chromeTestCalls.find(c=>c.name==='rename').data),{id:'a',name:'Nouveau nom'});
    await page.setViewport({width:900,height:700,deviceScaleFactor:1});
    await page.evaluate(()=>window.emitEdit({id:'a',name:'Interface',menu:true,y:690}));
    assert.equal(await page.$eval('#rename-action',el=>document.activeElement===el),true);
    assert.equal(await page.$$eval('[role=menuitem]',els=>els.length),2);
    assert.equal(await page.$eval('#space-popover',el=>el.getBoundingClientRect().bottom<=innerHeight-8),true);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.$eval('#remove-action',el=>document.activeElement===el),true);
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('#keep-space',el=>document.activeElement===el),true);
    assert.equal(await page.evaluate(()=>window.chromeTestCalls.filter(c=>c.name==='close').length),0);
    await page.click('#keep-space');
    await page.keyboard.press('Escape');
    const dismissed=await page.evaluate(()=>window.chromeTestCalls.filter(c=>c.name==='dismiss').length);
    await page.evaluate(()=>window.emitEdit({id:'a',name:'Interface',menu:true,y:20}));
    await page.mouse.click(700,500);
    assert.equal(await page.evaluate(()=>window.chromeTestCalls.filter(c=>c.name==='dismiss').length),dismissed+1);
    await page.evaluate(()=>window.emitEdit({id:'a',name:'Interface',menu:true,y:20}));
    await page.click('#remove-action');
    await page.click('#confirm-remove');
    assert.equal(await page.evaluate(()=>window.chromeTestCalls.find(c=>c.name==='close').data),'a');
    // Minimal native markup to test the actual stylesheet cascade, not shell behavior.
    await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
    const styles = ['fabi-type.css', 'index.css', 'fabi-ui-polish.css', 'fabi-explorer-type.css',
        'fabi-islands.css', 'fabi-activity-bar.css', 'fabi-space-accent.css', 'fabi-ui-icons.css', 'fabi-midnight.css', 'fabi-native-midnight.css', 'fabi-studio.css', 'fabi-navigation.css'];
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
    await page.waitForFunction(() => getComputedStyle(document.getElementById('test-tab')).backgroundColor === 'rgb(40, 41, 46)');
    const actualStyles = await page.evaluate(() => {
        const tab = getComputedStyle(document.getElementById('test-tab'));
        const dialog = getComputedStyle(document.getElementById('test-dialog'));
        document.getElementById('test-row').focus();
        const row = getComputedStyle(document.getElementById('test-row'));
        return { tabMargin: tab.marginTop, tabRadius: tab.borderTopLeftRadius,
            tabBackground: tab.backgroundColor, dialogBackground: dialog.backgroundColor,
            rowOutline: row.outlineStyle, rowOutlineWidth: row.outlineWidth };
    });
    assert.deepEqual(actualStyles, { tabMargin: '0px', tabRadius: '7px', tabBackground: 'rgb(40, 41, 46)',
        dialogBackground: 'rgb(37, 38, 44)', rowOutline: 'solid', rowOutlineWidth: '1px' });
    await page.evaluate(() => document.body.classList.add('fabi-dock-enabled'));
    assert.equal(await page.$eval('#test-toast', el => getComputedStyle(el).bottom), '88px');
    assert.equal(await page.$eval('#test-closed-toast', el => getComputedStyle(el).display), 'none');
    assert.equal(await page.$eval('#test-description', el => getComputedStyle(el).color), 'rgb(153, 153, 167)');
    await page.setViewport({ width: 360, height: 500, deviceScaleFactor: 1 });
    assert.equal(await page.$eval('#test-toast', el => getComputedStyle(el).width), '328px');
    await page.evaluate(() => {
        const dock = document.createElement('div');
        dock.id = 'fabi-workbench-dock';
        dock.innerHTML = '<nav class="fabi-dock-tools"><button class="fabi-dock-tool"><span class="fabi-dock-tile">T</span><span class="fabi-dock-label">Terminal</span></button><button class="fabi-dock-tool"><span class="fabi-dock-tile">A</span><span class="fabi-dock-label">Agents</span></button></nav>';
        document.body.append(dock);
    });
    const dockWidth = () => page.$eval('.fabi-dock-tools', el => el.getBoundingClientRect().width);
    await page.waitForFunction(() => document.querySelector('.fabi-dock-tools').getBoundingClientRect().width === 206);
    await page.$eval('#fabi-workbench-dock', el => el.classList.add('fabi-dock-resting'));
    assert.ok(await page.$eval('.fabi-dock-tools', el => getComputedStyle(el).transitionDuration.includes('0.46s')));
    await page.$eval('#fabi-workbench-dock', el => {
        void el.offsetWidth;
        el.getAnimations({ subtree: true }).forEach(animation => animation.finish());
    });
    assert.equal(await dockWidth(), 94);
    assert.equal(await page.$eval('.fabi-dock-label', el => getComputedStyle(el).opacity), '0');
    assert.equal(await page.$$eval('.fabi-dock-tile', nodes => nodes.every(el => el.getBoundingClientRect().width > 18)), true);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.equal(await page.$eval('.fabi-dock-tools', el => getComputedStyle(el).transitionDuration), '0s');
    await page.$eval('#fabi-workbench-dock', el => el.classList.remove('fabi-dock-resting'));
    assert.equal(await dockWidth(), 206);
    assert.deepEqual(errors, []);
    console.log('Static chrome and CSS cascade: validation, focus, compact layout, single submit, Space navigation, tabs, dialogs, settings and notifications passed. Native IPC and full shell not tested.');
} finally { await browser.close(); }
