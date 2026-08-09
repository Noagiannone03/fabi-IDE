#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const [playwrightPath, port, action = 'inspect'] = process.argv.slice(2);
if (!playwrightPath || !port) {
    throw new Error('usage: lab-electron-cdp.mjs <playwright-core/index.mjs> <port> [inspect]');
}
if (action !== 'inspect') {
    throw new Error(`unsupported action: ${action}`);
}

const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);

try {
    const pages = browser.contexts().flatMap(context => context.pages());
    const snapshot = [];
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
        snapshot.push({
            url: page.url(),
            title: await page.title().catch(() => ''),
            body: (await page.locator('body').innerText().catch(() => '')).slice(0, 30_000),
        });
        await page.screenshot({ path: `/tmp/fabi-cdp-page-${index}.png`, fullPage: true }).catch(() => undefined);
    }
    await new Promise(resolve => process.stdout.write(`${JSON.stringify({ pages: snapshot }, null, 2)}\n`, resolve));
} finally {
    // browser.close() sends Browser.close over CDP and would terminate Electron.
    // Exiting drops only this diagnostic client's transport.
    process.exit(0);
}
