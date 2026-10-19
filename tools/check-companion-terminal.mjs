import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: process.env.FABI_DEBUG_URL || 'http://127.0.0.1:9226', defaultViewport: null });
const page = (await browser.pages()).find(p => p.url().includes('/frontend/index.html'));
const client = await page.createCDPSession();
try {
    await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.waitForFunction(() => {
        const c = window.theia?.container, k = c && [...c._bindingDictionary._map.keys()].find(k => k?.name === 'FrontendApplicationStateService');
        return k && c.get(k).state === 'ready';
    });
    const results = await page.evaluate(async () => {
        const c = window.theia.container, contribution = c.get([...c._bindingDictionary._map.keys()].find(k => k?.name === 'AssistContribution'));
        const model = contribution.model, previous = model.shell.currentWidget?.id;
        const terminal = await model.terminals.newTerminal({ title: 'Companion geometry check' });
        const wait = () => new Promise(resolve => setTimeout(resolve, 500));
        const measure = label => ({ label, cols: terminal.term.cols, rows: terminal.term.rows, proposed: terminal.fitAddon.proposeDimensions(),
            viewport: terminal.term.element.parentElement.getBoundingClientRect().toJSON(), screen: terminal.term.element.querySelector('.xterm-screen').getBoundingClientRect().toJSON(),
            inert: terminal.term.element.inert, visibility: getComputedStyle(terminal.term.element).visibility, id: terminal.terminalId });
        const results = [];
        try {
            await terminal.start(); await model.terminals.open(terminal, { widgetOptions: { area: 'main' }, mode: 'activate' }); await wait();
            results.push(measure('full'));
            await contribution.open(false, terminal); await wait(); results.push(measure('learning'));
            await terminal.sendText("printf '\\nPTY_SIZE '; stty size\n"); await wait();
            results.push({ label: 'pty', text: terminal.buffer.getLines(0, terminal.buffer.length, true).join('\n') });
            terminal.node.style.width = '640px'; terminal.node.style.height = '440px'; await wait(); results.push(measure('narrow'));
            terminal.node.style.removeProperty('width'); terminal.node.style.removeProperty('height'); terminal.fit(); await wait();
            contribution.closeSurface(); await wait(); results.push(measure('restored'));
            await terminal.sendText("printf '\\033[?1049h\\033[2J\\033[H\\033[32mFABI_ALT café 漢字\\033[0m'\n"); await wait();
            results.push({ label: 'alternate', type: terminal.term.buffer.active.type, text: terminal.term.buffer.active.getLine(0)?.translateToString(true) });
            const other = await model.terminals.newTerminal({ title: 'Visibility validation' });
            try {
                await other.start(); await model.terminals.open(other, { widgetOptions: { area: 'main' }, mode: 'activate' }); await wait();
                await model.terminals.open(terminal, { widgetOptions: { area: 'main' }, mode: 'activate' }); await wait();
                results.push(measure('reshown'));
                results.push({ label: 'alternate-after-tab', type: terminal.term.buffer.active.type, text: terminal.term.buffer.active.getLine(0)?.translateToString(true) });
            } finally { other.dispose(); }
            await terminal.sendText("printf '\\033[?1049l'\n"); await wait();
            results.push({ label: 'normal-buffer', type: terminal.term.buffer.active.type });

        } finally { contribution.closeSurface(); terminal.dispose(); if (previous) await model.shell.activateWidget(previous); }
        return results;
    });
    for (const item of results.filter(item => item.proposed)) {
        assert.equal(item.cols, item.proposed.cols, item.label + ' columns');
        assert.equal(item.rows, item.proposed.rows, item.label + ' rows');
        assert.equal(item.inert, ['learning', 'narrow'].includes(item.label)); assert.equal(item.visibility, 'visible');
        assert.ok(item.screen.height <= item.viewport.height + 1, item.label + ' screen fits');
    }
    assert.equal(new Set(results.filter(r => r.id).map(r => r.id)).size, 1, 'same PTY');
    const learning = results.find(r => r.label === 'learning');
    assert.equal(learning.rows, results[0].rows, 'Assist must not shrink the terminal');
    assert.equal(learning.cols, results[0].cols, 'Assist must not shrink the terminal');
    assert.ok(results.find(r => r.label === 'pty').text.includes(`${learning.rows} ${learning.cols}`) || new RegExp(`PTY_SIZE\\s+${learning.rows}\\s+${learning.cols}`).test(results.find(r => r.label === 'pty').text), 'native PTY matches xterm');
    for (const label of ['alternate', 'alternate-after-tab']) {
        const buffer = results.find(item => item.label === label);
        assert.equal(buffer.type, 'alternate'); assert.ok(buffer.text.includes('FABI_ALT café 漢字'));
    }
    assert.equal(results.find(item => item.label === 'normal-buffer').type, 'normal');
    const clis = await page.evaluate(async () => {
        const c = window.theia.container, contribution = c.get([...c._bindingDictionary._map.keys()].find(k => k?.name === 'AssistContribution'));
        const output = [];
        for (const command of ['/opt/homebrew/bin/codex', '/Users/noagiannone/.local/bin/claude']) {
            const t = await contribution.model.terminals.newTerminal({ title: 'TUI validation', shellPath: command, shellArgs: [] });
            try {
                await t.start(); await contribution.model.terminals.open(t, { widgetOptions: { area: 'main' }, mode: 'activate' });
                await new Promise(resolve => setTimeout(resolve, 3000));
                output.push({ command, cols: t.term.cols, rows: t.term.rows, proposed: t.fitAddon.proposeDimensions(),
                    text: t.buffer.getLines(0, t.buffer.length, true).join('\n').slice(-2000), exit: t.exitStatus });
            } finally { t.dispose(); }
        }
        return output;
    });
    console.log(JSON.stringify(clis, null, 2));
    for (const cli of clis) { assert.equal(cli.cols, cli.proposed.cols); assert.equal(cli.rows, cli.proposed.rows); assert.ok(!cli.exit); }
    console.log(JSON.stringify(results, null, 2));
    console.log('PASS: measured grid, PTY synchronization, full-space learning, resizing, tab visibility, ANSI/Unicode alternate buffer and restored terminal. CLI text above indicates the actual startup state reached.');
} finally { await client.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await client.detach(); await browser.disconnect(); }
