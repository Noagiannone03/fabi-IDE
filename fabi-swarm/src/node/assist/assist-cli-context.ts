import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { AssistCliContext } from '../../common/fabi-assist-protocol';

const LIMIT = 256 * 1024;
/** Exact-session lookup; bounded reads and no fallback to another conversation. */
export async function readCliContext(project: string, source: string, sessionId?: string, home = homedir()): Promise<AssistCliContext> {
    const result: AssistCliContext = { source, sessionId, status: sessionId ? 'unavailable' : 'unbound', messages: [], truncated: false };
    if (!sessionId || !/^[a-zA-Z0-9_-]{1,120}$/.test(sessionId) || !['claude', 'codex'].includes(source)) return result;
    const root = source === 'claude' ? join(home, '.claude', 'projects') : join(home, '.codex', 'sessions');
    const target = await fs.realpath(project);
    let visited = 0;
    async function find(dir: string, depth: number): Promise<string | undefined> {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
            if (++visited > 15000) return;
            if (entry.isSymbolicLink()) continue;
            const path = join(dir, entry.name);
            if (entry.isFile() && (entry.name === `${sessionId}.jsonl` || entry.name.endsWith(`-${sessionId}.jsonl`))) return path;
            if (entry.isDirectory() && depth > 0 && entry.name !== 'subagents') { const match = await find(path, depth - 1); if (match) return match; }
        }
    }
    const file = await find(root, 4); if (!file) return result;
    const handle = await fs.open(file, 'r');
    try {
        const stat = await handle.stat();
        const head = Buffer.alloc(Math.min(stat.size, LIMIT)); await handle.read(head, 0, head.length, 0);
        const start = Math.max(0, stat.size - LIMIT);
        const tail = start ? Buffer.alloc(Math.min(stat.size, LIMIT)) : head;
        if (start) await handle.read(tail, 0, tail.length, start);
        const parse = (text: string) => text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
        const initial = parse(head.toString());
        const metadata = source === 'codex' ? initial.find(row => row.type === 'session_meta')?.payload : initial.find(row => row.cwd && row.sessionId === sessionId);
        if (!metadata || (metadata.id ?? metadata.sessionId) !== sessionId || typeof metadata.cwd !== 'string') return result;
        const cwd = await fs.realpath(metadata.cwd).catch(() => '');
        const rel = relative(target, cwd);
        if (!cwd || rel === '..' || rel.startsWith('..' + require('node:path').sep) || isAbsolute(rel)) return result;
        const rows = parse(start ? tail.toString().slice(tail.toString().indexOf('\n') + 1) : head.toString());
        result.messages = rows.flatMap(row => {
            const message = source === 'codex' ? row.type === 'response_item' ? row.payload : undefined : row.message;
            if (!message || !['user', 'assistant'].includes(message.role ?? row.type)) return [];
            const content = message.content;
            const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((part: any) => ['text', 'input_text', 'output_text'].includes(part.type)).map((part: any) => part.text ?? '').join('\n') : '';
            if (!text.trim()) return [];
            return [{ role: (message.role ?? row.type) as 'user' | 'assistant', text: text.slice(0, 3500).replace(/Bearer\s+\S+|\bsk-[\w-]{15,}/g, '[secret]') }];
        }).slice(-12);
        result.status = result.messages.length ? 'available' : 'empty'; result.truncated = stat.size > LIMIT || rows.length > 12;
        return result;
    } finally { await handle.close(); }
}

/** Check an actual descendant executable, not the terminal title or prompt text. */
export async function assertCliProcess(pid: number, source: string): Promise<void> {
    if (!Number.isSafeInteger(pid) || pid < 1 || !['claude', 'codex', 'opencode'].includes(source)) throw new Error('Ce terminal ne permet pas un envoi contrôlé.');
    const output = await new Promise<string>((yes, no) => execFile('ps', ['-axo', 'pid=,ppid=,comm=,stat='], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => error ? no(new Error('Impossible de vérifier le processus du CLI.')) : yes(stdout)));
    const rows = output.split('\n').flatMap(line => { const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s+(\S+)\s*$/); return m ? [{ pid: +m[1], parent: +m[2], name: m[3].split('/').pop()!, foreground: m[4].includes('+') }] : []; });
    const byPid = new Map(rows.map(row => [row.pid, row]));
    const alive = rows.some(row => {
        if (!row.foreground || !new RegExp(`^${source}(?:\\.exe)?$`, 'i').test(row.name)) return false;
        const seen = new Set<number>(); let current: typeof row | undefined = row;
        while (current && !seen.has(current.pid)) { if (current.pid === pid) return true; seen.add(current.pid); current = byPid.get(current.parent); }
        return false;
    });
    if (!alive) throw new Error('Le CLI n’est plus actif dans ce terminal. Aucun texte envoyé.');
}
