// Run with Electron, after building fabi-spaces. Uses an isolated user profile
// and a minimal frontend, but the production SpaceManager, chrome and IPC.
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app, ipcMain, webContents } = require('electron');

const directory = mkdtempSync(join(tmpdir(), 'fabi-electron-lifecycle-'));
app.setPath('userData', directory);
app.on('window-all-closed', () => {});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async predicate => {
    const deadline = Date.now() + 10_000;
    while (!await predicate()) {
        assert.ok(Date.now() < deadline, 'Timed out waiting for Electron');
        await delay(30);
    }
};
let manager;
const timeout = setTimeout(() => { console.error('Electron lifecycle timeout'); app.exit(1); }, 60_000);

app.whenReady().then(async () => {
    const { SpaceManager } = require('../lib/electron-main/space-manager');
    const { SpacesIpc } = require('../lib/common/space-types');
    const chrome = resolve(__dirname, '../resources/rail');
    const frontend = join(directory, 'frontend.html');
    writeFileSync(frontend, '<!doctype html><body><button>Editor control</button></body>');
    writeFileSync(join(directory, 'preload.js'), `
        const { contextBridge, ipcRenderer } = require('electron');
        contextBridge.exposeInMainWorld('remoteCheck', {
            invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
            reload: url => ipcRenderer.send(${JSON.stringify(require('@theia/core/lib/electron-common/electron-api').CHANNEL_REQUEST_RELOAD)}, url)
        });
    `);
    const spaces = ['one', 'two'].map(id => ({
        id, name: id, color: '#0A84FF', emoji: '', workspacePath: '', lastActive: 0
    }));
    writeFileSync(join(directory, 'spaces.json'), JSON.stringify({ version: 1, spaces, activeId: 'one' }));
    const options = {
        appName: 'Fabi lifecycle test', backendPort: 1234,
        frontendHtmlPath: frontend, preloadPath: join(directory, 'preload.js'),
        railHtmlPath: join(chrome, 'rail.html'), tabStripHtmlPath: join(chrome, 'tab-strip.html'),
        modalHtmlPath: join(chrome, 'modal.html'), railPreloadPath: join(chrome, 'preload.js')
    };
    const listeners = ipcMain.listenerCount(SpacesIpc.OPEN);
    manager = new SpaceManager(options);
    await manager.boot();
    manager.host.setBounds({ x: 150, y: 150, width: 900, height: 620 });
    manager.host.focus();
    app.focus({ steal: true });
    await delay(300);

    if (process.platform === 'darwin') {
        const title = manager.titlebarView;
        assert.deepEqual(title.getBounds(), { x: 0, y: 0, width: 900, height: 32 });
        assert.equal(await title.webContents.executeJavaScript('getComputedStyle(document.body).webkitAppRegion'), 'drag');
        assert.equal(manager.host.isMovable(), true);
        const drag = async () => {
            manager.host.setPosition(150, 100);
            await delay(150);
            const before = manager.host.getBounds();
            await promisify(execFile)(process.env.FABI_NATIVE_DRAG_HELPER,
                [String(before.x + 400), String(before.y + 16), '80', '50']);
            await wait(() => manager.host.getBounds().x !== before.x);
            const after = manager.host.getBounds();
            // AppKit can consume the first events while crossing its drag
            // threshold. Verify native movement, not an exact pixel delta.
            assert.ok(after.x - before.x >= 40 && after.x - before.x <= 82, JSON.stringify({ before, after }));
            assert.ok(after.y - before.y >= 20 && after.y - before.y <= 52, JSON.stringify({ before, after }));
        };
        if (process.env.FABI_NATIVE_DRAG_HELPER) {
            await drag();
            console.log('PASS native macOS title-bar drag');
            manager.setExpanded(true);
            await drag();
            manager.setExpanded(false);
            console.log('PASS native drag with Spaces overlay open');
            const modal = manager.promptNewSpace(directory);
            await wait(() => !manager.modalView.webContents.isLoading());
            await drag();
            manager.cancelModal();
            assert.equal(await modal, undefined);
            console.log('PASS native drag with creation modal open');
        } else {
            console.log('SKIP native pointer drag: FABI_NATIVE_DRAG_HELPER not provided');
        }
        manager.host.setSize(1000, 680);
        await wait(() => title.getBounds().width === 1000);
        assert.equal(manager.tabStripView.getBounds().y, 32);
    }

    // Exercise real renderer → preload → main → renderer navigation.
    await manager.tabStripView.webContents.executeJavaScript("window.fabiSpaces.open('two')");
    await wait(() => manager.activeId === 'two');
    assert.equal(manager.views.get('one').getVisible(), false);
    assert.equal(manager.views.get('two').getVisible(), true);
    // Real native views must switch even if renderer-side diagnostics never settle.
    const ensureViewport = manager.ensureViewport;
    manager.ensureViewport = () => new Promise(() => {});
    for (const id of ['one', 'two', 'one', 'two']) {
        await manager.open(id);
        assert.equal(manager.activeId, id);
        for (const [viewId, view] of manager.views) {
            assert.equal(view.getVisible(), viewId === id);
        }
        await wait(async () => await manager.tabStripView.webContents.executeJavaScript(
            `document.querySelector('.desktop[aria-current="page"]')?.dataset.spaceId`) === id);
    }
    manager.ensureViewport = ensureViewport;
    console.log('PASS repeated native Space switches with stalled renderer diagnostics');
    await manager.open('one');
    await manager.close('two');
    assert.equal(manager.activeId, 'one');

    manager.windowControl('minimize');
    await wait(() => manager.host.isMinimized());
    manager.host.restore();
    await wait(() => !manager.host.isMinimized());
    console.log('PASS minimize / restore');

    // First SSH folder choice must be acknowledged before the document reloads.
    await manager.views.get('one').webContents.executeJavaScript(
        "window.remoteCheck.invoke('fabi-spaces:remote-create', {host:'fixture.test',user:'fixture'}, 5678)");
    const remoteId = manager.activeId;
    const remoteView = manager.views.get(remoteId);
    await wait(() => !remoteView.webContents.isLoading());
    const folder = '/home/fixture/project #1';
    assert.equal(await remoteView.webContents.executeJavaScript(
        `window.remoteCheck.invoke('fabi-spaces:remote-workspace', ${JSON.stringify(folder)})`), true);
    assert.equal(manager.store.get(remoteId).workspacePath, folder);
    const oldPort = new URL(remoteView.webContents.getURL()).searchParams.get('port');
    const nextUrl = new URL(remoteView.webContents.getURL()); nextUrl.hash = encodeURI(folder);
    await remoteView.webContents.executeJavaScript(`window.remoteCheck.reload(${JSON.stringify(nextUrl.toString())})`);
    await wait(() => !remoteView.webContents.isLoading() && remoteView.webContents.getURL() === nextUrl.toString());
    const context = await remoteView.webContents.executeJavaScript("window.remoteCheck.invoke('fabi-spaces:remote-context')");
    assert.equal(context.workspacePath, folder, 'Reload must not present an empty Space and prompt again');
    assert.equal(new URL(remoteView.webContents.getURL()).searchParams.get('port'), oldPort);
    assert.equal(new URL(remoteView.webContents.getURL()).searchParams.get('localPort'), '1234');
    assert.equal(manager.remotePorts.get(remoteId), 5678, 'Folder opening keeps the established SSH tunnel');
    assert.equal(await remoteView.webContents.executeJavaScript(
        "window.remoteCheck.invoke('fabi-spaces:remote-workspace', 'relative/path')"), false);
    await manager.close(remoteId);
    console.log('PASS acknowledged remote folder choice, reload without reconnect, persisted selection');


    const modal = manager.promptNewSpace(directory);
    await wait(() => !manager.modalView.webContents.isLoading());
    manager.dispose();
    assert.equal(await modal, undefined, 'Disposal must settle the modal promise');
    await wait(() => webContents.getAllWebContents().length === 0);
    assert.equal(ipcMain.listenerCount(SpacesIpc.OPEN), listeners);
    assert.equal(manager.store.saveTimer, undefined);
    console.log('PASS all views, modal promises, IPC listeners and save timers released');

    manager = new SpaceManager({ ...options, frontendHtmlPath: join(directory, 'missing.html') });
    await assert.rejects(manager.boot());
    manager.dispose();
    await wait(() => webContents.getAllWebContents().length === 0);
    // A failed boot must not leave ipcMain.handle registrations behind.
    manager = new SpaceManager(options);
    await manager.boot();
    manager.dispose();
    await wait(() => webContents.getAllWebContents().length === 0);
    console.log('PASS failed boot cleanup and subsequent restart');
}).then(() => {
    clearTimeout(timeout);
    rmSync(directory, { recursive: true, force: true });
    app.exit(0);
}, error => {
    console.error(error);
    manager?.dispose();
    clearTimeout(timeout);
    rmSync(directory, { recursive: true, force: true });
    app.exit(1);
});
