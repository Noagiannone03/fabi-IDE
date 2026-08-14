#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { isFabiFrontendUrl } from './fabi-electron-page.mjs';

const [
    automationPath,
    port,
    firstPrompt,
    firstMarker,
    secondPrompt,
    secondMarker,
    timeoutArg = '600000',
    scenario = 'abort-owner',
] = process.argv.slice(2);

if (!automationPath || !port || !firstPrompt || !firstMarker || !secondPrompt || !secondMarker) {
    throw new Error(
        'usage: lab-electron-multispace-queue-e2e.mjs <puppeteer-core> <port> '
        + '<first-prompt> <first-marker> <second-prompt> <second-marker> '
        + '[timeout-ms] [abort-owner|complete-owner]'
    );
}
if (scenario !== 'abort-owner' && scenario !== 'complete-owner') {
    throw new Error(`unsupported scenario: ${scenario}`);
}

const timeoutMs = Number.parseInt(timeoutArg, 10);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid timeout: ${timeoutArg}`);
}

const automation = await import(pathToFileURL(automationPath).href);
const puppeteer = automation.connect ? automation : automation.default;
if (!puppeteer?.connect) {
    throw new Error(`unsupported browser automation module: ${automationPath}`);
}

const startedAt = Date.now();
const elapsed = () => Date.now() - startedAt;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const events = [];
const record = (type, detail = '') => {
    events.push({ atMs: elapsed(), type, detail: String(detail).slice(0, 4_000) });
};

const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
let exitCode = 0;

const frontendPages = async () => (await browser.pages())
    .filter(page => isFabiFrontendUrl(page.url()));

const waitForFrontends = async count => {
    while (elapsed() < timeoutMs) {
        const pages = await frontendPages();
        if (pages.length >= count) {
            return pages;
        }
        await pause(200);
    }
    throw new Error(`only ${(await frontendPages()).length} Fabi frontend page(s) found; ${count} required`);
};

const textboxSelector = '[role="textbox"][aria-label="Type your message here"]';

const waitForInput = async page => {
    await page.waitForFunction(selector => Array.from(document.querySelectorAll(selector)).some(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }), { timeout: 30_000 }, textboxSelector);
};

const snapshot = async (page, marker) => page.evaluate(({ selector, markerText }) => {
    const visible = element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };
    const body = document.body?.innerText ?? '';
    const send = Array.from(document.querySelectorAll('[aria-label="Send (Enter)"]')).find(visible);
    const cancel = Array.from(document.querySelectorAll(
        '[aria-label*="Cancel"], [aria-label*="Stop"], [aria-label*="Abort"]'
    )).find(visible);
    const textbox = Array.from(document.querySelectorAll(selector)).find(visible);
    const assistantFinals = Array.from(document.querySelectorAll('[role="article"]'))
        .filter(visible)
        .flatMap(article => Array.from(article.querySelectorAll('.theia-ResponseNode-Content')))
        .filter(content => !content.querySelector('.fabi-think'))
        .map(content => (content.innerText ?? '').trim())
        .filter(Boolean);
    const queueLines = body.split('\n')
        .map(line => line.trim())
        .filter(line => /En attente · position|Démarrage du tour/i.test(line));
    const rect = cancel?.getBoundingClientRect();
    return {
        url: location.href,
        title: document.title,
        markerVisible: assistantFinals.some(content => content.includes(markerText)),
        latestAssistantFinal: assistantFinals.at(-1) ?? '',
        queueLines: queueLines.slice(-8),
        cancelRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
        sendAriaLabel: send?.getAttribute('aria-label') ?? null,
        sendDisabled: !send || send.classList.contains('disabled') || send.matches(':disabled, [aria-disabled="true"]'),
        textboxReadOnly: textbox?.getAttribute('aria-readonly') === 'true',
        bodyTail: body.slice(-6_000),
    };
}, { selector: textboxSelector, markerText: marker });

const submit = async (page, prompt, label) => {
    await page.bringToFront();
    await waitForInput(page);
    const rect = await page.evaluate(selector => {
        const element = Array.from(document.querySelectorAll(selector)).find(candidate => {
            const bounds = candidate.getBoundingClientRect();
            return bounds.width > 0 && bounds.height > 0;
        });
        if (!element) {
            return undefined;
        }
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }, textboxSelector);
    if (!rect) {
        throw new Error(`${label} chat input is not visible`);
    }
    await page.mouse.click(rect.x + Math.min(32, rect.width / 2), rect.y + Math.min(18, rect.height / 2));
    const modifier = await page.evaluate(() => /Mac/i.test(navigator.platform)) ? 'Meta' : 'Control';
    await page.keyboard.down(modifier);
    await page.keyboard.press('A');
    await page.keyboard.up(modifier);
    await page.keyboard.press('Backspace');
    await page.keyboard.type(prompt, { delay: 1 });
    await page.waitForFunction(() => {
        const element = Array.from(document.querySelectorAll('[aria-label="Send (Enter)"]')).find(candidate => {
            const bounds = candidate.getBoundingClientRect();
            return bounds.width > 0 && bounds.height > 0;
        });
        return element
            && !element.classList.contains('disabled')
            && !element.matches(':disabled, [aria-disabled="true"]');
    }, { timeout: 10_000 });
    await page.keyboard.press('Enter');
    record(`${label}-submitted`, prompt);
};

const waitFor = async (description, predicate) => {
    while (elapsed() < timeoutMs) {
        const value = await predicate();
        if (value) {
            record(description, JSON.stringify(value));
            return value;
        }
        await pause(200);
    }
    throw new Error(`timeout waiting for ${description}`);
};

try {
    const pages = await waitForFrontends(2);
    const [ownerPage, queuedPage] = pages;
    for (const [label, page] of [['owner', ownerPage], ['queued', queuedPage]]) {
        page.on('console', message => record(`${label}:console:${message.type()}`, message.text()));
        page.on('pageerror', error => record(`${label}:pageerror`, error));
        page.on('requestfailed', request => record(
            `${label}:requestfailed`,
            `${request.url()} ${request.failure()?.errorText ?? ''}`
        ));
    }

    const distinctWorkspaces = new Set(pages.slice(0, 2).map(page => {
        const url = new URL(page.url());
        return url.hash || url.search || page.url();
    }));
    if (distinctWorkspaces.size !== 2) {
        throw new Error(`the first two frontend pages do not identify distinct Spaces: ${pages.slice(0, 2).map(page => page.url()).join(', ')}`);
    }
    record('spaces-ready', pages.slice(0, 2).map(page => page.url()).join(' | '));

    await submit(ownerPage, firstPrompt, 'owner');
    await waitFor('owner-active', async () => {
        const state = await snapshot(ownerPage, firstMarker);
        return state.cancelRect ? state : undefined;
    });

    await submit(queuedPage, secondPrompt, 'queued');
    const queuedAt = elapsed();
    await waitFor('second-ticket-queued', async () => {
        const state = await snapshot(queuedPage, secondMarker);
        if (state.markerVisible) {
            throw new Error('second response completed before its queue state became visible');
        }
        return state.queueLines.some(line => /En attente · position [1-9]/i.test(line)) ? state : undefined;
    });

    let ownerReleasedAt;
    if (scenario === 'abort-owner') {
        const owner = await snapshot(ownerPage, firstMarker);
        if (!owner.cancelRect) {
            throw new Error('owner cancel control disappeared before abort');
        }
        await ownerPage.bringToFront();
        await ownerPage.mouse.click(
            owner.cancelRect.x + owner.cancelRect.width / 2,
            owner.cancelRect.y + owner.cancelRect.height / 2
        );
        record('owner-abort-clicked');
        await waitFor('owner-released-after-abort', async () => {
            const state = await snapshot(ownerPage, firstMarker);
            if (state.markerVisible) {
                throw new Error(`aborted owner unexpectedly produced marker ${firstMarker}`);
            }
            if (!state.cancelRect && state.sendAriaLabel === 'Send (Enter)') {
                ownerReleasedAt = elapsed();
                return state;
            }
            return undefined;
        });
    } else {
        await waitFor('owner-completed', async () => {
            const state = await snapshot(ownerPage, firstMarker);
            if (state.latestAssistantFinal.includes(firstMarker)
                && !state.cancelRect
                && state.sendAriaLabel === 'Send (Enter)') {
                ownerReleasedAt = elapsed();
                return state;
            }
            return undefined;
        });
    }

    let secondStartedAt;
    await waitFor('second-ticket-active', async () => {
        const state = await snapshot(queuedPage, secondMarker);
        const active = !!state.cancelRect
            || state.queueLines.some(line => /Démarrage du tour/i.test(line));
        if (active) {
            secondStartedAt = elapsed();
            return state;
        }
        return undefined;
    });
    if (ownerReleasedAt === undefined || secondStartedAt < ownerReleasedAt) {
        throw new Error(`FIFO violation: second started at ${secondStartedAt}, owner released at ${ownerReleasedAt}`);
    }

    const final = await waitFor('second-ticket-completed', async () => {
        const state = await snapshot(queuedPage, secondMarker);
        if (state.latestAssistantFinal.includes(secondMarker)
            && !state.cancelRect
            && state.sendAriaLabel === 'Send (Enter)') {
            return state;
        }
        return undefined;
    });

    await queuedPage.screenshot({ path: '/tmp/fabi-multispace-queue-e2e-final.png', fullPage: true })
        .catch(() => undefined);
    process.stdout.write(`${JSON.stringify({
        ok: true,
        scenario,
        queuedAtMs: queuedAt,
        ownerReleasedAtMs: ownerReleasedAt,
        secondStartedAtMs: secondStartedAt,
        secondCompletedAtMs: elapsed(),
        ownerUrl: ownerPage.url(),
        queuedUrl: queuedPage.url(),
        final,
        events,
    }, null, 2)}\n`);
} catch (error) {
    exitCode = 2;
    const pages = await frontendPages().catch(() => []);
    const snapshots = [];
    for (const page of pages.slice(0, 4)) {
        snapshots.push(await snapshot(page, secondMarker).catch(snapshotError => ({
            url: page.url(),
            error: String(snapshotError),
        })));
    }
    process.stderr.write(`${JSON.stringify({
        ok: false,
        scenario,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
        snapshots,
        events,
    }, null, 2)}\n`);
} finally {
    browser.disconnect();
    process.exitCode = exitCode;
}
