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
// L'API ciblée est celle du fork OpenCode 1.15.0 qualifié dans le MANIFEST :
//   POST /session                      → { id, ... }
//   POST /session/{id}/message         → bloquant jusqu'à fin de tour
//   POST /session/{id}/abort           → interrompt
//   GET  /event                        → flux SSE global ({type, properties})
// Le ciblage du workspace se fait par le header `x-opencode-directory`.

import * as http from 'node:http';
import { createParser } from 'eventsource-parser';
import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
    FabiCodeService, FabiCodeClient, FabiCodeServerInfo, FabiCodePart,
    FabiCodePermissionReply
} from '../common/fabi-code-protocol';
import {
    FabiSwarmService, FABI_FALLBACK_MODEL
} from '../common/fabi-swarm-protocol';
import { findFabiCode } from './fabi-code-runtime';
import { startServer, ServerHandle } from './fabi-code-server';
import {
    buildFabiCodeConfig, FABI_CODE_DEFAULT_CONTEXT_TOKENS, positiveTokenLimit
} from './fabi-code-config';
import { FabiCodePartAccumulator } from './fabi-code-part-stream';

const SWARM_READY_TIMEOUT_MS = 120_000;
const OPENCODE_SSE_MAX_EVENT_BYTES = 16 * 1024 * 1024;
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;

@injectable()
export class FabiCodeServiceImpl implements FabiCodeService, BackendApplicationContribution {

    @inject(ILogger) protected readonly logger: ILogger;
    // Optionnel : fournit le scheduler actif + le jeton de compte (porte de conso).
    @inject(FabiSwarmService) @optional() protected readonly swarm?: FabiSwarmService;

    protected client: FabiCodeClient | undefined;
    protected server: ServerHandle | undefined;
    protected baseUrl: string | undefined;
    protected info: FabiCodeServerInfo = { status: 'stopped', activeTurns: 0, activity: 'idle' };
    /** Modèle à utiliser (providerID/modelID) — résolu au spawn. */
    protected modelId = FABI_FALLBACK_MODEL;
    /** Signature de config réellement chargée dans le sidecar OpenCode. */
    protected configKey: string | undefined;
    /** Contrôleurs d'abort des POST /message bloquants, par session. */
    protected readonly inflight = new Map<string, AbortController>();
    /** Tours OpenCode en cours : résolus par session.status/session.error ou timeout. */
    protected readonly turnWaiters = new Map<string, { resolve: () => void; timer: ReturnType<typeof setTimeout> }>();
    protected readonly turnPhases = new Map<string, 'preparing' | 'generating'>();
    protected readonly partStream = new FabiCodePartAccumulator();
    protected sseAbort: AbortController | undefined;
    protected stopping = false;
    /** Directory dont on écoute les events (OpenCode scope /event par workspace). */
    protected sseDirectory: string | undefined;
    /** Réveillés quand le serveur devient prêt (baseUrl connue). */
    protected readyWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

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
        const startupWaiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const waiter of startupWaiters) {
            waiter.reject(new Error('Fabi IDE est en cours de fermeture.'));
        }
        for (const ac of this.inflight.values()) {
            ac.abort();
        }
        this.inflight.clear();
        for (const waiter of this.turnWaiters.values()) {
            clearTimeout(waiter.timer);
            waiter.resolve();
        }
        this.turnWaiters.clear();
        this.turnPhases.clear();
        this.partStream.clear();
        await this.server?.stop().catch(() => undefined);
    }

    // ---- démarrage du sidecar ----

    protected async launch(): Promise<void> {
        const found = findFabiCode();
        if (!found) {
            const message = 'moteur fabi-code qualifié introuvable';
            this.setStatus('error', message);
            throw new Error(message);
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
                this.baseUrl = undefined;
                this.sseAbort?.abort();
                this.finishAllTurns('Le moteur Fabi a redémarré pendant la génération.');
                this.setStatus('error', msg);
            },
            onStopped: () => {
                this.baseUrl = undefined;
                this.setStatus('stopped');
            },
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
        this.finishAllTurns('Le modèle Fabi actif a changé pendant la génération.');
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
        let maxContextTokens = FABI_CODE_DEFAULT_CONTEXT_TOKENS;
        if (envBase) {
            baseURL = envBase.replace(/\/+$/, '');
            model = process.env.FABI_CODE_MODEL || FABI_FALLBACK_MODEL;
            apiKey = process.env.FABI_CODE_API_KEY || 'fabi-test';
            maxContextTokens = positiveTokenLimit(
                process.env.FABI_CODE_MAX_CONTEXT_TOKENS,
                FABI_CODE_DEFAULT_CONTEXT_TOKENS
            );
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
                maxContextTokens = positiveTokenLimit(
                    active?.maxContextTokens,
                    FABI_CODE_DEFAULT_CONTEXT_TOKENS
                );
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
        const built = buildFabiCodeConfig({
            baseURL,
            model,
            apiKey,
            maxContextTokens,
            maxOutputTokens: positiveTokenLimit(process.env.FABI_CODE_MAX_OUTPUT_TOKENS, 4_096)
        });
        return { config: built.config, key: built.key };
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
        await this.swarm.waitUntilReady(timeoutMs);
    }

    protected setStatus(status: FabiCodeServerInfo['status'], detail?: string): void {
        const activity = [...this.turnPhases.values()].includes('generating')
            ? 'generating'
            : this.turnPhases.size > 0 ? 'preparing' : 'idle';
        this.info = { status, url: this.baseUrl, detail, activeTurns: this.turnWaiters.size, activity };
        this.client?.onServerStatus(this.info);
        if (status === 'ready' && this.baseUrl) {
            const waiters = this.readyWaiters;
            this.readyWaiters = [];
            for (const w of waiters) {
                w.resolve();
            }
        } else if (status === 'error') {
            const waiters = this.readyWaiters;
            this.readyWaiters = [];
            for (const w of waiters) {
                w.reject(new Error(detail ?? 'le moteur fabi-code ne démarre pas'));
            }
        }
    }

    /** Résout dès que le sidecar est prêt (baseUrl connue), sinon rejette au bout du délai. */
    protected whenReady(timeoutMs = 25000): Promise<void> {
        if (this.baseUrl) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
            let waiter: { resolve: () => void; reject: (error: Error) => void };
            const timer = setTimeout(() => {
                this.readyWaiters = this.readyWaiters.filter(w => w !== waiter);
                reject(new Error(this.info.detail ?? 'le moteur fabi-code ne démarre pas'));
            }, timeoutMs);
            const onReady = (): void => {
                clearTimeout(timer);
                resolve();
            };
            const onError = (error: Error): void => {
                clearTimeout(timer);
                reject(error);
            };
            waiter = { resolve: onReady, reject: onError };
            this.readyWaiters.push(waiter);
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
        let reconnectScheduled = false;
        const scheduleReconnect = (): void => {
            if (reconnectScheduled) {
                return;
            }
            reconnectScheduled = true;
            reconnect();
        };
        const parser = createParser({
            maxBufferSize: OPENCODE_SSE_MAX_EVENT_BYTES,
            onEvent: event => this.handleEvent(event.data),
            onError: error => this.logger.warn(`[fabi-code] event SSE invalide: ${error.message}`)
        });
        try {
            const req = http.get(url, { headers: { accept: 'text/event-stream' }, signal: ac.signal }, res => {
                if (res.statusCode !== 200 || !String(res.headers['content-type'] ?? '').includes('text/event-stream')) {
                    res.resume();
                    scheduleReconnect();
                    return;
                }
                res.setEncoding('utf-8');
                res.on('data', (chunk: string) => {
                    try {
                        parser.feed(chunk);
                    } catch (error) {
                        this.logger.warn(`[fabi-code] flux SSE interrompu: ${error instanceof Error ? error.message : String(error)}`);
                        res.destroy();
                    }
                });
                res.on('end', () => {
                    try { parser.reset({ consume: true }); } catch { /* reconnexion ci-dessous */ }
                    scheduleReconnect();
                });
                res.on('error', scheduleReconnect);
            });
            req.on('error', scheduleReconnect);
        } catch {
            scheduleReconnect();
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
                if (part.type === 'step-start') {
                    this.setTurnPhase(sessionId, 'generating');
                }
                this.client?.onPart(this.partStream.remember(this.normalizePart(sessionId, part)));
            }
        } else if (type === 'message.part.delta') {
            const messageId = typeof props.messageID === 'string' ? props.messageID : '';
            const partId = typeof props.partID === 'string' ? props.partID : '';
            const field = typeof props.field === 'string' ? props.field : '';
            const delta = typeof props.delta === 'string' ? props.delta : '';
            const cumulative = this.partStream.append({ sessionId, messageId, partId, field, delta });
            if (cumulative) {
                this.client?.onPart(cumulative);
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
            // `retry` est encore un tour actif ; seul `idle` clôt réellement.
            if (status === 'idle') {
                this.finishTurn(sessionId);
            }
        } else if (type === 'session.idle') {
            // Event déprécié mais encore émis par OpenCode 1.15 avec status=idle.
            this.finishTurn(sessionId);
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

    async abort(sessionId: string, directory?: string): Promise<void> {
        this.inflight.get(sessionId)?.abort();
        this.inflight.delete(sessionId);
        try {
            await this.http('POST', `/session/${encodeURIComponent(sessionId)}/abort`, {}, directory);
        } catch {
            /* best-effort */
        }
    }

    protected waitForTurn(sessionId: string, ac: AbortController, directory?: string): Promise<void> {
        const previous = this.turnWaiters.get(sessionId);
        if (previous) {
            this.finishTurn(sessionId, 'Un nouveau tour a remplacé le tour précédent.');
        }
        return new Promise<void>(resolve => {
            const timeoutMs = Math.max(
                30_000,
                Math.min(positiveTokenLimit(process.env.FABI_CODE_TURN_TIMEOUT_MS, DEFAULT_TURN_TIMEOUT_MS), 60 * 60_000)
            );
            const timer = setTimeout(() => {
                ac.abort();
                void this.http('POST', `/session/${encodeURIComponent(sessionId)}/abort`, {}, directory)
                    .catch(() => undefined);
                this.finishTurn(sessionId, 'Timeout: le moteur Fabi n\'a pas terminé le tour.');
            }, timeoutMs);
            timer.unref?.();
            this.turnWaiters.set(sessionId, { resolve, timer });
            this.turnPhases.set(sessionId, 'preparing');
            this.setStatus(this.info.status, this.info.detail);
        });
    }

    protected finishTurn(sessionId: string, error?: string): void {
        const waiter = this.turnWaiters.get(sessionId);
        if (!waiter) {
            return;
        }
        clearTimeout(waiter.timer);
        this.turnWaiters.delete(sessionId);
        this.turnPhases.delete(sessionId);
        waiter.resolve();
        this.partStream.clearSession(sessionId);
        this.setStatus(this.info.status, this.info.detail);
        this.client?.onTurnDone(sessionId, error);
    }

    protected finishAllTurns(error: string): void {
        for (const sessionId of [...this.turnWaiters.keys()]) {
            this.finishTurn(sessionId, error);
        }
    }

    protected setTurnPhase(sessionId: string, phase: 'preparing' | 'generating'): void {
        if (!this.turnWaiters.has(sessionId) || this.turnPhases.get(sessionId) === phase) {
            return;
        }
        this.turnPhases.set(sessionId, phase);
        this.setStatus(this.info.status, this.info.detail);
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
        // OpenCode 1.15 scope les routes par `?directory=<projet>` (et accepte
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
