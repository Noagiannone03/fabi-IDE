// Ship the pinned native harness with the desktop app, independently of a system Node install.
import { createRequire } from 'node:module';
import { assistToolsBundle } from './build-assist-tools.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, copyFile, chmod, readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = dirname(require.resolve('opencode-ai/package.json'));
const meta = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const name = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
const binary = process.platform === 'win32'
    ? join(dirname(require.resolve(`opencode-windows-${process.arch}/package.json`)), 'bin', name)
    : join(packageRoot, 'bin', '.opencode');
const destination = join(root, 'electron-app', 'lib', 'assist-runtime');
await mkdir(destination, { recursive: true });
await copyFile(binary, join(destination, name));
await copyFile(assistToolsBundle, join(destination, 'assist-tools.mjs'));
await chmod(join(destination, name), 0o755);
await copyFile(join(packageRoot, 'LICENSE'), join(destination, 'LICENSE'));
await writeFile(join(destination, 'version.json'), JSON.stringify({ package: 'opencode-ai', version: meta.version, platform: process.platform, arch: process.arch }));
console.log(`Fabi Assist runtime prepared: OpenCode ${meta.version} (${process.platform}/${process.arch})`);
