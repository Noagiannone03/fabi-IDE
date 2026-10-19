import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { AssistKnowledge, AssistSource, AssistUnderstanding, AssistKnowledgeClaim } from '../../common/fabi-assist-protocol';
import { Lesson } from './assist-learning';
import { refreshProjectIndex } from './assist-project-index';
import { projectDirectory, readJson, safeProjectFile, writeJson, lockMemory, redactSensitiveText } from './assist-store';

export interface ModuleUnderstanding {
    claims?: AssistKnowledgeClaim[]; uncertainties?: string[];
    path: string; fingerprint: string; at: number; title: string; explanation: string;
    sources: AssistSource[]; readFiles: string[]; totalFiles: number;
    provenance: 'model-interpretation';
}
interface Understanding { version: 1; modules: ModuleUnderstanding[]; failures: { path: string; at: number }[]; }
const jobs = new Map<string, Promise<void>>();
const states = new Map<string, NonNullable<AssistKnowledge['understanding']>>();
let backgroundQueue = Promise.resolve();

type ProjectIndex = Awaited<ReturnType<typeof refreshProjectIndex>>;
function moduleFingerprint(index: ProjectIndex, directory: string): string | undefined {
    if (directory === '@project') return index.revision;
    const module = index.graph?.modules.find(item => item.path === directory);
    if (!module) return;
    const members = new Set(module.filePaths);
    const related = index.graph!.edges.filter(edge => members.has(edge.from) || members.has(edge.to));
    const hashes = new Map(index.files.map(file => [file.path, file.hash]));
    return createHash('sha256').update([...new Set([...members, ...related.flatMap(edge => [edge.from, edge.to])])].sort().map(name => `${name}:${hashes.get(name) ?? ''}`).join('\n')).digest('hex');
}

/** One background module at a time, cached by its files and direct local dependencies. */
export async function discoverProjectUnderstanding(project: string, home: string | undefined, analyze: (question: string, thread: string, signal: AbortSignal) => Promise<Lesson>, signal: AbortSignal): Promise<void> {
    const { root, memory } = await projectDirectory(project, home);
    const existing = jobs.get(memory); if (existing) return existing;
    const job = (async () => {
        const index = await refreshProjectIndex(root, home), modules = [...index.graph?.modules ?? []];
        if (modules.length > 1) modules.push({ path: '@project', filePaths: index.files.map(file => file.path), files: index.files.length,
            symbols: index.files.reduce((count, file) => count + file.symbols.length, 0), dependencies: [...new Set(modules.flatMap(module => module.dependencies))], entryPoints: modules.flatMap(module => module.entryPoints).slice(0, 24), documentation: modules.flatMap(module => module.documentation).slice(0, 24) });
        const lease = await lockMemory(memory, 'understanding', true);
        try {
            const file = join(memory, 'project-understanding.json');
            const book = await readJson<Understanding>(file) ?? { version: 1, modules: [], failures: [] };
            const status: NonNullable<AssistKnowledge['understanding']> = { phase: 'exploring', completed: 0, total: modules.length, reviewedFiles: 0, failed: 0 };
            states.set(memory, status);
            const reviewed = new Set<string>();
            const hashes = new Map(index.files.map(entry => [entry.path, entry.hash]));
            for (const module of modules) {
                signal.throwIfAborted();
                const members = new Set(module.filePaths);
                const related = index.graph!.edges.filter(edge => members.has(edge.from) || members.has(edge.to));
                const fingerprint = moduleFingerprint(index, module.path)!;
                let summary = book.modules.find(item => item.path === module.path && item.fingerprint === fingerprint && item.claims !== undefined);
                if (!summary) {
                    status.current = module.path;
                    const task = async () => {
                        signal.throwIfAborted();
                        const overview = module.path === '@project' ? 'Vue globale : relie les responsabilités des modules et le flux principal à partir des synthèses suivantes, en revérifiant les passages déterminants. ' + book.modules.filter(item => item.path !== '@project' && moduleFingerprint(index, item.path) === item.fingerprint).map(item => `${item.path}: ${item.explanation.slice(0, 600)}`).join('\n').slice(0, 16000) : '';
                        const question = overview + `Découverte initiale du module ${module.path}. Inventaire : ${module.files} fichiers, ${module.symbols} symboles. Dépendances déclarées : ${module.dependencies.join(', ')}. Points d’entrée candidats : ${module.entryPoints.join(', ')}. Documents : ${module.documentation.join(', ')}. Fichiers : ${module.filePaths.slice(0, 120).join(', ')}${module.files > 120 ? ' (liste tronquée ; utilise fabi_files pour approfondir)' : ''}. Lis les documents de conventions, les points d’entrée et les responsabilités principales. Explore les relations importantes : ${JSON.stringify(related.slice(0, 30))}. Retourne knowledge avec 3 à 5 constats courts (kind code, documentation, hypothesis ou historical-decision), leurs sources et les incertitudes. Une décision historique exige une trace documentaire. Produis une synthèse courte des responsabilités, du flux principal, des conventions et des incertitudes. Distingue les faits lus, les indications documentaires et tes hypothèses. N’invente ni motivation historique ni couverture exhaustive. Cite les passages effectivement lus. Aucun exercice, parcours ou recherche web : c’est la découverte du code local.`;
                        return analyze(question, 'knowledge-' + createHash('sha256').update(module.path + fingerprint).digest('hex').slice(0, 24), signal);
                    };
                    const result = backgroundQueue.then(task, task);
                    backgroundQueue = result.then(() => {}, () => {});
                    try {
                        const lesson = await result;
                        signal.throwIfAborted();
                        const sources: AssistSource[] = [];
                        for (const source of lesson.sources) {
                            try {
                                const current = createHash('sha256').update(await fs.readFile(await safeProjectFile(root, source.path))).digest('hex');
                                if (current !== hashes.get(source.path)) continue;
                                sources.push({ ...source, hash: current });
                            } catch { /* Never retain inaccessible or concurrently changed evidence. */ }
                        }
                        if (!sources.length) throw new Error('No verified evidence');
                        if (moduleFingerprint(await refreshProjectIndex(root, home), module.path) !== fingerprint) throw new Error('Module changed during discovery');
                        const claims = (lesson.knowledge?.claims ?? []).map(claim => ({ ...claim, sources: claim.sources.filter(source => sources.some(verified => verified.path === source.path && verified.line === source.line)) }))
                            .filter(claim => claim.kind === 'hypothesis' || claim.sources.length > 0)
                            .filter(claim => !['documentation', 'historical-decision'].includes(claim.kind) || claim.sources.some(source => /\.(md|mdx|rst|adoc|txt)$|(?:^|\/)README$/i.test(source.path)));
                        summary = { claims, uncertainties: lesson.knowledge?.uncertainties, path: module.path, fingerprint, at: Date.now(), title: lesson.title, explanation: lesson.explanation, sources,
                            readFiles: lesson.readFiles ?? sources.map(source => source.path), totalFiles: module.files, provenance: 'model-interpretation' };
                        book.modules = [...book.modules.filter(item => item.path !== module.path), summary];
                        book.failures = book.failures.filter(item => item.path !== module.path);
                    } catch {
                        signal.throwIfAborted(); status.failed++;
                        book.failures = [...book.failures.filter(item => item.path !== module.path), { path: module.path, at: Date.now() }];
                    }
                    lease.assertOwned(); await writeJson(file, book);
                }
                status.completed++;
                summary?.readFiles.forEach(file => reviewed.add(file)); status.reviewedFiles = reviewed.size;
            }
            book.modules = book.modules.filter(item => modules.some(module => module.path === item.path));
            book.failures = book.failures.filter(item => modules.some(module => module.path === item.path));
            lease.assertOwned(); await writeJson(file, book);
            status.introduction = (book.modules.find(item => item.path === '@project') ?? book.modules[0])?.explanation.slice(0, 400);
            status.phase = status.failed ? 'partial' : 'ready'; delete status.current;
        } finally { await lease.release(); }
    })();
    jobs.set(memory, job);
    try { await job; } finally { jobs.delete(memory); const state = states.get(memory); if (state?.phase === 'exploring') state.phase = 'partial'; }
}

export async function understandingStatus(project: string, home?: string): Promise<AssistKnowledge['understanding']> {
    const { memory } = await projectDirectory(project, home);
    if (jobs.has(memory) && states.has(memory)) return states.get(memory);
    const saved = await readJson<Understanding>(join(memory, 'project-understanding.json')).catch(() => undefined);
    if (!saved) return;
    const index = await readJson<ProjectIndex>(join(memory, 'project-index.json')).catch(() => undefined);
    const paths = (index?.graph?.modules ?? []).map(module => module.path);
    if (paths.length > 1) paths.push('@project');
    const fresh = saved.modules.filter(module => index && paths.includes(module.path) && moduleFingerprint(index, module.path) === module.fingerprint);
    const failed = saved.failures.filter(failure => paths.includes(failure.path) && !fresh.some(module => module.path === failure.path)).length;
    return { phase: fresh.length < paths.length || failed ? 'partial' : 'ready', completed: fresh.length, total: paths.length,
        reviewedFiles: new Set(fresh.flatMap(module => module.readFiles)).size, failed,
        introduction: (fresh.find(module => module.path === '@project') ?? fresh[0])?.explanation.slice(0, 400) };
}

export async function retrieveUnderstanding(project: string, query: string, home?: string): Promise<ModuleUnderstanding[]> {
    const { root, memory } = await projectDirectory(project, home);
    const saved = await readJson<Understanding>(join(memory, 'project-understanding.json')).catch(() => undefined);
    const index = await readJson<ProjectIndex>(join(memory, 'project-index.json')).catch(() => undefined);
    const tokens: string[] = query.toLowerCase().match(/[\p{L}\d_-]{3,}/gu) ?? [];
    const matches = (saved?.modules ?? []).map(module => ({ module, score: tokens.reduce((score, token) => score + (`${module.path} ${module.title} ${module.explanation}`.toLowerCase().includes(token) ? 1 : 0), 0) })).filter(item => item.score).sort((a, b) => b.score - a.score).slice(0, 3);
    const corrections = await readJson<Record<string, string>>(join(memory, 'project-corrections.json')).catch(() => undefined);
    const valid: ModuleUnderstanding[] = [];
    for (const { module } of matches) {
        if (!index || moduleFingerprint(index, module.path) !== module.fingerprint) continue;
        let fresh = true;
        for (const source of module.sources) {
            try { if (createHash('sha256').update(await fs.readFile(await safeProjectFile(root, source.path))).digest('hex') !== source.hash) fresh = false; }
            catch { fresh = false; }
        }
        if (fresh) valid.push({ ...module, ...(corrections?.[module.path] ? { userCorrection: corrections[module.path] } : {}) });
    }
    return valid;
}

export async function inspectUnderstanding(project: string, home?: string): Promise<AssistUnderstanding[]> {
    const { memory } = await projectDirectory(project, home);
    const saved = await readJson<Understanding>(join(memory, 'project-understanding.json')).catch(() => undefined);
    const index = await refreshProjectIndex(project, home);
    const corrections = await readJson<Record<string, string>>(join(memory, 'project-corrections.json')).catch(() => undefined);
    return (saved?.modules ?? []).slice(0, 100).map(module => ({ ...module, correction: corrections?.[module.path], stale: !index || moduleFingerprint(index, module.path) !== module.fingerprint }));
}
export async function correctUnderstanding(project: string, module: string, text: string, home?: string): Promise<void> {
    if (module.length > 1000 || text.length > 2000) throw new Error('Note trop longue.');
    const { memory } = await projectDirectory(project, home);
    const saved = await readJson<Understanding>(join(memory, 'project-understanding.json'));
    if (!saved?.modules.some(item => item.path === module)) throw new Error('Module inconnu.');
    const lease = await lockMemory(memory, 'corrections');
    try {
        const file = join(memory, 'project-corrections.json'), notes = await readJson<Record<string, string>>(file) ?? {};
        if (text.trim()) notes[module] = redactSensitiveText(text.trim()); else delete notes[module];
        lease.assertOwned(); await writeJson(file, notes);
    } finally { await lease.release(); }
}
