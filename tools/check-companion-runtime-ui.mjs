// Verify the actual Electron backend reaches the native harness, then cancel before inference.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer';
const project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-runtime-ui-')));
await fs.writeFile(path.join(project, 'counter.ts'), 'export const count = 42;\n');
const browser = await puppeteer.connect({ browserURL: process.env.FABI_DEBUG_URL || 'http://127.0.0.1:9226', defaultViewport: null });
try {
    const page = (await browser.pages()).find(page => page.url().includes('/frontend/index.html'));
    await page.waitForFunction(() => !!window.theia?.container);
    const result = await page.evaluate(async project => {
        const c = window.theia.container, connection = c.get([...c._bindingDictionary._map.keys()].find(key => key?.name === 'AssistConnection'));
        const id = 'runtime-loader-' + Date.now(), phases = [];
        let nativeReady;
        const ready = new Promise(resolve => { nativeReady = resolve; });
        const subscription = connection.progress.event(event => { if (event.id === id) { phases.push(event.phase); if (event.phase === 'thinking') nativeReady(); } });
        let error;
        const pending = connection.service.ask({ id, project, mode: 'explore', question: 'Explique count.', context: { path: 'counter.ts' } }).catch(reason => { error = String(reason.message ?? reason); nativeReady(); });
        let timer;
        try {
            await Promise.race([ready, new Promise(resolve => { timer = setTimeout(resolve, 15000); })]);
            await connection.service.cancel(id); await pending;
            return { phases, error };
        } finally { clearTimeout(timer); subscription.dispose(); }
    }, project);
    assert.ok(result.phases.includes('thinking'), JSON.stringify(result));
    assert.ok(!/Cannot find module|ERR_MODULE_NOT_FOUND/.test(result.error ?? ''), result.error);
    console.log('PASS: actual Electron RPC starts the bundled OpenCode harness without missing modules; request cancelled before the answer.');
} finally {
    await browser.disconnect();
    await fs.rm(path.join(os.homedir(), '.config/fabi/assist/projects', createHash('sha256').update(project).digest('hex')), { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
}
