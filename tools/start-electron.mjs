import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { desktopEnvironment } from './desktop-environment.mjs';

const require = createRequire(import.meta.url);
const cli = require.resolve('@theia/cli/bin/theia.js');
const cwd = fileURLToPath(new URL('../electron-app/', import.meta.url));
const env = desktopEnvironment(process.env);

// Extension installation belongs to build/download:plugins, never to opening the IDE.
const args = ['start', '--plugins=local-dir:plugins', ...process.argv.slice(2)];
const code = await new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: 'inherit' });
    const terminate = () => child.kill('SIGTERM');
    const interrupt = () => child.kill('SIGINT');
    process.on('SIGTERM', terminate);
    process.on('SIGINT', interrupt);
    child.once('error', error => { console.error(error); resolve(1); });
    child.once('close', (exitCode, signal) => {
        process.off('SIGTERM', terminate);
        process.off('SIGINT', interrupt);
        resolve(exitCode ?? (signal === 'SIGINT' ? 130 : 143));
    });
});
if (code !== 0) { process.exitCode = code; }
