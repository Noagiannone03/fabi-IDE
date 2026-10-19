import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';
const require = createRequire(import.meta.url);
const { playSpaceTransition } = require('../fabi-spaces/lib/common/space-transition');
const browser = await puppeteer.launch({ headless: true });
try {
    const page = await browser.newPage();
    const play = (direction = 1) => page.evaluate(`(${playSpaceTransition.toString()})(${direction})`);
    await page.setContent('<div id="theia-app-shell">Editor</div><div class="theia-preload"></div>');
    await play();
    assert.equal(await page.$eval('#theia-app-shell', e => getComputedStyle(e).opacity), '1');
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'cold shell stays visible without an animation gate');
    await page.$eval('.theia-preload', e => e.remove());
    await play();
    await play(-1);
    assert.equal(await page.evaluate(() => document.getAnimations().length), 1, 'rapid switches replace their motion');
    assert.equal(await page.$eval('#theia-app-shell', e => getComputedStyle(e).opacity), '1');
    // Simulate the compositor stopping. Production cleanup must work without finish().
    await page.evaluate(() => document.getAnimations().forEach(a => a.pause()));
    await page.waitForFunction(() => !document.getAnimations().length, { polling: 50, timeout: 2000 });
    assert.equal(await page.$eval('#theia-app-shell', e => getComputedStyle(e).transform), 'none');
    await play();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await play();
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    assert.equal(await page.$('[data-fabi-space-transition]'), null);
    console.log('Motion: visible content, cold load, interruption, stalled compositor cleanup and reduced motion passed.');
} finally { await browser.close(); }
