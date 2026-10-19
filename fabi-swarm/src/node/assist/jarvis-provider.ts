import { join } from 'node:path';
import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { AssistAccount } from '../../common/fabi-assist-protocol';
import { assistHome, readJson } from './assist-store';

// Theia's DOM typings predate Node 22's AbortSignal.any.
const abortSignals = AbortSignal as typeof AbortSignal & { any(signals: AbortSignal[]): AbortSignal };

const configuration = z.object({
    baseURL: z.string().url().optional(),
    apiKey: z.string().min(1),
    model: z.string().min(1).default('jarvis-heretic-122b'),
    pausedReason: z.string().max(400).optional()
});

/** Only the inference credential lives here. No RunPod billing/admin access in the IDE. */
export class JarvisProvider {
    constructor(private readonly home = assistHome(), private readonly http: typeof fetch = fetch) {}

    async config() {
        const raw = await readJson<unknown>(join(this.home, 'jarvis-provider.json'));
        if (!raw) { throw new Error('Le GPU Jarvis n’est pas encore configuré sur cette machine.'); }
        const parsed = configuration.safeParse(raw);
        if (!parsed.success) { throw new Error('La configuration privée du GPU Jarvis est invalide.'); }
        const value = parsed.data;
        if (value.pausedReason) { throw new Error(value.pausedReason); }
        if (!value.baseURL) { throw new Error('Le GPU Jarvis attend son redémarrage sur RunPod.'); }
        const url = new URL(value.baseURL);
        if (url.username || url.password || url.search || url.hash ||
            (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
            throw new Error('Le fournisseur GPU doit utiliser HTTPS (HTTP permis uniquement en local).');
        }
        return { ...value, baseURL: value.baseURL.replace(/\/+$/, '') };
    }

    private failure(status?: number): Error {
        if (status === 401 || status === 403) { return new Error('Le GPU Jarvis refuse sa clé d’inférence. Vérifie la configuration du serveur.'); }
        if (status === 429) { return new Error('Le GPU Jarvis est occupé. Ta question est conservée ; réessaie dans un instant.'); }
        if (status === 404 || status === 502 || status === 503 || status === 504) {
            return new Error('Le GPU Jarvis est arrêté ou démarre encore. Ta question est conservée.');
        }
        return new Error(status ? `Le GPU Jarvis n’a pas pu répondre (HTTP ${status}).` : 'Le GPU Jarvis est injoignable. Vérifie sa disponibilité et ta connexion.');
    }

    async account(): Promise<AssistAccount> {
        try {
            const config = await this.config();
            const response = await this.http(`${config.baseURL}/models`, {
                headers: { Authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(8000), redirect: 'error'
            });
            if (!response.ok) { throw this.failure(response.status); }
            const body = await response.json() as { data?: { id: string }[] };
            if (!Array.isArray(body.data) || !body.data.some(model => model.id === config.model)) {
                throw new Error('Le serveur répond, mais le modèle Jarvis n’est pas chargé.');
            }
            return { connected: true, name: 'Jarvis · GPU privé', selectedModel: config.model,
                models: [{ key: config.model, name: config.model, locked: false }], detail: 'Qwen sur ton GPU RunPod · mémoire conservée dans Fabi' };
        } catch (error) {
            // Never forward raw fetch / SDK errors or server bodies through RPC.
            const detail = error instanceof Error && /^(Le |La )/.test(error.message) ? error.message : this.failure().message;
            return { connected: false, name: 'Jarvis · GPU privé', models: [], detail };
        }
    }

    async model(signal: AbortSignal): Promise<ChatOpenAI> {
        const config = await this.config();
        return new ChatOpenAI({ model: config.model, apiKey: config.apiKey, temperature: 0.2, maxTokens: 4096,
            maxRetries: 0, streaming: false, useResponsesApi: false,
            modelKwargs: { parallel_tool_calls: false, chat_template_kwargs: { enable_thinking: false } },
            configuration: { baseURL: config.baseURL, fetch: async (input, init) => {
                let response: Response;
                try { response = await this.http(input, { ...init, signal: abortSignals.any([signal, ...(init?.signal ? [init.signal] : [])]), redirect: 'error' }); }
                catch { signal.throwIfAborted(); throw this.failure(); }
                if (!response.ok) {
                    await response.body?.cancel();
                    // Preserve the HTTP status for the SDK, never its potentially private body.
                    return new Response(JSON.stringify({ error: { message: this.failure(response.status).message } }), {
                        status: response.status, headers: { 'content-type': 'application/json' }
                    });
                }
                // vLLM/Qwen can ignore parallel_tool_calls=false. Serialize tool execution
                // at the OpenAI compatibility boundary before LangGraph parses final outputs.
                const body = await response.json();
                for (const choice of body.choices ?? []) {
                    const calls = choice.message?.tool_calls;
                    if (Array.isArray(calls) && calls.length > 1) { choice.message.tool_calls = [calls[0]]; }
                }
                return new Response(JSON.stringify(body), { status: response.status, headers: { 'content-type': 'application/json' } });
            } }
        });
    }
}
