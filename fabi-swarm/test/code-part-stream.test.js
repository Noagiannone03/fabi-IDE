'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { FabiCodePartAccumulator } = require('../lib/node/fabi-code-part-stream');
const { FabiCodeServiceImpl } = require('../lib/node/fabi-code-service');

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

test('relays reasoning, live tool states and real file edits from OpenCode events', () => {
    const service = new FabiCodeServiceImpl();
    const parts = [];
    const files = [];
    const engineEvents = [];
    const statuses = [];
    service.addClient({
        onServerStatus: status => statuses.push(status),
        onPart: part => parts.push(part),
        onFileEdited: (_sessionId, path) => files.push(path),
        onEngineEvent: event => engineEvents.push(event),
        onTurnDone() {}, onPermissionAsked() {}, onQuestionAsked() {},
        onUserMessage() {}, onTurnQueueChanged() {}
    });
    service.turnWaiters.set('ses_1', {
        resolve() {},
        accepted: true,
        observedActive: false,
        previousAssistantIds: new Set(),
        goalMode: false,
        goalContinuationPending: false,
        goalContinuationObservedActive: false
    });
    service.turnPhases.set('ses_1', 'preparing');

    const emit = (type, properties) => service.handleEvent(JSON.stringify({ type, properties }));
    emit('message.part.updated', {
        sessionID: 'ses_1',
        part: {
            id: 'reason_1', messageID: 'msg_1', type: 'reasoning', text: 'Analyse'
        }
    });
    emit('message.part.delta', {
        sessionID: 'ses_1', messageID: 'msg_1', partID: 'reason_1', field: 'text', delta: ' en cours'
    });
    emit('message.part.updated', {
        sessionID: 'ses_1',
        part: {
            id: 'tool_1', messageID: 'msg_1', type: 'tool', tool: 'edit', callID: 'call_1',
            state: { status: 'running', input: { filePath: '/workspace/file.ts' }, title: 'file.ts' }
        }
    });
    emit('message.part.updated', {
        sessionID: 'ses_1',
        part: {
            id: 'tool_1', messageID: 'msg_1', type: 'tool', tool: 'edit', callID: 'call_1',
            state: { status: 'completed', output: 'Done', title: 'file.ts' }
        }
    });
    emit('file.edited', { sessionID: 'ses_1', path: '/workspace/file.ts' });

    assert.deepEqual(parts.map(part => ({
        type: part.type,
        text: part.text,
        tool: part.tool,
        state: part.state,
        title: part.title
    })), [
        { type: 'reasoning', text: 'Analyse', tool: undefined, state: undefined, title: undefined },
        { type: 'reasoning', text: 'Analyse en cours', tool: undefined, state: undefined, title: undefined },
        { type: 'tool', text: undefined, tool: 'edit', state: 'running', title: 'file.ts' },
        { type: 'tool', text: undefined, tool: 'edit', state: 'completed', title: 'file.ts' }
    ]);
    assert.deepEqual(files, ['/workspace/file.ts']);
    assert.equal(engineEvents.length, 5);
    assert.equal(service.turnWaiters.get('ses_1').observedActive, true);
    assert.equal(service.turnPhases.get('ses_1'), 'generating');
    assert.equal(statuses.at(-1).activity, 'generating');
});
