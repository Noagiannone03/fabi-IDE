// Isolated Lumino layout with installed UMD distributions. No IDE/backend/build.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const source = ts.createSourceFile('dock.tsx', readFileSync(resolve(root,
    'fabi-branding/src/browser/shell/fabi-workbench-dock.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(source.parseDiagnostics.length, 0);
const contribution = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'FabiWorkbenchDockContribution');
const mount = contribution.members.find(node => node.name?.getText(source) === 'onDidInitializeLayout').body.getText(source);
const scripts = [];
const visited = new Set();
function visit(name) {
    if (visited.has(name)) { return; }
    visited.add(name);
    // Some packages point Node at index.node.js; use their distributed browser UMD.
    const file = resolve(dirname(require.resolve(name)), 'index.js');
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(/require\('(@lumino\/[^']+)'\)/g)) { visit(match[1]); }
    scripts.push(file);
}
visit('@lumino/widgets');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || await puppeteer.executablePath(),
    headless: true, protocolTimeout: 10000, args: ['--disable-gpu'] });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.setContent('<!doctype html><html><head></head><body></body></html>');
    for (const file of scripts) { await page.addScriptTag({ path: file }); }
    await page.addStyleTag({ path: require.resolve('@lumino/widgets/style/widget.css') });
    for (const file of ['fabi-activity-bar.css', 'fabi-midnight.css', 'fabi-studio.css']) {
        await page.addStyleTag({ path: resolve(root, 'fabi-branding/src/browser/style', file) });
    }
    await page.addStyleTag({ content: 'html,body{margin:0;width:100%;height:100%}#layout-test{position:absolute;inset:0}.test-status{min-height:24px;max-height:24px}.test-sidebar{min-width:224px;max-width:224px}' });
    await page.evaluate(mountBody => {
        const { Widget, BoxPanel, BoxLayout } = window.lumino_widgets;
        const shell = new BoxPanel({ direction: 'top-to-bottom', spacing: 0 });
        shell.id = 'layout-test';
        const content = new BoxPanel({ direction: 'left-to-right', spacing: 0 });
        const sidebar = new BoxPanel({ direction: 'top-to-bottom', spacing: 0 });
        sidebar.addClass('test-sidebar');
        const tree = new Widget();
        // Put the minimum on the leaf: BoxLayout derives its own inline limits.
        tree.node.style.minWidth = '224px';
        const activity = new Widget();
        activity.id = 'fabi-activity-bar';
        activity.node.innerHTML = '<nav class="fabi-activity-inner"><button class="fabi-activity-item">F</button></nav>';
        BoxPanel.setStretch(tree, 1); sidebar.addWidget(tree); sidebar.addWidget(activity);
        const editor = new Widget();
        BoxPanel.setStretch(editor, 1); content.addWidget(sidebar); content.addWidget(editor);
        const status = new Widget(); status.addClass('test-status');
        BoxPanel.setStretch(content, 1); shell.addWidget(content); shell.addWidget(status);
        class TestHandler { activityBar = activity; enableDockNavigation() { this.enabled = true; } }
        class TestTools extends Widget {
            constructor() {
                super(); this.id = 'fabi-dock-tools';
                this.node.innerHTML = '<nav class="fabi-dock-tools">' + ['Terminal', 'Agents', 'Commandes', 'Réglages'].map(label =>
                    '<button class="fabi-dock-tool"><span class="codicon">·</span><span class="fabi-dock-label">' + label + '</span></button>').join('') + '</nav>';
            }
        }
        const handler = new TestHandler();
        shell.leftPanelHandler = handler;
        shell.getWidgets = () => [];
        // This body is JavaScript already; its TS signature/decorators are not executed.
        const mountDock = new Function('BoxPanel', 'BoxLayout', 'FabiSidePanelHandler', 'DockTools', mountBody.slice(1, -1));
        document.body.classList.add('fabi-maestro-mode');
        mountDock.call({ get shell() { throw new Error('Dock must not access the Maestro shell'); } }, BoxPanel, BoxLayout, TestHandler, TestTools);
        document.body.classList.remove('fabi-maestro-mode');
        document.body.classList.add('fabi-native-spaces');
        mountDock.call({ shell }, BoxPanel, BoxLayout, TestHandler, TestTools);
        Widget.attach(shell, document.body);
        window.layoutTest = { shell, content, sidebar, editor, status, activity, handler };
    }, mount);
    for (const [width, height] of [[1440, 900], [900, 600], [640, 400]]) {
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        for (const hideSidebar of [false, true]) {
            const bounds = await page.evaluate(hidden => {
                const { shell, sidebar, editor, status, activity, handler } = window.layoutTest;
                window.dispatchEvent(new Event('resize'));
                sidebar.setHidden(hidden); shell.fit(); shell.update();
                for (let pass = 0; pass < 4; pass++) { window.lumino_messaging.MessageLoop.flush(); }
                const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height }; };
                return { dock: rect(document.getElementById('fabi-workbench-dock')), editor: rect(editor.node),
                    status: rect(status.node), sidebar: rect(sidebar.node), tools: rect(document.getElementById('fabi-dock-tools')),
                    parent: activity.parent.id, navigationEnabled: handler.enabled };
            }, hideSidebar);
            assert.equal(bounds.parent, 'fabi-workbench-dock');
            assert.equal(bounds.navigationEnabled, true);
            assert.equal(bounds.dock.height, 64);
            assert.ok(bounds.editor.bottom <= bounds.dock.y + 1);
            assert.ok(bounds.dock.bottom <= bounds.status.y + 1);
            assert.ok(bounds.status.bottom <= height + 1);
            assert.ok(bounds.dock.right <= width + 1, JSON.stringify({ width, bounds }));
            if (!hideSidebar) {
                assert.ok(bounds.sidebar.right - bounds.sidebar.x >= 224, JSON.stringify({ width, bounds }));
                assert.ok(bounds.editor.x >= bounds.sidebar.right - 1, JSON.stringify({ width, bounds }));
            }
            assert.ok(bounds.tools.right <= width + 1, JSON.stringify({ width, height, hideSidebar, bounds }));
        }
    }
    assert.deepEqual(errors, []);
    console.log('Real Lumino: dock mount/reparent, 3 viewports, sidebar open/closed and non-overlap passed. React/IDE services not tested.');
} finally { await browser.close(); }
