// Service backend du moteur fabi-code (OpenCode en sidecar).
//
// Responsabilités :
//   1. Spawn `opencode serve` au démarrage de l'IDE (config provider swarm
//      injectée en env), arrêt propre au quit (BackendApplicationContribution).
//   2. Tenir UNE connexion SSE persistante vers `/event` d'OpenCode, parser les
//      `message.part.updated` / `session.status` et les pousser au frontend via
//      FabiCodeClient (relais zéro-polling).
//   3. Exposer createSession / prompt / abort via RPC pour le ChatAgent relais.
//
// L'API ciblée est celle d'OpenCode 1.14.33 (validée en live) :
//   POST /session                      → { id, ... }
//   POST /session/{id}/message         → bloquant jusqu'à fin de tour
//   POST /session/{id}/abort           → interrompt
//   GET  /event                        → flux SSE global ({type, properties})
// Le ciblage du workspace se fait par le header `x-opencode-directory`.

import * as http from 'node:http';
import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
    FabiCodeService, FabiCodeClient, FabiCodeServerInfo, FabiCodePart,
    FabiCodePermissionReply, FABI_CODE_PROVIDER_ID
} from '../common/fabi-code-protocol';
import {
    FabiSwarmService, FABI_FALLBACK_MODEL
} from '../common/fabi-swarm-protocol';
import { findFabiCode } from './fabi-code-runtime';
import { startServer, ServerHandle } from './fabi-code-server';

const SWARM_READY_TIMEOUT_MS = 120_000;
const SWARM_READY_POLL_MS = 1_000;
const SWARM_PICK_MODEL_GRACE_MS = 5_000;

@injectable()
export class FabiCodeServiceImpl implements FabiCodeService, BackendApplicationContribution {

    @inject(ILogger) protected readonly logger: ILogger;
    // Optionnel : fournit le scheduler actif + le jeton de compte (porte de conso).
    @inject(FabiSwarmService) @optional() protected readonly swarm?: FabiSwarmService;

    protected client: FabiCodeClient | undefined;
    protected server: ServerHandle | undefined;
    protected baseUrl: string | undefined;
    protected info: FabiCodeServerInfo = { status: 'stopped' };
    /** Modèle à utiliser (providerID/modelID) — résolu au spawn. */
    protected modelId = FABI_FALLBACK_MODEL;
    /** Signature de config réellement chargée dans le sidecar OpenCode. */
    protected configKey: string | undefined;
    /** Contrôleurs d'abort des POST /message bloquants, par session. */
    protected readonly inflight = new Map<string, AbortController>();
    /** Tours OpenCode en cours : résolus par session.status/session.error ou timeout. */
    protected readonly turnWaiters = new Map<string, { resolve: () => void; timer: ReturnType<typeof setTimeout> }>();
    protected sseAbort: AbortController | undefined;
    protected stopping = false;
    /** Directory dont on écoute les events (OpenCode scope /event par workspace). */
    protected sseDirectory: string | undefined;
    /** Réveillés quand le serveur devient prêt (baseUrl connue). */
    protected readyWaiters: Array<() => void> = [];

    setClient(client: FabiCodeClient | undefined): void {
        this.client = client;
        if (client) {
            // Rendu immédiat à l'attache.
            client.onServerStatus(this.info);
        }
    }

    // ---- BackendApplicationContribution ----

    onStart(): void {
        // Démarrage lazy : le sidecar OpenCode doit être configuré avec le swarm
        // actif. Celui-ci peut arriver quelques secondes après le boot via le
        // registry/autoreconnect, donc createSession/prompt déclenchent le vrai
        // launch via ensureCurrentServer().
        this.setStatus('stopped');
    }

    async onStop(): Promise<void> {
        this.stopping = true;
        this.sseAbort?.abort();
        for (const ac of this.inflight.values()) {
            ac.abort();
        }
        this.inflight.clear();
        for (const waiter of this.turnWaiters.values()) {
            clearTimeout(waiter.timer);
            waiter.resolve();
        }
        this.turnWaiters.clear();
        await this.server?.stop().catch(() => undefined);
    }

    // ---- démarrage du sidecar ----

    protected async launch(): Promise<void> {
        const found = findFabiCode();
        if (!found) {
            this.setStatus('error', 'moteur fabi-code introuvable');
            return;
        }
        const { config, key } = await this.buildConfigWithKey();
        const port = 41960 + Math.floor(Math.random() * 2000);
        this.configKey = key;
        this.setStatus('starting');
        this.server = startServer({
            binary: found.binary,
            config,
            hostname: '127.0.0.1',
            port,
            onReady: url => {
                this.baseUrl = url;
                this.setStatus('ready');
                this.openEventStream();
            },
            onError: msg => {
                this.logger.warn(`[fabi-code] ${msg}`);
                if (!this.baseUrl) {
                    this.setStatus('error', msg);
                }
            },
            onStopped: () => this.setStatus('stopped'),
            onLog: line => this.logger.debug(`[fabi-code] ${line}`)
        });
    }

    /** Redémarre OpenCode si le modèle/scheduler/token actif a changé depuis le spawn. */
    protected async ensureCurrentServer(): Promise<void> {
        if (!process.env.FABI_CODE_BASE_URL) {
            await this.waitForConsumableSwarm();
        }
        const { key } = await this.buildConfigWithKey();
        if (this.server && this.baseUrl && this.configKey === key) {
            return;
        }
        this.sseAbort?.abort();
        this.sseAbort = undefined;
        this.baseUrl = undefined;
        for (const ac of this.inflight.values()) {
            ac.abort();
        }
        this.inflight.clear();
        for (const waiter of this.turnWaiters.values()) {
            clearTimeout(waiter.timer);
            waiter.resolve();
        }
        this.turnWaiters.clear();
        await this.server?.stop().catch(() => undefined);
        this.server = undefined;
        await this.launch();
        await this.whenReady();
    }

    /** Construit la config OpenCode : provider swarm OpenAI-compatible + local. */
    protected async buildConfigWithKey(): Promise<{ config: Record<string, unknown>; key: string }> {
        // --- Override de TEST (env) : pointe le provider sur n'importe quel
        // endpoint OpenAI-compatible (Ollama, LM Studio…) sans toucher au code.
        //   FABI_CODE_BASE_URL  ex: http://172.18.0.12:11434/v1
        //   FABI_CODE_MODEL     ex: qwen3-coder:30b
        //   FABI_CODE_API_KEY   ex: ollama (ignoré par Ollama)
        // Défaut (aucune env) = le swarm Fabi.
        const envBase = process.env.FABI_CODE_BASE_URL;
        let baseURL: string;
        let model: string;
        let apiKey: string | undefined;
        if (envBase) {
            baseURL = envBase.replace(/\/+$/, '');
            model = process.env.FABI_CODE_MODEL || FABI_FALLBACK_MODEL;
            apiKey = process.env.FABI_CODE_API_KEY || 'fabi-test';
        } else {
            let schedulerUrl: string | undefined;
            model = FABI_FALLBACK_MODEL;
            try {
                const active = await this.swarm?.getActiveSwarm();
                if (active?.schedulerUrl) {
                    schedulerUrl = active.schedulerUrl;
                }
                if (active?.model) {
                    model = active.model;
                }
                apiKey = await this.swarm?.getAccountToken();
            } catch (err) {
                throw new Error(`Impossible de lire le swarm actif: ${err instanceof Error ? err.message : String(err)}`);
            }
            if (!schedulerUrl) {
                throw new Error('Aucun swarm Fabi actif: choisis un modèle et attends que le worker soit prêt.');
            }
            baseURL = `${schedulerUrl.replace(/\/+$/, '')}/v1`;
        }
        this.modelId = model;
        const options: Record<string, unknown> = { baseURL };
        if (apiKey) {
            options.apiKey = apiKey;
        }
        const key = JSON.stringify({ baseURL, model, apiKey: apiKey ?? '' });
        const config = {
            $schema: 'https://opencode.ai/config.json',
            share: 'disabled',
            // Approbation façon Cursor : les commandes shell et les fetch web
            // demandent l'autorisation (carte Autoriser/Refuser dans le chat) ;
            // lectures et éditions passent (les éditions sont rendues visibles
            // par le pont éditeur + la carte d'outil). `permission.asked` est
            // émis → relayé → carte de confirmation → replyPermission.
            permission: {
                bash: 'ask',
                webfetch: 'ask'
            },
            provider: {
                [FABI_CODE_PROVIDER_ID]: {
                    npm: '@ai-sdk/openai-compatible',
                    name: 'Fabi Swarm',
                    options,
                    models: {
                        [model]: {
                            name: model,
                            tool_call: true,
                            // Le swarm P2P doit rester interactif. Une limite de
                            // sortie trop haute laisse un petit modèle tourner
                            // longtemps et rend l'annulation coûteuse côté worker.
                            limit: { context: 262144, output: 1024 }
                        }
                    }
                }
            },
            model: `${FABI_CODE_PROVIDER_ID}/${model}`
        };
        return { config, key };
    }

    protected async buildConfig(): Promise<Record<string, unknown>> {
        return (await this.buildConfigWithKey()).config;
    }

    /**
     * Porte d'admission avant de démarrer OpenCode ou d'envoyer un tour.
     * Les serveurs d'inférence de prod backpressurent les requêtes quand la file
     * ou les replicas ne sont pas prêts ; ici on applique le même principe côté
     * desktop pour éviter un "Generating..." infini ou un fallback silencieux.
     */
    protected async waitForConsumableSwarm(timeoutMs = SWARM_READY_TIMEOUT_MS): Promise<void> {
        if (!this.swarm) {
            throw new Error('Service swarm indisponible: impossible de router le chat Fabi.');
        }
        const started = Date.now();
        let lastMessage = 'connexion au swarm en cours';
        for (;;) {
            let active = false;
            try {
                active = !!(await this.swarm.getActiveSwarm());
                const connection = await this.swarm.getConnection();
                lastMessage = `${connection.headline}: ${connection.activity}${connection.detail ? ` (${connection.detail})` : ''}`;
                if (active && connection.ready) {
                    return;
                }
                if (!active && connection.reason === 'pick-model' && Date.now() - started >= SWARM_PICK_MODEL_GRACE_MS) {
                    throw new Error('Aucun modèle Fabi sélectionné: choisis un swarm avant de lancer le chat.');
                }
            } catch (err) {
                if (err instanceof Error && err.message.startsWith('Aucun modèle Fabi sélectionné')) {
                    throw err;
                }
                lastMessage = err instanceof Error ? err.message : String(err);
            }
            if (Date.now() - started >= timeoutMs) {
                throw new Error(`Le swarm Fabi n'est pas prêt après ${Math.round(timeoutMs / 1000)} s: ${lastMessage}`);
            }
            await new Promise<void>(resolve => setTimeout(resolve, SWARM_READY_POLL_MS));
        }
    }

    protected setStatus(status: FabiCodeServerInfo['status'], detail?: string): void {
        this.info = { status, url: this.baseUrl, detail };
        this.client?.onServerStatus(this.info);
        if (status === 'ready' && this.baseUrl) {
            const waiters = this.readyWaiters;
            this.readyWaiters = [];
            for (const w of waiters) {
                w();
            }
        }
    }

    /** Résout dès que le sidecar est prêt (baseUrl connue), sinon rejette au bout du délai. */
    protected whenReady(timeoutMs = 25000): Promise<void> {
        if (this.baseUrl) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.readyWaiters = this.readyWaiters.filter(w => w !== onReady);
                reject(new Error(this.info.detail ?? 'le moteur fabi-code ne démarre pas'));
            }, timeoutMs);
            const onReady = (): void => {
                clearTimeout(timer);
                resolve();
            };
            this.readyWaiters.push(onReady);
        });
    }

    // ---- flux SSE persistant ----

    protected openEventStream(): void {
        if (!this.baseUrl) {
            return;
        }
        this.sseAbort?.abort();
        const ac = new AbortController();
        this.sseAbort = ac;
        // OpenCode scope /event par workspace → on écoute le directory des sessions.
        const url = `${this.baseUrl}/event${this.sseDirectory ? `?directory=${encodeURIComponent(this.sseDirectory)}` : ''}`;
        // Lecture SSE via node:http natif (streaming garanti) plutôt que `fetch`
        // (le bundle backend webpack ne streame pas le body de fetch de façon
        // fiable → aucun event n'était lu). Le sidecar est toujours en http local.
        const reconnect = (): void => {
            if (!this.stopping && this.sseAbort === ac && this.baseUrl) {
                setTimeout(() => this.openEventStream(), 1000).unref?.();
            }
        };
        try {
            const req = http.get(url, { headers: { accept: 'text/event-stream' }, signal: ac.signal }, res => {
                res.setEncoding('utf-8');
                let buf = '';
                res.on('data', (chunk: string) => {
                    buf += chunk;
                    let nl: number;
                    while ((nl = buf.indexOf('\n')) >= 0) {
                        const line = buf.slice(0, nl).trim();
                        buf = buf.slice(nl + 1);
                        if (line.startsWith('data:')) {
                            this.handleEvent(line.slice(5).trim());
                        }
                    }
                });
                res.on('end', reconnect);
                res.on('error', reconnect);
            });
            req.on('error', reconnect);
        } catch {
            reconnect();
        }
    }

    protected handleEvent(data: string): void {
        let evt: { type?: string; properties?: Record<string, unknown> };
        try {
            evt = JSON.parse(data);
        } catch {
            return;
        }
        const type = evt.type;
        const props = (evt.properties ?? {}) as Record<string, unknown>;
        const sessionId = typeof props.sessionID === 'string' ? props.sessionID : undefined;
        if (!sessionId) {
            return;
        }
        // Miroir fidèle : on relaie l'event BRUT au widget de chat (qui réduit
        // tout l'état). Les callbacks normalisés ci-dessous restent pour le
        // relais ChatAgent historique.
        if (type) {
            this.client?.onEngineEvent({ sessionId, type, properties: props });
        }
        if (type === 'message.part.updated') {
            const part = props.part as Record<string, unknown> | undefined;
            if (part) {
                this.client?.onPart(this.normalizePart(sessionId, part));
            }
        } else if (type === 'message.updated') {
            // En début de tour, le message UTILISATEUR est publié → on capte son
            // id pour les checkpoints (revert/delete).
            const info = props.info as { id?: string; role?: string } | undefined;
            if (info?.role === 'user' && typeof info.id === 'string') {
                this.client?.onUserMessage(sessionId, info.id);
            }
        } else if (type === 'session.status') {
            const status = (props.status as { type?: string } | undefined)?.type;
            // 'busy' = en cours ; tout autre statut (idle/…) = tour terminé.
            if (status && status !== 'busy') {
                this.finishTurn(sessionId);
            }
        } else if (type === 'session.error') {
            const err = props.error as { data?: { message?: string } } | undefined;
            this.finishTurn(sessionId, err?.data?.message ?? 'erreur de session');
        } else if (type === 'file.edited') {
            const path = typeof props.path === 'string' ? props.path : undefined;
            if (path) {
                this.client?.onFileEdited(sessionId, path);
            }
        } else if (type === 'permission.asked' || type === 'permission.updated') {
            const id = typeof props.id === 'string' ? props.id : undefined;
            if (id) {
                const tool = props.tool as { callID?: string } | undefined;
                const meta = props.metadata as Record<string, unknown> | undefined;
                // Détail lisible : commande shell ou URL si présente dans metadata.
                const detail = typeof meta?.command === 'string' ? meta.command as string
                    : typeof meta?.url === 'string' ? meta.url as string
                        : undefined;
                this.client?.onPermissionAsked({
                    id,
                    sessionId,
                    title: typeof props.permission === 'string' ? props.permission as string : 'Autorisation requise',
                    detail,
                    callId: tool?.callID
                });
            }
        }
    }

    protected normalizePart(sessionId: string, part: Record<string, unknown>): FabiCodePart {
        const str = (k: string): string | undefined => typeof part[k] === 'string' ? part[k] as string : undefined;
        // Les parts d'outil portent un sous-objet `state` (status/input/output/title).
        const state = part.state as Record<string, unknown> | undefined;
        const stateStatus = typeof state?.status === 'string' ? state.status as string : str('state');
        return {
            sessionId,
            messageId: str('messageID') ?? '',
            partId: str('id') ?? '',
            type: str('type') ?? 'text',
            text: str('text'),
            tool: str('tool'),
            callId: str('callID') ?? str('callId'),
            state: stateStatus,
            input: state?.input ?? part.input,
            output: typeof state?.output === 'string' ? state.output as string : str('output'),
            title: typeof state?.title === 'string' ? state.title as string : str('title'),
            error: typeof state?.error === 'string' ? state.error as string : str('error')
        };
    }

    // ---- API RPC ----

    async getServerInfo(): Promise<FabiCodeServerInfo> {
        return this.info;
    }

    async getMessages(sessionId: string, directory?: string): Promise<string> {
        return this.http('GET', `/session/${encodeURIComponent(sessionId)}/message`, undefined, directory);
    }

    /** (Ré)ouvre la SSE pour ce workspace si on n'écoute pas déjà le bon directory. */
    protected ensureEventStreamFor(directory?: string): void {
        if (directory && directory !== this.sseDirectory) {
            this.sseDirectory = directory;
            if (this.baseUrl) {
                this.openEventStream();
            }
        }
    }

    async createSession(directory?: string): Promise<string> {
        await this.ensureCurrentServer();
        this.ensureEventStreamFor(directory);
        const res = await this.http('POST', '/session', { title: 'Fabi' }, directory);
        const json = JSON.parse(res) as { id?: string };
        if (!json.id) {
            throw new Error('createSession: pas d\'id retourné');
        }
        return json.id;
    }

    async prompt(sessionId: string, text: string, directory?: string, agent?: string): Promise<void> {
        await this.ensureCurrentServer();
        this.ensureEventStreamFor(directory);
        const ac = new AbortController();
        this.inflight.set(sessionId, ac);
        try {
            const done = this.waitForTurn(sessionId, ac, directory);
            const body: Record<string, unknown> = { parts: [{ type: 'text', text }] };
            if (agent) {
                body.agent = agent; // 'build' (édite) | 'plan' (lecture seule)
            }
            // OpenCode 1.14.x répond vite au POST, puis publie la vraie fin via /event.
            // On attend donc session.status idle/session.error, avec timeout anti-spin.
            await this.http(
                'POST',
                `/session/${encodeURIComponent(sessionId)}/message`,
                body,
                directory,
                ac.signal
            );
            await done;
        } catch (err) {
            const aborted = (err as Error)?.name === 'AbortError';
            this.finishTurn(sessionId, aborted ? undefined : String((err as Error)?.message ?? err));
        } finally {
            this.inflight.delete(sessionId);
        }
    }

    async abort(sessionId: string): Promise<void> {
        this.inflight.get(sessionId)?.abort();
        this.inflight.delete(sessionId);
        try {
            await this.http('POST', `/session/${encodeURIComponent(sessionId)}/abort`, {});
        } catch {
            /* best-effort */
        }
    }

    protected waitForTurn(sessionId: string, ac: AbortController, directory?: string): Promise<void> {
        const previous = this.turnWaiters.get(sessionId);
        if (previous) {
            clearTimeout(previous.timer);
            previous.resolve();
        }
        return new Promise<void>(resolve => {
            const timer = setTimeout(() => {
                ac.abort();
                void this.http('POST', `/session/${encodeURIComponent(sessionId)}/abort`, {}, directory)
                    .catch(() => undefined);
                this.finishTurn(sessionId, 'Timeout: le moteur Fabi n\'a pas terminé le tour.');
            }, 120000);
            timer.unref?.();
            this.turnWaiters.set(sessionId, { resolve, timer });
        });
    }

    protected finishTurn(sessionId: string, error?: string): void {
        const waiter = this.turnWaiters.get(sessionId);
        if (waiter) {
            clearTimeout(waiter.timer);
            this.turnWaiters.delete(sessionId);
            waiter.resolve();
        }
        this.client?.onTurnDone(sessionId, error);
    }

    async replyPermission(requestId: string, reply: FabiCodePermissionReply, directory?: string): Promise<void> {
        await this.http(
            'POST',
            `/permission/${encodeURIComponent(requestId)}/reply`,
            { reply },
            directory
        );
    }

    async revert(sessionId: string, messageId: string, directory?: string): Promise<void> {
        await this.http(
            'POST',
            `/session/${encodeURIComponent(sessionId)}/revert`,
            { messageID: messageId },
            directory
        );
    }

    async unrevert(sessionId: string, directory?: string): Promise<void> {
        await this.http('POST', `/session/${encodeURIComponent(sessionId)}/unrevert`, {}, directory);
    }

    async deleteTurn(sessionId: string, messageId: string, directory?: string): Promise<void> {
        const sid = encodeURIComponent(sessionId);
        // Supprime le message utilisateur PUIS sa/ses réponse(s) assistant
        // (celles dont parentID === messageId) — sans toucher au code.
        try {
            const raw = await this.http('GET', `/session/${sid}/message`, undefined, directory);
            const msgs = JSON.parse(raw) as Array<{ info?: { id?: string; parentID?: string } }>;
            const children = msgs
                .map(m => m.info)
                .filter((i): i is { id: string; parentID?: string } => !!i?.id && i.parentID === messageId);
            for (const child of children) {
                await this.http('DELETE', `/session/${sid}/message/${encodeURIComponent(child.id)}`, undefined, directory)
                    .catch(() => undefined);
            }
        } catch {
            /* best-effort : si la liste échoue, on supprime au moins le message utilisateur */
        }
        await this.http('DELETE', `/session/${sid}/message/${encodeURIComponent(messageId)}`, undefined, directory);
    }

    protected async http(method: string, path: string, body?: unknown, directory?: string, signal?: AbortSignal): Promise<string> {
        if (!this.baseUrl) {
            // Le sidecar boote (~1-2 s) : on attend qu'il soit prêt plutôt que d'échouer.
            await this.whenReady();
        }
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        // OpenCode 1.14.33 scope les routes par `?directory=<projet>` (et accepte
        // aussi le header). On envoie les deux pour cibler le bon workspace.
        let url = `${this.baseUrl}${path}`;
        if (directory) {
            headers['x-opencode-directory'] = directory;
            url += `${path.includes('?') ? '&' : '?'}directory=${encodeURIComponent(directory)}`;
        }
        const res = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal
        });
        const txt = await res.text();
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${path}: ${txt.slice(0, 200)}`);
        }
        return txt;
    }
}
