import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { verifyDesktopUpdateConfig } from './verify-desktop-update-config.mjs';

const expected = Object.freeze({
    url: 'https://server.undefinedstudio.fr/fabi-updates/stable',
    channel: 'stable'
});

function writeConfig(overrides = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'fabi-update-config-test-'));
    const config = join(directory, 'app-update.yml');
    writeFileSync(config, YAML.stringify({
        provider: 'generic',
        ...expected,
        useMultipleRangeRequest: false,
        updaterCacheDirName: 'fabi-updater',
        ...overrides
    }));
    return config;
}

test('accepts the qualified generic feed and Windows publisher', () => {
    const config = writeConfig({ publisherName: ['undefined studio'] });
    const value = verifyDesktopUpdateConfig({ config, ...expected, publisher: 'undefined studio' });
    assert.equal(value.provider, 'generic');
});

test('rejects another origin, channel, or Windows signing identity', () => {
    assert.throws(
        () => verifyDesktopUpdateConfig({ config: writeConfig({ url: 'https://example.invalid' }), ...expected }),
        /unexpected update URL/u
    );
    assert.throws(
        () => verifyDesktopUpdateConfig({ config: writeConfig({ channel: 'beta' }), ...expected }),
        /unexpected update channel/u
    );
    assert.throws(
        () => verifyDesktopUpdateConfig({ config: writeConfig({ publisherName: 'attacker' }), ...expected, publisher: 'undefined studio' }),
        /does not pin publisher/u
    );
});
