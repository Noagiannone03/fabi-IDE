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
    const client = await page.createCDPSession();
    await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setViewport({ width: 1440, height: 900 });
    await page.setContent('<html><head></head><body></body></html>');
    for (const file of scripts) { await page.addScriptTag({ path: file }); }
    await page.addStyleTag({ path: require.resolve('@lumino/widgets/style/widget.css') });
    for (const file of ['fabi-activity-bar.css', 'fabi-midnight.css', 'fabi-studio.css', 'fabi-navigation.css']) {
        await page.addStyleTag({ path: resolve(root, 'fabi-branding/src/browser/style', file) });
    }
    await page.addStyleTag({ content: 'html,body{margin:0;width:100%;height:100%}#layout-test{position:absolute;inset:0}.test-status{min-height:24px;max-height:24px}' });
    const executable = ts.transpileModule('function mount() ' + mount, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    await page.evaluate(executable => {
        const { Widget, BoxPanel } = window.lumino_widgets;
        const shell = new BoxPanel({ direction: 'top-to-bottom', spacing: 0 });
        shell.id = 'layout-test';
        const content = new BoxPanel({ direction: 'left-to-right', spacing: 0 });
        const sidebar = new BoxPanel({ direction: 'top-to-bottom', spacing: 0 });
        const tree = new Widget();
        tree.node.style.minWidth = '224px';
        const activity = new Widget();
        activity.id = 'fabi-activity-bar';
        sidebar.addWidget(activity);
        BoxPanel.setStretch(tree, 1);
        sidebar.addWidget(tree);
        const editor = new Widget();
        BoxPanel.setStretch(editor, 1);
        content.addWidget(sidebar);
        content.addWidget(editor);
        const status = new Widget();
        status.addClass('test-status');
        BoxPanel.setStretch(content, 1);
        shell.addWidget(content);
        shell.addWidget(status);
        class Handler { enableDockNavigation() {} }
        class Tools extends Widget {
            constructor() {
                super();
                this.node.innerHTML = '<nav class="fabi-dock-tools">' + ['Terminal', 'Agents'].map(label => '<button class="fabi-dock-tool">' + label + '</button>').join('') + '</nav>';
            }
        }
        shell.mainPanel = editor;
        shell.leftPanelHandler = new Handler();
        shell.getWidgets = () => [];
        Widget.attach(shell, document.body);
        const mountDock = new Function('Widget', 'FabiSidePanelHandler', 'DockTools', executable + '; return mount;')(Widget, Handler, Tools);
        mountDock.call({ shell });
        window.layoutTest = { shell, sidebar, editor, status, activity };
    }, executable);
    for (const [width, height] of [[1440, 900], [900, 600], [640, 400]]) {
        await page.setViewport({ width, height });
        for (const hidden of [false, true]) {
            await page.evaluate(hidden => {
                const { shell, sidebar } = window.layoutTest;
                sidebar.setHidden(hidden);
                shell.fit();
                window.lumino_messaging.MessageLoop.flush();
                window.dispatchEvent(new Event('resize'));
            }, hidden);
            const bounds = await page.evaluate(() => {
                const { editor, status, activity } = window.layoutTest;
                const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width }; };
                return { dock:rect(document.getElementById('fabi-workbench-dock')),editor:rect(editor.node),status:rect(status.node),activityInSidebar:activity.parent===window.layoutTest.sidebar };
            });
            assert.equal(bounds.activityInSidebar, true);
            assert.equal(bounds.editor.bottom, bounds.status.y, 'No empty dock row');
            assert.ok(bounds.dock.y > bounds.editor.y && bounds.dock.bottom < bounds.editor.bottom);
            assert.ok(bounds.dock.x >= bounds.editor.x && bounds.dock.right <= bounds.editor.right);
            assert.ok(Math.abs((bounds.dock.x + bounds.dock.right) / 2 - (bounds.editor.x + bounds.editor.right) / 2) <= 1);
        }
    }
    await page.evaluate(() => window.layoutTest.shell.dispose());
    assert.deepEqual(errors, []);
    console.log('Floating dock: 3 viewports, sidebar open/closed, editor-relative centering, no reserved row, disposal passed.');
} finally { await browser.close(); }
