const { test } = require('node:test');
const assert = require('node:assert/strict');
const { migrateProjectTreeState } = require('../lib/common/fabi-project-tree-state');
test('legacy workspace flattens code, drops agent nodes, and preserves native leaves and expansion', () => {
    const leaf = { id: 'root:/src/main.ts', name: 'main.ts', selected: true };
    const directory = { id: 'root:/src', expanded: true, children: [leaf] };
    const saved = { id: 'workspace', children: [{ id: 'root', expanded: true, children: [
        { id: 'root#agents', fabiSection: 'agents', children: [{ id: 'agent' }] },
        { id: 'root#code', fabiSection: 'code', children: [directory] }
    ] }] };
    const migrated = migrateProjectTreeState(saved);
    assert.deepEqual(migrated.children[0].children, [directory]);
    assert.equal('children' in migrated.children[0].children[0].children[0], false);
    assert.equal(saved.children[0].children.length, 2, 'Does not mutate saved data');
    assert.deepEqual(migrateProjectTreeState(migrated), migrated, 'Idempotent');
    assert.deepEqual(migrateProjectTreeState({ id: 'root:/#agents' }), { id: 'root:/#agents' });
});
