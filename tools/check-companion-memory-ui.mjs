import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer';
const project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-memory-ui-')));
const memory = path.join(os.homedir(), '.config/fabi/assist/projects', createHash('sha256').update(project).digest('hex'));
const book = { version: 1, project, turns: [], concepts: [{ id: 'values', title: 'Les valeurs', objective: 'Suivre une valeur', prerequisites: [], stage: 'explained', status: 'new' }],
    journeys: [{ id: 'journey-fixture', title: 'Suivre une valeur', scope: 'project', cursor: 0, paused: false, updatedAt: Date.now(), steps: [{ title: 'Créer la valeur', conceptId: 'values' }, { title: 'La retrouver', conceptId: 'values' }] }] };
await fs.mkdir(memory, { recursive: true, mode: 0o700 });
await fs.writeFile(path.join(memory, 'notebook.json'), JSON.stringify(book), { mode: 0o600 });
const browser = await puppeteer.connect({ browserURL: process.env.FABI_DEBUG_URL || 'http://127.0.0.1:9226', defaultViewport: null });
let page; const clients = [];
try {
    for (const p of await browser.pages()) { const c = await p.createCDPSession(); clients.push(c); await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }); }
    page = (await browser.pages()).find(p => p.url().includes('/frontend/index.html'));
    await page.waitForFunction(() => {
        const c = window.theia?.container, key = c && [...c._bindingDictionary._map.keys()].find(k => k?.name === 'FrontendApplicationStateService');
        return key && c.get(key).state === 'ready' && !document.querySelector('.theia-preload');
    });
    await page.evaluate(async project => {
        const c = window.theia.container, a = c.get([...c._bindingDictionary._map.keys()].find(k => k?.name === 'AssistContribution'));
        a.closeSurface();
        const m = a.model, previous = { root: m.root, book: m.book, context: m.context, thread: m.thread, selectedAgent: m.selectedAgent };
        const t = await m.terminals.newTerminal({ title: 'Memory validation' }); await t.start(); await m.terminals.open(t, { widgetOptions: { area: 'main' }, mode: 'activate' });
        m.root = m.workspace.tryGetRoots()[0].resource.withPath(project); m.book = await m.service.notebook(project); m.context = {}; m.newThread('terminal');
        window.memoryCheck = { a, t, previous };
        await a.open(true, t);
    }, project);
    await page.waitForSelector('.fabi-assist-bottom');
    await page.$eval('.fabi-assist-bottom button', button => button.click());
    await page.waitForSelector('.fabi-assist-drawer select');
    await page.select('.fabi-assist-drawer select', 'concise');
    const read = async () => JSON.parse(await fs.readFile(path.join(memory, 'notebook.json'), 'utf8'));
    const wait = async check => { for (let n = 0; n < 50; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Memory change did not persist'); };
    await wait(async () => (await read()).preferences?.depth === 'concise');
    await page.evaluate(() => [...document.querySelectorAll('.fabi-assist-drawer button')].find(button => button.textContent === 'Mettre en pause').click());
    await wait(async () => (await read()).journeys[0].paused);
    await page.evaluate(() => [...document.querySelectorAll('.fabi-assist-drawer button')].find(button => button.textContent === 'Suivant').click());
    await wait(async () => (await read()).journeys[0].cursor === 1);
    assert.equal((await read()).concepts[0].stage, 'explained');
    await page.evaluate(() => [...document.querySelectorAll('.fabi-assist-drawer button')].find(button => button.textContent === 'À revoir').click());
    await wait(async () => (await read()).concepts[0].stage === 'reinforce');
    await page.evaluate(() => [...document.querySelectorAll('.fabi-assist-drawer button')].find(button => button.textContent === 'Réinitialiser le niveau').click());
    await wait(async () => (await read()).concepts[0].stage === 'discovered');
    if (process.env.FABI_CAPTURE) await page.screenshot({ path: '/tmp/fabi-memory-ui.png' });
    console.log('PASS: real RPC persistence from learning UI, depth preference, pause, navigation without mastery, review and reset.');
} finally {
    await page?.evaluate(() => { const state = window.memoryCheck; if (state) { state.a.closeSurface(); Object.assign(state.a.model, state.previous); state.t.dispose(); delete window.memoryCheck; } }).catch(() => {});
    for (const c of clients) { await c.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {}); await c.detach().catch(() => {}); }
    await browser.disconnect(); await fs.rm(memory, { recursive: true, force: true }); await fs.rm(project, { recursive: true, force: true });
}
