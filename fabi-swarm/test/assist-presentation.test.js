const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readableAssistMarkdown } = require('../lib/common/fabi-assist-markdown');
const { lessonSchema } = require('../lib/node/assist/assist-learning');

test('repairs escaped prose paragraphs without altering inline or fenced code', () => {
    const text = 'Un signal.\\n\\nPuis un résultat. `"\\n\\n"`\n```js\nconst separator = "\\n\\n";\n```\nFin.\\n\\nSuite.';
    assert.equal(readableAssistMarkdown(text), 'Un signal.\n\nPuis un résultat. `"\\n\\n"`\n```js\nconst separator = "\\n\\n";\n```\nFin.\n\nSuite.');
    for (const code of ['~~~js\n"\\n\\n"\n~~~', '```js\n"\\n\\n"']) assert.equal(readableAssistMarkdown(code), code);
    assert.equal(readableAssistMarkdown('Une ligne\n\nUne autre'), 'Une ligne\n\nUne autre');
    assert.equal(readableAssistMarkdown('Le caractère \\n signifie un retour.'), 'Le caractère \\n signifie un retour.');
});

test('visual orientation survives schema parsing; old replies remain valid', () => {
    const legacy = { title: 'Un signal', explanation: 'Une fonction attend un signal.', sources: [], concepts: [] };
    assert.ok(lessonSchema.safeParse(legacy).success);
    const visual = { ...legacy, takeaway: 'Le point disparaît après le versement.', diagram: { caption: 'L’ordre des animations', steps: [{ title: 'Verser', detail: 'Le versement se termine.' }, { title: 'Retirer', detail: 'Le point disparaît.' }] } };
    assert.equal(lessonSchema.parse(visual).takeaway, visual.takeaway);
    assert.equal(lessonSchema.safeParse({ ...visual, takeaway: 'x'.repeat(361) }).success, false);
});
