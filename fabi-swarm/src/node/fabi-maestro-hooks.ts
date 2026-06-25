import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, platform } from 'node:os';
import * as net from 'node:net';
import { MaestroAgent, MaestroHooksStatus, MaestroSource, MaestroStatus, MaestroWaitingKind } from '../common/fabi-maestro-protocol';

/**
 * Source du client de hook, EMBARQUÉE (écrite à l'install). Évite toute
 * dépendance à un fichier `resources/` non bundlé en app packagée. Appelé par
 * Claude/Codex sur chaque événement → relaie au socket local de Maestro.
 * NB : pas de template literal ni de `${}` à l'intérieur (script autonome).
 */
const HOOK_CLIENT_SOURCE = `#!/usr/bin/env node
'use strict';
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
const si = args.indexOf('--source');
const source = si >= 0 ? args[si + 1] : 'codex';
const socketPath = process.env.FABI_MAESTRO_SOCKET || (
    process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'Fabi', 'maestro.sock')
        : path.join(os.homedir(), '.fabi', 'maestro.sock')
);
function ttyForParent() {
    try {
        const tty = execFileSync('ps', ['-p', String(process.ppid), '-o', 'tty='], { encoding: 'utf8', timeout: 1500 }).trim();
        if (!tty || tty === '??' || tty === '-') { return undefined; }
        return tty.indexOf('/dev/') === 0 ? tty : '/dev/' + tty;
    } catch (e) { return undefined; }
}
function main() {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function (c) { raw += c; });
    process.stdin.on('end', function () {
        let payload;
        try { payload = JSON.parse(raw); } catch (e) { return; }
        const event = String(payload.hook_event_name || '');
        const interactive = event === 'PermissionRequest';
        const socket = net.createConnection(socketPath);
        let response = '';
        const timeout = interactive ? (source === 'claude' ? 86400000 : 3600000) : 2500;
        socket.setTimeout(timeout);
        socket.on('connect', function () {
            socket.write(JSON.stringify({ source: source, payload: payload, runtime: { pid: process.ppid, tty: ttyForParent(), receivedAt: Date.now() } }) + '\\n');
            if (!interactive) { socket.end(); }
        });
        socket.on('data', function (c) { response += c.toString('utf8'); });
        socket.on('end', function () {
            const line = response.trim();
            if (line) { process.stdout.write(line.charAt(line.length - 1) === '\\n' ? line : line + '\\n'); }
        });
        socket.on('timeout', function () { socket.destroy(); });
        socket.on('error', function () {});
    });
    process.stdin.resume();
}
main();
`;

interface HookEnvelope {
    source?: string;
    payload?: Record<string, unknown>;
    runtime?: { pid?: number; tty?: string; receivedAt?: number };
}

interface HookSession {
    source: 'claude' | 'codex';
    id: string;
    directory?: string;
    model?: string;
    status: MaestroStatus;
    waitingKind?: MaestroWaitingKind;
    pendingPermission?: string;
    preview?: string;
    updatedAt: number;
    pid?: number;
    socket?: net.Socket;
}

const MANAGED_MARKER = 'fabi-maestro-hook-client.js';

export class MaestroHookBridge {

    protected readonly sessions = new Map<string, HookSession>();
    protected server: net.Server | undefined;
    protected readonly socketPath = platform() === 'darwin'
        ? join(homedir(), 'Library', 'Application Support', 'Fabi', 'maestro.sock')
        : join(homedir(), '.fabi', 'maestro.sock');

    constructor(protected readonly onChange: () => void) { }

    async start(): Promise<void> {
        if (this.server) {
            return;
        }
        await fs.mkdir(dirname(this.socketPath), { recursive: true });
        await fs.unlink(this.socketPath).catch(() => undefined);
        this.server = net.createServer(socket => this.accept(socket));
        await new Promise<void>((resolve, reject) => {
            this.server!.once('error', reject);
            this.server!.listen(this.socketPath, () => {
                this.server!.off('error', reject);
                resolve();
            });
        });
        await fs.chmod(this.socketPath, 0o600).catch(() => undefined);
    }

    isRunning(): boolean {
        return !!this.server?.listening;
    }

    apply(agents: MaestroAgent[]): MaestroAgent[] {
        const hooks = [...this.sessions.values()]
            .filter(session => Date.now() - session.updatedAt < 24 * 60 * 60 * 1000)
            .sort((a, b) => b.updatedAt - a.updatedAt);
        const used = new Set<string>();
        return agents.map(agent => {
            if (agent.source === 'fabi') {
                return agent;
            }
            const hook = hooks.find(candidate =>
                !used.has(this.key(candidate.source, candidate.id))
                && candidate.source === agent.source
                && this.sameDirectory(candidate.directory, agent.directory)
            );
            if (!hook) {
                return agent;
            }
            used.add(this.key(hook.source, hook.id));
            return {
                ...agent,
                key: `${hook.source}:${hook.id}`,
                id: hook.id,
                status: hook.status,
                waitingKind: hook.waitingKind,
                pendingPermission: hook.pendingPermission,
                pendingPermissionId: hook.socket ? `hook:${hook.source}:${hook.id}` : undefined,
                preview: hook.preview || agent.preview,
                model: hook.model || agent.model,
                updatedAt: hook.updatedAt,
                approximate: false
            };
        });
    }

    respond(source: MaestroSource, id: string, allow: boolean): boolean {
        if (source !== 'claude' && source !== 'codex') {
            return false;
        }
        const session = this.sessions.get(this.key(source, id));
        if (!session?.socket) {
            return false;
        }
        const directive = source === 'claude'
            ? {
                continue: true,
                suppressOutput: true,
                hookSpecificOutput: {
                    hookEventName: 'PermissionRequest',
                    decision: allow
                        ? { behavior: 'allow' }
                        : { behavior: 'deny', message: 'Permission refusée depuis Fabi Maestro', interrupt: false }
                }
            }
            : {
                continue: true,
                hookSpecificOutput: {
                    hookEventName: 'PermissionRequest',
                    decision: allow
                        ? { behavior: 'allow' }
                        : { behavior: 'deny', message: 'Permission refusée depuis Fabi Maestro' }
                }
            };
        session.socket.end(`${JSON.stringify(directive)}\n`);
        session.socket = undefined;
        session.pendingPermission = undefined;
        session.waitingKind = undefined;
        session.status = allow ? 'generating' : 'idle';
        session.updatedAt = Date.now();
        this.onChange();
        return true;
    }

    async status(): Promise<MaestroHooksStatus> {
        const [claude, codex] = await Promise.all([
            this.fileContains(join(homedir(), '.claude', 'settings.json'), MANAGED_MARKER),
            this.fileContains(join(homedir(), '.codex', 'hooks.json'), MANAGED_MARKER)
        ]);
        return { claude, codex, bridge: this.isRunning() };
    }

    async install(): Promise<MaestroHooksStatus> {
        const helper = await this.installHelper();
        const node = process.execPath;
        // En app Electron, process.execPath est le binaire Electron. Le mode Node
        // explicite permet au même helper de fonctionner en dev et en application packagée.
        const command = `ELECTRON_RUN_AS_NODE=1 ${this.shellQuote(node)} ${this.shellQuote(helper)}`;
        await Promise.all([
            this.installClaude(`${command} --source claude`),
            this.installCodex(`${command} --source codex`)
        ]);
        return this.status();
    }

    protected accept(socket: net.Socket): void {
        socket.setEncoding('utf8');
        let buffer = '';
        socket.on('data', chunk => {
            buffer += chunk;
            const newline = buffer.indexOf('\n');
            if (newline < 0) {
                return;
            }
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            try {
                this.handle(JSON.parse(line) as HookEnvelope, socket);
            } catch {
                socket.end();
            }
        });
        socket.on('error', () => undefined);
    }

    protected handle(envelope: HookEnvelope, socket: net.Socket): void {
        const source = envelope.source === 'claude' || envelope.source === 'codex' ? envelope.source : undefined;
        const payload = envelope.payload;
        const id = typeof payload?.session_id === 'string' ? payload.session_id : undefined;
        if (!source || !payload || !id) {
            socket.end();
            return;
        }
        const event = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : '';
        const key = this.key(source, id);
        if (event === 'SessionEnd') {
            this.sessions.delete(key);
            socket.end();
            this.onChange();
            return;
        }
        const current = this.sessions.get(key) || {
            source,
            id,
            status: 'idle' as MaestroStatus,
            updatedAt: Date.now()
        };
        current.directory = typeof payload.cwd === 'string' ? payload.cwd : current.directory;
        current.model = typeof payload.model === 'string' ? payload.model : current.model;
        current.pid = envelope.runtime?.pid || current.pid;
        current.updatedAt = envelope.runtime?.receivedAt || Date.now();
        current.preview = this.preview(payload) || current.preview;
        current.waitingKind = undefined;
        current.pendingPermission = undefined;

        switch (event) {
            case 'UserPromptSubmit':
            case 'PreToolUse':
                if (typeof payload.tool_name === 'string' && /askuserquestion|question/i.test(payload.tool_name)) {
                    current.status = 'waiting';
                    current.waitingKind = 'input';
                    break;
                }
                current.status = 'generating';
                break;
            case 'PostToolUse':
            case 'SubagentStart':
            case 'SubagentStop':
            case 'PreCompact':
                current.status = 'generating';
                break;
            case 'PermissionRequest':
                current.status = 'waiting';
                current.waitingKind = 'permission';
                current.pendingPermission = this.permissionDetail(payload);
                current.socket?.destroy();
                current.socket = socket;
                break;
            case 'Notification':
                if (payload.notification_type === 'permission_prompt') {
                    current.status = 'waiting';
                    current.waitingKind = 'permission';
                } else if (payload.notification_type === 'idle_prompt' || !payload.notification_type) {
                    current.status = 'waiting';
                    current.waitingKind = 'input';
                } else {
                    current.status = 'idle';
                }
                break;
            case 'Stop':
                current.status = 'waiting';
                current.waitingKind = 'input';
                break;
            case 'StopFailure':
            case 'PostToolUseFailure':
                current.status = 'error';
                break;
            case 'SessionStart':
            default:
                current.status = 'idle';
                break;
        }
        this.sessions.set(key, current);
        if (event !== 'PermissionRequest') {
            socket.end();
        }
        this.onChange();
    }

    protected preview(payload: Record<string, unknown>): string | undefined {
        for (const key of ['last_assistant_message', 'message', 'prompt', 'error']) {
            const value = payload[key];
            if (typeof value === 'string' && value.trim()) {
                return this.clip(value);
            }
        }
        return undefined;
    }

    protected permissionDetail(payload: Record<string, unknown>): string {
        const input = payload.tool_input as Record<string, unknown> | undefined;
        const detail = input?.command || input?.description || input?.file_path || payload.tool_name;
        return typeof detail === 'string' ? this.clip(detail, 260) : 'Action sensible';
    }

    protected async installHelper(): Promise<string> {
        const directory = join(homedir(), '.fabi', 'maestro');
        const target = join(directory, MANAGED_MARKER);
        await fs.mkdir(directory, { recursive: true });
        // On ÉCRIT le helper depuis la constante embarquée → fonctionne en dev ET
        // en app packagée (aucune dépendance à un fichier resource non bundlé).
        await fs.writeFile(target, HOOK_CLIENT_SOURCE, { mode: 0o755 });
        await fs.chmod(target, 0o755);
        return target;
    }

    protected async installClaude(command: string): Promise<void> {
        const file = join(homedir(), '.claude', 'settings.json');
        const root = await this.readJson(file);
        const hooks = (root.hooks && typeof root.hooks === 'object' ? root.hooks : {}) as Record<string, unknown>;
        const specs: Array<[string, string | undefined, number | undefined]> = [
            ['SessionStart', undefined, undefined],
            ['SessionEnd', undefined, undefined],
            ['UserPromptSubmit', undefined, undefined],
            ['Stop', undefined, undefined],
            ['StopFailure', undefined, undefined],
            ['Notification', '*', undefined],
            ['PreToolUse', '*', undefined],
            ['PostToolUse', '*', undefined],
            ['PostToolUseFailure', '*', undefined],
            ['PermissionRequest', '*', 86400],
            ['PreCompact', undefined, undefined]
        ];
        for (const [event, matcher, timeout] of specs) {
            const groups = Array.isArray(hooks[event]) ? hooks[event] as Array<Record<string, unknown>> : [];
            const cleaned = this.removeManagedGroups(groups);
            const hook: Record<string, unknown> = { type: 'command', command };
            if (timeout) {
                hook.timeout = timeout;
            }
            const group: Record<string, unknown> = { hooks: [hook] };
            if (matcher) {
                group.matcher = matcher;
            }
            hooks[event] = [...cleaned, group];
        }
        root.hooks = hooks;
        await this.writeJson(file, root);
    }

    protected async installCodex(command: string): Promise<void> {
        const hooksFile = join(homedir(), '.codex', 'hooks.json');
        const root = await this.readJson(hooksFile);
        const hooks = (root.hooks && typeof root.hooks === 'object' ? root.hooks : {}) as Record<string, unknown>;
        const specs: Array<[string, string | undefined, number]> = [
            ['SessionStart', 'startup|resume', 45],
            ['UserPromptSubmit', undefined, 45],
            ['PermissionRequest', undefined, 3600],
            ['Stop', undefined, 45]
        ];
        for (const [event, matcher, timeout] of specs) {
            const groups = Array.isArray(hooks[event]) ? hooks[event] as Array<Record<string, unknown>> : [];
            const cleaned = this.removeManagedGroups(groups);
            const group: Record<string, unknown> = {
                hooks: [{ type: 'command', command, timeout }]
            };
            if (matcher) {
                group.matcher = matcher;
            }
            hooks[event] = [...cleaned, group];
        }
        root.hooks = hooks;
        await this.writeJson(hooksFile, root);
        await this.enableCodexHooks(join(homedir(), '.codex', 'config.toml'));
    }

    protected removeManagedGroups(groups: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
        return groups.flatMap(group => {
            const hooks = Array.isArray(group.hooks) ? group.hooks as Array<Record<string, unknown>> : [];
            const kept = hooks.filter(hook => typeof hook.command !== 'string' || !hook.command.includes(MANAGED_MARKER));
            return kept.length ? [{ ...group, hooks: kept }] : [];
        });
    }

    protected async enableCodexHooks(file: string): Promise<void> {
        let text = await fs.readFile(file, 'utf8').catch(() => '');
        const lines = text.split(/\r?\n/);
        const header = lines.findIndex(line => line.trim() === '[features]');
        if (header < 0) {
            text = `${text.trimEnd()}${text.trim() ? '\n\n' : ''}[features]\nhooks = true\n`;
        } else {
            let end = lines.findIndex((line, index) => index > header && /^\s*\[/.test(line));
            if (end < 0) {
                end = lines.length;
            }
            const hookLine = lines.findIndex((line, index) =>
                index > header && index < end && /^\s*(hooks|codex_hooks)\s*=/.test(line)
            );
            if (hookLine >= 0) {
                lines[hookLine] = 'hooks = true';
            } else {
                lines.splice(end, 0, 'hooks = true');
            }
            text = lines.join('\n');
        }
        await this.atomicWrite(file, text);
    }

    protected async readJson(file: string): Promise<Record<string, unknown>> {
        const raw = await fs.readFile(file, 'utf8').catch(() => '');
        if (!raw.trim()) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`${file} ne contient pas un objet JSON.`);
        }
        return parsed as Record<string, unknown>;
    }

    protected async writeJson(file: string, value: Record<string, unknown>): Promise<void> {
        await this.atomicWrite(file, `${JSON.stringify(value, undefined, 2)}\n`);
    }

    protected async atomicWrite(file: string, contents: string): Promise<void> {
        await fs.mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.fabi-${process.pid}.tmp`;
        await fs.writeFile(temporary, contents, { mode: 0o600 });
        await fs.rename(temporary, file);
    }

    protected fileContains(file: string, needle: string): Promise<boolean> {
        return fs.readFile(file, 'utf8').then(value => value.includes(needle)).catch(() => false);
    }

    protected shellQuote(value: string): string {
        return `'${value.replace(/'/g, `'\\''`)}'`;
    }

    protected key(source: string, id: string): string {
        return `${source}:${id}`;
    }

    protected sameDirectory(a?: string, b?: string): boolean {
        return !!a && !!b && a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '');
    }

    protected clip(value: string, max = 180): string {
        const text = value.replace(/\s+/g, ' ').trim();
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }
}
