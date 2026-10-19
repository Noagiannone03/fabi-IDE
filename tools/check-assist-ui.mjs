// UI integration checks. The temporary shell and teaching fixtures are disposed afterwards.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: process.env.FABI_DEBUG_URL || 'http://127.0.0.1:9224', defaultViewport: null });
let page;
const settle = async () => page.evaluate(() => Promise.all([...document.querySelectorAll('.fabi-assist-popover, .fabi-assist-surface')].flatMap(node => node.getAnimations({ subtree: true })).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
try {
    for (const candidate of await browser.pages()) {
        if (!candidate.url().includes('/frontend/index.html')) continue;
        const matches = await candidate.evaluate(() => {
            const c = window.theia?.container;
            const key = c && [...c._bindingDictionary._map.keys()].find(k => k?.name === 'WorkspaceService');
            return key && c.get(key).tryGetRoots().some(r => r.resource.path.toString().endsWith('/fabi-IDE-desktop-ssh'));
        }).catch(() => false);
        if (matches) { page = candidate; break; }
    }
    assert.ok(page);
    await page.bringToFront();
    await page.waitForFunction(() => !!window.theia?.container);
    await page.waitForFunction(() => {
        const c = window.theia.container;
        const key = [...c._bindingDictionary._map.keys()].find(key => key?.name === 'FrontendApplicationStateService');
        return !!key && c.get(key).state === 'ready';
    });
    await page.evaluate(async () => {
        const c = window.theia.container;
        const get = name => c.get([...c._bindingDictionary._map.keys()].find(key => key?.name === name));
        const contribution = get('AssistContribution'), model = contribution.contextModel;
        const editor = await model.editors.open(model.workspace.tryGetRoots()[0].resource.resolve('fabi-swarm/src/node/assist/assist-harness.ts'));
        editor.editor.selection = { start: { line: 23, character: 0 }, end: { line: 33, character: 0 } };
        editor.editor.revealRange(editor.editor.selection);
        await model.shell.activateWidget(editor.id);
        await model.prepare(editor.editor.uri);
        contribution.showSelectionCue();
        window.assistCheck = { model, contribution, editor, book: model.book, account: model.account, draft: model.draft, serial: model.replySerial, thread: model.thread, context: model.context };
        model.account = { connected: true, name: 'Test UI', models: [] };
    });
    // Selection offers Assist without making any model request. Option opens its radial actions.
    await page.waitForSelector('.fabi-assist-selection-cue');
    assert.equal(await page.evaluate(() => window.assistCheck.model.context.kind), 'selection');
    assert.ok(await page.evaluate(() => window.assistCheck.model.context.surrounding?.text.length > window.assistCheck.model.context.text.length));
    const countBefore = await page.evaluate(() => window.assistCheck.model.replySerial);
    await page.keyboard.press('Alt');
    await page.waitForSelector('.fabi-assist-orbital');
    await settle();
    assert.equal(await page.$$eval('.fabi-orbit-action', buttons => buttons.length), 3);
    assert.equal(await page.evaluate(() => window.assistCheck.model.replySerial), countBefore);
    assert.equal(await page.$('.fabi-assist-popover textarea'), null);
    if (process.env.FABI_CAPTURE) await page.screenshot({ path: '/tmp/fabi-assist-orbit.png' });
    await page.keyboard.press('Escape');
    // Pointer holds on actual navigator rows must capture that row, not the active editor.
    await page.evaluate(async () => {
        const c = window.theia.container;
        const key = [...c._bindingDictionary._map.keys()].find(k => k?.name === 'FileNavigatorContribution');
        await c.get(key).openView({ activate: true });
    });
    // Passive agent refreshes must leave a manually scrolled explorer in place.
    const scrollCheck = await page.evaluate(async () => {
        const s = window.assistCheck;
        const navigator = s.model.shell.widgets.find(w => w.id === 'files');
        navigator.showFiles?.();
        await new Promise(resolve => setTimeout(resolve, 200));
        const scroller = navigator.node.querySelector('[data-virtuoso-scroller]');
        if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 100) throw new Error('Explorer fixture must scroll');
        const wait = () => new Promise(resolve => setTimeout(resolve, 200));
        scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
        await wait(); const before = scroller.scrollTop;
        for (let i = 0; i < 3; i++) { s.model.agents.changedEmitter.fire(); await wait(); }
        return { before, after: scroller.scrollTop };
    });
    assert.ok(Math.abs(scrollCheck.before - scrollCheck.after) < 3, `Agent refresh moved explorer: ${JSON.stringify(scrollCheck)}`);
    for (const suffix of ['/docs', '/fabi-swarm/src/node/assist/assist-harness.ts']) {
        await page.evaluate(async suffix => {
            const s = window.assistCheck, navigator = s.model.shell.widgets.find(w => w.id === 'files');
            await navigator.model.revealFile(s.model.root.resolve(suffix.slice(1)));
            await new Promise(resolve => setTimeout(resolve, 100));
            const row = [...navigator.rows.values()].find(row => row.node.uri?.path.toString().endsWith(suffix));
            if (row) navigator.view.list.scrollToIndex({ index: row.index, align: 'center' });
        }, suffix);
        const selector = `#files .theia-TreeNode[title$="${suffix}"] .theia-TreeNodeSegmentGrow`;
        await page.waitForSelector(selector);
        await page.$eval(selector, node => node.scrollIntoView({ block: 'center' }));
        await page.$eval(selector, node => {
            node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
            node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 130, clientY: 240 }));
        });
        await page.waitForSelector('.fabi-assist-orbital');
        await page.evaluate(() => { document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); document.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        assert.ok((await page.evaluate(() => window.assistCheck.model.context.path)).endsWith(suffix), 'Navigator context must match the pressed row');
        await page.keyboard.press('Escape');
    }
    await page.evaluate(async () => {
        const s = window.assistCheck;
        await s.model.shell.activateWidget(s.editor.id);
    });
    // A normal click and a selection drag must not summon Assist.
    await page.evaluate(() => {
        const target = document.querySelector('.monaco-editor .view-line');
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 510, clientY: 200 }));
        target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 530, clientY: 200 }));
        target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    });
    assert.equal(await page.$('.fabi-assist-hold'), null);
    assert.equal(await page.$('.fabi-assist-popover'), null);
    // Long press opens a compact lens; the cursor receives a visible affordance.
    await page.evaluate(() => document.querySelector('.monaco-editor .view-line').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 510, clientY: 200 })));
    assert.equal(await page.evaluate(() => document.body.classList.contains('fabi-assist-cursor')), true);
    await page.waitForSelector('.fabi-assist-lens');
    await page.evaluate(() => { document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 })); document.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await settle();
    assert.equal(await page.$('.fabi-assist-popover textarea'), null);
    assert.equal(await page.$eval('.fabi-assist-popover', node => node.getBoundingClientRect().height <= 240), true, 'Three radial actions fit in a compact constellation');
    if (process.env.FABI_CAPTURE) await page.screenshot({ path: '/tmp/fabi-assist-lens.png' });
    await page.$eval('.fabi-assist-question-action', button => button.click());
    await page.waitForSelector('.fabi-assist-popover textarea');
    await page.type('.fabi-assist-popover textarea', 'Pourquoi séparer ces responsabilités ?');
    await page.evaluate(() => { const m = window.assistCheck.model; m.busy = 'ui-fixture'; m.progress = 'Je lis ce passage…'; m.changed.fire(); });
    await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    assert.ok(await page.$('.fabi-assist-popover'), 'Outside click must keep the reading surface');
    await page.evaluate(async () => {
        const s = window.assistCheck;
        s.contribution.hide(false);
        await s.contribution.ask();
        if (s.contribution.model.busy) throw new Error('Context generation leaked to terminal');
    });
    await page.waitForSelector('[data-phase=thinking]');

    await page.waitForSelector('[data-phase=thinking]');
    await page.evaluate(() => {
        const m = window.assistCheck.model;
        m.busy = undefined; m.replySerial++;
        m.book = { ...m.book, concepts: [{ id: 'separation', title: 'Séparer les responsabilités', objective: 'Comprendre deux rôles', prerequisites: [], status: 'practicing' }], turns: [...m.book.turns, { id: 'ui-fixture', at: Date.now(), mode: 'learn', thread: m.thread, context: m.context, question: m.draft,
            reply: { title: 'Chaque partie a son rôle.', explanation: 'Le **provider** relie ton compte au modèle. Le **professeur** organise la lecture du code et garde les notes de ton parcours.\n\nDans `runTutor`, le professeur reçoit un modèle, puis lui donne les outils nécessaires pour lire ton projet. Si tu changes de modèle, ton parcours peut continuer.', sources: [{ path: 'fabi-swarm/src/node/assist/assist-harness.ts', line: 18 }], exercise: { id: 'ui-question', conceptId: 'separation', kind: 'explain', question: 'Quelle partie devrait garder ce que tu as appris ?', hint: 'Pense à ce qui doit rester quand tu changes de modèle.' } } }] };
        m.changed.fire();
    });
    await page.waitForSelector('[data-phase=answer]');
    await settle();
    assert.equal(await page.$('.fabi-assist-popover textarea'), null, 'Answer replaces the question input');
    if (process.env.FABI_CAPTURE) await page.screenshot({ path: '/tmp/fabi-assist-lens-answer-fixture.png' });
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.fabi-assist-popover'), null);
    await page.evaluate(async () => {
        const s = window.assistCheck;
        s.terminal = await s.model.terminals.newTerminal({ title: 'Assist UI test', location: 'editor' });
        await s.terminal.start(); s.model.terminals.open(s.terminal, { widgetOptions: { area: 'main' }, mode: 'activate' });
        s.pid = await s.terminal.processId;
    });
    await page.waitForSelector('.fabi-terminal-assist');
    await page.evaluate(async () => {
        const s = window.assistCheck;
        s.terminal.write('\r\nFABI_TERMINAL_CONTEXT_4317\r\n');
    });
    await page.waitForFunction(() => {
        const t = window.assistCheck.terminal;
        return t.buffer.getLines(0, t.buffer.length, true).join('\n').includes('FABI_TERMINAL_CONTEXT_4317');
    });
    await page.evaluate(() => {
        const s = window.assistCheck;
        s.terminal.node.querySelector('.xterm').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 520, clientY: 300 }));
    });
    await page.waitForSelector('.fabi-assist-orbital');
    const terminalContext = await page.evaluate(() => window.assistCheck.model.context);
    assert.equal(terminalContext.kind, 'terminal');
    assert.equal(terminalContext.path, undefined);
    assert.match(terminalContext.text, /FABI_TERMINAL_CONTEXT_4317/);
    await page.evaluate(() => { document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); document.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
        const s = window.assistCheck;
        s.terminal.selectAll();
        s.terminal.node.querySelector('.xterm').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 500, clientY: 300 }));
    });
    await page.waitForSelector('.fabi-assist-selection-cue');
    await page.$eval('.fabi-assist-selection-cue', node => node.click());
    await page.waitForSelector('.fabi-assist-orbital');
    assert.equal(await page.evaluate(() => window.assistCheck.model.context.terminal.selected), true);
    await page.keyboard.press('Escape');
    const terminalResult = await page.evaluate(async () => {
        const s = window.assistCheck;
        s.contextModel = s.model; s.model = s.contribution.model;
        s.terminalBackup = { book: s.model.book, account: s.model.account, draft: s.model.draft, replySerial: s.model.replySerial, thread: s.model.thread, context: s.model.context };
        await s.model.prepare(undefined, s.terminal, 'terminal');
        if (s.model === s.contextModel || s.model.thread.id === s.contextModel.thread.id) throw new Error('Context and terminal must have independent state');
        s.model.book = { ...s.model.book, turns: [...s.model.book.turns, { id: 'terminal-fixture', at: Date.now(), mode: 'learn', thread: s.model.thread, context: s.model.context, question: 'Explique-moi', reply: { title: 'Une idée à la fois', explanation: 'Une **API REST** permet de demander des ressources par HTTP.', terms: [{ term: 'API REST', definition: 'Une interface pour échanger des ressources par HTTP.', example: 'GET /users demande la liste des utilisateurs.' }], diagram: { caption: 'Une demande et sa réponse', steps: [{ title: 'Navigateur', detail: 'Demande la liste' }, { title: 'API', detail: 'Retourne les utilisateurs' }] }, sources: [], exercise: { id: 'quiz-fixture', conceptId: 'api', kind: 'quiz', question: 'À quoi sert GET ?', choices: ['Lire une ressource', 'Effacer une ressource'], hint: 'GET demande une représentation.' } } }] };
        const before = s.model.shell.getWidgets('main').map(w => w.id);
        await s.contribution.open(true, s.terminal);
        return { before, after: s.model.shell.getWidgets('main').map(w => w.id), id: s.terminal.id };
    });
    assert.deepEqual(terminalResult.after, terminalResult.before, 'Assist opens in the terminal without adding a tab');
    await page.waitForSelector('.fabi-assist-surface .fabi-assist-exercise');
    await settle();
    assert.equal(await page.evaluate(() => window.assistCheck.terminal.node.contains(document.querySelector('.fabi-assist-surface'))), true);
    assert.equal(await page.evaluate(() => window.assistCheck.terminal.node.querySelector('.xterm').inert), true);
    assert.equal(await page.$$eval('.fabi-learning-flow li', nodes => nodes.length), 2);
    await page.$eval('.fabi-term > button', node => node.click());
    assert.equal(await page.$eval('.fabi-term > button', node => node.getAttribute('aria-expanded')), 'true');
    assert.equal(await page.$$eval('.fabi-quiz-choices button', nodes => nodes.length), 2);
    await page.evaluate(() => {
        const p = document.querySelector('.fabi-assist-surface .fabi-assist-markdown p');
        const range = document.createRange(); range.selectNodeContents(p);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.waitForSelector('.fabi-quote-question');
    assert.match(await page.$eval('.fabi-quote-question blockquote', node => node.textContent), /API REST/);
    await page.click('[aria-label="Annuler la sélection"]');
    await page.click('.fabi-context-button');
    await page.waitForSelector('.fabi-context-inspector');
    assert.ok(await page.evaluate(() => window.assistCheck.model.ideContext.openFiles.some(file => file.path.endsWith('assist-harness.ts'))));
    assert.ok(await page.evaluate(() => window.assistCheck.model.ideContext.changes.length > 0));
    await page.click('[aria-label="Fermer le panneau"]');
    await page.click('[aria-label=Discussions]');
    assert.ok(await page.$('.fabi-thread-row'));
    await page.click('[aria-label="Fermer le panneau"]');
    if (process.env.FABI_CAPTURE) await page.screenshot({ path: '/tmp/fabi-assist-terminal-lesson-fixture.png' });
    await page.$eval('.fabi-assist-back', button => button.click());
    assert.equal(await page.$('.fabi-assist-surface'), null);
    assert.equal(await page.evaluate(async () => (await window.assistCheck.terminal.processId) === window.assistCheck.pid), true, 'Same live PTY after returning to CLI');
    assert.equal(await page.evaluate(() => window.assistCheck.terminal.node.querySelector('.xterm').inert), false);
    // Switching remains immediate even if provider/notebook preparation is stalled.
    assert.equal(await page.evaluate(async () => {
        const s = window.assistCheck, model = s.contribution.model;
        const prepare = model.prepare;
        let release;
        model.prepare = () => new Promise(resolve => { release = resolve; });
        try {
            const opened = s.contribution.open(false, s.terminal);
            const immediate = !!s.contribution.surface;
            s.contribution.closeSurface();
            release(); await opened;
            return immediate && !s.contribution.surface;
        } finally { model.prepare = prepare; }
    }), true, 'Terminal/Assist switch must not wait for the provider or reopen after returning');
    await page.evaluate(() => window.assistCheck.terminal.node.querySelector('.fabi-terminal-assist [aria-label="Assist"]').click());
    await page.waitForSelector('.fabi-assist-surface');
    assert.equal(await page.evaluate(async () => (await window.assistCheck.terminal.processId) === window.assistCheck.pid), true);
    await page.click('.fabi-assist-back');
    assert.equal(await page.evaluate(() => window.assistCheck.terminal.node.querySelector('.fabi-terminal-assist [aria-label="Terminal"]').getAttribute('aria-pressed')), 'true');

    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluate(async () => { await window.assistCheck.contribution.ask(); });
    await page.waitForSelector('.fabi-assist-popover');
    assert.equal(await page.$eval('.fabi-assist-popover', node => getComputedStyle(node).animationName), 'none');
    await page.keyboard.press('Escape');
    console.log('Assist UI passed: selection cue, Option key, anchored palette, reply selection, IDE context inspector, editor, navigator file/folder and terminal long press with captured context, drag cancellation, answer, no extra tab, same terminal process, return to CLI, reduced motion. Teaching content was a renderer-only fixture.');
} finally {
    if (page) await page.evaluate(() => {
        const s = window.assistCheck;
        if (s) {
            s.contribution.hide(false); s.contribution.closeSurface(); s.terminal?.dispose();
            if (s.terminalBackup) { Object.assign(s.model, s.terminalBackup); s.model.changed.fire(); s.model = s.contextModel; }
            Object.assign(s.model, { book: s.book, account: s.account, draft: s.draft, replySerial: s.serial, thread: s.thread, context: s.context, busy: undefined });
            s.model.changed.fire(); delete window.assistCheck;
        }
    }).catch(() => {});
    browser.disconnect();
}
