import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { CodeFacts, ProjectGraph, extractCodeFacts, buildProjectGraph } from './assist-project-graph';
import { projectDirectory, readJson, safeProjectFile, writeJson, lockMemory, readProjectFile } from './assist-store';
import { AssistKnowledge, AssistProjectChange } from '../../common/fabi-assist-protocol';

const exec = promisify(execFile);
const excluded = /^(?:\.git|\.npmrc|\.pypirc|auth\.json|service-account(?:\..*)?|\.fabi|\.env(?:\..*)?|\.ssh|\.secrets|credentials(?:\..*)?|id_(?:rsa|ed25519)|node_modules|vendor|dist|build|coverage|\.next|\.venv|__pycache__|.*\.(?:pem|key|p12))$/i;
const generated = /(?:\.min\.[cm]?js|\.map|(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)|\.d\.ts)$/;
interface Entry extends CodeFacts {
    path: string; stamp: string; hash?: string; state: 'indexed' | 'binary' | 'large' | 'unreadable';
}
export interface Index { version: 1; parserVersion?: number; graph?: ProjectGraph; revision?: string; root: string; at: number; files: Entry[]; partial: boolean; excluded: number; changes: AssistProjectChange[]; }
const running = new Map<string, Promise<Index>>();
const progress = new Map<string, AssistKnowledge>();

async function inventory(root: string): Promise<{ paths: string[]; partial: boolean; excluded: number }> {
    let candidates: string[];
    let partial = false, omitted = 0;
    try {
        const result = await exec('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], { maxBuffer: 16 * 1024 * 1024, timeout: 15000 });
        candidates = result.stdout.split('\0').filter(Boolean);
    } catch {
        candidates = [];
        const pending = ['']; let visited = 0;
        while (pending.length && visited++ < 100000) {
            const dir = pending.pop()!;
            try {
                for (const item of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
                    if (excluded.test(item.name) || generated.test(item.name) || item.isSymbolicLink()) { omitted++; continue; }
                    const name = path.join(dir, item.name);
                    if (item.isDirectory()) pending.push(name); else if (item.isFile()) candidates.push(name);
                }
            } catch { partial = true; }
        }
        partial ||= pending.length > 0;
    }
    const paths = [...new Set(candidates)].filter(file => {
        const allowed = !file.split(/[\\/]/).some(part => excluded.test(part)) && !generated.test(file);
        if (!allowed) omitted++;
        return allowed;
    }).sort();
    return { paths: paths.slice(0, 50000), partial: partial || paths.length > 50000, excluded: omitted };
}

export function knowledgeSummary(index: Index): AssistKnowledge {
    const connections = new Map<string, number>();
    for (const edge of index.graph?.edges ?? []) {
        connections.set(edge.from, (connections.get(edge.from) ?? 0) + 1);
        connections.set(edge.to, (connections.get(edge.to) ?? 0) + 1);
    }
    const sources = new Set(index.files.filter(file => file.state === 'indexed' && file.symbols.length
        && !/(^|\/)(test|tests|__tests__|tools|scripts)(\/|$)|\.(test|spec)\./.test(file.path)).map(file => file.path));
    return { phase: 'ready', at: index.at, total: index.files.length, processed: index.files.length,
        indexed: index.files.filter(file => file.state === 'indexed').length, excluded: index.excluded,
        unreadable: index.files.filter(file => file.state === 'unreadable').length,
        partial: index.partial, symbols: index.files.reduce((n, f) => n + f.symbols.length, 0),
        technologies: [...new Set(index.files.flatMap(file => file.dependencies))].slice(0, 80),
        revision: index.revision, modules: index.graph?.modules.slice(0, 80).map(({ filePaths: _files, ...module }) => module), relations: index.graph?.edges.length, unresolved: index.graph?.unresolved.length,
        learningFiles: [...sources].sort((a, b) => (connections.get(b) ?? 0) - (connections.get(a) ?? 0) || a.localeCompare(b)).slice(0, 12),
        changes: index.changes.slice(-40) };
}

export async function refreshProjectIndex(project: string, home?: string): Promise<Index> {
    const { root, memory } = await projectDirectory(project, home);
    const key = memory;
    const existing = running.get(key); if (existing) return existing;
    const run = (async () => {
        const lease = await lockMemory(memory, 'index', true);
        try {
        const file = path.join(memory, 'project-index.json');
        const saved = await readJson<Index>(file).catch(() => undefined);
        const previous = saved?.version === 1 && saved.root === root ? saved : undefined;
        const old = new Map(previous?.files.map(entry => [entry.path, entry]));
        progress.set(key, { phase: 'inventory', total: 0, processed: 0, indexed: 0, excluded: 0, unreadable: 0, symbols: 0, partial: false, technologies: [], changes: [] });
        const listing = await inventory(root);
        const status = { ...progress.get(key)!, phase: 'indexing' as const, total: listing.paths.length, excluded: listing.excluded, partial: listing.partial };
        progress.set(key, status);
        const entries: Entry[] = [], changes: Index['changes'] = [];
        for (const name of listing.paths) {
            let entry: Entry = { path: name, stamp: '', state: 'unreadable', symbols: [], imports: [], dependencies: [] };
            try {
                const absolute = path.join(root, name), stat = await fs.lstat(absolute);
                if (stat.isSymbolicLink() || !stat.isFile()) { status.excluded++; continue; }
                if (stat.size > 256000) entry.state = 'large';
                else {
                    const verifiedPath = await safeProjectFile(root, name);
                    const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
                    const cached = old.get(name);
                    if (previous?.parserVersion === 5 && cached?.stamp === stamp) entry = cached;
                    else {
                        const text = await fs.readFile(verifiedPath, 'utf8');
                        const after = await fs.stat(absolute);
                        if (after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || after.size !== stat.size) throw new Error('changed while reading');
                        const hash = createHash('sha256').update(text).digest('hex');
                        entry = { ...entry, stamp, hash, state: text.includes('\0') ? 'binary' : 'indexed', ...(!text.includes('\0') ? extractCodeFacts(name, text) : {}) };
                        const changedSymbols = previous?.parserVersion === 5 ? entry.symbols.filter(symbol => symbol.parameters !== undefined && !cached?.symbols.some(oldSymbol => oldSymbol.name === symbol.name && oldSymbol.kind === symbol.kind && oldSymbol.scope === symbol.scope && oldSymbol.fingerprint === symbol.fingerprint)).map(symbol => symbol.scope && symbol.scope !== '<module>' ? `${symbol.scope}.${symbol.name}` : symbol.name).slice(0, 12) : [];
                        if (previous && cached?.hash !== hash) changes.push({ path: name, kind: cached ? 'modified' : 'created', at: Date.now(), symbolsChanged: changedSymbols, dependenciesAdded: entry.dependencies.filter(value => !cached?.dependencies.includes(value)), dependenciesRemoved: cached?.dependencies.filter(value => !entry.dependencies.includes(value)), importsAdded: entry.imports.filter(value => !cached?.imports.includes(value)), importsRemoved: cached?.imports.filter(value => !entry.imports.includes(value)) });
                    }
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    if (old.has(name)) changes.push({ path: name, kind: 'removed-from-inventory', at: Date.now() });
                    status.processed++; continue;
                }
                status.partial = true;
            }
            entries.push(entry); status.processed++; if (entry.state === 'indexed') status.indexed++;
        }
        const present = new Set(listing.paths);
        if (!listing.partial) for (const name of old.keys()) if (!present.has(name)) changes.push({ path: name, kind: 'removed-from-inventory', at: Date.now() });
        const revision = createHash('sha256').update(entries.map(f => `${f.path}:${f.hash ?? f.state}`).join('\n')).digest('hex');
        const graph = previous?.parserVersion === 5 && previous.revision === revision && previous.graph ? previous.graph : await buildProjectGraph(root, entries.filter(entry => entry.state === 'indexed'));
        const index: Index = { version: 1, parserVersion: 5, graph, revision, root, at: Date.now(), files: entries, partial: status.partial, excluded: status.excluded,
            changes: [...previous?.changes ?? [], ...changes].slice(-200) };
        lease.assertOwned(); await writeJson(file, index); progress.set(key, knowledgeSummary(index)); return index;
        } finally { await lease.release(); }
    })();
    running.set(key, run);
    try { return await run; } finally { running.delete(key); }
}

export async function projectKnowledge(project: string, home?: string): Promise<AssistKnowledge | undefined> {
    const { memory } = await projectDirectory(project, home);
    if (running.has(memory)) return progress.get(memory);
    const index = await readJson<Index>(path.join(memory, 'project-index.json')).catch(() => undefined);
    return index?.version === 1 ? knowledgeSummary(index) : undefined;
}

/** Bounded retrieval, never the complete inventory in a model context. Revalidate selected files at read time. */
export async function retrieveProjectKnowledge(project: string, query: string, home?: string) {
    const { memory } = await projectDirectory(project, home);
    const index = await readJson<Index>(path.join(memory, 'project-index.json')).catch(() => undefined);
    if (!index || index.version !== 1) return { available: false };
    const tokens = query.toLowerCase().match(/[\p{L}\d_./-]{3,}/gu)?.slice(0, 40) ?? [];
    const ranked = index.files.filter(f => f.state === 'indexed').map(file => {
        const haystack = `${file.path} ${file.symbols.map(s => s.name).join(' ')} ${file.imports.join(' ')} ${file.dependencies.join(' ')} ${(file.headings ?? []).map(h => h.title).join(' ')}`.toLowerCase();
        return { file, score: tokens.reduce((n, word) => n + (haystack.includes(word) ? 1 : 0), 0) };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
    const selected = new Set(ranked.map(item => item.file.path));
    const relations = index.graph?.edges.filter(edge => selected.has(edge.from) || selected.has(edge.to)).slice(0, 40) ?? [];
    const candidates = [...new Set([...selected, ...relations.flatMap(edge => [edge.from, edge.to])])].slice(0, 6);
    const excerpts = (await Promise.all(candidates.map(async name => {
        const entry = index.files.find(file => file.path === name);
        const symbol = entry?.symbols.find(item => tokens.includes(item.name.toLowerCase()));
        const line = Math.max(1, (symbol?.line ?? 1) - 4);
        try { return { path: name, line, text: (await readProjectFile(project, name, line)).slice(0, 4000) }; }
        catch { return undefined; }
    }))).filter((value): value is { path: string; line: number; text: string } => !!value);
    return { available: true, at: index.at, revision: index.revision, relations, excerpts, coverage: knowledgeSummary(index), provenance: 'Syntaxe, manifestes, titres documentaires et imports résolus par TypeScript. Les appels sont des sites syntaxiques, pas un graphe d’exécution. Relire les sources ; vérifier aussi les relations si elles ont changé.',
        matches: await Promise.all(ranked.map(async ({ file }) => {
            try {
                const current = await fs.readFile(await safeProjectFile(project, file.path), 'utf8');
                const valid = createHash('sha256').update(current).digest('hex') === file.hash;
                return { path: file.path, hash: file.hash, stale: !valid, symbols: valid ? file.symbols.slice(0, 30) : [], imports: valid ? file.imports.slice(0, 20) : [], calls: valid ? file.calls?.slice(0, 30) : [], headings: valid ? file.headings?.slice(0, 12) : [] };
            } catch { return { path: file.path, stale: true }; }
        })) };
}

// The standalone OpenCode runtime reuses these readers without loading the parser.
export { projectFilesPage, searchProjectSources, projectFileDiff } from './assist-project-tools';
