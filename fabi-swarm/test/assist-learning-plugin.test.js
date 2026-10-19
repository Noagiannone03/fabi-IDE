const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { learningPluginContext } = require('../lib/node/assist/assist-learning-plugin');
const { teachingPrompt } = require('../lib/node/assist/assist-prompts');
const root = path.join(__dirname, '../src/node/assist/vendor/learning-output-style');
const request = mode => ({ id: 'fixture', project: '/fixture', mode, question: 'Explique', context: {} });

test('the complete pinned plugin and its extracted prompt retain upstream integrity', () => {
    const source = JSON.parse(fs.readFileSync(path.join(root, 'SOURCE.json'), 'utf8'));
    for (const [file, checksum] of Object.entries(source.files)) {
        assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), checksum.sha256, file);
        assert.match(checksum.gitBlob, /^[a-f0-9]{40}$/);
    }
    const script = fs.readFileSync(path.join(root, 'hooks-handlers/session-start.sh'), 'utf8');
    const original = JSON.parse(script.split("cat << 'EOF'\n")[1].split('\nEOF')[0]);
    const extracted = JSON.parse(fs.readFileSync(path.join(root, 'context.json'), 'utf8'));
    assert.deepEqual(extracted, original);
    assert.ok(teachingPrompt(request('learn')).includes(original.hookSpecificOutput.additionalContext));
});

test('full learning plugin is scoped to learning and adapts correction to Fabi permissions', () => {
    for (const mode of ['explore', 'brief', 'review', 'assist']) {
        assert.equal(learningPluginContext(request(mode)), '');
        assert.ok(!teachingPrompt(request(mode)).includes('<learning_output_style_plugin>'));
    }
    const feedback = learningPluginContext({ ...request('learn'), answerTo: 'exercise' });
    assert.match(feedback, /ne crées ni ne modifies/);
    assert.match(feedback, /uniquement activeExercise avec assessment/);
});
