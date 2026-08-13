#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
    constants as fsConstants,
    copyFileSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { createReadStream } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ALLOWED_TOP_LEVEL_KEYS = new Set([
    'version', 'files', 'path', 'sha512', 'releaseDate', 'stagingPercentage'
]);
const ALLOWED_FILE_KEYS = new Set(['url', 'sha512', 'size', 'blockMapSize']);
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ +()-]*$/u;

const PLATFORM_SPECS = Object.freeze({
    mac: Object.freeze({
        metadataSuffix: '-mac.yml',
        requiredExtensions: Object.freeze(['.zip', '.dmg'])
    }),
    windows: Object.freeze({
        metadataSuffix: '.yml',
        requiredExtensions: Object.freeze(['.exe'])
    })
});

function invariant(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyKeys(value, allowed, label) {
    for (const key of Object.keys(value)) {
        invariant(allowed.has(key), `${label} contains unsupported key ${JSON.stringify(key)}`);
    }
}

function safeArtifactName(value, label) {
    invariant(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
    invariant(value === basename(value), `${label} must not contain a directory`);
    invariant(!value.includes('/') && !value.includes('\\'), `${label} must not contain a path separator`);
    invariant(value !== '.' && value !== '..' && SAFE_NAME.test(value), `${label} is not a safe artifact name`);
    return value;
}

function strictYaml(path) {
    const document = YAML.parseDocument(readFileSync(path, 'utf8'), {
        prettyErrors: true,
        strict: true,
        uniqueKeys: true
    });
    invariant(document.errors.length === 0, `${basename(path)} is not valid strict YAML: ${document.errors.join('; ')}`);
    const value = document.toJS({ maxAliasCount: 0 });
    invariant(plainObject(value), `${basename(path)} must contain a mapping`);
    return value;
}

async function digestFile(path, algorithm, encoding) {
    const hash = createHash(algorithm);
    await new Promise((resolvePromise, rejectPromise) => {
        const stream = createReadStream(path);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('error', rejectPromise);
        stream.on('end', resolvePromise);
    });
    return hash.digest(encoding);
}

function assertRegularFile(path, label) {
    const stat = lstatSync(path);
    invariant(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular file, not a symlink`);
    return stat;
}

function canonicalBase64Sha512(value, label) {
    invariant(typeof value === 'string', `${label} must be a base64 string`);
    const decoded = Buffer.from(value, 'base64');
    invariant(decoded.length === 64 && decoded.toString('base64') === value, `${label} is not a canonical SHA-512 digest`);
    return value;
}

function endsWithExtension(name, extension) {
    return name.toLocaleLowerCase('en-US').endsWith(extension);
}

async function validatePlatform({ platform, inputDir, version, channel }) {
    const spec = PLATFORM_SPECS[platform];
    const metadataName = `${channel}${spec.metadataSuffix}`;
    const metadataPath = join(inputDir, metadataName);
    assertRegularFile(metadataPath, `${platform} metadata`);
    const metadata = strictYaml(metadataPath);
    assertOnlyKeys(metadata, ALLOWED_TOP_LEVEL_KEYS, metadataName);

    invariant(metadata.version === version, `${metadataName} version ${JSON.stringify(metadata.version)} does not equal ${version}`);
    invariant(Array.isArray(metadata.files) && metadata.files.length > 0, `${metadataName} files must be a non-empty array`);
    invariant(typeof metadata.releaseDate === 'string' && Number.isFinite(Date.parse(metadata.releaseDate)), `${metadataName} releaseDate is invalid`);
    if (metadata.stagingPercentage !== undefined) {
        invariant(Number.isFinite(metadata.stagingPercentage)
            && metadata.stagingPercentage >= 0
            && metadata.stagingPercentage <= 100,
        `${metadataName} stagingPercentage must be between 0 and 100`);
    }

    const names = new Set();
    const files = [];
    for (const [index, entry] of metadata.files.entries()) {
        invariant(plainObject(entry), `${metadataName} files[${index}] must be a mapping`);
        assertOnlyKeys(entry, ALLOWED_FILE_KEYS, `${metadataName} files[${index}]`);
        const name = safeArtifactName(entry.url, `${metadataName} files[${index}].url`);
        invariant(!names.has(name), `${metadataName} contains duplicate artifact ${name}`);
        names.add(name);
        canonicalBase64Sha512(entry.sha512, `${metadataName} ${name} sha512`);
        invariant(Number.isSafeInteger(entry.size) && entry.size > 0, `${metadataName} ${name} size must be a positive integer`);
        if (entry.blockMapSize !== undefined) {
            invariant(Number.isSafeInteger(entry.blockMapSize) && entry.blockMapSize > 0,
                `${metadataName} ${name} blockMapSize must be a positive integer`);
        }

        const sourcePath = join(inputDir, name);
        const stat = assertRegularFile(sourcePath, `${platform} artifact ${name}`);
        invariant(stat.size === entry.size, `${name} is ${stat.size} bytes but metadata declares ${entry.size}`);
        const actualSha512 = await digestFile(sourcePath, 'sha512', 'base64');
        invariant(actualSha512 === entry.sha512, `${name} SHA-512 does not match ${metadataName}`);
        files.push({ name, sourcePath, size: stat.size, sha512: actualSha512 });
    }

    const primaryName = safeArtifactName(metadata.path, `${metadataName} path`);
    const primary = files.find(file => file.name === primaryName);
    invariant(primary !== undefined, `${metadataName} path does not name an entry in files`);
    canonicalBase64Sha512(metadata.sha512, `${metadataName} top-level sha512`);
    invariant(metadata.sha512 === primary.sha512, `${metadataName} top-level sha512 does not match path`);

    for (const extension of spec.requiredExtensions) {
        invariant(files.some(file => endsWithExtension(file.name, extension)), `${metadataName} is missing a ${extension} artifact`);
    }

    const blockmaps = [];
    for (const artifact of files) {
        const blockmapName = `${artifact.name}.blockmap`;
        const blockmapPath = join(inputDir, blockmapName);
        const stat = assertRegularFile(blockmapPath, `${platform} blockmap ${blockmapName}`);
        invariant(stat.size > 0, `${blockmapName} must not be empty`);
        blockmaps.push({ name: blockmapName, sourcePath: blockmapPath, size: stat.size });
    }

    return {
        platform,
        metadataName,
        metadataPath,
        files,
        blockmaps
    };
}

function validateVersion(version) {
    invariant(typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(version),
        `invalid release version ${JSON.stringify(version)}`);
}

function validateChannel(channel) {
    invariant(typeof channel === 'string' && /^[a-z][a-z0-9-]*$/u.test(channel), `invalid channel ${JSON.stringify(channel)}`);
}

export async function prepareDesktopUpdateRelease({ macDir, windowsDir, outputDir, version, channel = 'stable' }) {
    validateVersion(version);
    validateChannel(channel);
    const resolvedOutput = resolve(outputDir);
    const parent = dirname(resolvedOutput);
    mkdirSync(parent, { recursive: true });
    try {
        lstatSync(resolvedOutput);
        throw new Error(`output already exists: ${resolvedOutput}`);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }

    const platforms = await Promise.all([
        validatePlatform({ platform: 'mac', inputDir: resolve(macDir), version, channel }),
        validatePlatform({ platform: 'windows', inputDir: resolve(windowsDir), version, channel })
    ]);

    const publishNames = new Set();
    for (const platform of platforms) {
        for (const file of [...platform.files, ...platform.blockmaps, { name: platform.metadataName }]) {
            invariant(!publishNames.has(file.name), `cross-platform filename collision: ${file.name}`);
            publishNames.add(file.name);
        }
    }

    const staging = join(parent, `.${basename(resolvedOutput)}.tmp-${randomUUID()}`);
    mkdirSync(staging, { recursive: false, mode: 0o755 });
    try {
        const copied = [];
        for (const platform of platforms) {
            for (const file of [...platform.files, ...platform.blockmaps]) {
                const destination = join(staging, file.name);
                copyFileSync(file.sourcePath, destination, fsConstants.COPYFILE_EXCL);
                copied.push(file.name);
            }
        }

        // The metadata files are copied after every payload. Deployment must
        // preserve this order so an updater can never discover a half-uploaded
        // release.
        for (const platform of platforms) {
            copyFileSync(platform.metadataPath, join(staging, platform.metadataName), fsConstants.COPYFILE_EXCL);
            copied.push(platform.metadataName);
        }

        const manifest = {
            schema: 1,
            version,
            channel,
            platforms: Object.fromEntries(platforms.map(platform => [platform.platform, {
                metadata: platform.metadataName,
                artifacts: platform.files.map(file => file.name),
                blockmaps: platform.blockmaps.map(file => file.name)
            }])),
            publishOrder: copied
        };
        writeFileSync(join(staging, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o644
        });

        const checksumNames = [...copied, 'release-manifest.json'].sort((left, right) => left.localeCompare(right, 'en'));
        const checksumLines = [];
        for (const name of checksumNames) {
            checksumLines.push(`${await digestFile(join(staging, name), 'sha256', 'hex')}  ${name}`);
        }
        writeFileSync(join(staging, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`, {
            encoding: 'ascii',
            flag: 'wx',
            mode: 0o644
        });
        renameSync(staging, resolvedOutput);
        return manifest;
    } catch (error) {
        rmSync(staging, { recursive: true, force: true });
        throw error;
    }
}

function parseArguments(argv) {
    const result = { channel: 'stable' };
    for (let index = 0; index < argv.length; index += 2) {
        const flag = argv[index];
        const value = argv[index + 1];
        invariant(flag?.startsWith('--') && value !== undefined, `invalid arguments near ${JSON.stringify(flag)}`);
        switch (flag) {
        case '--mac': result.macDir = value; break;
        case '--windows': result.windowsDir = value; break;
        case '--output': result.outputDir = value; break;
        case '--version': result.version = value; break;
        case '--channel': result.channel = value; break;
        default: throw new Error(`unknown option ${flag}`);
        }
    }
    for (const required of ['macDir', 'windowsDir', 'outputDir', 'version']) {
        invariant(result[required], `missing --${required.replace(/Dir$/u, '').toLocaleLowerCase('en-US')}`);
    }
    return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    prepareDesktopUpdateRelease(parseArguments(process.argv.slice(2)))
        .then(manifest => process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`))
        .catch(error => {
            process.stderr.write(`desktop update release rejected: ${error.message}\n`);
            process.exitCode = 1;
        });
}
