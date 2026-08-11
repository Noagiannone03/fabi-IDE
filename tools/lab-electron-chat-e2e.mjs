#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const [
    automationPath,
    port,
    prompt,
    marker,
    timeoutArg = '600000',
    abortAfterArg,
] = process.argv.slice(2);
if (!automationPath || !port || !prompt || !marker) {
    throw new Error(
        'usage: lab-electron-chat-e2e.mjs <puppeteer-core> <port> <prompt> <marker> [timeout-ms] [abort-after-ms]'
    );
}

const timeoutMs = Number.parseInt(timeoutArg, 10);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid timeout: ${timeoutArg}`);
}
const abortAfterMs = abortAfterArg === undefined
    ? undefined
    : Number.parseInt(abortAfterArg, 10);
if (abortAfterMs !== undefined && (!Number.isFinite(abortAfterMs) || abortAfterMs < 0)) {
    throw new Error(`invalid abort delay: ${abortAfterArg}`);
}

const automation = await import(pathToFileURL(automationPath).href);
const puppeteer = automation.connect ? automation : automation.default;
if (!puppeteer?.connect) {
    throw new Error(`unsupported browser automation module: ${automationPath}`);
}

const startedAt = Date.now();
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
const events = [];
let exitCode = 0;

const record = (type, text) => {
    events.push({
        atMs: Date.now() - startedAt,
        type,
        text: String(text).slice(0, 4_000),
    });
};

try {
    const pages = await browser.pages();
    const page = pages.find(candidate => candidate.url().includes('app.asar/lib/frontend'));
    if (!page) {
        throw new Error('Fabi frontend page not found');
    }

    await page.bringToFront();
    page.on('console', message => record(`console:${message.type()}`, message.text()));
    page.on('pageerror', error => record('pageerror', error));
    page.on('requestfailed', request => record(
        'requestfailed',
        `${request.url()} ${request.failure()?.errorText ?? ''}`
    ));

    const textboxSelector = '[role="textbox"][aria-label="Type your message here"]';
    await page.waitForFunction(selector => Array.from(document.querySelectorAll(selector)).some(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }), {
        timeout: 30_000,
    }, textboxSelector);
    const baseline = await page.evaluate(({ markerText }) => ({
        body: document.body?.innerText ?? '',
        markerCount: (document.body?.innerText ?? '').split(markerText).length - 1,
        articleCount: document.querySelectorAll('[role="article"]').length,
    }), { markerText: marker });

    const inputRect = await page.evaluate(selector => {
        const textbox = Array.from(document.querySelectorAll(selector)).find(element => {
            const candidateRect = element.getBoundingClientRect();
            return candidateRect.width > 0 && candidateRect.height > 0;
        });
        if (!textbox) {
            return undefined;
        }
        const rect = textbox.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }, textboxSelector);
    if (!inputRect || inputRect.width <= 0 || inputRect.height <= 0) {
        throw new Error('Fabi chat input disappeared before focus');
    }
    await page.mouse.click(
        inputRect.x + Math.min(32, inputRect.width / 2),
        inputRect.y + Math.min(18, inputRect.height / 2)
    );
    const selectAllModifier = await page.evaluate(() => /Mac/i.test(navigator.platform))
        ? 'Meta'
        : 'Control';
    await page.keyboard.down(selectAllModifier);
    await page.keyboard.press('A');
    await page.keyboard.up(selectAllModifier);
    await page.keyboard.press('Backspace');
    await page.keyboard.type(prompt, { delay: 1 });
    await page.waitForFunction(() => {
        const button = Array.from(document.querySelectorAll('[aria-label="Send (Enter)"]')).find(element => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
        return button && !button.classList.contains('disabled');
    }, { timeout: 10_000 });
    const submittedAtMs = Date.now() - startedAt;
    await page.keyboard.press('Enter');
    record('submitted', prompt);

    const observations = [];
    let lastSignature = '';
    let firstBusyAtMs;
    let firstResponseAtMs;
    let completedAtMs;
    let abortedAtMs;
    let finalSnapshot;

    while (Date.now() - startedAt < timeoutMs) {
        const snapshot = await page.evaluate(({ markerText, baselineArticleCount }) => {
            const body = document.body?.innerText ?? '';
            const visible = selector => Array.from(document.querySelectorAll(selector)).find(element => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
            const send = visible('[aria-label="Send (Enter)"]');
            const cancel = visible('[aria-label*="Cancel"], [aria-label*="Stop"], [aria-label*="Abort"]');
            const articles = Array.from(document.querySelectorAll('[role="article"]'));
            const newArticles = articles.slice(baselineArticleCount);
            const assistantFinals = newArticles.flatMap(article => Array.from(
                article.querySelectorAll('.theia-ResponseNode-Content')
            )).filter(content => !content.querySelector('.fabi-think'))
                .map(content => (content.innerText ?? '').trim())
                .filter(Boolean);
            const lines = body.split('\n').map(line => line.trim()).filter(Boolean);
            return {
                body,
                markerCount: body.split(markerText).length - 1,
                articleCount: articles.length,
                latestAssistantFinal: assistantFinals.at(-1) ?? '',
                sendClass: send?.className ?? null,
                sendAriaLabel: send?.getAttribute('aria-label') ?? null,
                cancelVisible: !!cancel,
                cancelRect: cancel ? (() => {
                    const rect = cancel.getBoundingClientRect();
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                })() : undefined,
                interestingLines: lines.filter(line => /prépar|génér|réflé|outil|fichier|permission|prêt|failed|timeout|problème|erreur/i.test(line)).slice(-20),
            };
        }, { markerText: marker, baselineArticleCount: baseline.articleCount });
        finalSnapshot = snapshot;

        const busy = snapshot.cancelVisible
            || snapshot.sendAriaLabel !== 'Send (Enter)'
            || snapshot.interestingLines.some(line => /prépar|génér|réflé/i.test(line));
        if (busy && firstBusyAtMs === undefined) {
            firstBusyAtMs = Date.now() - startedAt;
        }
        if (snapshot.latestAssistantFinal && firstResponseAtMs === undefined) {
            firstResponseAtMs = Date.now() - startedAt;
        }

        const signature = JSON.stringify({
            markerCount: snapshot.markerCount,
            articleCount: snapshot.articleCount,
            latestAssistantFinal: snapshot.latestAssistantFinal,
            sendClass: snapshot.sendClass,
            sendAriaLabel: snapshot.sendAriaLabel,
            cancelVisible: snapshot.cancelVisible,
            interestingLines: snapshot.interestingLines,
        });
        if (signature !== lastSignature) {
            observations.push({ atMs: Date.now() - startedAt, ...JSON.parse(signature) });
            lastSignature = signature;
        }

        if (
            abortAfterMs !== undefined
            && abortedAtMs === undefined
            && snapshot.cancelRect
            && Date.now() - startedAt - submittedAtMs >= abortAfterMs
        ) {
            const rect = snapshot.cancelRect;
            await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
            abortedAtMs = Date.now() - startedAt;
            record('abort-clicked', `after ${abortedAtMs - submittedAtMs} ms`);
        }

        const assistantMarkerVisible = snapshot.latestAssistantFinal.includes(marker);
        const idle = !snapshot.cancelVisible && snapshot.sendAriaLabel === 'Send (Enter)';
        const abortCompleted = abortAfterMs !== undefined && abortedAtMs !== undefined && idle;
        if ((assistantMarkerVisible && idle) || abortCompleted) {
            completedAtMs = Date.now() - startedAt;
            break;
        }

        const fatalLine = snapshot.interestingLines.find(line => /failed|timeout|problème|erreur/i.test(line));
        if (fatalLine && idle) {
            record('fatal-ui-state', fatalLine);
            exitCode = 2;
            break;
        }
        await pause(200);
    }

    if (completedAtMs === undefined && exitCode === 0) {
        exitCode = 3;
        record('timeout', `assistant marker not observed within ${timeoutMs} ms`);
    }

    await page.screenshot({ path: '/tmp/fabi-chat-e2e-final.png', fullPage: true }).catch(() => undefined);
    process.stdout.write(`${JSON.stringify({
        ok: exitCode === 0,
        prompt,
        marker,
        mode: abortAfterMs === undefined ? 'completion' : 'abort',
        submittedAtMs,
        firstBusyAtMs,
        firstResponseAtMs,
        abortedAtMs,
        completedAtMs,
        totalAfterSubmitMs: completedAtMs === undefined ? undefined : completedAtMs - submittedAtMs,
        baselineMarkerCount: baseline.markerCount,
        baselineArticleCount: baseline.articleCount,
        observations,
        events,
        final: finalSnapshot && {
            markerCount: finalSnapshot.markerCount,
            articleCount: finalSnapshot.articleCount,
            latestAssistantFinal: finalSnapshot.latestAssistantFinal,
            sendClass: finalSnapshot.sendClass,
            sendAriaLabel: finalSnapshot.sendAriaLabel,
            cancelVisible: finalSnapshot.cancelVisible,
            interestingLines: finalSnapshot.interestingLines,
            bodyTail: finalSnapshot.body.slice(-8_000),
        },
    }, null, 2)}\n`);
} finally {
    // browser.close() would terminate Electron. Dropping this process closes
    // only the diagnostic CDP transport.
    browser.disconnect();
    process.exitCode = exitCode;
}
