// Détection des agents CLI externes (Claude Code, Codex) tournant dans un
// terminal de l'IDE — pour les superviser dans le tableau de bord Maestro.
//
// Approche (calquée sur open-vibe-island / vibe-notch, portée en TS) : on lit les
// TRANSCRIPTS sur disque que ces CLI écrivent en continu, plus une vérification de
// liveness des process. Sans hooks (cf. phase 3), le statut est volontairement
// prudent : `generating` si le transcript a été écrit à l'instant ET qu'un process
// de l'agent tourne ; `idle` sinon (fin de tour / en attente de l'utilisateur).
//
//   - Claude Code : ~/.claude/projects/<cwd encodé>/<sessionId>.jsonl
//       lignes {type:'user'|'assistant', message:{content}, cwd, timestamp, sessionId}
//   - Codex       : ~/.codex/sessions/Y/M/D/rollout-<iso>-<uuid>.jsonl
//       1ère ligne {type:'session_meta', payload:{id, cwd, …}}, puis response_item/event_msg
//
// Lecture seule, robuste aux gros fichiers (on ne lit que les bords pour la liste).

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { exec } from 'node:child_process';
import { ILogger } from '@theia/core';
import { MaestroAgent, MaestroMessage, MaestroStatus, MaestroSource, MaestroSurface } from '../common/fabi-maestro-protocol';

/** Au-delà, un transcript inactif n'est plus listé. */
const RECENT_MS = 12 * 60 * 60 * 1000;
/** En-deçà (dernière écriture), on considère l'agent en train de générer. */
const ACTIVE_MS = 12_000;
/** Nb max de transcripts parsés par source (les plus récents). */
const MAX_FILES = 40;
/** Octets lus en tête/queue pour l'aperçu (évite de charger des transcripts énormes). */
const EDGE_BYTES = 48 * 1024;
/** Plafond de lecture pour le détail complet d'une conversation. */
const DETAIL_MAX_BYTES = 2 * 1024 * 1024;

interface ScanFile { file: string; mtime: number; }
interface ProcessRow { pid: number; ppid: number; command: string; }
interface TerminalBinding { surface: MaestroSurface; source: 'claude' | 'codex'; }

export class ExternalAgentMonitor {

    protected readonly claudeRoot = join(homedir(), '.claude', 'projects');
    protected readonly codexRoot = join(homedir(), '.codex', 'sessions');

    /** Cache id de session → chemin du transcript (pour getConversation). */
    protected readonly fileById = new Map<string, string>();

    constructor(protected readonly logger?: ILogger) { }

    /**
     * Ne retourne que les agents rattachés à un terminal Theia ouvert. Le process
     * enfant est la vérité de présence; le transcript sert ensuite à enrichir.
     */
    async scan(terminals: MaestroSurface[] = []): Promise<MaestroAgent[]> {
        const bindings = await this.terminalBindings(terminals);
        if (bindings.length === 0) {
            return [];
        }
        const [claude, codex] = await Promise.all([
            this.scanClaude(bindings.some(binding => binding.source === 'claude')),
            this.scanCodex(bindings.some(binding => binding.source === 'codex'))
        ]);
        const candidates = [...claude, ...codex];
        const used = new Set<string>();
        return bindings.map(binding => {
            const match = candidates
                .filter(agent =>
                    agent.source === binding.source
                    && !used.has(agent.key)
                    && this.sameDirectory(agent.directory, binding.surface.directory)
                )
                .sort((a, b) => b.updatedAt - a.updatedAt)[0];
            if (match) {
                used.add(match.key);
                return {
                    ...match,
                    workspaceName: binding.surface.workspaceName || match.workspaceName,
                    surface: binding.surface,
                    approximate: true
                };
            }
            return {
                key: `${binding.source}-terminal:${binding.surface.ownerId}:${binding.surface.widgetId}`,
                source: binding.source,
                id: `${binding.surface.ownerId}:${binding.surface.widgetId}`,
                title: binding.surface.title || (binding.source === 'claude' ? 'Claude Code' : 'Codex'),
                status: 'idle' as MaestroStatus,
                directory: binding.surface.directory,
                workspaceName: binding.surface.workspaceName,
                preview: 'Statut précis indisponible sans hooks',
                updatedAt: Date.now(),
                surface: binding.surface,
                approximate: true
            };
        });
    }

    /** Historique d'une conversation externe (clé `claude:<id>` ou `codex:<id>`). */
    async getConversation(source: MaestroSource, id: string): Promise<MaestroMessage[]> {
        const file = this.fileById.get(`${source}:${id}`);
        if (!file) {
            return [];
        }
        try {
            const text = await this.readCapped(file, DETAIL_MAX_BYTES);
            const lines = this.jsonLines(text);
            return source === 'claude' ? this.parseClaudeMessages(lines) : this.parseCodexMessages(lines);
        } catch (err) {
            this.logger?.warn(`[maestro] getConversation ${source}:${id}: ${String(err)}`);
            return [];
        }
    }

    // ----------------------------------------------------------- Claude

    protected async scanClaude(alive: boolean): Promise<MaestroAgent[]> {
        const files = await this.recentFiles(this.claudeRoot, name => name.endsWith('.jsonl'), 2);
        const agents: MaestroAgent[] = [];
        for (const { file, mtime } of files) {
            const { head, tail } = await this.readEdges(file);
            const all = [...head, ...tail];
            let cwd: string | undefined;
            let sessionId: string | undefined;
            let model: string | undefined;
            let firstUser: string | undefined;
            let lastText: string | undefined;
            for (const d of all) {
                if (typeof d.cwd === 'string') { cwd = d.cwd; }
                if (typeof d.sessionId === 'string') { sessionId = d.sessionId; }
                const msg = d.message as { role?: string; model?: string; content?: unknown } | undefined;
                if (d.type === 'user' && msg) {
                    const t = this.claudeText(msg.content);
                    if (t && firstUser === undefined) { firstUser = t; }
                    if (t) { lastText = t; }
                } else if (d.type === 'assistant' && msg) {
                    if (typeof msg.model === 'string') { model = msg.model; }
                    const t = this.claudeText(msg.content);
                    if (t) { lastText = t; }
                }
            }
            sessionId = sessionId ?? this.basenameNoExt(file);
            this.fileById.set(`claude:${sessionId}`, file);
            agents.push({
                key: `claude:${sessionId}`,
                source: 'claude',
                id: sessionId,
                title: this.clip(firstUser || 'Session Claude', 70),
                status: this.coarseStatus(mtime, alive),
                directory: cwd,
                workspaceName: cwd ? this.basename(cwd) : undefined,
                preview: lastText ? this.clip(lastText) : undefined,
                model,
                updatedAt: mtime
            });
        }
        return agents;
    }

    /** Texte d'un `message.content` Claude (string ou tableau de blocs). */
    protected claudeText(content: unknown): string | undefined {
        if (typeof content === 'string') {
            return content.trim() || undefined;
        }
        if (Array.isArray(content)) {
            const parts: string[] = [];
            for (const b of content) {
                if (b && typeof b === 'object' && (b as { type?: string }).type === 'text') {
                    const t = (b as { text?: string }).text;
                    if (typeof t === 'string') { parts.push(t); }
                }
            }
            const joined = parts.join('\n').trim();
            return joined || undefined;
        }
        return undefined;
    }

    protected parseClaudeMessages(lines: Array<Record<string, unknown>>): MaestroMessage[] {
        const out: MaestroMessage[] = [];
        for (const d of lines) {
            const type = d.type;
            if (type !== 'user' && type !== 'assistant') {
                continue;
            }
            const msg = d.message as { content?: unknown } | undefined;
            if (!msg) {
                continue;
            }
            const text = this.claudeText(msg.content);
            const tools: MaestroMessage['tools'] = [];
            if (Array.isArray(msg.content)) {
                for (const b of msg.content) {
                    if (b && typeof b === 'object' && (b as { type?: string }).type === 'tool_use') {
                        const tu = b as { name?: string; input?: { description?: string; file_path?: string } };
                        tools.push({ name: tu.name || 'tool', title: tu.input?.file_path || tu.input?.description });
                    }
                }
            }
            if (!text && tools.length === 0) {
                continue;
            }
            const ts = typeof d.timestamp === 'string' ? Date.parse(d.timestamp) : undefined;
            out.push({ role: type === 'user' ? 'user' : 'assistant', text: text || '', tools: tools.length ? tools : undefined, ts });
        }
        return out;
    }

    // ----------------------------------------------------------- Codex

    protected async scanCodex(alive: boolean): Promise<MaestroAgent[]> {
        const files = await this.recentFiles(this.codexRoot, name => name.startsWith('rollout-') && name.endsWith('.jsonl'), 3);
        const agents: MaestroAgent[] = [];
        for (const { file, mtime } of files) {
            const { head, tail } = await this.readEdges(file);
            let cwd: string | undefined;
            let id: string | undefined;
            for (const d of head) {
                if (d.type === 'session_meta') {
                    const p = d.payload as { id?: string; cwd?: string } | undefined;
                    cwd = p?.cwd;
                    id = p?.id;
                    break;
                }
            }
            id = id ?? this.codexIdFromName(file);
            const lastText = this.codexLastText([...head, ...tail]);
            this.fileById.set(`codex:${id}`, file);
            agents.push({
                key: `codex:${id}`,
                source: 'codex',
                id,
                title: lastText ? this.clip(lastText, 70) : 'Session Codex',
                status: this.coarseStatus(mtime, alive),
                directory: cwd,
                workspaceName: cwd ? this.basename(cwd) : undefined,
                preview: lastText ? this.clip(lastText) : undefined,
                updatedAt: mtime
            });
        }
        return agents;
    }

    /** Best-effort : extrait le dernier texte lisible d'un rollout Codex. */
    protected codexLastText(lines: Array<Record<string, unknown>>): string | undefined {
        let last: string | undefined;
        for (const d of lines) {
            const payload = d.payload as Record<string, unknown> | undefined;
            if (!payload) {
                continue;
            }
            // event_msg type 'agent_message' / response_item message → champ texte.
            const msg = payload.message;
            if (typeof msg === 'string' && msg.trim()) {
                last = msg.trim();
            }
            const content = payload.content;
            if (Array.isArray(content)) {
                for (const b of content) {
                    const t = (b as { text?: string })?.text;
                    if (typeof t === 'string' && t.trim()) { last = t.trim(); }
                }
            }
        }
        return last;
    }

    protected parseCodexMessages(lines: Array<Record<string, unknown>>): MaestroMessage[] {
        const out: MaestroMessage[] = [];
        for (const d of lines) {
            const payload = d.payload as Record<string, unknown> | undefined;
            if (!payload) {
                continue;
            }
            const role = payload.role === 'user' ? 'user' : payload.role === 'assistant' ? 'assistant' : undefined;
            let text: string | undefined;
            if (typeof payload.message === 'string') {
                text = payload.message;
            } else if (Array.isArray(payload.content)) {
                text = payload.content
                    .map(b => (b as { text?: string })?.text).filter((t): t is string => typeof t === 'string').join('\n');
            }
            if (!role || !text || !text.trim()) {
                continue;
            }
            const ts = typeof d.timestamp === 'string' ? Date.parse(d.timestamp) : undefined;
            out.push({ role, text: text.trim(), ts });
        }
        return out;
    }

    protected codexIdFromName(file: string): string {
        const m = file.match(/([0-9a-fA-F-]{36})\.jsonl$/);
        return m ? m[1] : this.basenameNoExt(file);
    }

    // ----------------------------------------------------------- Communs

    /** Statut prudent sans hooks : génère si écrit à l'instant + process vivant. */
    protected coarseStatus(mtime: number, alive: boolean): MaestroStatus {
        return alive && (Date.now() - mtime) < ACTIVE_MS ? 'generating' : 'idle';
    }

    /** Associe chaque shell de terminal à son descendant Claude/Codex éventuel. */
    protected async terminalBindings(terminals: MaestroSurface[]): Promise<TerminalBinding[]> {
        const rows = await this.processRows();
        const byPid = new Map(rows.map(row => [row.pid, row]));
        const bindings: TerminalBinding[] = [];
        for (const surface of terminals) {
            if (!surface.processId) {
                continue;
            }
            const descendants = rows.filter(row => this.hasAncestor(row, surface.processId!, byPid));
            const rootSource = byPid.get(surface.processId)
                ? this.processSource(byPid.get(surface.processId)!.command)
                : undefined;
            const detected = rootSource || descendants
                .map(row => this.processSource(row.command))
                .find((source): source is 'claude' | 'codex' => !!source);
            const source = detected || surface.sourceHint;
            if (source) {
                bindings.push({ surface, source });
            }
        }
        return bindings;
    }

    protected processRows(): Promise<ProcessRow[]> {
        return new Promise(resolve => {
            exec('ps -axo pid=,ppid=,command=', { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
                if (err || !stdout) {
                    resolve([]);
                    return;
                }
                const rows: ProcessRow[] = [];
                for (const line of stdout.split('\n')) {
                    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
                    if (match) {
                        rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
                    }
                }
                resolve(rows);
            });
        });
    }

    protected hasAncestor(row: ProcessRow, ancestor: number, byPid: Map<number, ProcessRow>): boolean {
        let current: ProcessRow | undefined = row;
        const visited = new Set<number>();
        while (current && !visited.has(current.pid)) {
            if (current.ppid === ancestor) {
                return true;
            }
            visited.add(current.pid);
            current = byPid.get(current.ppid);
        }
        return false;
    }

    protected processSource(command: string): 'claude' | 'codex' | undefined {
        const normalized = command.toLowerCase();
        if (/(^|[ /@])claude(?:-code)?(?:[./ ]|$)/.test(normalized) && !normalized.includes('claude-island')) {
            return 'claude';
        }
        if (/(^|[ /@])codex(?:[./ ]|$)/.test(normalized) && !normalized.includes('openislandhooks')) {
            return 'codex';
        }
        return undefined;
    }

    protected sameDirectory(a?: string, b?: string): boolean {
        if (!a || !b) {
            return false;
        }
        return a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '');
    }

    /**
     * Liste les transcripts récents sous `root`, en descendant de `depth` niveaux de
     * dossiers, filtrés par `match`, triés du plus récent au plus ancien, plafonnés.
     */
    protected async recentFiles(root: string, match: (name: string) => boolean, depth: number): Promise<ScanFile[]> {
        const found: ScanFile[] = [];
        const now = Date.now();
        const walk = async (dir: string, d: number): Promise<void> => {
            let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
            try {
                entries = await fs.readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const e of entries) {
                const full = join(dir, e.name);
                if (e.isDirectory() && d > 0) {
                    // On n'entre pas dans les transcripts de sous-agents (bruit).
                    if (e.name === 'subagents') {
                        continue;
                    }
                    await walk(full, d - 1);
                } else if (e.isFile() && match(e.name)) {
                    try {
                        const st = await fs.stat(full);
                        if (now - st.mtimeMs <= RECENT_MS) {
                            found.push({ file: full, mtime: st.mtimeMs });
                        }
                    } catch { /* fichier disparu */ }
                }
            }
        };
        await walk(root, depth);
        found.sort((a, b) => b.mtime - a.mtime);
        return found.slice(0, MAX_FILES);
    }

    /** Lit les EDGE_BYTES premiers et derniers octets et renvoie les lignes JSON complètes. */
    protected async readEdges(file: string): Promise<{ head: Array<Record<string, unknown>>; tail: Array<Record<string, unknown>> }> {
        const fh = await fs.open(file, 'r');
        try {
            const size = (await fh.stat()).size;
            const headLen = Math.min(EDGE_BYTES, size);
            const headBuf = Buffer.alloc(headLen);
            await fh.read(headBuf, 0, headLen, 0);
            let tail: Array<Record<string, unknown>> = [];
            if (size > headLen) {
                const tailLen = Math.min(EDGE_BYTES, size);
                const tailBuf = Buffer.alloc(tailLen);
                await fh.read(tailBuf, 0, tailLen, size - tailLen);
                tail = this.jsonLines(tailBuf.toString('utf8'), { dropFirst: true });
            }
            return { head: this.jsonLines(headBuf.toString('utf8'), { dropLast: size > headLen }), tail };
        } finally {
            await fh.close();
        }
    }

    protected async readCapped(file: string, maxBytes: number): Promise<string> {
        const fh = await fs.open(file, 'r');
        try {
            const size = (await fh.stat()).size;
            const len = Math.min(maxBytes, size);
            const buf = Buffer.alloc(len);
            await fh.read(buf, 0, len, size - len); // queue (les plus récents)
            return buf.toString('utf8');
        } finally {
            await fh.close();
        }
    }

    /** Découpe en lignes et parse chaque JSON, en ignorant d'éventuelles lignes partielles aux bords. */
    protected jsonLines(text: string, opts?: { dropFirst?: boolean; dropLast?: boolean }): Array<Record<string, unknown>> {
        const lines = text.split('\n');
        if (opts?.dropFirst) { lines.shift(); }
        if (opts?.dropLast) { lines.pop(); }
        const out: Array<Record<string, unknown>> = [];
        for (const line of lines) {
            const s = line.trim();
            if (!s) { continue; }
            try {
                const d = JSON.parse(s);
                if (d && typeof d === 'object') { out.push(d); }
            } catch { /* ligne partielle / non-JSON */ }
        }
        return out;
    }

    protected clip(text: string, max = 160): string {
        const t = text.replace(/\s+/g, ' ').trim();
        return t.length > max ? t.slice(0, max - 1) + '…' : t;
    }

    protected basename(p: string): string {
        const parts = p.split(/[/\\]/).filter(Boolean);
        return parts[parts.length - 1] ?? p;
    }

    protected basenameNoExt(p: string): string {
        return this.basename(p).replace(/\.[^.]+$/, '');
    }
}
