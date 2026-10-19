import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
const rgba = value => {
    if (value.startsWith('#')) {
        const hex = value.slice(1);
        return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(Math.round((hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1) * 100) / 100);
    }
    const parts = value.match(/[\d.]+/g).map(Number); if (parts.length === 3) parts.push(1); return parts;
};
const vendor = JSON.parse(await fs.readFile(new URL('../fabi-branding/src/browser/theme/vendor/cursor-dark/theme.json', import.meta.url), 'utf8'));
const fixture = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-colors-')), 'syntax.ts');
await fs.writeFile(fixture, '// Cursor Dark\ninterface User { name: string; active: boolean; }\nexport function greet(user: User): string {\n    const prefix = "Bonjour";\n    return user.active ? `${prefix} ${user.name}` : "";\n}\nconsole.log(greet({ name: "Ada", active: true }));\n');
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9224', defaultViewport: null });
let page;
try {
    page = (await browser.pages()).find(p => p.url().includes('/frontend/') && !p.url().includes('localPort=') && p.url().split('#')[1]?.startsWith('/'));
    assert.ok(page, 'Open a local workspace before running the check');
    const result = await page.evaluate(async fixture => {
        const c = window.theia.container;
        const key = [...c._bindingDictionary._map.keys()].find(k => k?.name === 'AssistContribution');
        const model = c.get(key).model;
        const URI = model.workspace.tryGetRoots()[0].resource.constructor;
        const editor = await model.editors.open(new URI(`file://${fixture}`));
        const terminal = await model.terminals.newTerminal({ title: 'Color verification', location: 'editor' });
        window.fabiColors = { editor, terminal, shell: model.shell };
        await new Promise(resolve => setTimeout(resolve, 1500));
        const syntax = [...editor.node.querySelectorAll('.view-line span[class*="mtk"]')].map(e => ({ text: e.textContent, color: getComputedStyle(e).color }));
        const background = getComputedStyle(editor.node.querySelector('.monaco-editor-background')).backgroundColor;
        await terminal.start();
        await model.terminals.open(terminal, { widgetOptions: { area: 'main' }, mode: 'activate' });
        const theme = terminal.term.options.theme;
        terminal.write('\r\n\x1b[31mANSI_RED\x1b[0m \x1b[91mBRIGHT_RED\x1b[0m \x1b[38;2;255;0;127mTRUECOLOR\x1b[0m\r\n');
        await new Promise(resolve => setTimeout(resolve, 250));
        const buffer = terminal.term.buffer.active;
        const cells = [];
        for (let i = 0; i < buffer.length; i++) {
            const line = buffer.getLine(i), text = line.translateToString(true);
            for (const label of ['ANSI_RED', 'BRIGHT_RED', 'TRUECOLOR']) {
                const offset = text.indexOf(label);
                if (offset >= 0) { const cell = line.getCell(offset); cells.push({ label, value: cell.getFgColor(), rgb: cell.isFgRGB(), palette: cell.isFgPalette() }); }
            }
        }
        return { syntax, background, theme, cells };
    }, fixture);
    for (const [key, value] of Object.entries(vendor.colors)) {
        if (!key.startsWith('terminal.ansi')) continue;
        const name = key.slice('terminal.ansi'.length); const xtermName = name[0].toLowerCase() + name.slice(1);
        assert.deepEqual(rgba(result.theme[xtermName]), rgba(value), key);
    }
    assert.equal(result.background, 'rgb(24, 24, 24)', 'Monaco background must honor the imported theme');
    assert.ok(new Set(result.syntax.map(t => t.color)).size >= 5, 'Syntax should have distinct semantic/token colors');
    assert.equal(result.cells.find(c => c.label === 'ANSI_RED')?.value, 1);
    assert.equal(result.cells.find(c => c.label === 'BRIGHT_RED')?.value, 9);
    assert.equal(result.cells.find(c => c.label === 'TRUECOLOR')?.value, 0xff007f);
    assert.ok(result.cells.find(c => c.label === 'TRUECOLOR')?.rgb);
    console.log('PASS: live Monaco syntax, theme background, 16 upstream ANSI colors, normal/bright ANSI and unmodified RGB output.');
} finally {
    await page?.evaluate(async () => { const check = window.fabiColors; if (check) { await check.shell.closeWidget(check.terminal.id); await check.shell.closeWidget(check.editor.id); } delete window.fabiColors; }).catch(() => {});
    await browser.disconnect(); await fs.rm(path.dirname(fixture), { recursive: true, force: true });
}
