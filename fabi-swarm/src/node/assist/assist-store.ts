import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { AssistNotebook } from '../../common/fabi-assist-protocol';

export const assistHome = () => path.join(homedir(), '.config', 'fabi', 'assist');

export async function readJson<T>(file: string): Promise<T | undefined> {
    try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; }
        throw new Error(`Impossible de lire la mémoire Fabi Assist : ${path.basename(file)}`);
    }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
        await fs.rename(temp, file);
    } finally { await fs.rm(temp, { force: true }); }
}

export async function projectDirectory(project: string, home = assistHome()): Promise<{ root: string; memory: string }> {
    if (!path.isAbsolute(project)) { throw new Error('Ouvre un dossier de projet avant Fabi Assist.'); }
    const root = await fs.realpath(project);
    if (!(await fs.stat(root)).isDirectory()) { throw new Error('Le projet doit être un dossier.'); }
    const key = createHash('sha256').update(root).digest('hex');
    const memory = path.join(home, 'projects', key);
    await fs.mkdir(memory, { recursive: true, mode: 0o700 });
    return { root, memory };
}

export async function readNotebook(root: string, memory: string): Promise<AssistNotebook> {
    const book = await readJson<AssistNotebook>(path.join(memory, 'notebook.json'));
    if (book && (book.version !== 1 || book.project !== root || !Array.isArray(book.turns) || !Array.isArray(book.concepts))) {
        throw new Error('Format de mémoire inconnu ; le dossier est conservé intact.');
    }
    return book ?? { version: 1, project: root, concepts: [], turns: [] };
}

/** Resolve symlinks before checking containment; the tutor cannot read outside its project. */
export async function safeProjectEntry(root: string, requested: string): Promise<string> {
    root = await fs.realpath(root);
    const file = await fs.realpath(path.resolve(root, requested));
    const relative = path.relative(root, file);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
        throw new Error('Ce fichier est en dehors du projet.');
    }
    if (relative.split(path.sep).some(part => /^(?:\.git|\.npmrc|\.pypirc|auth\.json|service-account(?:\..*)?|\.secrets|\.ssh|node_modules|\.env(?:\..*)?|credentials(?:\..*)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12))$/i.test(part))) {
        throw new Error('Ce fichier contient potentiellement des secrets ou des données hors contexte.');
    }
    return file;
}

export async function safeProjectFile(root: string, requested: string): Promise<string> {
    const file = await safeProjectEntry(root, requested);
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 256_000) { throw new Error('Choisis un fichier texte de moins de 256 Ko.'); }
    return file;
}

export async function readProjectDirectory(root: string, requested = '.'): Promise<string> {
    const directory = await safeProjectEntry(root, requested);
    if (!(await fs.stat(directory)).isDirectory()) { throw new Error('Ce chemin n’est pas un dossier.'); }
    const entries: string[] = [];
    for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        try {
            const full = await safeProjectEntry(root, path.join(directory, item.name));
            entries.push(`${path.relative(root, full)}${(await fs.stat(full)).isDirectory() ? '/' : ''}`);
        } catch { /* No private names or links escaping the workspace. */ }
        if (entries.length >= 120) { break; }
    }
    return entries.join('\n') || '(dossier vide)';
}

/** Bounded traversal also works for projects which have not been committed to Git yet. */
export async function listProjectFiles(root: string, requested = '.', signal?: AbortSignal): Promise<string[]> {
    const first = await safeProjectEntry(root, requested);
    const pending = [first], files: string[] = [];
    let visited = 0;
    while (pending.length && files.length < 300 && visited++ < 80) {
        signal?.throwIfAborted();
        const directory = pending.shift()!;
        for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            if (item.isSymbolicLink()) { continue; }
            const candidate = path.join(directory, item.name);
            try {
                if (item.isDirectory()) { pending.push(await safeProjectEntry(root, candidate)); }
                else { files.push(path.relative(root, await safeProjectFile(root, candidate))); }
            } catch { /* Exclude private, generated, binary-sized, or inaccessible entries. */ }
            if (files.length >= 300) { break; }
        }
    }
    return files;
}

export async function readProjectFile(root: string, requested: string, line = 1): Promise<string> {
    const file = await safeProjectFile(root, requested);
    const content = await fs.readFile(file, 'utf8');
    if (content.includes('\0')) { throw new Error('Le fichier est binaire.'); }
    return redactSensitiveText(content).split('\n').slice(Math.max(0, line - 1), line + 119)
        .map((text, index) => `${line + index}: ${text}`).join('\n').slice(0, 16000);
}

/** Shared by all backend processes. A lost lease forbids committing stale state. */
export async function lockMemory(memory: string, name: 'notebook' | 'index' | 'understanding' | 'sessions' | 'corrections', wait = false): Promise<{ assertOwned(): void; release(): Promise<void> }> {
    const lockfile: { lock(file: string, options: object): Promise<() => Promise<void>> } = require('proper-lockfile');
    let compromised: Error | undefined;
    const release = await lockfile.lock(path.join(memory, name), { realpath: false, stale: 30000, update: 5000,
        retries: wait ? { retries: 40, minTimeout: 100, maxTimeout: 1000 } : 0,
        onCompromised: (error: Error) => { compromised = error; } }).catch(() => { throw new Error('Cette mémoire est utilisée dans une autre fenêtre. Réessaie dans un instant.'); });
    return { assertOwned: () => { if (compromised) throw new Error('La mémoire a changé dans une autre fenêtre. Réessaie cette opération.'); },
        release: async () => { await release().catch(() => {}); } };
}

/** Redact recognizable credentials before source excerpts leave the local reader. */
export function redactSensitiveText(text: string): string {
    return text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, value => '[clé privée retirée]' + '\n'.repeat(value.split('\n').length - 1))
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [secret]')
        .replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{16,}\b|\bAKIA[A-Z0-9]{16}\b/g, '[secret]')
        .replace(/\b((?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|TOKEN|SECRET|PASSWORD))\s*[:=]\s*(['"])[^'"\r\n]{8,}\2/gi, '$1 = "[secret]"')
        .replace(/^([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))=\S{8,}$/gm, '$1=[secret]');
}
