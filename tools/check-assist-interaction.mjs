import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: process.env.FABI_DEBUG_URL || 'http://127.0.0.1:9224', defaultViewport: null });
try {
    const pages = await browser.pages();
    const page = pages.find(p => p.url().includes('/frontend/index.html') && !p.url().includes('remote='));
    assert.ok(page);
    const result = await page.evaluate(async () => {
        const container = window.theia.container;
        const key = [...container._bindingDictionary._map.keys()].find(k => k?.name === 'AssistContribution');
        const contribution = container.get(key), model = contribution.model;
        if (model.busy || contribution.contextModel.busy || contribution.bubble || contribution.surface) throw new Error('Close Assist before testing');
        const terminal = await model.terminals.newTerminal({ title: 'Interaction check', location: 'editor' });
        const prepare = model.prepare;
        let release;
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        try {
            await terminal.start(); await model.terminals.open(terminal, { widgetOptions: { area: 'main' }, mode: 'activate' });
            model.prepare = () => new Promise(resolve => { release = resolve; });
            terminal.node.querySelector('[aria-label="Ouvrir Fabi Assist"]').click();
            const immediate = !!contribution.surface;
            await wait(50);
            terminal.node.querySelector('.fabi-terminal-return').click();
            release(); await wait(50);
            const closed = !contribution.surface && !terminal.node.querySelector('.xterm').inert;
            const target = terminal.node.querySelector('.xterm');
            target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 400, clientY: 250 }));
            await wait(80);
            const noFlash = !document.querySelector('.fabi-assist-hold');
            target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
            await wait(150);
            const noLateFlash = !document.querySelector('.fabi-assist-hold');
            target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 400, clientY: 250 }));
            await wait(230);
            const holdVisible = !!document.querySelector('.fabi-assist-hold');
            target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
            return { immediate, closed, noFlash, noLateFlash, holdVisible };
        } finally { model.prepare = prepare; release?.(); contribution.cancelHold(); contribution.closeSurface(); terminal.dispose(); }
    });
    assert.deepEqual(result, { immediate: true, closed: true, noFlash: true, noLateFlash: true, holdVisible: true });
    console.log('Passed: instant toggle with stalled provider, return to terminal, no click flash or delayed flash, intentional hold feedback.');
} finally { await browser.disconnect(); }
