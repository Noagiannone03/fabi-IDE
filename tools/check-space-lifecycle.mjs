import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the production method without starting Electron or altering Spaces.
const source = ts.createSourceFile('manager.ts', readFileSync('fabi-spaces/src/electron-main/space-manager.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const manager = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'SpaceManager');
const method = manager.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'open');
assert.ok(method);
const context = { setTimeout, Promise };
vm.runInNewContext(ts.transpileModule(`globalThis.TestManager = class { ${method.getText(source)} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText, context);

function fixture() {
    const instance = new context.TestManager();
    const spaces = new Map([['a', { id: 'a' }], ['b', { id: 'b' }]]);
    const activations = [];
    const views = new Map([...spaces.keys()].map(id => [id, {
        setVisible() {},
        webContents: { isDestroyed: () => false, focus: () => activations.push(id) }
    }]));
    Object.assign(instance, {
        disposed: false, openSequence: 0, views, viewReady: new WeakMap(),
        store: { get: id => spaces.get(id), getSpaces: () => [...spaces.values()], setActive() {} },
        ensureView() {}, capturePreview: () => Promise.resolve(undefined),
        layout() {}, applyAccent() {}, fadeInView() {}, enforceSuspension() {}, pushState() {}
    });
    let release;
    instance.viewReady.set(views.get('a'), new Promise(resolve => { release = resolve; }));
    return { instance, spaces, activations, release };
}

for (const invalidation of ['removed', 'suspended', 'disposed', 'destroyed']) {
    const { instance, spaces, activations, release } = fixture();
    const pending = instance.open('a');
    if (invalidation === 'removed') spaces.delete('a');
    if (invalidation === 'suspended') instance.views.delete('a');
    if (invalidation === 'disposed') instance.disposed = true;
    if (invalidation === 'destroyed') instance.views.get('a').webContents.isDestroyed = () => true;
    release();
    await pending;
    assert.deepEqual(activations, [], invalidation);
    assert.equal(instance.activeId, undefined, invalidation);
}

const { instance, activations, release } = fixture();
const older = instance.open('a');
await instance.open('b');
release();
await older;
assert.equal(instance.activeId, 'b');
assert.deepEqual(activations, ['b']);
console.log('Space lifecycle: latest request wins; removed, suspended, disposed and destroyed views never activate.');
