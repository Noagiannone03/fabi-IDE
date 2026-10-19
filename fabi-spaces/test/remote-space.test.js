const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRemoteSpace } = require('../lib/common/remote-space');
const { parsePersistedSpaces } = require('../lib/common/persisted-spaces');
const { buildRemoteFrontendUrl } = require('../lib/electron-main/frontend-url');

test('SSH aliases, host ports and trimmed users are accepted without credentials', () => {
    assert.deepEqual(parseRemoteSpace({ host: ' staging:2222 ', user: ' debian ', password: 'never-persist' }),
        { host: 'staging:2222', user: 'debian' });
    for (const host of ['-oProxyCommand=x', 'user@host', 'host;touch x', 'host:0', 'host:65536', 'ho\nst']) {
        assert.equal(parseRemoteSpace({ host, user: 'debian' }), undefined, host);
    }
});

test('a host awaiting folder selection persists as remote and opens without a local workspace', () => {
    const state = parsePersistedSpaces({ spaces: [
        { id: 'remote', workspacePath: '', remote: { host: 'server', user: 'debian' } }
    ], activeId: 'remote' });
    assert.equal(state.activeId, 'remote');
    assert.equal(state.spaces[0].remote.host, 'server');
    const url = new URL(buildRemoteFrontendUrl({ frontendHtmlPath: '/app/index.html', preloadPath: '/app/preload.js', backendPort: 1234 }, '', 5678));
    assert.equal(url.hash, '#!empty');
    assert.equal(url.searchParams.get('localPort'), '1234');
});

test('remote persistence drops malformed entries without opening their paths locally', () => {
    const state = parsePersistedSpaces({ spaces: [null, { id: 'local', workspacePath: '/tmp' },
        { id: 'invalid', workspacePath: '/etc', remote: { host: 'bad host', user: 'root' } },
        { id: 'remote', workspacePath: '/home/debian/project', remote: { host: 'server', user: 'debian', password: 'never-persist' } },
        { id: 'maestro', workspacePath: '', kind: 'maestro' }], activeId: 'invalid' });
    assert.deepEqual(state.spaces.map(s => s.id), ['local', 'remote']);
    assert.equal(state.activeId, undefined);
    assert.equal(JSON.stringify(state).includes('never-persist'), false);
});

test('remote URL retains the local control backend and correctly encodes project paths', () => {
    const url = new URL(buildRemoteFrontendUrl({ frontendHtmlPath: '/app/index.html', preloadPath: '/app/preload.js', backendPort: 1234 }, '/home/user/my project#one', 5678));
    assert.equal(url.searchParams.get('port'), '5678');
    assert.equal(url.searchParams.get('localPort'), '1234');
    assert.equal(decodeURI(url.hash.slice(1)), '/home/user/my project#one');
    assert.equal(url.protocol, 'file:');
});
