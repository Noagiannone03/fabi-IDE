'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseFabiCodeQuestion } = require('../lib/common/fabi-code-protocol');

test('validates OpenCode question events and preserves interaction semantics', () => {
    assert.deepEqual(parseFabiCodeQuestion({
        id: 'que_1',
        sessionID: 'ses_1',
        questions: [{
            header: 'Approche',
            question: 'Quelle stratégie faut-il appliquer ?',
            options: [
                { label: 'Migration', description: 'Remplacer progressivement' },
                { label: 'Refonte', description: 'Basculer en une fois' }
            ],
            multiple: true
        }],
        tool: { messageID: 'msg_1', callID: 'call_1' }
    }), {
        id: 'que_1',
        sessionId: 'ses_1',
        questions: [{
            header: 'Approche',
            question: 'Quelle stratégie faut-il appliquer ?',
            options: [
                { label: 'Migration', description: 'Remplacer progressivement' },
                { label: 'Refonte', description: 'Basculer en une fois' }
            ],
            multiple: true,
            custom: true
        }],
        callId: 'call_1'
    });
});

test('rejects malformed question events before frontend RPC', () => {
    assert.equal(parseFabiCodeQuestion({
        id: 'que_1',
        sessionID: 'ses_1',
        questions: [{
            header: 'Approche',
            question: 'Choix ?',
            options: [{ label: 'Incomplet' }]
        }]
    }), undefined);
    assert.equal(parseFabiCodeQuestion({
        id: 'que_1',
        sessionID: 'ses_1',
        questions: []
    }), undefined);
});
