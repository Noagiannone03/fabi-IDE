import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { prepareDesktopUpdateRelease } from './desktop-update-release.mjs';

function sha512(content) {
    return createHash('sha512').update(content).digest('base64');
}

function makeFixture() {
    const root = mkdtempSync(join(tmpdir(), 'fabi-desktop-release-test-'));
    const mac = join(root, 'mac');
    const windows = join(root, 'windows');
    mkdirSync(mac);
    mkdirSync(windows);
    const version = '0.1.11';
    const releaseDate = '2026-08-11T12:00:00.000Z';

    const macFiles = [
        ['Fabi-0.1.11-arm64-mac.zip', Buffer.from('signed notarized mac zip')],
        ['Fabi-0.1.11-arm64.dmg', Buffer.from('signed notarized mac dmg')]
    ];
    const windowsFiles = [
        ['Fabi-Setup-0.1.11-x64.exe', Buffer.from('authenticode windows installer')]
    ];
    for (const [directory, files] of [[mac, macFiles], [windows, windowsFiles]]) {
        for (const [name, content] of files) {
            writeFileSync(join(directory, name), content);
            writeFileSync(join(directory, `${name}.blockmap`), `blockmap for ${name}`);
        }
    }

    const metadata = files => ({
        version,
        files: files.map(([url, content]) => ({ url, sha512: sha512(content), size: content.length })),
        path: files[0][0],
        sha512: sha512(files[0][1]),
        releaseDate
    });
    writeFileSync(join(mac, 'stable-mac.yml'), YAML.stringify(metadata(macFiles)));
    writeFileSync(join(windows, 'stable.yml'), YAML.stringify(metadata(windowsFiles)));
    return { root, mac, windows, output: join(root, 'release'), version };
}

test('assembles an immutable two-platform bundle with metadata published last', async () => {
    const fixture = makeFixture();
    const manifest = await prepareDesktopUpdateRelease({
        macDir: fixture.mac,
        windowsDir: fixture.windows,
        outputDir: fixture.output,
        version: fixture.version
    });
    assert.equal(manifest.version, fixture.version);
    assert.deepEqual(manifest.publishOrder.slice(-2), ['stable-mac.yml', 'stable.yml']);
    assert.match(readFileSync(join(fixture.output, 'SHA256SUMS'), 'ascii'), /stable-mac\.yml/u);
    assert.deepEqual(JSON.parse(readFileSync(join(fixture.output, 'release-manifest.json'), 'utf8')), manifest);
});

test('rejects an artifact whose bytes do not match electron-builder metadata', async () => {
    const fixture = makeFixture();
    writeFileSync(join(fixture.windows, 'Fabi-Setup-0.1.11-x64.exe'), 'tampered');
    await assert.rejects(
        prepareDesktopUpdateRelease({ macDir: fixture.mac, windowsDir: fixture.windows, outputDir: fixture.output, version: fixture.version }),
        /bytes but metadata declares|SHA-512 does not match/u
    );
});

test('rejects a traversal path before copying any release', async () => {
    const fixture = makeFixture();
    const metadataPath = join(fixture.windows, 'stable.yml');
    const metadata = YAML.parse(readFileSync(metadataPath, 'utf8'));
    metadata.files[0].url = '../escape.exe';
    writeFileSync(metadataPath, YAML.stringify(metadata));
    await assert.rejects(
        prepareDesktopUpdateRelease({ macDir: fixture.mac, windowsDir: fixture.windows, outputDir: fixture.output, version: fixture.version }),
        /must not contain a directory/u
    );
});

test('rejects a symlinked artifact', async () => {
    const fixture = makeFixture();
    const metadataPath = join(fixture.windows, 'stable.yml');
    const metadata = YAML.parse(readFileSync(metadataPath, 'utf8'));
    metadata.files[0].url = 'linked.exe';
    const target = join(fixture.windows, 'Fabi-Setup-0.1.11-x64.exe');
    symlinkSync(target, join(fixture.windows, 'linked.exe'));
    metadata.files[0].size = readFileSync(target).length;
    metadata.files[0].sha512 = sha512(readFileSync(target));
    metadata.path = 'linked.exe';
    metadata.sha512 = metadata.files[0].sha512;
    writeFileSync(metadataPath, YAML.stringify(metadata));
    await assert.rejects(
        prepareDesktopUpdateRelease({ macDir: fixture.mac, windowsDir: fixture.windows, outputDir: fixture.output, version: fixture.version }),
        /regular file, not a symlink/u
    );
});

test('rejects a version mismatch and leaves no visible output', async () => {
    const fixture = makeFixture();
    await assert.rejects(
        prepareDesktopUpdateRelease({ macDir: fixture.mac, windowsDir: fixture.windows, outputDir: fixture.output, version: '0.1.12' }),
        /does not equal 0\.1\.12/u
    );
    assert.throws(() => readFileSync(join(fixture.output, 'release-manifest.json')), /ENOENT/u);
});

test('refuses to overwrite an existing release directory', async () => {
    const fixture = makeFixture();
    mkdirSync(fixture.output);
    await assert.rejects(
        prepareDesktopUpdateRelease({ macDir: fixture.mac, windowsDir: fixture.windows, outputDir: fixture.output, version: fixture.version }),
        /output already exists/u
    );
});
