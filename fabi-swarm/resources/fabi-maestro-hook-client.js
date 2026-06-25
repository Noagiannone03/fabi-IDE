#!/usr/bin/env node
'use strict';

// Client fail-open appelé par les hooks Claude/Codex.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
const source = sourceIndex >= 0 ? args[sourceIndex + 1] : 'codex';
const socketPath = process.env.FABI_MAESTRO_SOCKET || (
    process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'Fabi', 'maestro.sock')
        : path.join(os.homedir(), '.fabi', 'maestro.sock')
);

function ttyForParent() {
    try {
        const tty = execFileSync('ps', ['-p', String(process.ppid), '-o', 'tty='], {
            encoding: 'utf8',
            timeout: 1500
        }).trim();
        return tty && tty !== '??' && tty !== '-' ? (tty.startsWith('/dev/') ? tty : `/dev/${tty}`) : undefined;
    } catch {
        return undefined;
    }
}

function main() {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { raw += chunk; });
    process.stdin.on('end', () => {
        let payload;
        try {
            payload = JSON.parse(raw);
        } catch {
            return;
        }
        const event = String(payload.hook_event_name || '');
        const interactive = event === 'PermissionRequest';
        const socket = net.createConnection(socketPath);
        let response = '';
        const timeout = interactive
            ? (source === 'claude' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000)
            : 2500;
        socket.setTimeout(timeout);
        socket.on('connect', () => {
            socket.write(JSON.stringify({
                source,
                payload,
                runtime: {
                    pid: process.ppid,
                    tty: ttyForParent(),
                    receivedAt: Date.now()
                }
            }) + '\n');
            if (!interactive) {
                socket.end();
            }
        });
        socket.on('data', chunk => { response += chunk.toString('utf8'); });
        socket.on('end', () => {
            const line = response.trim();
            if (line) {
                process.stdout.write(line.endsWith('\n') ? line : `${line}\n`);
            }
        });
        socket.on('timeout', () => socket.destroy());
        socket.on('error', () => undefined);
    });
    process.stdin.resume();
}

main();
