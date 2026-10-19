import { AssistNotebook, AssistRequest } from '../../common/fabi-assist-protocol';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDeepAgent, FilesystemBackend } from 'deepagents';
import { AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { createMiddleware, modelCallLimitMiddleware } from 'langchain';
import { z } from 'zod';
import { Lesson, lessonSchema, tutorInstructions } from './assist-learning';
import { JarvisProvider } from './jarvis-provider';
import { readProjectFile, readProjectDirectory, listProjectFiles, safeProjectFile } from './assist-store';

/** Deep Agents owns the tool loop and durable notes; only inference runs on Jarvis. */
export async function runTutor(provider: JarvisProvider, request: AssistRequest, book: AssistNotebook,
    memory: string, signal: AbortSignal, progress: (text: string) => void): Promise<Lesson> {
    const model = await provider.model(signal);
    const knowledge = join(memory, 'knowledge');
    await fs.mkdir(join(knowledge, 'lessons'), { recursive: true, mode: 0o700 });
    await fs.writeFile(join(knowledge, 'AGENTS.md'), 'Mémoire pédagogique Fabi.\nLes notes sont dans /lessons/<concept-id>.md.\nLe code du projet se lit uniquement avec read_project_file.\nLe carnet fourni dans le message contient les acquis vérifiés.\n', { mode: 0o600 });
    const read = tool(async ({ path, line }) => {
        signal.throwIfAborted(); progress('Je lis le code lié à ta question…');
        try { return await readProjectFile(book.project, path, line); }
        catch { return 'Lecture refusée ou fichier absent. Choisis un fichier texte du projet, sans secrets.'; }
    }, { name: 'read_project_file', description: 'Lire le code réel du projet (120 lignes maximum), en lecture seule.',
        schema: z.object({ path: z.string(), line: z.number().int().min(1).default(1) }) });
    const list = tool(async () => {
        signal.throwIfAborted(); progress('Je repère les fichiers du projet…');
        try {
            const { stdout } = await promisify(execFile)('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
                { cwd: book.project, maxBuffer: 512000, timeout: 5000, signal });
            const files: string[] = [];
            for (const name of [...new Set(stdout.split('\0').filter(Boolean))].slice(0, 1000)) {
                try { await safeProjectFile(book.project, name); files.push(name); } catch { /* Omit private / oversized files. */ }
                if (files.length >= 300) { break; }
            }
            return files.join('\n');
        } catch { return (await listProjectFiles(book.project, '.', signal)).join('\n'); }
    }, { name: 'list_project_files', description: 'Repérer les fichiers du projet Git, en excluant les fichiers privés.', schema: z.object({}) });
    const directory = tool(async ({ path }) => {
        signal.throwIfAborted();
        try { return await readProjectDirectory(book.project, path); }
        catch { return 'Dossier absent ou hors du projet.'; }
    }, { name: 'list_project_directory', description: 'Lire le contenu immédiat du dossier pointé ou d’un autre dossier du projet.', schema: z.object({ path: z.string().default('.') }) });
    const context = tool(async () => JSON.stringify(request.context), { name: 'read_ide_context',
        description: 'Relire le contexte capturé dans l’IDE : sélection, fichier, dossier ou sortie du terminal. Un instantané, pas un terminal interactif.', schema: z.object({}) });
    let completed: Lesson | undefined;
    const finish = tool(async lesson => { completed = lessonSchema.parse(lesson); return 'Explication transmise.'; }, {
        name: 'submit_lesson', description: 'Terminer le tour avec une explication sourcée et, en apprentissage, une étape pédagogique.',
        schema: lessonSchema, returnDirect: true
    });
    const allowedTools = new Set(['submit_lesson', 'read_ide_context', 'list_project_directory', 'read_project_file', 'list_project_files', 'read_file', 'write_file', 'edit_file']);
    let modelCalls = 0;
    const tutorTools = createMiddleware({ name: 'TutorToolScope', wrapModelCall: async (step, handler) => {
        // A question needs bounded research followed by a response, not an open-ended coding run.
        // Deep Agents still owns execution and schema repair. Its final-output tool remains
        // available when research tools are removed for the conclusion step.
        const conclude = ++modelCalls > (request.mode === 'explore' ? 3 : 5);
        if (conclude) { progress('Je termine l’explication avec le contexte trouvé…'); }
        const response = await handler({ ...step,
            tools: step.tools.filter(tool => 'name' in tool && typeof tool.name === 'string' &&
                (conclude ? tool.name === 'submit_lesson' : allowedTools.has(tool.name))),
            toolChoice: conclude ? { type: 'function' as const, function: { name: 'submit_lesson' } } : 'auto'
        });
        if (AIMessage.isInstance(response) && !response.tool_calls?.length) {
            // One protocol repair using the framework's model middleware: preserve the
            // answer and ask for the final tool, without re-running research or tools.
            modelCalls++;
            return handler({ ...step, messages: [...step.messages, response],
                tools: step.tools.filter(tool => 'name' in tool && tool.name === 'submit_lesson'),
                toolChoice: { type: 'function', function: { name: 'submit_lesson' } }
            });
        }
        return response;
    } });
    const agent = createDeepAgent({ name: 'fabi-tutor', model, systemPrompt: tutorInstructions,
        tools: [read, list, directory, context, finish], backend: new FilesystemBackend({ rootDir: knowledge, virtualMode: true }),
        memory: ['/AGENTS.md'],
        middleware: [tutorTools, modelCallLimitMiddleware({ runLimit: 8, exitBehavior: 'error' })],
        permissions: [
            { operations: ['write'], paths: ['/lessons/**'], mode: 'allow' },
            { operations: ['write'], paths: ['/**'], mode: 'deny' }
        ]
    });
    progress('Je prépare une explication à partir de ton projet…');
    await agent.invoke({ messages: [{ role: 'user', content: JSON.stringify({
        question: request.question, mode: request.mode, context: request.context, answerTo: request.answerTo,
        concepts: book.concepts, recentTurns: book.turns.filter(turn => request.mode !== 'explore' ||
            (turn.mode === 'explore' && turn.context.kind === request.context.kind && turn.context.path === request.context.path &&
                turn.context.terminal?.id === request.context.terminal?.id)).slice(-12)
    }) }] }, { signal, recursionLimit: 36 });
    if (!completed) { throw new Error('Le professeur n’a pas terminé son explication. Réessaie.'); }
    return completed;
}
