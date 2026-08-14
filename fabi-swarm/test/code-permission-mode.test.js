'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    automaticPermissionReply,
    FABI_CODE_DEFAULT_PERMISSION_MODE,
    normalizeFabiCodePermissionMode,
    resolveOpenCodeRootSessionId
} = require('../lib/common/fabi-code-permission-mode');
const { FabiCodeServiceImpl } = require('../lib/node/fabi-code-service');

test('defaults permissions to explicit user approval', () => {
    assert.equal(FABI_CODE_DEFAULT_PERMISSION_MODE, 'ask');
    assert.equal(normalizeFabiCodePermissionMode(undefined), 'ask');
    assert.equal(normalizeFabiCodePermissionMode('unexpected'), 'ask');
    assert.equal(normalizeFabiCodePermissionMode('auto'), 'auto');
});

test('treats auto mode as persistent YOLO approval for the whole build chat', () => {
    assert.equal(automaticPermissionReply('auto', 'build'), 'once');
    assert.equal(automaticPermissionReply('auto', 'general'), 'once');
    assert.equal(automaticPermissionReply('ask', 'build'), undefined);
    assert.equal(automaticPermissionReply('auto', 'plan'), undefined);
});

test('maps nested OpenCode task sessions back to their root chat', () => {
    const sessions = [
        { id: 'root' },
        { id: 'child', parentID: 'root' },
        { id: 'grandchild', parentID: 'child' }
    ];
    assert.equal(resolveOpenCodeRootSessionId('root', sessions), 'root');
    assert.equal(resolveOpenCodeRootSessionId('child', sessions), 'root');
    assert.equal(resolveOpenCodeRootSessionId('grandchild', sessions), 'root');
});

test('does not escape to another chat through malformed parent graphs', () => {
    assert.equal(resolveOpenCodeRootSessionId('unknown', []), 'unknown');
    assert.equal(resolveOpenCodeRootSessionId('a', [
        { id: 'a', parentID: 'b' },
        { id: 'b', parentID: 'a' }
    ]), 'a');
    assert.equal(resolveOpenCodeRootSessionId('deep', [
        { id: 'deep', parentID: 'parent' },
        { id: 'parent' }
    ], 1), 'deep');
});

test('Ask edits relays the real permission and its explicit reply to OpenCode', async () => {
    const service = new FabiCodeServiceImpl();
    const asked = [];
    const requests = [];
    service.addClient({
        onServerStatus() {}, onPart() {}, onTurnDone() {}, onFileEdited() {},
        onQuestionAsked() {}, onUserMessage() {}, onEngineEvent() {}, onTurnQueueChanged() {},
        onPermissionAsked: permission => asked.push(permission)
    });
    service.sessionParents.set('root-session', undefined);
    service.permissionPolicies.set('root-session', { mode: 'ask', agent: 'build' });
    service.http = async (method, path, body, directory) => {
        requests.push({ method, path, body, directory });
        return '{}';
    };

    await service.publishPermission({
        id: 'permission-1',
        sessionID: 'root-session',
        permission: 'edit',
        patterns: ['/workspace/a/file.ts'],
        tool: { callID: 'call-1' }
    }, '/workspace/a');

    assert.deepEqual(asked, [{
        id: 'permission-1',
        sessionId: 'root-session',
        rootSessionId: 'root-session',
        title: 'edit',
        detail: '/workspace/a/file.ts',
        callId: 'call-1'
    }]);
    assert.deepEqual(requests, []);

    await service.replyPermission('permission-1', 'once', '/workspace/a');
    assert.deepEqual(requests, [{
        method: 'POST',
        path: '/permission/permission-1/reply',
        body: { reply: 'once' },
        directory: '/workspace/a'
    }]);
});

test('YOLO approves nested tools once without leaking into another chat', async () => {
    const service = new FabiCodeServiceImpl();
    const asked = [];
    const requests = [];
    service.addClient({
        onServerStatus() {}, onPart() {}, onTurnDone() {}, onFileEdited() {},
        onQuestionAsked() {}, onUserMessage() {}, onEngineEvent() {}, onTurnQueueChanged() {},
        onPermissionAsked: permission => asked.push(permission)
    });
    service.sessionParents.set('auto-root', undefined);
    service.sessionParents.set('auto-child', 'auto-root');
    service.sessionParents.set('ask-root', undefined);
    service.permissionPolicies.set('auto-root', { mode: 'auto', agent: 'build' });
    service.permissionPolicies.set('ask-root', { mode: 'ask', agent: 'build' });
    service.http = async (method, path, body, directory) => {
        requests.push({ method, path, body, directory });
        return '{}';
    };

    await service.publishPermission({
        id: 'permission-auto',
        sessionID: 'auto-child',
        permission: 'bash',
        metadata: { command: 'npm test' }
    }, '/workspace/auto');
    await service.publishPermission({
        id: 'permission-ask',
        sessionID: 'ask-root',
        permission: 'edit',
        patterns: ['/workspace/ask/file.ts']
    }, '/workspace/ask');

    assert.deepEqual(requests, [{
        method: 'POST',
        path: '/permission/permission-auto/reply',
        body: { reply: 'once' },
        directory: '/workspace/auto'
    }]);
    assert.deepEqual(asked, [{
        id: 'permission-ask',
        sessionId: 'ask-root',
        rootSessionId: 'ask-root',
        title: 'edit',
        detail: '/workspace/ask/file.ts',
        callId: undefined
    }]);
});
