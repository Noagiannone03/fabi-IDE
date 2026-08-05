// Service backend du moteur fabi-code (OpenCode en sidecar).
//
// Responsabilités :
//   1. Spawn `opencode serve` au démarrage de l'IDE (config provider swarm
//      injectée en env), arrêt propre au quit (BackendApplicationContribution).
//   2. Tenir UNE connexion SSE persistante vers `/event` d'OpenCode, parser les
//      `message.part.updated` / `session.status` et les pousser au frontend via
//      FabiCodeClient (relais zéro-polling).
//   3. Exposer createSession / prompt_async / abort via RPC pour le ChatAgent relais.
//
// L'API ciblée est celle du fork OpenCode 1.15.0 qualifié dans le MANIFEST :
//   POST /session                      → { id, ... }
//   POST /session/{id}/prompt_async    → acquittement 204 immédiat
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
    FabiCodePermission, FabiCodePermissionReply, FabiCodeQuestion, parseFabiCodeQuestion
} from '../common/fabi-code-protocol';
import {
    automaticPermissionReply, FabiCodePermissionMode, normalizeFabiCodePermissionMode,
    OpenCodeSessionParent, resolveOpenCodeRootSessionId
} from '../common/fabi-code-permission-mode';
import {
    FabiSwarmService, FABI_FALLBACK_MODEL
} from '../common/fabi-swarm-protocol';
import { findFabiCode } from './fabi-code-runtime';
import { startServer, ServerHandle } from './fabi-code-server';
import {
    buildFabiCodeConfig, FABI_CODE_DEFAULT_CONTEXT_TOKENS, positiveTokenLimit,
    recommendedOutputTokens
} from './fabi-code-config';
import { FabiCodePartAccumulator } from './fabi-code-part-stream';
import {
    classifyOpenCodeTurnStatus, hasNewCompletedAssistantMessage,
    OpenCodeMessageState, OpenCodeSessionStatuses, snapshotAssistantMessageIds
} from './fabi-code-turn-state';

const SWARM_READY_TIMEOUT_MS = 120_000;
const OPENCODE_SSE_MAX_EVENT_BYTES = 16 * 1024 * 1024;

interface TurnWaiter {
    resolve: () => void;
    directory?: string;
    /** OpenCode acknowledged `/prompt_async`. */
    accepted: boolean;
    /** At least one durable/SSE active state was observed for this turn. */
    observedActive: boolean;
    /** Assistant messages that predated this prompt. */
    previousAssistantIds: ReadonlySet<string>;
}

@injectable()
export class FabiCodeServiceImpl implements FabiCodeService, BackendApplicationContribution {

    @inject(ILogger) protected readonly logger: ILogger;
    // Optionnel : fournit le Request Agent local + le jeton de compte.
    @inject(FabiSwarmService) @optional() protected readonly swarm?: FabiSwarmService;

    protected client: FabiCodeClient | undefined;
    protected server: ServerHandle | undefined;
    protected baseUrl: string | undefined;
    protected info: FabiCodeServerInfo = { status: 'stopped', activeTurns: 0, activity: 'idle' };
    /** Modèle à utiliser (providerID/modelID) — résolu au spawn. */
    protected modelId = FABI_FALLBACK_MODEL;
    /** Signature de config réellement chargée dans le sidecar OpenCode. */
    protected configKey: string | undefined;
    /** Contrôleurs d'abort des soumissions prompt_async, par session. */
    protected readonly inflight = new Map<string, AbortController>();
    /** Tours OpenCode en cours : résolus par état durable, erreur ou abort. */
    protected readonly turnWaiters = new Map<string, TurnWaiter>();
    protected readonly turnPhases = new Map<string, 'preparing' | 'generating'>();
    protected readonly partStream = new FabiCodePartAccumulator();
    protected sseAbort: AbortController | undefined;
    protected stopping = false;
    /** Directory dont on écoute les events (OpenCode scope /event par workspace). */
    protected sseDirectory: string | undefined;
    /** Réveillés quand le serveur devient prêt (baseUrl connue). */
    protected readyWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
    /** Parent connu de chaque session OpenCode (racines comprises). */
    protected readonly sessionParents = new Map<string, string | undefined>();
    /**
     * Politique choisie par chaque chat racine pour toute sa session OpenCode.
     * Une sous-tâche peut demander un outil après l'événement idle du parent :
     * supprimer cette entrée à la fin du tour ferait réapparaître une carte de
     * permission alors que le chat est toujours en mode automatique.
     */
    protected readonly permissionPolicies = new Map<string, { mode: FabiCodePermissionMode; agent: string }>();
    /** Interactions déjà remises au frontend ou traitées automatiquement. */
    protected readonly publishedPermissionIds = new Set<string>();
    protected readonly publishedQuestionIds = new Set<string>();

    setClient(client: FabiCodeClient | undefined): void {
        this.client = client;
        if (client) {
            // Rendu immédiat à l'attache.
            client.onServerStatus(this.info);
            // Un renderer peut se recharger pendant qu'OpenCode attend une
            // réponse. Les listes REST sont la vérité durable ; le SSE seul ne
            // rejouera pas l'event `asked` déjà consommé.
            this.publishedPermissionIds.clear();
            this.publishedQuestionIds.clear();
            if (this.baseUrl) {
                void this.reconcilePendingInteractions().catch(error => {
                    this.logger.warn(`[fabi-code] reprise des interactions impossible: ${error instanceof Error ? error.message : String(error)}`);
                });
            }
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
            waiter.resolve();
        }
        this.turnWaiters.clear();
        this.turnPhases.clear();
        this.partStream.clear();
        this.sessionParents.clear();
        this.permissionPolicies.clear();
        this.publishedPermissionIds.clear();
        this.publishedQuestionIds.clear();
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

    /** Redémarre OpenCode si le modèle/Request Agent/token actif a changé. */
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
        this.sessionParents.clear();
        this.permissionPolicies.clear();
        this.publishedPermissionIds.clear();
        this.publishedQuestionIds.clear();
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
            let requestAgentUrl: string | undefined;
            model = FABI_FALLBACK_MODEL;
            try {
                const active = await this.swarm?.getActiveSwarm();
                if (active?.model) {
                    model = active.model;
                }
                maxContextTokens = positiveTokenLimit(
                    active?.maxContextTokens,
                    FABI_CODE_DEFAULT_CONTEXT_TOKENS
                );
                apiKey = await this.swarm?.getAccountToken();
                const requestAgent = await this.swarm?.waitForRequestAgent();
                if (requestAgent?.kind === 'ready') {
                    requestAgentUrl = requestAgent.baseUrl;
                }
            } catch (err) {
                throw new Error(`Impossible de lire le swarm actif: ${err instanceof Error ? err.message : String(err)}`);
            }
            if (!requestAgentUrl) {
                throw new Error('Le Request Agent local du swarm actif n’est pas prêt.');
            }
            baseURL = `${requestAgentUrl.replace(/\/+$/, '')}/v1`;
        }
        this.modelId = model;
        const configuredOutputTokens = process.env.FABI_CODE_MAX_OUTPUT_TOKENS;
        const built = buildFabiCodeConfig({
            baseURL,
            model,
            apiKey,
            maxContextTokens,
            maxOutputTokens: configuredOutputTokens === undefined
                ? undefined
                : positiveTokenLimit(configuredOutputTokens, recommendedOutputTokens(maxContextTokens))
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
                // SSE est une notification de bord, pas un journal durable.
                // Après chaque connexion on relit donc les états ET les
                // interactions en attente. Une coupure ne peut ainsi perdre ni
                // une fin de tour, ni une permission/question.
                void Promise.all([
                    this.reconcileActiveTurns(),
                    this.reconcilePendingInteractions()
                ]).catch(error => {
                    this.logger.warn(`[fabi-code] resynchronisation impossible: ${error instanceof Error ? error.message : String(error)}`);
                });
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
        const sessionInfo = props.info && typeof props.info === 'object'
            ? props.info as Record<string, unknown>
            : undefined;
        const sessionId = typeof props.sessionID === 'string'
            ? props.sessionID
            : type === 'session.updated' && typeof sessionInfo?.id === 'string'
                ? sessionInfo.id
                : undefined;
        if (!sessionId) {
            return;
        }
        if (type === 'session.updated') {
            this.sessionParents.set(
                sessionId,
                typeof sessionInfo?.parentID === 'string' ? sessionInfo.parentID : undefined
            );
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
                    this.markTurnActive(sessionId);
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
                // A persisted text/reasoning delta is stronger evidence than a
                // possibly delayed Request Agent phase: decode has started.
                this.markTurnActive(sessionId);
                this.setTurnPhase(sessionId, 'generating');
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
                this.handleTurnIdle(sessionId);
            } else if (status) {
                this.markTurnActive(sessionId);
            }
        } else if (type === 'session.idle') {
            // Event déprécié mais encore émis par OpenCode 1.15 avec status=idle.
            this.handleTurnIdle(sessionId);
        } else if (type === 'session.error') {
            const err = props.error as { data?: { message?: string } } | undefined;
            this.finishTurn(sessionId, err?.data?.message ?? 'erreur de session');
        } else if (type === 'file.edited') {
            const path = typeof props.path === 'string' ? props.path : undefined;
            if (path) {
                this.client?.onFileEdited(sessionId, path);
            }
        } else if (type === 'permission.asked') {
            void this.publishPermission(props).catch(error => {
                this.logger.warn(`[fabi-code] permission non relayée: ${error instanceof Error ? error.message : String(error)}`);
            });
        } else if (type === 'permission.replied') {
            const requestId = typeof props.requestID === 'string' ? props.requestID : undefined;
            if (requestId) {
                this.publishedPermissionIds.delete(requestId);
            }
        } else if (type === 'question.asked') {
            const question = parseFabiCodeQuestion(props);
            if (question) {
                void this.publishQuestion(question).catch(error => {
                    this.logger.warn(`[fabi-code] question non relayée: ${error instanceof Error ? error.message : String(error)}`);
                });
            }
        } else if (type === 'question.replied' || type === 'question.rejected') {
            const requestId = typeof props.requestID === 'string' ? props.requestID : undefined;
            if (requestId) {
                this.publishedQuestionIds.delete(requestId);
            }
        }
    }

    protected permissionFromProperties(properties: Record<string, unknown>): FabiCodePermission | undefined {
        const id = typeof properties.id === 'string' ? properties.id : undefined;
        const sessionId = typeof properties.sessionID === 'string' ? properties.sessionID : undefined;
        if (!id || !sessionId) {
            return undefined;
        }
        const tool = properties.tool as { callID?: string } | undefined;
        const metadata = properties.metadata as Record<string, unknown> | undefined;
        const patterns = Array.isArray(properties.patterns)
            ? properties.patterns.filter((value): value is string => typeof value === 'string')
            : [];
        const detail = typeof metadata?.command === 'string' ? metadata.command
            : typeof metadata?.url === 'string' ? metadata.url
                : patterns.length > 0 ? patterns.join(', ')
                    : undefined;
        return {
            id,
            sessionId,
            title: typeof properties.permission === 'string' ? properties.permission : 'Autorisation requise',
            detail,
            callId: typeof tool?.callID === 'string' ? tool.callID : undefined
        };
    }

    /** Résout le chat racine par les liens parentID durables d'OpenCode. */
    protected async resolveRootSessionId(sessionId: string, directory?: string): Promise<string> {
        const ancestry: OpenCodeSessionParent[] = [];
        const visited = new Set<string>();
        let current = sessionId;
        for (let depth = 0; depth < 64 && !visited.has(current); depth++) {
            visited.add(current);
            if (!this.sessionParents.has(current)) {
                const raw = await this.http('GET', `/session/${encodeURIComponent(current)}`, undefined, directory);
                const info = JSON.parse(raw) as { id?: string; parentID?: string };
                if (!info.id) {
                    break;
                }
                this.sessionParents.set(info.id, typeof info.parentID === 'string' ? info.parentID : undefined);
            }
            const parentID = this.sessionParents.get(current);
            ancestry.push({ id: current, parentID });
            if (!parentID) {
                break;
            }
            current = parentID;
        }
        return resolveOpenCodeRootSessionId(sessionId, ancestry);
    }

    protected async publishPermission(
        properties: Record<string, unknown>,
        directory = this.sseDirectory
    ): Promise<void> {
        const permission = this.permissionFromProperties(properties);
        if (!permission || this.publishedPermissionIds.has(permission.id)) {
            return;
        }
        const rootSessionId = await this.resolveRootSessionId(permission.sessionId, directory)
            .catch(() => permission.sessionId);
        const enriched = { ...permission, rootSessionId };
        const policy = this.permissionPolicies.get(rootSessionId);

        // Le mode automatique appartient à CE chat racine et couvre aussi ses
        // sous-tâches. `always` évite de refaire transiter les mêmes motifs par
        // le broker ; les nouvelles catégories restent autorisées ici. La
        // politique ne fuit jamais vers un autre chat et plan reste non élevé.
        const automaticReply = policy
            ? automaticPermissionReply(policy.mode, policy.agent)
            : undefined;
        if (automaticReply) {
            this.publishedPermissionIds.add(permission.id);
            try {
                await this.replyPermission(permission.id, automaticReply, directory);
                return;
            } catch (error) {
                this.publishedPermissionIds.delete(permission.id);
                this.logger.warn(`[fabi-code] approbation automatique impossible, retour au dialogue: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (!this.client) {
            return;
        }
        this.publishedPermissionIds.add(permission.id);
        this.client.onPermissionAsked(enriched);
    }

    protected async publishQuestion(question: FabiCodeQuestion, directory = this.sseDirectory): Promise<void> {
        if (this.publishedQuestionIds.has(question.id) || !this.client) {
            return;
        }
        const rootSessionId = await this.resolveRootSessionId(question.sessionId, directory)
            .catch(() => question.sessionId);
        this.publishedQuestionIds.add(question.id);
        this.client.onQuestionAsked({ ...question, rootSessionId });
    }

    /** Rejoue les interactions qui survivent à une reconnexion SSE/renderer. */
    protected async reconcilePendingInteractions(): Promise<void> {
        if (!this.baseUrl) {
            return;
        }
        const [permissionsRaw, questionsRaw] = await Promise.all([
            this.http('GET', '/permission', undefined, this.sseDirectory),
            this.http('GET', '/question', undefined, this.sseDirectory)
        ]);
        const permissions = JSON.parse(permissionsRaw) as unknown;
        const questions = JSON.parse(questionsRaw) as unknown;
        if (Array.isArray(permissions)) {
            await Promise.all(permissions
                .filter((value): value is Record<string, unknown> => !!value && typeof value === 'object')
                .map(permission => this.publishPermission(permission)));
        }
        if (Array.isArray(questions)) {
            await Promise.all(questions
                .filter((value): value is Record<string, unknown> => !!value && typeof value === 'object')
                .map(value => parseFabiCodeQuestion(value))
                .filter((value): value is FabiCodeQuestion => !!value)
                .map(question => this.publishQuestion(question)));
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

    async prompt(
        sessionId: string,
        text: string,
        directory?: string,
        agent = 'build',
        permissionMode?: FabiCodePermissionMode
    ): Promise<void> {
        await this.ensureCurrentServer();
        this.ensureEventStreamFor(directory);
        this.sessionParents.set(sessionId, undefined);
        this.permissionPolicies.set(sessionId, {
            mode: normalizeFabiCodePermissionMode(permissionMode),
            agent
        });
        const ac = new AbortController();
        this.inflight.set(sessionId, ac);
        try {
            const done = this.waitForTurn(sessionId, directory);
            const waiter = this.turnWaiters.get(sessionId)!;
            waiter.previousAssistantIds = await this.snapshotAssistantIds(sessionId, directory);
            const body: Record<string, unknown> = { parts: [{ type: 'text', text }] };
            body.agent = agent; // 'build' (édite) | 'plan' (lecture seule)
            // OpenCode 1.15 fournit un acquittement asynchrone explicite. La
            // génération et sa fin sont suivies par /event + /session/status ;
            // aucune connexion HTTP n'est gardée pendant un long prefill/decode.
            await this.http(
                'POST',
                `/session/${encodeURIComponent(sessionId)}/prompt_async`,
                body,
                directory,
                ac.signal
            );
            if (this.turnWaiters.get(sessionId) === waiter) {
                waiter.accepted = true;
                // `prompt_async` peut répondre quelques millisecondes avant
                // `busy`. reconcileTurn distingue cet état non observé d'un
                // vrai idle et consulte l'historique en repli.
                await this.reconcileTurn(sessionId, waiter);
            }
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
        } finally {
            // Abort is a local user decision. It must settle the desktop even
            // when the corresponding OpenCode idle event is lost with the SSE
            // connection that was just interrupted.
            this.finishTurn(sessionId);
        }
    }

    protected waitForTurn(sessionId: string, directory?: string): Promise<void> {
        const previous = this.turnWaiters.get(sessionId);
        if (previous) {
            this.finishTurn(sessionId, 'Un nouveau tour a remplacé le tour précédent.');
        }
        return new Promise<void>(resolve => {
            this.turnWaiters.set(sessionId, {
                resolve,
                directory,
                accepted: false,
                observedActive: false,
                previousAssistantIds: new Set()
            });
            this.turnPhases.set(sessionId, 'preparing');
            this.setStatus(this.info.status, this.info.detail);
        });
    }

    protected async reconcileActiveTurns(): Promise<void> {
        await Promise.all(
            [...this.turnWaiters.entries()]
                .filter(([, waiter]) => waiter.accepted)
                .map(([sessionId, waiter]) => this.reconcileTurn(sessionId, waiter))
        );
    }

    protected async reconcileTurn(sessionId: string, waiter: TurnWaiter): Promise<void> {
        if (this.turnWaiters.get(sessionId) !== waiter || !waiter.accepted) {
            return;
        }
        const raw = await this.http('GET', '/session/status', undefined, waiter.directory);
        const statuses = JSON.parse(raw) as OpenCodeSessionStatuses;
        const state = classifyOpenCodeTurnStatus(statuses, sessionId, waiter.observedActive);
        if (state === 'active') {
            waiter.observedActive = true;
            return;
        }
        if (state === 'settled') {
            this.finishTurn(sessionId);
            return;
        }
        // Le 204 de prompt_async précède parfois `busy`. Une absence initiale
        // n'est terminale que si l'historique durable contient déjà une nouvelle
        // réponse assistant achevée (cas où les deux bords SSE ont été manqués).
        const messages = await this.readMessages(sessionId, waiter.directory);
        if (hasNewCompletedAssistantMessage(messages, waiter.previousAssistantIds)) {
            this.finishTurn(sessionId);
        }
    }

    protected markTurnActive(sessionId: string): void {
        const waiter = this.turnWaiters.get(sessionId);
        if (waiter) {
            waiter.observedActive = true;
        }
    }

    protected handleTurnIdle(sessionId: string): void {
        const waiter = this.turnWaiters.get(sessionId);
        if (!waiter) {
            return;
        }
        if (waiter.observedActive) {
            this.finishTurn(sessionId);
            return;
        }
        // OpenCode 1.15 may emit both `session.status: idle` and the legacy
        // `session.idle`. A delayed duplicate from the previous turn must not
        // settle a newly-created waiter in the prompt_async acknowledgement gap.
        // Once accepted, durable history can still prove a very short turn that
        // completed before its busy edge was observed.
        if (waiter.accepted) {
            void this.reconcileTurn(sessionId, waiter).catch(error => {
                this.logger.warn(`[fabi-code] réconciliation idle impossible: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
    }

    protected async readMessages(sessionId: string, directory?: string): Promise<OpenCodeMessageState[]> {
        const raw = await this.http(
            'GET',
            `/session/${encodeURIComponent(sessionId)}/message`,
            undefined,
            directory
        );
        const messages = JSON.parse(raw) as unknown;
        return Array.isArray(messages) ? messages as OpenCodeMessageState[] : [];
    }

    protected async snapshotAssistantIds(sessionId: string, directory?: string): Promise<ReadonlySet<string>> {
        return snapshotAssistantMessageIds(await this.readMessages(sessionId, directory));
    }

    protected finishTurn(sessionId: string, error?: string): void {
        const waiter = this.turnWaiters.get(sessionId);
        if (!waiter) {
            return;
        }
        this.turnWaiters.delete(sessionId);
        this.turnPhases.delete(sessionId);
        // Ne pas effacer permissionPolicies ici : les sessions enfants OpenCode
        // peuvent encore travailler après l'idle du parent. La politique est
        // remplacée au prochain prompt et purgée uniquement avec le sidecar.
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

    async replyQuestion(requestId: string, answers: string[][], directory?: string): Promise<void> {
        await this.http(
            'POST',
            `/question/${encodeURIComponent(requestId)}/reply`,
            { answers },
            directory
        );
    }

    async rejectQuestion(requestId: string, directory?: string): Promise<void> {
        await this.http(
            'POST',
            `/question/${encodeURIComponent(requestId)}/reject`,
            {},
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
