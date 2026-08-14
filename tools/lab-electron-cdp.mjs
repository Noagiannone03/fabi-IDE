#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { isFabiFrontendUrl } from './fabi-electron-page.mjs';

const [automationPath, port, action = 'inspect', timeoutArg = '120000'] = process.argv.slice(2);
if (!automationPath || !port) {
    throw new Error('usage: lab-electron-cdp.mjs <playwright-core/index.mjs|puppeteer-core> <port> [inspect|wait-shell|wait-ai|wait-ready] [timeout-ms]');
}
const waitAction = action === 'wait-shell' || action === 'wait-ai' || action === 'wait-ready';
if (action !== 'inspect' && !waitAction) {
    throw new Error(`unsupported action: ${action}`);
}
const timeoutMs = Number.parseInt(timeoutArg, 10);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid timeout: ${timeoutArg}`);
}
const startedAt = Date.now();
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const automation = await import(pathToFileURL(automationPath).href);
const playwright = automation.chromium ?? automation.default?.chromium;
const puppeteer = automation.connect ? automation : automation.default;
const connect = async () => playwright
    ? playwright.connectOverCDP(`http://127.0.0.1:${port}`)
    : puppeteer?.connect
        ? puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` })
        : undefined;
let browser;
do {
    try {
        browser = await connect();
    } catch (error) {
        if (!waitAction || Date.now() - startedAt >= timeoutMs) {
            throw error;
        }
        await pause(250);
    }
} while (!browser && Date.now() - startedAt < timeoutMs);
if (!browser) {
    throw new Error(`unsupported browser automation module: ${automationPath}`);
}

let exitCode = 0;
try {
    let pages = playwright
        ? browser.contexts().flatMap(context => context.pages())
        : await browser.pages();
    let mainPage = pages.find(page => isFabiFrontendUrl(page.url()));
    while (waitAction && !mainPage && Date.now() - startedAt < timeoutMs) {
        await pause(100);
        pages = playwright
            ? browser.contexts().flatMap(context => context.pages())
            : await browser.pages();
        mainPage = pages.find(page => isFabiFrontendUrl(page.url()));
    }
    // Electron launched from an SSH-controlled macOS session can be visible to
    // CDP while its animation frames remain throttled until the page is brought
    // forward. This is lab automation only; production launches are activated
    // by the user's normal GUI action.
    if (mainPage && waitAction) {
        await mainPage.bringToFront().catch(() => undefined);
    }
    const events = [];
    if (mainPage && waitAction) {
        mainPage.on('console', message => events.push({
            atMs: Date.now() - startedAt,
            type: `console:${message.type()}`,
            text: message.text().slice(0, 2_000),
        }));
        mainPage.on('pageerror', error => events.push({
            atMs: Date.now() - startedAt,
            type: 'pageerror',
            text: String(error).slice(0, 4_000),
        }));
        mainPage.on('requestfailed', request => events.push({
            atMs: Date.now() - startedAt,
            type: 'requestfailed',
            text: `${request.url()} ${request.failure()?.errorText ?? ''}`.slice(0, 4_000),
        }));
    }
    let shellReadyAtMs;
    let aiReadyAtMs;
    let readyAtMs;
    while (waitAction && mainPage && Date.now() - startedAt < timeoutMs) {
        const readiness = await mainPage.evaluate(() => ({
            shell: !!document.querySelector('#theia-app-shell'),
            ai: document.body?.innerText?.includes('Fabi AI') ?? false,
        })).catch(() => ({ shell: false, ai: false }));
        const elapsedMs = Date.now() - startedAt;
        if (readiness.shell && shellReadyAtMs === undefined) {
            shellReadyAtMs = elapsedMs;
        }
        if (readiness.shell && readiness.ai && aiReadyAtMs === undefined) {
            aiReadyAtMs = elapsedMs;
        }
        const ready = action === 'wait-shell' ? readiness.shell : readiness.shell && readiness.ai;
        if (ready) {
            readyAtMs = elapsedMs;
            break;
        }
        await pause(250);
    }
    if (waitAction && readyAtMs === undefined) {
        exitCode = 2;
    }
    const snapshot = [];
    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        if (playwright) {
            await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
        } else {
            await page.waitForFunction(() => document.readyState !== 'loading', { timeout: 10_000 }).catch(() => undefined);
        }
        const controls = await page.evaluate(() => Array.from(document.querySelectorAll(
            'button, input, textarea, [contenteditable="true"], [role="button"], [role="option"], [role="textbox"]'
        )).slice(0, 300).map((element, controlIndex) => ({
            index: controlIndex,
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute('role'),
            ariaLabel: element.getAttribute('aria-label'),
            title: element.getAttribute('title'),
            placeholder: element.getAttribute('placeholder'),
            text: (element.innerText || element.getAttribute('value') || '').trim().slice(0, 300),
            className: typeof element.className === 'string' ? element.className : '',
            disabled: element.matches(':disabled, [aria-disabled="true"]'),
            visible: !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length),
        }))).catch(() => []);
        snapshot.push({
            url: page.url(),
            title: await page.title().catch(() => ''),
            body: (await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')).slice(0, 30_000),
            controls,
        });
        await page.screenshot({ path: `/tmp/fabi-cdp-page-${index}.png`, fullPage: true }).catch(() => undefined);
    }
    await new Promise(resolve => process.stdout.write(`${JSON.stringify({
        action,
        elapsedMs: Date.now() - startedAt,
        readyAtMs,
        shellReadyAtMs,
        aiReadyAtMs,
        events,
        pages: snapshot,
    }, null, 2)}\n`, resolve));
} finally {
    // browser.close() sends Browser.close over CDP and would terminate Electron.
    // Exiting drops only this diagnostic client's transport.
    process.exit(exitCode);
}
