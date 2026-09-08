// Parse two self-contained method bodies and execute their JavaScript directly.
// No TypeScript program, emission, bundling or IDE startup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const file = path.resolve(__dirname, '../fabi-branding/src/browser/shell/fabi-activity-bar.tsx');
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
assert.equal(source.parseDiagnostics.length, 0);
const constants = source.statements.filter(ts.isVariableStatement)
    .flatMap(statement => statement.declarationList.declarations)
    .map(declaration => `const ${declaration.name.getText(source)} = ${declaration.initializer.getText(source)};`).join('\n');
const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'FabiActivityBar');
const body = name => declaration.members.find(member => member.name?.getText(source) === name).body.getText(source);
const visibleCount = new Function(`${constants}\nreturn function(total, width) ${body('visibleCount')}`)();
const dimensions = new Function(`${constants}\nreturn { ITEM, GAP, PAD };`)();
const slot = dimensions.ITEM + dimensions.GAP;
const base = 2 * dimensions.PAD - dimensions.GAP;
for (const total of [0, 1, 4, 8, 20, 100]) {
    for (const width of [52, 90, 166, 224, 320, 640]) {
        const visible = visibleCount(total, width);
        assert.ok(visible >= 0 && visible <= total);
        const items = visible + (visible < total ? 1 : 0);
        assert.ok(items * slot + base <= width, `${total} views overflow ${width}px`);
    }
}
assert.equal(visibleCount(8, 0), 8, 'unknown width retains initial render');
const position = new Function('window', `return function() ${body('overflowPosition')}`);
for (const width of [320, 640, 1440]) {
    const calculate = position({ innerWidth: width, innerHeight: 600 });
    for (const left of [8, width / 2, width - 40]) {
        const result = calculate.call({ node: { querySelector: () => ({ getBoundingClientRect: () => ({ left, top: 530 }) }) } });
        assert.ok(result.left >= 8);
        assert.ok(result.left + result.width <= width - 8);
        assert.ok(600 - result.bottom - result.maxHeight >= 8);
    }
}
console.log('Dock source geometry: 36 capacity cases and 9 popup positions passed. React and Lumino integration not tested.');
