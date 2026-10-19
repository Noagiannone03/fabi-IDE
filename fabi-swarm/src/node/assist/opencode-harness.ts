import { retrieveUnderstanding } from './assist-project-understanding';
import { retrieveProjectKnowledge } from './assist-project-index';
import { spawn, ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { AssistNotebook, AssistRequest } from '../../common/fabi-assist-protocol';
import { JarvisProvider } from './jarvis-provider';
import { assistHome, readJson, writeJson, safeProjectFile, lockMemory } from './assist-store';
import { Lesson, lessonSchema, recordLesson } from './assist-learning';
import { teachingPrompt } from './assist-prompts';
import { teachingState } from './assist-pedagogy';

/** An authenticated, application-owned OpenCode server. The upstream runtime owns
 * sessions, tool execution, web search/fetch, context compaction and schema repair. */
class AssistOpenCode {
    stopped = false;
    private child?: ChildProcess;
    private pluginFile?: string;
    private url = '';
    private readonly authorization = 'Basic ' + Buffer.from('opencode:' + randomBytes(32).toString('hex')).toString('base64');
    private readonly exit = () => {
        try { if (this.child?.pid && process.platform !== 'win32') { process.kill(-this.child.pid, 'SIGTERM'); } else { this.child?.kill('SIGTERM'); } } catch { /* already stopped */ }
    };
    async start(config: Awaited<ReturnType<JarvisProvider['config']>>): Promise<void> {
        const home = join(assistHome(), 'opencode');
        await fs.mkdir(home, { recursive: true, mode: 0o700 });
        const binary = process.env.FABI_ASSIST_OPENCODE_BIN || join(dirname(require.resolve('opencode-ai/package.json')), 'bin', 'opencode');
        // A bundled backend has no sibling ./assist-store.js, and Bun cannot read app.asar.
        // Prefer the standalone artifact shipped beside OpenCode; the package path is for source development.
        let toolBundle = join(dirname(binary), 'assist-tools.mjs');
        try { await fs.access(toolBundle); }
        catch { toolBundle = require.resolve('fabi-swarm/lib/assist-tools.mjs'); }
        const permissions = { '*': 'deny', read: 'deny', glob: 'deny', grep: 'deny', list: 'deny', fabi_read: 'allow', fabi_search: 'allow', fabi_files: 'allow', fabi_diff: 'allow', websearch: 'allow', webfetch: 'allow', fabi_context: 'allow', StructuredOutput: 'allow', external_directory: 'deny' };
        const plugin = this.pluginFile = join(home, `context-budget-${process.pid}-${randomBytes(6).toString('hex')}.mjs`);
        await fs.writeFile(plugin, `import { readFile } from 'node:fs/promises';
        import { join } from 'node:path';
        const runtime = await import(${JSON.stringify(pathToFileURL(toolBundle).href)});
        const { z, readProjectFile, projectFilesPage, searchProjectSources, projectFileDiff } = runtime.default ?? runtime;
        const capture = async (context) => {
            if (!/^ses_[a-zA-Z0-9]+$/.test(context.sessionID)) throw new Error('Session invalide');
            return JSON.parse(await readFile(join(${JSON.stringify(join(home, 'contexts'))}, context.sessionID + '.json'), 'utf8'));
        };
        export const FabiContextBudget = async () => ({
            tool: {
                fabi_read: { description: 'Lire un fichier texte du projet. Chemin relatif et ligne de départ. Les fichiers privés et les liens extérieurs sont refusés.',
                    args: { path: z.string().max(1000), line: z.number().int().min(1).optional() },
                    execute: async (args, context) => { const data = await capture(context); return readProjectFile(data.project, args.path, args.line ?? 1); } },
                fabi_files: { description: 'Naviguer dans l’inventaire complet. query filtre les chemins, offset permet de poursuivre les pages. Les symboles orientent la lecture.',
                    args: { query: z.string().max(120).optional(), offset: z.number().int().min(0).optional() },
                    execute: async (args, context) => { const data = await capture(context); return JSON.stringify(await projectFilesPage(data.project, data.memory, args.query ?? '', args.offset ?? 0)); } },
                fabi_diff: { description: 'Comparer un fichier autorisé au HEAD Git. Ne prouve pas quel agent a modifié le fichier. Un fichier non suivi peut ne pas avoir de diff.', args: { path: z.string().max(1000) }, execute: async (args, context) => { const data = await capture(context); return JSON.stringify(await projectFileDiff(data.project, args.path)); } },
                fabi_search: { description: 'Chercher un texte littéral dans les sources autorisées du projet. Renvoie fichiers, lignes et extraits. Si partial, poursuivre avec nextOffset si nécessaire.',
                    args: { query: z.string().min(2).max(120), offset: z.number().int().min(0).optional() },
                    execute: async (args, context) => { const data = await capture(context); return JSON.stringify(await searchProjectSources(data.project, data.memory, args.query, args.offset ?? 0)); } },
                fabi_context: {
                description: 'Lire la capture Fabi de cette demande : IDE, session CLI exacte, messages récents et statut. La date indique la fraîcheur ; une capture ne prouve pas une exécution. Aucun argument ni chemin arbitraire.',
                args: {},
                execute: async (_args, context) => {
                    if (!/^ses_[a-zA-Z0-9]+$/.test(context.sessionID)) return JSON.stringify({ error: 'Session invalide' });
                    try { return await readFile(join(${JSON.stringify(join(home, 'contexts'))}, context.sessionID + '.json'), 'utf8'); }
                    catch { return JSON.stringify({ error: 'Capture indisponible. Utilise le contexte fourni dans la demande ; ne suppose pas un historique vide.' }); }
                }
            } },
            config: async (config) => {
                const options = config.provider?.jarvis?.options;
                if (!options) return;
                const upstream = options.fetch ?? globalThis.fetch;
                options.fetch = (input, init) => {
                    if (typeof init?.body === 'string') {
                        const body = JSON.parse(init.body);
                        // vLLM's required tool grammar is extremely slow for the
                        // nested teaching schema. Qwen supports native auto tools;
                        // OpenCode still owns the loop and Fabi validates the result.
                        if (body.tool_choice === 'required' && body.tools?.some(tool => tool.function?.name === 'StructuredOutput')) {
                            const repairing = body.messages.some(message => message.role === 'system' && JSON.stringify(message.content).includes('FABI_STRUCTURED_REPAIR'));
                            body.tool_choice = 'auto';
                            if (repairing) body.tools = body.tools.filter(tool => tool.function?.name === 'StructuredOutput');
                            return upstream(input, { ...init, body: JSON.stringify(body) });
                        }
                    }
                    return upstream(input, init);
                };
            },
            'tool.execute.after': async (input, output) => {
                if (typeof output.output === 'string' && output.output.length > 9000)
                    output.output = output.output.slice(0, 9000) + '\\n[Extrait limité : utilise une recherche ciblée si une information manque.]';
            }
        });`, { mode: 0o600 });
        const settings = { model: `jarvis/${config.model}`, small_model: `jarvis/${config.model}`, share: 'disabled', autoupdate: false,
            plugin: [plugin], enabled_providers: ['jarvis'], permission: permissions,
            provider: { jarvis: { npm: '@ai-sdk/openai-compatible', name: 'Jarvis', options: { baseURL: config.baseURL, apiKey: config.apiKey },
                models: { [config.model]: { name: config.model, tool_call: true, limit: { context: 65536, output: 2048 },
                    options: { chat_template_kwargs: { enable_thinking: false }, parallel_tool_calls: false } } } } },
            agent: { 'fabi-teacher': { mode: 'primary', prompt: 'Tu es le professeur Fabi. Applique le contrat pédagogique du message système. Quelques recherches ciblées puis StructuredOutput pour terminer.', description: 'Professeur Fabi en lecture seule', temperature: 0.2, permission: permissions } }
        };
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => { this.stop(); reject(new Error('OpenCode ne démarre pas. Réessaie.')); }, 30000);
            const child = this.child = spawn(binary, ['serve', '--hostname=127.0.0.1', '--port=0'], { cwd: home, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(settings), OPENCODE_SERVER_PASSWORD: Buffer.from(this.authorization.slice(6), 'base64').toString().split(':')[1],
                    OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_ENABLE_EXA: '1',
                    XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache') }
            });
            let output = '';
            const chunk = (data: Buffer) => {
                output = (output + data.toString()).slice(-8000);
                const match = output.match(/listening on\s+(http:\/\/127\.0\.0\.1:\d+)/);
                if (match) { this.url = match[1]; clearTimeout(timeout); resolve(); }
            };
            child.stdout?.on('data', chunk); child.stderr?.on('data', chunk);
            child.once('error', () => { this.stopped = true; clearTimeout(timeout); reject(new Error('Le moteur OpenCode est indisponible.')); });
            child.once('exit', () => { this.stopped = true; clearTimeout(timeout); this.url = ''; reject(new Error('Le moteur OpenCode s’est arrêté.')); });
        });
        process.once('exit', this.exit);
    }
    stop(): void { if (this.pluginFile) void fs.rm(this.pluginFile, { force: true }).catch(() => {}); this.stopped = true; process.removeListener('exit', this.exit); this.exit(); this.url = ''; }
    async call(path: string, project: string, body?: unknown, signal?: AbortSignal, method?: 'DELETE'): Promise<any> {
        if (!this.url) { throw new Error('Le moteur OpenCode est arrêté. Relance Fabi Assist.'); }
        const response = await fetch(this.url + path, { method: method ?? (body === undefined ? 'GET' : 'POST'),
            headers: { authorization: this.authorization, 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent(project) },
            body: body === undefined ? undefined : JSON.stringify(body), signal });
        if (!response.ok) { await response.body?.cancel(); throw new Error(`OpenCode n’a pas pu répondre (HTTP ${response.status}).`); }
        return response.status === 204 ? undefined : response.json();
    }
}
let runtime: { key: string; engine: AssistOpenCode; ready: Promise<void> } | undefined;
export async function stopAssistOpenCode(): Promise<void> { runtime?.engine.stop(); runtime = undefined; }

export async function runOpenCodeTutor(provider: JarvisProvider, request: AssistRequest, book: AssistNotebook,
    memory: string, signal: AbortSignal, progress: (text: string, detail?: { phase: 'connecting' | 'thinking' | 'tool' | 'writing'; tool?: string }) => void, repairAttempt = 0, verifiedEarlier: string[] = []): Promise<Lesson> {
    const outputSchema = request.thread?.id.startsWith('knowledge-') ? lessonSchema.omit({ exercise: true, assessment: true, developerPrompt: true, journey: true }).extend({ knowledge: lessonSchema.shape.knowledge.unwrap() }) : request.answerTo
        ? lessonSchema.omit({ exercise: true }).extend({ assessment: lessonSchema.shape.assessment.unwrap() })
        : request.mode === 'explore'
            ? lessonSchema.omit({ exercise: true, assessment: true, developerPrompt: true, journey: true })
            : ['assist', 'brief'].includes(request.mode) ? lessonSchema.omit({ exercise: true, assessment: true }).extend({ intent: lessonSchema.shape.intent.unwrap() }) : request.mode === 'learn' && !book.journeys?.length ? lessonSchema.extend({ journey: lessonSchema.shape.journey.unwrap() }) : lessonSchema;
    const config = await provider.config();
    const key = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    if (!runtime || runtime.key !== key || runtime.engine.stopped) {
        runtime?.engine.stop();
        const engine = new AssistOpenCode(); runtime = { key, engine, ready: engine.start(config) };
        runtime.ready.catch(() => { if (runtime?.engine === engine) { runtime = undefined; } });
    }
    const instance = runtime;
    await instance.ready; signal.throwIfAborted();
    const sessionsFile = join(memory, 'opencode-sessions.json');
    const thread = request.thread?.id ?? 'legacy';
    const sessionLease = await lockMemory(memory, 'sessions', true);
    let session: string;
    try {
        const sessions = await readJson<Record<string, string>>(sessionsFile) ?? {};
        session = sessions[thread];
        if (!session) {
            const created = await instance.engine.call('/session', book.project, { title: request.thread?.title ?? request.question.slice(0, 80) }, signal);
            session = sessions[thread] = created.id;
            sessionLease.assertOwned(); await writeJson(sessionsFile, sessions);
        }
    } finally { await sessionLease.release(); }
    if (!/^ses_[a-zA-Z0-9]+$/.test(session)) throw new Error('Identifiant de session OpenCode invalide.');
    await writeJson(join(assistHome(), 'opencode', 'contexts', session + '.json'), { capturedAt: Date.now(), project: book.project, memory, context: request.context });
    const abort = () => { void instance.engine.call(`/session/${session}/abort`, book.project, {}, AbortSignal.timeout(3000)).catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    progress('Je réfléchis à ta demande…', { phase: 'thinking' });
    try {
        // Match OpenCode's chronological 48-bit timestamp/counter prefix so
        // subsequent turns remain ordered relative to native assistant messages.
        const order = (BigInt(Date.now()) * BigInt(4096) + BigInt(1)) & BigInt('0xffffffffffff');
        const messageID = `msg_${order.toString(16).padStart(12, '0')}${randomBytes(7).toString('hex')}`;
        const knowledge = await retrieveProjectKnowledge(book.project, request.question + ' ' + (request.context.path ?? ''), dirname(dirname(memory)));
        await instance.engine.call(`/session/${session}/prompt_async`, book.project, {
            messageID,
            agent: 'fabi-teacher', model: { providerID: 'jarvis', modelID: config.model },
            system: teachingPrompt(request) + (repairAttempt ? '\nFABI_STRUCTURED_REPAIR : corrige seulement le contrat de sortie en appelant StructuredOutput.' : ''), format: { type: 'json_schema', schema: z.toJSONSchema(outputSchema), retryCount: 2 },
            parts: [{ type: 'text', text: JSON.stringify({ question: request.question, mode: request.mode, context: request.context,
                projectKnowledge: knowledge,
                projectUnderstanding: await retrieveUnderstanding(book.project, request.question, dirname(dirname(memory))),
                concepts: book.concepts, answerTo: request.answerTo,
                pedagogy: teachingState(request, book),
                activeExercise: request.answerTo ? book.turns.find(turn => turn.reply.exercise?.id === request.answerTo)?.reply.exercise : undefined }) }]
        }, signal);
        // Observe the native run. A completed StructuredOutput tool is the commit
        // point even if an OpenAI-compatible SSE stream never sends its final frame.
        // OpenCode still owns all model/tool iterations; this only transports progress.
        let result: any;
        let lastTool = '';
        while (!result) {
            signal.throwIfAborted();
            const messages = await instance.engine.call(`/session/${session}/message?limit=100`, book.project, undefined, signal);
            const current = (Array.isArray(messages) ? messages : []).filter((message: any) => message.info?.parentID === messageID);
            const completed = current.find((message: any) => message.info?.structured !== undefined);
            const finalTool = current.flatMap((message: any) => (message.parts ?? []).map((part: any) => ({ message, part })))
                .find(({ part }: any) => part.type === 'tool' && part.tool === 'StructuredOutput' && part.state?.status === 'completed');
            if (completed) { result = completed; }
            else if (finalTool) {
                result = { info: { ...finalTool.message.info, structured: finalTool.part.state.input } };
                // Do not lose an already completed response while waiting for stream teardown.
                await instance.engine.call(`/session/${session}/abort`, book.project, {}, AbortSignal.timeout(3000)).catch(() => {});
            } else {
                const failed = current.find((message: any) => message.info?.error);
                const finished = current.find((message: any) => message.info?.time?.completed && !['tool-calls', 'unknown'].includes(message.info.finish));
                if (failed || finished) { result = failed ?? finished; }
            }
            const tool = current.flatMap((message: any) => message.parts ?? []).filter((part: any) => part.type === 'tool').at(-1);
            const active = tool && ['pending', 'running'].includes(tool.state?.status);
            const key = tool ? `${tool.id}:${tool.tool}:${tool.state?.status}` : '';
            if (key && key !== lastTool && !result) {
                lastTool = key;
                const writing = tool.tool === 'StructuredOutput';
                const labels: Record<string, string> = { fabi_diff: 'Comparaison des changements', fabi_read: 'Lecture du code', fabi_search: 'Recherche dans le projet', fabi_files: 'Navigation dans les modules', websearch: 'Recherche sur le web', webfetch: 'Lecture de la documentation', fabi_context: 'Consultation du contexte de l’IDE', read: 'Lecture des fichiers', glob: 'Recherche de fichiers', grep: 'Recherche dans le code', list: 'Exploration du dossier' };
                progress(active ? writing ? 'Je mets en forme la réponse…' : labels[tool.tool] ?? 'Consultation du projet' : 'Je prépare ma réponse…',
                    { phase: active ? writing ? 'writing' : 'tool' : 'thinking', tool: active ? tool.tool : undefined });
            }
            if (!result) { await delay(650, undefined, { signal }); }
        }
        if (result.info?.error && result.info.error.name !== 'StructuredOutputError') { throw new Error('Le professeur n’a pas pu terminer sa réponse. Ton fil est conservé ; réessaie.'); }
        const messages = await instance.engine.call(`/session/${session}/message`, book.project, undefined, signal);
        const tools = (Array.isArray(messages) ? messages : []).filter((message: any) => message.info?.parentID === result.info?.parentID).flatMap((message: any) => message.parts ?? []).filter((part: any) => part.type === 'tool');
        await writeJson(join(memory, 'last-tools.json'), { thread, tools: tools.slice(-30).map((part: any) => ({ tool: part.tool, status: part.state?.status, failure: toolFailure(part.state?.error) })) });
        const verifiedUrls = Array.from(new Set([...verifiedEarlier, ...webEvidence((Array.isArray(messages) ? messages : []).flatMap((message: any) => message.parts ?? []))]));
        const validationSchema = outputSchema;
        const parsed = validationSchema.safeParse(normalizeTutorOutput(result.info?.structured, request.mode, book.concepts));
        if (!parsed.success) {
            if (repairAttempt < 2) {
                progress('Je finalise la présentation de ton explication…');
                const issues = parsed.error.issues.map(issue => ({ field: issue.path.join('.'), problem: issue.message }));
                return await runOpenCodeTutor(provider, { ...request, question: request.question.slice(0, 12000) +
                    '\nTa réponse précédente doit être corrigée, sans refaire les recherches déjà faites. Appelle StructuredOutput avec tous les champs requis. concepts doit déclarer chaque notion référencée par exercise.conceptId et journey.steps[].conceptId, avec id, title, objective, prerequisites. Omet les champs optionnels inutiles au lieu de null. Si diagram est invalide, répare sa structure sans supprimer le parcours pédagogique : {caption: string, steps: [{title: string, detail: string}]}, de 2 à 5 étapes. Conserve takeaway et les étapes déjà préparées. Erreurs de validation : ' + JSON.stringify(issues) },
                    book, memory, signal, progress, repairAttempt + 1, verifiedUrls);
            }
            throw new Error('Le professeur n’a pas terminé sa réponse dans le format attendu. Ton parcours est conservé ; réessaie la question.');
        }
        const lesson: Lesson = parsed.data;
        if (!['assist', 'brief'].includes(request.mode)) { lesson.intent = 'answer'; delete lesson.developerPrompt; }
        if (request.mode === 'learn' || request.answerTo) {
            try { recordLesson(book, request, { ...lesson, ...(lesson.exercise ? { exercise: { ...lesson.exercise, id: 'exercise-' + createHash('sha256').update(request.id).digest('hex').slice(0, 24) } } : {}) }); }
            catch (error) {
                if (repairAttempt >= 2) throw error;
                progress('Je vérifie la progression de ton parcours…');
                return await runOpenCodeTutor(provider, { ...request, question: request.question.slice(0, 12000) + '\nCorrige uniquement la cohérence du parcours, sans nouvelle recherche. ' + (error instanceof Error ? error.message : 'Vérifie les références de notions et les prérequis.') }, book, memory, signal, progress, repairAttempt + 1, verifiedUrls);
            }
        }
        // Keep a small local execution trace for troubleshooting, never raw prompts or credentials.

        // A completed call alone is not proof: an empty search can also complete.
        lesson.webSources = (lesson.webSources ?? []).filter(source => verifiedUrls.includes(source.url));
        // Verification is a limitation notice, never an unchecked model claim.
        if (lesson.intent === 'relay') { lesson.sources = []; lesson.webSources = []; lesson.terms = undefined; lesson.diagram = undefined; }
        lesson.verification = undefined;
        if (!verifiedUrls.length && tools.some((part: any) => ['websearch', 'webfetch'].includes(part.tool)) && !['relay', 'develop', 'clarify'].includes(lesson.intent ?? '') && !['brief', 'review'].includes(request.mode)) {
            const attempted = tools.some((part: any) => ['websearch', 'webfetch'].includes(part.tool));
            lesson.verification = attempted
                ? 'La recherche web n’a pas fourni de source exploitable. Cette explication reste à vérifier.'
                : 'Cette réponse n’a pas pu être vérifiée sur le web : aucune source consultée pour cette réponse.';
        }
        if (['relay', 'develop'].includes(lesson.intent ?? '') && !lesson.developerPrompt?.trim()) throw new Error('Fabi n’a pas préparé le message à transmettre. Ta demande est conservée.');
        const reads = new Set<string>('excerpts' in knowledge ? knowledge.excerpts?.map(excerpt => excerpt.path) : []);
        for (const tool of tools) {
            if (!['read', 'fabi_read'].includes(tool.tool) || tool.state?.status !== 'completed' || tool.state?.error) continue;
            const requested = tool.state?.input?.filePath ?? tool.state?.input?.path;
            if (typeof requested !== 'string') continue;
            try { reads.add(relative(book.project, await safeProjectFile(book.project, requested))); } catch { /* Not a verified project source. */ }
        }
        if (request.context.path && request.context.text && request.context.kind !== 'directory') {
            try { reads.add(relative(book.project, await safeProjectFile(book.project, request.context.path))); } catch { /* Invalid snapshot. */ }
        }
        lesson.readFiles = [...reads];
        lesson.sources = lesson.sources.filter(source => /^https?:\/\//.test(source.path) || reads.has(relative(book.project, join(book.project, source.path))) || reads.has(relative(book.project, source.path)));
        return lesson;
    } finally {
        signal.removeEventListener('abort', abort);
        // A capture is a per-request input, not another permanent copy of the user's code.
        if (repairAttempt === 0) {
            await fs.rm(join(assistHome(), 'opencode', 'contexts', session + '.json'), { force: true }).catch(() => {});
            // Discovery keeps its checked summary, not an ever-growing conversation per revision.
            // Interactive lesson threads keep their native history for subsequent questions.
            if (thread.startsWith('knowledge-')) {
                try {
                    await instance.engine.call(`/session/${session}/abort`, book.project, {}, AbortSignal.timeout(3000));
                    await instance.engine.call(`/session/${session}`, book.project, undefined, AbortSignal.timeout(3000), 'DELETE');
                    const lease = await lockMemory(memory, 'sessions', true);
                    try {
                        const sessions = await readJson<Record<string, string>>(sessionsFile) ?? {};
                        if (sessions[thread] === session) { delete sessions[thread]; lease.assertOwned(); await writeJson(sessionsFile, sessions); }
                    } finally { await lease.release(); }
                } catch { /* A cleanup failure must not discard a valid explanation or interrupt an agent. */ }
            }
        }
    }
}

/** Normalize citation variants from compatible models before strict validation.
 * Context questions do not update the curriculum or introduce an exercise. */
export function normalizeTutorOutput(value: unknown, mode: AssistRequest['mode'], knownConcepts: AssistNotebook['concepts'] = []): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { return value; }
    const result = { ...value } as Record<string, any>;
    for (const key of ['sources', 'webSources', 'terms', 'concepts', 'exercise', 'assessment', 'diagram', 'journey', 'knowledge', 'coveredConceptIds']) {
        if (typeof result[key] === 'string' && /^\s*(?:[\[{]|null\s*$)/.test(result[key])) {
            try { result[key] = JSON.parse(result[key]); } catch { /* Strict validation below reports malformed JSON. */ }
        }
    }
    if (Array.isArray(result.concepts)) {
        result.concepts = result.concepts.map((concept: any) => ({ ...knownConcepts.find(known => known.id === concept?.id), ...concept }));
    }
    if (result.concepts === undefined && (!result.exercise || knownConcepts.some(known => known.id === result.exercise?.conceptId))) { result.concepts = []; }
    for (const key of ['exercise', 'assessment', 'diagram', 'terms', 'webSources', 'verification', 'developerPrompt', 'journey', 'knowledge', 'coveredConceptIds', 'takeaway']) {
        if (result[key] === null) { delete result[key]; }
    }
    if (result.exercise && typeof result.exercise === 'object') {
        result.exercise = { ...result.exercise };
        for (const key of ['choices', 'starterCode']) { if (result.exercise[key] === null) { delete result.exercise[key]; } }
    }
    const web = Array.isArray(result.webSources) ? [...result.webSources] : [];
    if (Array.isArray(result.sources)) {
        result.sources = result.sources.filter((source: any) => {
            if (!source || typeof source !== 'object') { return false; }
            const url = source.url ?? (/^https?:\/\//i.test(source.path ?? '') ? source.path : undefined);
            if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
                try {
                    const parsed = new URL(url);
                    if (!parsed.username && !parsed.password && !web.some(item => item.url === parsed.href)) {
                        web.push({ title: typeof source.title === 'string' ? source.title.slice(0, 200) : parsed.hostname, url: parsed.href });
                    }
                } catch { /* Ignore invalid links, never interpret them as local files. */ }
                return false;
            }
            return typeof source.path === 'string' && Number.isInteger(source.line) && source.line > 0;
        });
    }
    result.webSources = web.slice(0, 6);
    if (mode === 'explore') {
        result.concepts = (Array.isArray(result.concepts) ? result.concepts : []).filter((concept: any) => Array.isArray(concept.prerequisites) && !concept.prerequisites.length); delete result.exercise; delete result.assessment;
    }
    return result;
}

/** Categorize errors without persisting URLs, queries, private code or server messages. */
export function toolFailure(error: unknown): string | undefined {
    if (!error) return undefined;
    const message = String(error);
    if (/timed? ?out|timeout|aborted/i.test(message)) return 'timeout';
    if (/403|forbidden/i.test(message)) return 'forbidden';
    if (/404|not found/i.test(message)) return 'not-found';
    if (/429|rate.limit/i.test(message)) return 'rate-limit';
    if (/connect|network|fetch failed/i.test(message)) return 'network';
    return 'tool-error';
}

/** Only URLs actually returned by successful native tools can back citations. */
export function webEvidence(parts: any[]): string[] {
    const urls = new Set<string>();
    for (const part of parts) {
        const state = part.state;
        if (!['websearch', 'webfetch'].includes(part.tool) || state?.status !== 'completed') continue;
        const output = typeof state.output === 'string' ? state.output.trim() : '';
        if (!output || /^(?:error:|no (?:results|search results)|search request timed out)/i.test(output)) continue;
        if (part.tool === 'webfetch' && /^https?:\/\//.test(state.input?.url ?? '')) urls.add(state.input.url);
        if (part.tool === 'websearch') {
            for (const match of output.matchAll(/^URL:\s*(https?:\/\/\S+)/gm)) urls.add(match[1]);
        }
    }
    return [...urls];
}
