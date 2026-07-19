'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { FabiCodePartAccumulator } = require('../lib/node/fabi-code-part-stream');

test('adapts OpenCode 1.15 delta events to cumulative Theia parts', () => {
    const stream = new FabiCodePartAccumulator();
    stream.remember({
        sessionId: 'ses_1', messageId: 'msg_1', partId: 'part_1', type: 'reasoning', text: ''
    });
    const first = stream.append({
        sessionId: 'ses_1', messageId: 'msg_1', partId: 'part_1', field: 'text', delta: 'IDE-'
    });
    const second = stream.append({
        sessionId: 'ses_1', messageId: 'msg_1', partId: 'part_1', field: 'text', delta: 'SWARM-OK'
    });
    assert.equal(first.text, 'IDE-');
    assert.equal(second.text, 'IDE-SWARM-OK');
    assert.equal(second.type, 'reasoning');
});

test('ignores non-text deltas and releases session state at turn completion', () => {
    const stream = new FabiCodePartAccumulator();
    stream.remember({ sessionId: 'ses_1', messageId: 'msg_1', partId: 'part_1', type: 'text', text: 'old' });
    assert.equal(stream.append({
        sessionId: 'ses_1', messageId: 'msg_1', partId: 'part_1', field: 'metadata', delta: 'x'
    }), undefined);
    stream.clearSession('ses_1');
    const next = stream.append({
        sessionId: 'ses_1', messageId: 'msg_1', partId: 'part_1', field: 'text', delta: 'new'
    });
    assert.equal(next.text, 'new');
    assert.equal(next.type, 'text');
});
