const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    ensureSpacesTitleBarPreference,
    resolveUserSettingsPath
} = require('../lib/electron-main/title-bar-preference');

async function withSettings(initial, run) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'fabi-titlebar-'));
    const settingsPath = path.join(directory, 'settings.json');
    try {
        if (initial !== undefined) {
            await writeFile(settingsPath, initial, 'utf8');
        }
        await run(settingsPath);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test('creates a Spaces-compatible setting before the first frontend starts', async () => {
    await withSettings(undefined, async settingsPath => {
        assert.equal(await ensureSpacesTitleBarPreference(settingsPath), 'created');
        assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), {
            'window.titleBarStyle': 'custom'
        });
    });
});

test('migrates native JSONC while preserving comments and other preferences', async () => {
    await withSettings(`{\n  // keep this comment\n  "editor.fontSize": 15,\n  "window.titleBarStyle": "native",\n}\n`, async settingsPath => {
        assert.equal(await ensureSpacesTitleBarPreference(settingsPath), 'updated');
        const migrated = await readFile(settingsPath, 'utf8');
        assert.match(migrated, /keep this comment/);
        assert.match(migrated, /"editor\.fontSize": 15/);
        assert.match(migrated, /"window\.titleBarStyle": "custom"/);
    });
});

test('does not rewrite an already compatible setting', async () => {
    const initial = `{\n  "window.titleBarStyle": "custom"\n}\n`;
    await withSettings(initial, async settingsPath => {
        assert.equal(await ensureSpacesTitleBarPreference(settingsPath), 'unchanged');
        assert.equal(await readFile(settingsPath, 'utf8'), initial);
    });
});

test('leaves invalid user settings untouched', async () => {
    const initial = '{ invalid json';
    await withSettings(initial, async settingsPath => {
        assert.equal(await ensureSpacesTitleBarPreference(settingsPath), 'invalid');
        assert.equal(await readFile(settingsPath, 'utf8'), initial);
    });
});

test('resolves THEIA_CONFIG_DIR consistently with the backend', () => {
    assert.equal(
        resolveUserSettingsPath({ THEIA_CONFIG_DIR: './relative-config' }),
        path.join(process.cwd(), 'relative-config', 'settings.json')
    );
});
