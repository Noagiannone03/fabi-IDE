import { discoverProjectUnderstanding, understandingStatus, inspectUnderstanding, correctUnderstanding } from './assist-project-understanding';
import { refreshProjectIndex, projectKnowledge, knowledgeSummary } from './assist-project-index';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { relative, join } from 'node:path';
import { promises as fs } from 'node:fs';
import { AssistNotebook, AssistLearningUpdate, FabiAssistClient, FabiAssistService } from '../../common/fabi-assist-protocol';
import { projectDirectory, readNotebook, readProjectFile, readProjectDirectory, safeProjectEntry, safeProjectFile, writeJson, lockMemory, redactSensitiveText } from './assist-store';
import { recordLesson } from './assist-learning';
import { runOpenCodeTutor } from './opencode-harness';
import { readCliContext, assertCliProcess } from './assist-cli-context';
import { JarvisProvider } from './jarvis-provider';

const requestSchema = z.object({
    id: z.string().min(1).max(100), project: z.string().min(1).max(4000),
    mode: z.enum(['explore', 'learn', 'brief', 'review', 'assist']), question: z.string().trim().min(1).max(16000),
    thread: z.object({ id: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/), kind: z.enum(['context', 'terminal']), title: z.string().max(160), terminalId: z.string().max(300).optional() }).optional(),
    origin: z.enum(['user', 'cli-review', 'rewrite']).optional(),
    answerTo: z.string().max(100).optional(),
    context: z.object({
        snapshot: z.object({ version: z.number().int(), dirty: z.boolean(), hash: z.string().max(64).optional(), range: z.object({ start: z.object({ line: z.number().int().min(0), character: z.number().int().min(0) }), end: z.object({ line: z.number().int().min(0), character: z.number().int().min(0) }) }).optional() }).optional(),
        cli: z.object({ source: z.string().max(40), sessionId: z.string().max(120).optional(), status: z.enum(['available', 'empty', 'unavailable', 'unbound']), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(3500) })).max(12), truncated: z.boolean() }).optional(),
        ide: z.object({ capturedAt: z.number(), activeFile: z.string().max(1000).optional(),
            activeExcerpt: z.object({ path: z.string().max(1000), text: z.string().max(10000), startLine: z.number().int().min(1) }).optional(),
            openFiles: z.array(z.object({ path: z.string().max(1000), dirty: z.boolean() })).max(40),
            events: z.array(z.object({ at: z.number(), kind: z.string().max(40), detail: z.string().max(1000) })).max(50),
            agents: z.array(z.object({ title: z.string().max(160), state: z.string().max(40), sessionId: z.string().max(120).optional(), observations: z.array(z.object({ at: z.number(), origin: z.enum(['hook', 'rollout', 'app-server']).optional(), eventId: z.string().max(200).optional(), sessionId: z.string().max(120), source: z.enum(['claude', 'codex']), phase: z.enum(['started', 'completed', 'failed']), tool: z.string().max(100), path: z.string().max(1000).optional() })).max(12).optional(), preview: z.string().max(1000).optional() })).max(12),
            changes: z.array(z.object({ path: z.string().max(1000), status: z.string().max(100) })).max(100)
        }).optional(),
        replyExcerpt: z.object({ title: z.string().max(160), text: z.string().max(4000) }).optional(),
        kind: z.enum(['file', 'directory', 'selection', 'terminal']).optional(),
        terminal: z.object({ id: z.string().max(300), title: z.string().max(300), selected: z.boolean() }).optional(),
        path: z.string().max(4000).optional(), text: z.string().max(16000).optional(),
        surrounding: z.object({ text: z.string().max(14000), startLine: z.number().int().min(1) }).optional(),
        startLine: z.number().int().min(1).optional(), endLine: z.number().int().min(1).optional(),
        activity: z.object({ title: z.string().max(1000), status: z.string().max(50), preview: z.string().max(12000).optional() }).optional()
    })
});
const projectsInFlight = new Set<string>();

/** One RPC service per client: progress and cancellation never leak across Spaces. */
export class AssistService implements FabiAssistService {
    private readonly discovery = new AbortController();
    private readonly runs = new Map<string, AbortController>();
    constructor(private readonly provider: JarvisProvider, private readonly client: FabiAssistClient,
        private readonly home?: string, private readonly run = runOpenCodeTutor) {}

    async cliContext(project: string, source: string, sessionId?: string) {
        const { root } = await projectDirectory(project, this.home);
        return readCliContext(root, source, sessionId);
    }
    assertCliProcess(pid: number, source: string) { return assertCliProcess(pid, source); }

    async updateLearning(project: string, input: AssistLearningUpdate): Promise<AssistNotebook> {
        const update = z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('preferences'), value: z.object({ depth: z.enum(['guided', 'concise', 'advanced']), minutes: z.union([z.literal(2), z.literal(5), z.literal(10)]), invitations: z.boolean() }) }),
            z.object({ kind: z.literal('journey'), id: z.string().max(100), action: z.enum(['pause', 'resume', 'next', 'previous']) }),
            z.object({ kind: z.literal('reset-concept'), id: z.string().max(100) }),
            z.object({ kind: z.literal('invitation'), id: z.string().max(2000), outcome: z.enum(['accepted', 'dismissed']) })
        ]).parse(input);
        const { root, memory } = await projectDirectory(project, this.home);
        const lease = await lockMemory(memory, 'notebook');
        try {
            const book = await readNotebook(root, memory);
            if (update.kind === 'invitation') book.invitations = [...(book.invitations ?? []).filter(item => item.id !== update.id), { id: update.id, at: Date.now(), outcome: update.outcome }].slice(-100);
            if (update.kind === 'preferences') book.preferences = update.value;
            if (update.kind === 'journey') {
                const journey = book.journeys?.find(item => item.id === update.id);
                if (!journey) throw new Error('Parcours introuvable.');
                if (update.action === 'pause' || update.action === 'resume') journey.paused = update.action === 'pause';
                else journey.cursor = Math.max(0, Math.min(journey.steps.length - 1, journey.cursor + (update.action === 'next' ? 1 : -1)));
                journey.updatedAt = Date.now(); // Navigation never changes demonstrated knowledge.
            }
            if (update.kind === 'reset-concept') {
                const concept = book.concepts.find(item => item.id === update.id);
                if (!concept) throw new Error('Notion introuvable.');
                concept.status = 'new'; concept.stage = 'discovered'; delete concept.evidence; delete concept.reviewAt; delete concept.attempts; delete concept.successes; delete concept.lastAttemptAt;
            }
            lease.assertOwned(); await writeJson(join(memory, 'notebook.json'), book); return book;
        } finally { await lease.release(); }
    }

    async reviewConcept(project: string, id: string): Promise<AssistNotebook> {
        const { root, memory } = await projectDirectory(project, this.home);
        if (projectsInFlight.has(root)) throw new Error('Attends la fin de la réponse pour ajuster cette notion.');
        projectsInFlight.add(root);
        let lease: Awaited<ReturnType<typeof lockMemory>> | undefined;
        try {
            lease = await lockMemory(memory, 'notebook');
            const book = await readNotebook(root, memory), concept = book.concepts.find(item => item.id === id);
            if (!concept) throw new Error('Cette notion n’appartient pas à ce projet.');
            concept.status = 'practicing'; concept.stage = 'reinforce'; concept.reviewAt = Date.now();
            concept.evidence = 'L’utilisateur demande de reprendre cette notion.';
            lease.assertOwned(); await writeJson(join(memory, 'notebook.json'), book); return book;
        } finally { await lease?.release(); projectsInFlight.delete(root); }
    }

    understandings(project: string) { return inspectUnderstanding(project, this.home); }
    correctUnderstanding(project: string, module: string, text: string) { return correctUnderstanding(project, module, text, this.home); }

    async refreshKnowledge(project: string, deep = false) {
        const index = await refreshProjectIndex(project, this.home);
        if (deep) {
            const { root, memory } = await projectDirectory(project, this.home);
            await discoverProjectUnderstanding(root, this.home, async (question, thread, signal) => {
                if (projectsInFlight.has(root)) throw new Error('Foreground learning has priority');
                const controller = new AbortController(), abort = () => controller.abort();
                signal.addEventListener('abort', abort, { once: true });
                const timer = setTimeout(abort, 120000);
                try { return await this.run(this.provider, { id: thread, project: root, mode: 'explore', question, context: {}, thread: { id: thread, kind: 'context', title: 'Découverte du projet' } }, await readNotebook(root, memory), memory, controller.signal, () => {}); }
                finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
            }, this.discovery.signal);
        }
        return { ...knowledgeSummary(index), understanding: await understandingStatus(project, this.home) };
    }
    async knowledge(project: string) {
        const state = await projectKnowledge(project, this.home);
        return state && { ...state, understanding: await understandingStatus(project, this.home) };
    }

    account() { return this.provider.account(); }

    async notebook(project: string): Promise<AssistNotebook> {
        const { root, memory } = await projectDirectory(project, this.home);
        const book = await readNotebook(root, memory);
        // Revalidate citations after reopening, including changes made while Fabi was closed.
        const hashes = new Map<string, string | undefined>();
        const contents = new Map<string, Promise<string>>();
        const content = (path: string) => {
            let reading = contents.get(path);
            if (!reading) { reading = safeProjectFile(root, path).then(file => fs.readFile(file, 'utf8')); contents.set(path, reading); }
            return reading;
        };
        for (const turn of book.turns) for (const source of turn.reply.sources) {
            if (!source.hash) continue;
            if (!hashes.has(source.path)) {
                try { hashes.set(source.path, createHash('sha256').update(await content(source.path)).digest('hex')); }
                catch { hashes.set(source.path, undefined); }
            }
            source.stale = hashes.get(source.path) !== source.hash;
        }
        for (const turn of book.turns) {
            const snapshot = turn.context.snapshot;
            if (!snapshot?.hash || !turn.context.path) continue;
            try {
                const text = await content(turn.context.path);
                const range = snapshot.range;
                const lines = range ? text.split('\n').slice(range.start.line, range.end.line + 1) : [];
                if (range && lines.length) {
                    lines[lines.length - 1] = lines[lines.length - 1].slice(0, range.end.character);
                    lines[0] = lines[0].slice(range.start.character);
                }
                const selected = (range ? lines.join('\n') : text).slice(0, 16000);
                snapshot.stale = createHash('sha256').update(selected).digest('hex') !== snapshot.hash;
            } catch { snapshot.stale = true; }
        }
        return book;
    }

    async ask(input: unknown): Promise<AssistNotebook> {
        const request = requestSchema.parse(input);
        request.question = redactSensitiveText(request.question);
        if (request.context.text) request.context.text = redactSensitiveText(request.context.text);
        if (request.context.surrounding) request.context.surrounding.text = redactSensitiveText(request.context.surrounding.text);
        if (request.context.ide?.activeExcerpt) request.context.ide.activeExcerpt.text = redactSensitiveText(request.context.ide.activeExcerpt.text);
        if (request.context.activity?.preview) request.context.activity.preview = redactSensitiveText(request.context.activity.preview);
        for (const message of request.context.cli?.messages ?? []) message.text = redactSensitiveText(message.text);
        for (const agent of request.context.ide?.agents ?? []) if (agent.preview) agent.preview = redactSensitiveText(agent.preview);

        const { root, memory } = await projectDirectory(request.project, this.home);
        if (projectsInFlight.has(root) || this.runs.has(request.id)) { throw new Error('Une réponse est déjà en cours pour ce projet.'); }
        const controller = new AbortController();
        this.runs.set(request.id, controller);
        projectsInFlight.add(root);
        let lease: Awaited<ReturnType<typeof lockMemory>> | undefined;
        const timeout = setTimeout(() => controller.abort(new Error('Le délai de réponse a été dépassé. Réessaie.')), 180000);
        try {
            lease = await lockMemory(memory, 'notebook');
            const book = await readNotebook(root, memory);
            if (book.turns.some(turn => turn.id === request.id)) { return book; }
            if (request.answerTo && !book.turns.some(turn => turn.reply.exercise?.id === request.answerTo && turn.thread?.id === request.thread?.id)) {
                throw new Error('Cet exercice n’appartient pas à ce projet.');
            }
            if (request.context.kind === 'terminal') {
                delete request.context.path; delete request.context.startLine; delete request.context.endLine;
            }
            if (request.context.ide?.activeExcerpt) {
                try { await safeProjectFile(root, request.context.ide.activeExcerpt.path); }
                catch { delete request.context.ide.activeExcerpt; }
            }
            if (request.context.path) {
                const entry = await safeProjectEntry(root, request.context.path);
                request.context.path = relative(root, entry) || '.';
                if ((await fs.stat(entry)).isDirectory()) {
                    request.context.kind = 'directory';
                    request.context.text = await readProjectDirectory(root, entry);
                } else {
                    await safeProjectFile(root, entry);
                    request.context.kind ??= 'file';
                    if (!request.context.text) { request.context.text = await readProjectFile(root, entry, request.context.startLine ?? 1); }
                }
            }
            if (request.context.snapshot && request.context.text) request.context.snapshot.hash = createHash('sha256').update(request.context.text).digest('hex');
            const snapshot = await refreshProjectIndex(root, this.home);
            const versions = new Map(snapshot.files.map(file => [file.path, file.hash]));
            this.client.onProgress({ id: request.id, text: 'Connexion au GPU Jarvis…', phase: 'connecting' });
            const lesson = await this.run(this.provider, request, book, memory, controller.signal,
                (text, detail) => this.client.onProgress({ id: request.id, text, ...detail }));
            controller.signal.throwIfAborted();
            // Qwen occasionally puts documentation URLs in the local citations.
            // Normalize them without trying to resolve an HTTPS URL on disk.
            const localSources = [];
            for (const source of lesson.sources) {
                if (/^https?:\/\//i.test(source.path)) {
                    const url = new URL(source.path);
                    if (!url.username && !url.password) {
                        lesson.webSources ??= [];
                        if (!lesson.webSources.some(item => item.url === url.href) && lesson.webSources.length < 6) {
                            lesson.webSources.push({ title: url.hostname, url: url.href });
                        }
                    }
                    continue;
                }
                try {
                    const file = await safeProjectFile(root, source.path), name = relative(root, file);
                    const text = await fs.readFile(file, 'utf8');
                    if (source.line > text.split('\n').length) continue;
                    const hash = versions.get(name), current = createHash('sha256').update(text).digest('hex');
                    localSources.push({ ...source, path: name, hash: hash ?? current, stale: !hash || hash !== current });
                }
                catch { /* An invalid citation must not discard a complete explanation. */ }
            }
            lesson.sources = localSources;
            for (const step of [...lesson.diagram?.steps ?? [], ...lesson.journey?.steps ?? []]) {
                if (step.source && !localSources.some(source => source.path === step.source!.path && source.line === step.source!.line)) delete step.source;
            }
            if (lesson.webSources) { lesson.webSources = lesson.webSources.filter(source => /^https?:\/\//i.test(source.url)); }
            // A contextual explanation must never depend on curriculum prerequisites.
            if (['explore', 'assist', 'brief', 'review'].includes(request.mode) && !request.answerTo) {
                // Keep observed exposure, without injecting a curriculum into a contextual answer.
                lesson.concepts = lesson.concepts.filter(concept => !concept.prerequisites.length);
                if (['brief', 'review'].includes(request.mode)) lesson.concepts = [];
                delete lesson.exercise; delete lesson.assessment; delete lesson.journey;
            }
            if (['assist', 'brief'].includes(request.mode) && !['relay', 'develop'].includes(lesson.intent ?? '')) delete lesson.developerPrompt;
            if (['review', 'explore', 'learn'].includes(request.mode)) delete lesson.developerPrompt;
            // Exercise identity belongs to the application, not to model-generated labels.
            if (lesson.exercise) { lesson.exercise.id = 'exercise-' + createHash('sha256').update(request.id).digest('hex').slice(0, 24); }
            const next = recordLesson(book, request, lesson);
            // Atomic authoritative record. A failed/aborted turn never counts as learning.
            lease.assertOwned(); await writeJson(join(memory, 'notebook.json'), next);
            return next;
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error(controller.signal.reason instanceof Error && /délai/.test(controller.signal.reason.message)
                    ? 'Le GPU a dépassé le délai de réponse. Ton parcours est conservé ; réessaie dans un instant.'
                    : 'Réponse arrêtée. Ton parcours précédent est conservé.');
            }
            // Provider libraries may attach request headers to errors: never serialize them through RPC.
            const message = error instanceof Error ? error.message : 'La réponse n’a pas pu être produite.';
            if (/recursion limit|model call limit/i.test(message)) {
                throw new Error('Le professeur n’a pas réussi à conclure cette explication. Ta question et ton parcours sont conservés. Essaie une sélection plus précise.');
            }
            throw new Error(message.replace(/Bearer\s+\S+|(?:sk-|eyJ)[A-Za-z0-9._-]{15,}/g, '[secret]').slice(0, 600));
        } finally {
            clearTimeout(timeout); await lease?.release(); this.runs.delete(request.id); projectsInFlight.delete(root);
        }
    }

    async cancel(id: string): Promise<void> { this.runs.get(id)?.abort(); }
    dispose(): void { this.discovery.abort(); for (const controller of this.runs.values()) { controller.abort(); } }
}
