'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    automaticPermissionReply,
    FABI_CODE_DEFAULT_PERMISSION_MODE,
    normalizeFabiCodePermissionMode,
    resolveOpenCodeRootSessionId
} = require('../lib/common/fabi-code-permission-mode');

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
