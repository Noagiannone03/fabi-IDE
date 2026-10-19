const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { refreshProjectIndex, retrieveProjectKnowledge } = require('../lib/node/assist/assist-project-index');

test('persistent inventory exceeds old cap, resolves syntax, excludes secrets and updates changed/deleted files', async t => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-index-'));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const root = path.join(home, 'project'); await fs.mkdir(root);
    execFileSync('git', ['init', '-q', root]);
    await fs.writeFile(path.join(root, '.gitignore'), 'ignored/\n');
    await fs.mkdir(path.join(root, 'ignored')); await fs.writeFile(path.join(root, 'ignored', 'private.ts'), 'const password = "private"');
    await fs.writeFile(path.join(root, '.env'), 'TOKEN=secret');
    await fs.writeFile(path.join(root, 'outside.ts'), 'export const external = 1');
    await fs.symlink('/etc/passwd', path.join(root, 'escape.ts'));
    await Promise.all(Array.from({ length: 310 }, (_, n) => fs.writeFile(path.join(root, `module-${n}.ts`), `export function operation${n}() { return ${n}; }`)));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19' } }));
    const first = await refreshProjectIndex(root, home);
    assert.ok(first.files.length > 300);
    assert.ok(!first.files.some(f => /\.env|private|escape/.test(f.path)));
    assert.equal(first.files.find(f => f.path === 'module-0.ts').symbols[0].name, 'operation0');
    const second = await refreshProjectIndex(root, home);
    assert.deepEqual(second.files, first.files); assert.equal(second.changes.length, 0);
    await fs.writeFile(path.join(root, 'module-0.ts'), 'export function authenticate() { return true; }');
    await fs.rm(path.join(root, 'module-1.ts'));
    const third = await refreshProjectIndex(root, home);
    assert.ok(third.changes.some(c => c.path === 'module-0.ts' && c.kind === 'modified'));
    assert.ok(third.changes.some(c => c.path === 'module-1.ts' && c.kind === 'removed-from-inventory'));
    const found = await retrieveProjectKnowledge(root, 'authenticate', home);
    assert.equal(found.matches[0].path, 'module-0.ts');
    assert.ok(found.matches[0].hash); assert.ok(found.coverage.technologies.includes('react'));
    assert.ok(found.matches.length <= 8);
});

test('non-Git worktrees retain coverage and do not follow symlinks or generated dependencies', async t => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-index-'));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const root = path.join(home, 'project'); await fs.mkdir(root);
    await fs.mkdir(path.join(root, 'node_modules')); await fs.writeFile(path.join(root, 'node_modules', 'x.js'), 'private');
    await fs.writeFile(path.join(root, 'a.ts'), 'import { x } from "./b"; export const a = x;');
    await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
    await fs.symlink(root, path.join(root, 'cycle'));
    const index = await refreshProjectIndex(root, home);
    assert.equal(index.files.length, 2); assert.equal(index.files.find(f => f.path === 'binary').state, 'binary');
    assert.deepEqual(index.files.find(f => f.path === 'a.ts').imports, ['./b']);
});

test('recommendations require fresh verified changes and suppress already explained files', () => {
    const { learningOpportunity } = require('../lib/common/fabi-learning-opportunity');
    const now = 2000000;
    const knowledge = { phase: 'ready', changes: [{ path: 'a.ts', kind: 'modified', at: now - 10 }, { path: 'package.json', kind: 'modified', at: now - 20 }] };
    assert.equal(learningOpportunity(knowledge, undefined, now).path, 'package.json');
    const book = { turns: [{ at: now, context: {}, reply: { sources: [{ path: 'package.json' }] } }] };
    assert.equal(learningOpportunity(knowledge, book, now).path, 'a.ts');
    assert.equal(learningOpportunity(knowledge, undefined, now + 1800001), undefined);
    assert.equal(learningOpportunity({ ...knowledge, phase: 'indexing' }, undefined, now), undefined);
});

test('real Git branch switches invalidate symbols while worktrees keep separate memories', async t => {
    const { projectDirectory } = require('../lib/node/assist/assist-store');
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-branches-')));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const root = path.join(home, 'project'), other = path.join(home, 'worktree');
    await fs.mkdir(root);
    const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=Fabi test', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    await fs.writeFile(path.join(root, 'entry.ts'), 'export function mainFeature() { return 1; }');
    git('add', '.'); git('commit', '-qm', 'Fixture main');
    const main = await refreshProjectIndex(root, home);
    git('checkout', '-qb', 'feature');
    await fs.writeFile(path.join(root, 'entry.ts'), 'export function newFeature() { return 2; }');
    git('add', '.'); git('commit', '-qm', 'Fixture feature');
    const feature = await refreshProjectIndex(root, home);
    assert.notEqual(feature.revision, main.revision);
    assert.equal(feature.files.find(file => file.path === 'entry.ts').symbols[0].name, 'newFeature');
    git('worktree', 'add', '-q', other, 'main');
    const tree = await refreshProjectIndex(other, home);
    assert.equal(tree.files.find(file => file.path === 'entry.ts').symbols[0].name, 'mainFeature');
    assert.notEqual((await projectDirectory(root, home)).memory, (await projectDirectory(other, home)).memory);
    git('worktree', 'remove', other);
    git('checkout', '-q', 'main');
    const restored = await refreshProjectIndex(root, home);
    assert.equal(restored.revision, main.revision);
    assert.ok(restored.changes.some(change => change.symbolsChanged?.includes('mainFeature')));
});

test('a quiet project without conventional entry filenames offers real source discovery', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fabi-discovery-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, 'session-service.ts'), 'export function recognizeUser(id: string) { return id; }');
    const { knowledgeSummary } = require('../lib/node/assist/assist-project-index');
    const { learningOpportunity } = require('../lib/common/fabi-learning-opportunity');
    const index = await refreshProjectIndex(root, path.join(root, '.memory'));
    const knowledge = knowledgeSummary(index); knowledge.changes = [];
    assert.deepEqual(knowledge.modules.flatMap(module => module.entryPoints), []);
    const opportunity = learningOpportunity(knowledge, { turns: [], concepts: [] });
    assert.equal(opportunity.path, 'session-service.ts');
    assert.match(opportunity.question, /Ne prétends pas que l’agent travaille dessus/);
    assert.equal(learningOpportunity(knowledge, { concepts: [], turns: [{ at: Date.now(), context: {}, reply: { sources: [{ path: 'session-service.ts' }] } }] }), undefined);
});
