const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { learningOpportunity } = require('../lib/common/fabi-learning-opportunity');

// Exercise the actual contribution method, with a clock and DOM boundary only.
// No copy of the invitation algorithm: parse it from the production class.
const source = ts.createSourceFile('assist.tsx', fs.readFileSync(path.join(__dirname, '../src/browser/assist/assist-contribution.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AssistContribution');
const method = declaration.members.find(node => node.name?.getText(source) === 'updatePresence');
const body = ts.transpileModule(`function updatePresence() ${method.body.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
    let now = 100000;
    let serial = 0;
    const timers = new Map();
    const context = { learningOpportunity, Date: { now: () => now }, setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id) };
    const updatePresence = vm.runInNewContext(body + '\nupdatePresence', context);
    const root = { toString: () => '/project', path: { fsPath: () => '/project' } };
    const row = { key: 'codex', widgetId: 'terminal', state: 'working', turnStartedAt: 96000 };
    const button = { dataset: {}, getClientRects: () => [{}], querySelector: () => ({ textContent: '' }) };
    const instance = { model: { workspace: { tryGetRoots: () => [{ resource: root }] }, agents: { rowsFor: () => [row] }, knowledge: new Map([['/project', { phase: 'ready', changes: [], learningFiles: ['session-service.ts'] }]]) }, launchers: new Map([['terminal', button]]), notebooks: new Map(), workingSince: new Map(), invitationsSeen: new Set(), invitationCooldown: 0, presenceReason() {}, updatePresence };
    const advance = at => { now = at; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } };
    return { instance, row, button, timers, advance };
}
test('a turn discovered four seconds late invites at native start + six seconds, without another poll', () => {
    const f = fixture(); f.instance.updatePresence();
    assert.equal(f.button.dataset.invited, undefined);
    assert.equal([...f.timers.values()][0].at, 102000);
    f.advance(102000);
    assert.ok(f.button.dataset.invited);
    assert.equal(f.button.dataset.question.includes('session-service.ts'), true);
});
test('a turn completed before the invitation deadline cancels the scheduled appearance', () => {
    const f = fixture(); f.instance.updatePresence();
    f.advance(101000); f.row.state = 'done'; f.instance.updatePresence(); f.advance(103000);
    assert.equal(f.button.dataset.invited, undefined); assert.equal(f.timers.size, 0);
});
test('a later native turn gets its own deadline instead of reusing the previous generation', () => {
    const f = fixture(); f.instance.updatePresence(); f.advance(102000);
    f.row.state = 'done'; f.instance.updatePresence();
    f.advance(110000); f.row.state = 'working'; f.row.turnStartedAt = 110000; f.instance.updatePresence();
    assert.equal(f.button.dataset.invited, undefined);
    f.advance(116000); assert.ok(f.button.dataset.invited.endsWith(':110000'));
});
test('an offered invitation remains readable after a short turn and expires without opening a lesson', () => {
    const f = fixture(); f.instance.updatePresence(); f.advance(102000);
    const invitation = f.button.dataset.invited;
    f.advance(104600); f.row.state = 'done'; f.instance.updatePresence();
    assert.equal(f.button.dataset.invited, invitation);
    f.advance(127000);
    assert.equal(f.button.dataset.invited, undefined);
    assert.equal(f.instance.surface, undefined);
});
