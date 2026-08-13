#!/usr/bin/env node

import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

function invariant(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function parseArguments(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 2) {
        const flag = argv[index];
        const value = argv[index + 1];
        invariant(flag?.startsWith('--') && value !== undefined, `invalid arguments near ${JSON.stringify(flag)}`);
        switch (flag) {
        case '--config': result.config = value; break;
        case '--url': result.url = value; break;
        case '--channel': result.channel = value; break;
        case '--publisher': result.publisher = value; break;
        default: throw new Error(`unknown option ${flag}`);
        }
    }
    for (const required of ['config', 'url', 'channel']) {
        invariant(result[required], `missing --${required}`);
    }
    return result;
}

export function verifyDesktopUpdateConfig({ config, url, channel, publisher }) {
    const stat = lstatSync(config);
    invariant(stat.isFile() && !stat.isSymbolicLink(), 'app-update.yml must be a regular file');
    const document = YAML.parseDocument(readFileSync(config, 'utf8'), {
        prettyErrors: true,
        strict: true,
        uniqueKeys: true
    });
    invariant(document.errors.length === 0, `invalid app-update.yml: ${document.errors.join('; ')}`);
    const value = document.toJS({ maxAliasCount: 0 });
    invariant(value && typeof value === 'object' && !Array.isArray(value), 'app-update.yml must contain a mapping');
    invariant(value.provider === 'generic', `unexpected update provider: ${JSON.stringify(value.provider)}`);
    invariant(value.url === url, `unexpected update URL: ${JSON.stringify(value.url)}`);
    invariant(value.channel === channel, `unexpected update channel: ${JSON.stringify(value.channel)}`);
    invariant(value.useMultipleRangeRequest === false, 'multiple range requests must stay disabled for the generic origin');
    if (publisher !== undefined) {
        const names = Array.isArray(value.publisherName) ? value.publisherName : [value.publisherName];
        invariant(names.length > 0 && names.every(name => typeof name === 'string' && name.length > 0),
            'Windows updater publisherName is missing');
        invariant(names.includes(publisher), `Windows updater does not pin publisher ${JSON.stringify(publisher)}`);
    }
    return value;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    try {
        verifyDesktopUpdateConfig(parseArguments(process.argv.slice(2)));
        process.stdout.write('packaged updater configuration verified\n');
    } catch (error) {
        process.stderr.write(`packaged updater configuration rejected: ${error.message}\n`);
        process.exitCode = 1;
    }
}
