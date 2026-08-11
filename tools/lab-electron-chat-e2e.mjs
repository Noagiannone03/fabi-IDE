#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
        'usage: lab-electron-chat-e2e.mjs <puppeteer-core> <port> <prompt> <marker> '
        + '[timeout-ms] [abort-after-ms|route-active:<cluster-status-url>|request-active:<cluster-status-url>'
        + '|contribution-active:<contribution-status-url>]'
    );
}

const timeoutMs = Number.parseInt(timeoutArg, 10);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid timeout: ${timeoutArg}`);
}
const routeAbortPrefix = 'route-active:';
const requestAbortPrefix = 'request-active:';
const contributionAbortPrefix = 'contribution-active:';
const abortRouteStatusUrl = abortAfterArg?.startsWith(routeAbortPrefix)
    ? abortAfterArg.slice(routeAbortPrefix.length)
    : undefined;
const abortRequestStatusUrl = abortAfterArg?.startsWith(requestAbortPrefix)
    ? abortAfterArg.slice(requestAbortPrefix.length)
    : undefined;
const abortContributionStatusUrl = abortAfterArg?.startsWith(contributionAbortPrefix)
    ? abortAfterArg.slice(contributionAbortPrefix.length)
    : undefined;
const abortStatusUrl = abortRouteStatusUrl ?? abortRequestStatusUrl;
const abortStateStatusUrl = abortStatusUrl ?? abortContributionStatusUrl;
const abortAfterMs = abortAfterArg === undefined || abortStateStatusUrl !== undefined
    ? undefined
    : Number.parseInt(abortAfterArg, 10);
if (abortAfterMs !== undefined && (!Number.isFinite(abortAfterMs) || abortAfterMs < 0)) {
    throw new Error(`invalid abort trigger: ${abortAfterArg}`);
}
if (abortStateStatusUrl !== undefined) {
    const url = new URL(abortStateStatusUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`unsupported abort status URL: ${abortStateStatusUrl}`);
    }
}
const abortEnabled = abortAfterMs !== undefined || abortStateStatusUrl !== undefined;
const accountToken = abortContributionStatusUrl === undefined
    ? undefined
    : (await readFile(
        process.env.FABI_E2E_ACCOUNT_TOKEN_FILE ?? join(homedir(), '.config', 'fabi', 'account-token'),
        'utf8'
    )).trim();
if (abortContributionStatusUrl !== undefined && !accountToken) {
    throw new Error('contribution-active requires a non-empty local Fabi account token');
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

const readClusterRequestState = async () => {
    if (abortStatusUrl === undefined) {
        return { activeRouteRequestIds: [], maxRunningRequests: 0 };
    }
    const response = await fetch(abortStatusUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
        throw new Error(`route status returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    const routes = payload?.data?.swarm_v3_execution?.active_routes;
    if (!Array.isArray(routes)) {
        throw new Error('route status does not expose data.swarm_v3_execution.active_routes');
    }
    const maxRunningRequests = payload?.data?.max_running_request;
    if (!Number.isInteger(maxRunningRequests) || maxRunningRequests < 0) {
        throw new Error('route status does not expose a valid data.max_running_request');
    }
    return {
        activeRouteRequestIds: routes.map(route => String(route?.request_id ?? '')).filter(Boolean),
        maxRunningRequests,
    };
};

const readContributionState = async () => {
    if (abortContributionStatusUrl === undefined) {
        return { activeRequests: 0 };
    }
    const response = await fetch(abortContributionStatusUrl, {
        headers: {
            accept: 'application/json',
            authorization: `Bearer ${accountToken}`,
        },
        signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
        throw new Error(`contribution status returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!Number.isInteger(payload?.active_requests) || payload.active_requests < 0) {
        throw new Error('contribution status does not expose a valid active_requests');
    }
    return { activeRequests: payload.active_requests };
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
        articleCount: Array.from(document.querySelectorAll('[role="article"]')).filter(element => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }).length,
    }), { markerText: marker });
    const baselineRequestState = await readClusterRequestState();
    const baselineContributionState = await readContributionState();
    const baselineActiveRouteIds = new Set(baselineRequestState.activeRouteRequestIds);

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
        const snapshot = await page.evaluate(({ markerText }) => {
            const body = document.body?.innerText ?? '';
            const visible = selector => Array.from(document.querySelectorAll(selector)).find(element => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
            const send = visible('[aria-label="Send (Enter)"]');
            const cancel = visible('[aria-label*="Cancel"], [aria-label*="Stop"], [aria-label*="Abort"]');
            const articles = Array.from(document.querySelectorAll('[role="article"]')).filter(article => {
                const rect = article.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
            // Theia may recycle/prune article nodes as a conversation grows,
            // so an article-count offset is not a stable cursor. The marker is
            // unique per run; inspect every assistant final and select the
            // latest one instead.
            const assistantFinals = articles.flatMap(article => Array.from(
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
        }, { markerText: marker });
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

        let abortReason;
        if (
            abortAfterMs !== undefined
            && Date.now() - startedAt - submittedAtMs >= abortAfterMs
        ) {
            abortReason = `${Date.now() - startedAt - submittedAtMs} ms elapsed`;
        } else if (abortStatusUrl !== undefined && snapshot.cancelRect) {
            const requestState = await readClusterRequestState();
            const newRouteIds = requestState.activeRouteRequestIds
                .filter(requestId => !baselineActiveRouteIds.has(requestId));
            if (newRouteIds.length > 0) {
                abortReason = `active route ${newRouteIds.join(',')}`;
                record('abort-route-observed', abortReason);
            } else if (
                abortRequestStatusUrl !== undefined
                && requestState.maxRunningRequests > baselineRequestState.maxRunningRequests
            ) {
                abortReason = `active request permit ${requestState.maxRunningRequests}`;
                record('abort-request-observed', abortReason);
            }
        } else if (abortContributionStatusUrl !== undefined && snapshot.cancelRect) {
            const contributionState = await readContributionState();
            if (contributionState.activeRequests > baselineContributionState.activeRequests) {
                abortReason = `active contribution permit ${contributionState.activeRequests}`;
                record('abort-contribution-observed', abortReason);
            }
        }
        if (abortedAtMs === undefined && snapshot.cancelRect && abortReason !== undefined) {
            const rect = snapshot.cancelRect;
            await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
            abortedAtMs = Date.now() - startedAt;
            record('abort-clicked', abortReason);
        }

        const assistantMarkerVisible = snapshot.latestAssistantFinal.includes(marker);
        const idle = !snapshot.cancelVisible && snapshot.sendAriaLabel === 'Send (Enter)';
        const abortCompleted = abortEnabled && abortedAtMs !== undefined && idle;
        if (abortCompleted || (!abortEnabled && assistantMarkerVisible && idle)) {
            completedAtMs = Date.now() - startedAt;
            break;
        }
        if (abortEnabled && assistantMarkerVisible && idle) {
            completedAtMs = Date.now() - startedAt;
            exitCode = 4;
            record('abort-trigger-missed', 'generation completed before the requested abort state was observed');
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
        mode: abortRouteStatusUrl !== undefined
            ? 'abort-on-active-route'
            : abortRequestStatusUrl !== undefined ? 'abort-on-active-request'
            : abortContributionStatusUrl !== undefined ? 'abort-on-active-contribution'
            : abortAfterMs === undefined ? 'completion' : 'abort-after-delay',
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
