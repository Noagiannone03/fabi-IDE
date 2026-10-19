const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { readCliContext, assertCliProcess } = require('../lib/node/assist/assist-cli-context');
const { prepareCliPrompt, cliPaste, CLI_TEACHING_PREAMBLE } = require('../lib/common/fabi-assist-dispatch');

test('exact Claude and Codex histories cannot cross projects or fall back to another session', async t => {
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-cli-context-')));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const project = path.join(home, 'project'); const other = path.join(home, 'other');
    await fs.mkdir(project); await fs.mkdir(other);
    for (const source of ['claude', 'codex']) {
        const folder = source === 'claude' ? path.join(home, '.claude/projects/encoded') : path.join(home, '.codex/sessions/2026/10/15');
        await fs.mkdir(folder, { recursive: true });
        const rows = source === 'claude' ? [
            { sessionId: 'session-1', cwd: project, type: 'user', message: { role: 'user', content: 'Build a counter' } },
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Plan: add one function' }, { type: 'thinking', thinking: 'hidden' }] } }
        ] : [{ type: 'session_meta', payload: { id: 'session-1', cwd: project } },
            { type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: 'Build a counter' }] } },
            { type: 'response_item', payload: { role: 'assistant', content: [{ type: 'output_text', text: 'Plan: add one function' }] } }];
        await fs.writeFile(path.join(folder, source === 'claude' ? 'session-1.jsonl' : 'rollout-date-session-1.jsonl'), rows.map(x => JSON.stringify(x)).join('\n') + '\n{"partial":');
        const context = await readCliContext(project, source, 'session-1', home);
        assert.equal(context.status, 'available'); assert.equal(context.messages.length, 2);
        assert.equal(context.messages[1].text, 'Plan: add one function');
        assert.equal((await readCliContext(other, source, 'session-1', home)).status, 'unavailable');
        assert.equal((await readCliContext(project, source, 'missing', home)).status, 'unavailable');
        assert.equal((await readCliContext(project, source, undefined, home)).status, 'unbound');
    }
});

test('dispatch preserves literal text, adds a visible teaching contract and rejects terminal controls', async () => {
    const text = 'Explain `$(echo test)`\nThen change the UI';
    const prepared = prepareCliPrompt(text, true);
    assert.equal(prepareCliPrompt(prepared), prepared);
    assert.equal(cliPaste('Texte édité sans ajout'), '\x1b[200~Texte édité sans ajout\x1b[201~\r');
    assert.ok(prepared.endsWith(CLI_TEACHING_PREAMBLE));
    assert.equal(cliPaste(prepared), '\x1b[200~' + prepared + '\x1b[201~\r');
    for (const invalid of ['', '\x1b[201~evil', 'bad\rcommand', 'x'.repeat(16001)]) assert.throws(() => cliPaste(invalid));
    await assert.rejects(assertCliProcess(0, 'codex'));
    await assert.rejects(assertCliProcess(process.pid, 'shell'));
    await assert.rejects(assertCliProcess(process.pid, 'codex'), /plus actif/);
});
