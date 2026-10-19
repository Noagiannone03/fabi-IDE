import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-pty-colors-'));
const probe = path.join(dir, 'probe.cjs');
await fs.writeFile(probe, `const util=require('node:util');console.log('CAPABILITIES '+JSON.stringify({term:process.env.TERM,colorterm:process.env.COLORTERM,noColor:process.env.NO_COLOR??null,tty:process.stdout.isTTY,depth:process.stdout.getColorDepth()}));console.log(util.inspect({verified:'COLOR_PROBE'}, {colors:process.stdout.hasColors()}));`);
const browser = await puppeteer.connect({ browserURL: process.env.FABI_DEBUG_URL || 'http://127.0.0.1:9226', defaultViewport: null });
let page; const clients = [];
try {
    for (const p of await browser.pages()) { const c = await p.createCDPSession(); clients.push(c); await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }); }
    page = (await browser.pages()).find(p => p.url().includes('/frontend/index.html'));
    await page.waitForFunction(() => { const c = window.theia?.container; const k = c && [...c._bindingDictionary._map.keys()].find(k => k?.name === 'FrontendApplicationStateService'); return k && c.get(k).state === 'ready'; }, { timeout: 45000 });
    const result = await page.evaluate(async probe => {
        const c = window.theia.container, m = c.get([...c._bindingDictionary._map.keys()].find(k => k?.name === 'AssistContribution')).model;
        const old = m.shell.currentWidget?.id;
        const results = [];
        for (const explicit of [false, true]) {
            const t = await m.terminals.newTerminal({ title: 'Terminal capability check', env: explicit ? { NO_COLOR: '1' } : undefined });
            try {
                await t.start(); await m.terminals.open(t, { widgetOptions: { area: 'main' }, mode: 'activate' });
                await t.sendText(`node '${probe}'\n`);
                const deadline = Date.now() + 12000;
                let caps, colors;
                while (Date.now() < deadline) {
                    const lines = [], buffer = t.term.buffer.active;
                    colors = [];
                    for (let i = 0; i < buffer.length; i++) {
                        const line = buffer.getLine(i), text = line.translateToString(true); lines.push(text);
                        const j = text.indexOf('COLOR_PROBE');
                        if (j >= 0) { const cell = line.getCell(j); colors.push(cell.isFgPalette() || cell.isFgRGB()); }
                    }
                    const match = lines.join('').match(/CAPABILITIES (\{[^}]+\})/);
                    if (match && colors.length) { caps = JSON.parse(match[1]); break; }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                results.push({ explicit, caps, colored: colors.some(Boolean) });
            } finally { t.dispose(); }
        }
        if (old) await m.shell.activateWidget(old);
        return results;
    }, probe);
    assert.equal(result[0].caps?.term, 'xterm-256color');
    assert.equal(result[0].caps?.colorterm, 'truecolor');
    assert.equal(result[0].caps?.noColor, null);
    assert.equal(result[0].caps?.tty, true);
    assert.equal(result[0].caps?.depth, 24);
    assert.equal(result[0].colored, true);
    assert.equal(result[1].caps?.noColor, '1');
    assert.equal(result[1].colored, false);
    console.log('PASS: real PTY detects 24-bit color and generates colored output; explicit NO_COLOR terminal option still honored.', JSON.stringify(result));
} finally {
    for (const c of clients) { await c.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {}); await c.detach().catch(() => {}); }
    await browser.disconnect(); await fs.rm(dir, { recursive: true, force: true });
}
