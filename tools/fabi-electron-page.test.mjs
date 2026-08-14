import test from 'node:test';
import assert from 'node:assert/strict';
import { isFabiFrontendUrl } from './fabi-electron-page.mjs';

test('recognizes packaged Fabi frontends on macOS and Windows', () => {
    assert.equal(isFabiFrontendUrl(
        'file:///Applications/Fabi.app/Contents/Resources/app.asar/lib/frontend/index.html?port=1234#/workspace'
    ), true);
    assert.equal(isFabiFrontendUrl(
        'file:///C:/Program%20Files/Fabi/resources/app.asar/lib/frontend/index.html?port=1234#/C:/workspace'
    ), true);
});

test('recognizes the current development Electron frontend', () => {
    assert.equal(isFabiFrontendUrl(
        'file:///Users/fabi/repository/electron-app/lib/frontend/index.html?port=1234#/workspace'
    ), true);
});

test('rejects rails, browser frontends, lookalikes, and invalid URLs', () => {
    assert.equal(isFabiFrontendUrl('file:///Users/fabi/repository/fabi-spaces/resources/rail/rail.html'), false);
    assert.equal(isFabiFrontendUrl('http://127.0.0.1:3000/lib/frontend/index.html'), false);
    assert.equal(isFabiFrontendUrl('file:///tmp/not-app.asar/lib/frontend/index.html'), false);
    assert.equal(isFabiFrontendUrl('not a URL'), false);
});
