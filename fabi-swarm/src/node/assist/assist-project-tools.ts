import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Index } from './assist-project-index';
import { readJson, safeProjectFile, redactSensitiveText } from './assist-store';
const exec = promisify(execFile);

/** Paged, inventory-scoped tools shared by discovery and contextual teaching. */
export async function projectFilesPage(project: string, memory: string, query = '', offset = 0) {
    const index = await readJson<Index>(path.join(memory, 'project-index.json'));
    if (!index || index.root !== project) return { files: [], total: 0, unavailable: true };
    const files = index.files.filter(file => file.state === 'indexed' && file.path.toLowerCase().includes(query.toLowerCase()));
    return { files: files.slice(offset, offset + 100).map(file => ({ path: file.path, symbols: file.symbols.slice(0, 8) })), total: files.length,
        nextOffset: offset + 100 < files.length ? offset + 100 : undefined };
}
export async function searchProjectSources(project: string, memory: string, query: string, offset = 0) {
    const index = await readJson<Index>(path.join(memory, 'project-index.json'));
    if (!index || index.root !== project) return { matches: [], unavailable: true };
    const files = index.files.filter(file => file.state === 'indexed');
    const matches: { path: string; line: number; text: string }[] = [];
    let cursor = offset;
    for (; cursor < Math.min(files.length, offset + 1000); cursor++) {
        const file = files[cursor];
        try {
            const text = await fs.readFile(await safeProjectFile(project, file.path), 'utf8');
            if (text.includes('\0')) continue;
            for (const [line, content] of text.split('\n').entries()) if (content.toLowerCase().includes(query.toLowerCase())) {
                matches.push({ path: file.path, line: line + 1, text: redactSensitiveText(content).slice(0, 240) });
                if (matches.length >= 20) break;
            }
        } catch { /* Disappearing or newly private files are not model input. */ }
        if (matches.length >= 20) { cursor++; break; }
    }
    return { matches, scannedFiles: cursor - offset, nextOffset: cursor < files.length ? cursor : undefined, partial: cursor < files.length };
}

/** Git evidence is workspace-wide, never attributed to a coding agent. */
export async function projectFileDiff(project: string, requested: string): Promise<object> {
    const file = await safeProjectFile(project, requested), relative = path.relative(project, file);
    try {
        const result = await exec('git', ['-C', project, 'diff', '--no-ext-diff', '--no-textconv', '--unified=3', 'HEAD', '--', relative], { timeout: 5000, maxBuffer: 64000 });
        return { path: relative, baseline: 'HEAD', author: 'unknown', diff: redactSensitiveText(result.stdout).slice(0, 16000), truncated: result.stdout.length > 16000,
            note: result.stdout ? 'Comparaison du contenu de travail à HEAD ; peut regrouper plusieurs auteurs.' : 'Aucun diff contre HEAD. Un fichier non suivi ne figure pas dans cette comparaison.' };
    } catch { return { path: relative, unavailable: true, note: 'Comparaison Git indisponible (projet sans HEAD, hors Git ou diff trop volumineux).' }; }
}
