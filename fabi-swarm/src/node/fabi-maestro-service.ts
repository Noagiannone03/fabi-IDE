// Service backend du tableau de bord « Maestro ».
//
// Agrège l'état de TOUS les agents IA de l'IDE et le pousse au frontend (zéro
// polling côté UI). Source phase 1 = les chats Fabi AI = sessions du sidecar
// OpenCode, TOUTES workspaces confondues :
//   - liste GLOBALE des sessions via `GET /session` (sans directory) — chaque
//     session porte son `directory`, `title`, `time`, `summary` ;
//   - statut LIVE via UN flux SSE global `GET /event` (sans directory) — on a
//     vérifié que ce flux émet les events de toutes les sessions.
//
// On NE TOUCHE PAS au chemin de chat existant : on se branche en lecture sur le
// même sidecar (via FabiCodeService.getBaseUrl + listSessions/getMessages) et on
// ouvre NOTRE PROPRE flux SSE (OpenCode accepte plusieurs abonnés /event).
//
// (Phase 2 : agents CLI externes Claude/Codex — détection process + transcript.)

import * as http from 'node:http';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { FabiCodeService } from '../common/fabi-code-protocol';
import {
    FabiMaestroService, FabiMaestroClient, MaestroSnapshot, MaestroAgent, MaestroMessage, MaestroStatus, MaestroSurface,
    MaestroHooksStatus
} from '../common/fabi-maestro-protocol';
import { ExternalAgentMonitor } from './fabi-external-agents';
import { MaestroHookBridge } from './fabi-maestro-hooks';

/** Nombre max d'agents Fabi AI affichés (les plus récents). */
const MAX_AGENTS = 60;

/** Enregistrement interne d'une session OpenCode supervisée. */
interface FabiRec {
    id: string;
    directory?: string;
    title: string;
    status: MaestroStatus;
    updatedAt: number;
    preview?: string;
    model?: string;
    pendingPermission?: string;
    pendingPermissionId?: string;
    edits?: { files: number; additions: number; deletions: number };
    /** Vu pour la dernière fois dans la liste/les events (ms) — pour la réconciliation. */
    lastSeen: number;
}

@injectable()
export class FabiMaestroServiceImpl implements FabiMaestroService, BackendApplicationContribution {

    @inject(ILogger) protected readonly logger: ILogger;
    @inject(FabiCodeService) protected readonly fabiCode: FabiCodeService;

    protected client: FabiMaestroClient | undefined;
    protected started = false;
    protected disposed = false;

    /** Sessions Fabi AI, par id OpenCode. */
    protected readonly fabi = new Map<string, FabiRec>();

    /** Agents CLI externes (Claude/Codex) détectés au dernier scan. */
    protected external: MaestroAgent[] = [];
    protected extMonitor: ExternalAgentMonitor | undefined;
    protected extTimer: NodeJS.Timeout | undefined;
    protected externalScanRunning = false;
    protected hooks: MaestroHookBridge | undefined;

    protected baseUrl: string | undefined;
    protected engineStatus: MaestroSnapshot['engine'] = 'starting';
    protected sseAbort: AbortController | undefined;
    protected pollTimer: NodeJS.Timeout | undefined;
    protected refreshTimer: NodeJS.Timeout | undefined;
    protected pushTimer: NodeJS.Timeout | undefined;
    /** Surfaces ouvertes, publiées par chaque frontend de workspace. */
    protected readonly surfaces = new Map<string, { updatedAt: number; items: MaestroSurface[] }>();

    setClient(client: FabiMaestroClient | undefined): void {
        this.client = client;
        if (client) {
            // Rendu immédiat à l'attache.
            this.safePush(this.snapshot());
        }
    }

    // ---- API RPC ----

    async start(): Promise<MaestroSnapshot> {
        if (!this.started) {
            this.started = true;
            void this.run();
        }
        return this.snapshot();
    }

    async getSnapshot(): Promise<MaestroSnapshot> {
        return this.snapshot();
    }

    async reportOpenSurfaces(ownerId: string, surfaces: MaestroSurface[]): Promise<void> {
        if (!this.started) {
            this.started = true;
            void this.run();
        }
        if (!ownerId) {
            return;
        }
        if (surfaces.length === 0) {
            this.surfaces.delete(ownerId);
        } else {
            this.surfaces.set(ownerId, { updatedAt: Date.now(), items: surfaces });
        }
        await this.scanExternal();
        this.schedulePush();
    }

    async getConversation(key: string): Promise<MaestroMessage[]> {
        const parsed = this.parseKey(key);
        if (parsed.source === 'claude' || parsed.source === 'codex') {
            return this.extMonitor ? this.extMonitor.getConversation(parsed.source, parsed.id) : [];
        }
        const rec = this.fabi.get(parsed.id);
        try {
            const raw = await this.http('GET', `/session/${encodeURIComponent(parsed.id)}/message`, undefined, rec?.directory);
            return this.parseMessages(raw);
        } catch (err) {
            this.logger.warn(`[maestro] getConversation ${key}: ${String(err)}`);
            return [];
        }
    }

    async send(key: string, text: string): Promise<void> {
        const parsed = this.parseKey(key);
        if (parsed.source !== 'fabi') {
            throw new Error('Maestro : envoi non supporté pour cette source (phase 2).');
        }
        const rec = this.fabi.get(parsed.id);
        // Marque « génère » tout de suite (le SSE global confirmera/affinera).
        if (rec) {
            rec.status = 'generating';
            rec.updatedAt = Date.now();
            this.schedulePush();
        }
        // POST /message d'OpenCode est BLOQUANT jusqu'à la fin du tour. On NE l'attend
        // PAS (sinon l'appel RPC resterait ouvert tout le tour) : la progression
        // (statut + aperçu + messages) arrive en live via NOTRE flux SSE global. On
        // poste via NOTRE http → aucune interférence avec le flux SSE du chat.
        void this.http('POST', `/session/${encodeURIComponent(parsed.id)}/message`,
            { parts: [{ type: 'text', text }] }, rec?.directory)
            .catch(err => this.logger.warn(`[maestro] send ${key}: ${String(err)}`));
    }

    async abort(key: string): Promise<void> {
        const parsed = this.parseKey(key);
        if (parsed.source !== 'fabi') {
            return;
        }
        const rec = this.fabi.get(parsed.id);
        try {
            await this.http('POST', `/session/${encodeURIComponent(parsed.id)}/abort`, {}, rec?.directory);
        } catch (err) {
            this.logger.warn(`[maestro] abort ${key}: ${String(err)}`);
        }
    }

    async replyPermission(key: string, allow: boolean): Promise<void> {
        const parsed = this.parseKey(key);
        if (parsed.source === 'claude' || parsed.source === 'codex') {
            if (this.hooks?.respond(parsed.source, parsed.id, allow)) {
                await this.scanExternal();
            }
            return;
        }
        if (parsed.source !== 'fabi') {
            return;
        }
        const rec = this.fabi.get(parsed.id);
        if (!rec?.pendingPermissionId) {
            return;
        }
        try {
            await this.fabiCode.replyPermission(
                rec.pendingPermissionId,
                allow ? 'once' : 'reject',
                rec.directory
            );
            rec.pendingPermission = undefined;
            rec.pendingPermissionId = undefined;
            rec.status = allow ? 'generating' : 'idle';
            rec.updatedAt = Date.now();
            this.schedulePush();
        } catch (err) {
            this.logger.warn(`[maestro] permission ${key}: ${String(err)}`);
        }
    }

    async getHooksStatus(): Promise<MaestroHooksStatus> {
        return this.hooks
            ? this.hooks.status()
            : { claude: false, codex: false, bridge: false };
    }

    async installHooks(): Promise<MaestroHooksStatus> {
        if (!this.hooks) {
            throw new Error('Bridge de hooks Maestro non démarré.');
        }
        return this.hooks.install();
    }

    // ---- Cycle de vie backend ----

    /**
     * Au démarrage du backend (BackendApplicationContribution) : on démarre le
     * pont de hooks et on INSTALLE automatiquement les hooks Claude/Codex — AVANT
     * tout lancement d'agent → ils sont prêts dès le premier `claude`/`codex`.
     * (comme open-vibe-island / vibe-notch installent au lancement de l'app).
     */
    onStart(): void {
        void this.ensureHooks();
    }

    /** Crée+démarre le pont de hooks et installe les hooks (idempotent). */
    protected async ensureHooks(): Promise<void> {
        if (this.hooks) {
            return;
        }
        this.hooks = new MaestroHookBridge(() => {
            void this.scanExternal();
            this.schedulePush();
        });
        await this.hooks.start().catch(err => this.logger.warn(`[maestro] hook bridge: ${String(err)}`));
        // Fusion idempotente et sûre dans ~/.claude et ~/.codex.
        await this.hooks.install().catch(err => this.logger.warn(`[maestro] auto-install hooks: ${String(err)}`));
    }

    // ---- Boucle de supervision ----

    protected async run(): Promise<void> {
        await this.ensureHooks();

        // Agents CLI externes (Claude/Codex) : scan disque + liveness, indépendant
        // du sidecar OpenCode → démarre tout de suite.
        this.extMonitor = new ExternalAgentMonitor(this.logger);
        await this.scanExternal();
        this.extTimer = setInterval(() => void this.scanExternal(), 4000);
        this.extTimer.unref?.();

        // Chats Fabi AI (sidecar OpenCode).
        await this.ensureBaseUrl();
        await this.refreshSessions();
        this.openEventStream();
        // Filet : capte les sessions créées ailleurs + réconcilie les suppressions.
        this.pollTimer = setInterval(() => void this.refreshSessions(), 6000);
        this.pollTimer.unref?.();
    }

    protected async scanExternal(): Promise<void> {
        if (this.disposed || !this.extMonitor || this.externalScanRunning) {
            return;
        }
        this.externalScanRunning = true;
        try {
            const scanned = await this.extMonitor.scan(this.openSurfaces().filter(surface => surface.kind === 'terminal'));
            this.external = this.hooks ? this.hooks.apply(scanned) : scanned;
            this.schedulePush();
        } catch (err) {
            this.logger.debug(`[maestro] scanExternal: ${String(err)}`);
        } finally {
            this.externalScanRunning = false;
        }
    }

    /** Attend que le sidecar OpenCode soit prêt (baseUrl connue). */
    protected async ensureBaseUrl(timeoutMs = 30000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            try {
                const info = await this.fabiCode.getServerInfo();
                this.engineStatus = info.status;
                if (info.url) {
                    this.baseUrl = info.url;
                    return;
                }
            } catch { /* pas prêt */ }
            if (Date.now() >= deadline || this.disposed) {
                return;
            }
            await this.delay(500);
        }
    }

    /** (Re)charge la liste GLOBALE des sessions OpenCode et met à jour le modèle. */
    protected async refreshSessions(): Promise<void> {
        if (this.disposed) {
            return;
        }
        try {
            const info = await this.fabiCode.getServerInfo();
            this.engineStatus = info.status;
            if (info.url) {
                this.baseUrl = info.url;
            }
        } catch { /* ignore */ }
        if (!this.baseUrl) {
            return;
        }
        let list: Array<Record<string, unknown>>;
        try {
            // GET /session SANS directory → liste GLOBALE (toutes workspaces).
            const raw = await this.http('GET', '/session');
            const parsed = JSON.parse(raw);
            list = Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            this.logger.debug(`[maestro] listSessions: ${String(err)}`);
            return;
        }
        const now = Date.now();
        const liveIds = new Set<string>();
        for (const s of list) {
            const id = typeof s.id === 'string' ? s.id : undefined;
            if (!id) {
                continue;
            }
            // On ignore les sous-sessions (sous-agents) : on ne supervise que les
            // conversations de premier niveau.
            if (typeof s.parentID === 'string' && s.parentID) {
                continue;
            }
            liveIds.add(id);
            const time = (s.time as { updated?: number; created?: number } | undefined) ?? {};
            const summary = (s.summary as { additions?: number; deletions?: number; files?: number } | undefined);
            const rec = this.fabi.get(id) ?? this.newRec(id);
            rec.directory = typeof s.directory === 'string' ? s.directory : rec.directory;
            rec.title = this.cleanTitle(typeof s.title === 'string' ? s.title : rec.title);
            rec.updatedAt = Math.max(rec.updatedAt, time.updated ?? time.created ?? now);
            if (summary && (summary.files || summary.additions || summary.deletions)) {
                rec.edits = {
                    files: summary.files ?? 0,
                    additions: summary.additions ?? 0,
                    deletions: summary.deletions ?? 0
                };
            }
            rec.lastSeen = now;
            this.fabi.set(id, rec);
        }
        // Réconciliation : une session absente de la liste ET non touchée récemment
        // (par un event) a été supprimée → on la retire.
        for (const [id, rec] of [...this.fabi]) {
            if (!liveIds.has(id) && now - rec.lastSeen > 15000) {
                this.fabi.delete(id);
            }
        }
        this.schedulePush();
    }

    // ---- Flux SSE global (statut live) ----

    protected openEventStream(): void {
        if (!this.baseUrl || this.disposed) {
            return;
        }
        this.sseAbort?.abort();
        const ac = new AbortController();
        this.sseAbort = ac;
        const url = `${this.baseUrl}/event`; // GLOBAL (aucun directory) — vérifié.
        const reconnect = (): void => {
            if (!this.disposed && this.sseAbort === ac && this.baseUrl) {
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
        if (!type) {
            return;
        }
        const now = Date.now();

        switch (type) {
            case 'session.deleted': {
                if (sessionId) {
                    this.fabi.delete(sessionId);
                    this.schedulePush();
                }
                return;
            }
            case 'session.created':
            case 'session.updated': {
                // Métadonnées (titre/dir) → on re-synchronise depuis la liste.
                if (sessionId) {
                    this.touch(sessionId, now);
                }
                this.scheduleRefresh();
                return;
            }
            case 'session.idle': {
                this.updateStatus(sessionId, 'idle', now, { clearPermission: true });
                return;
            }
            case 'session.status': {
                const st = (props.status as { type?: string } | undefined)?.type;
                if (st === 'busy') {
                    this.updateStatus(sessionId, 'generating', now);
                } else {
                    this.updateStatus(sessionId, 'idle', now, { clearPermission: true });
                }
                return;
            }
            case 'session.error': {
                this.updateStatus(sessionId, 'error', now);
                return;
            }
            case 'message.part.updated': {
                const part = props.part as Record<string, unknown> | undefined;
                if (sessionId && part) {
                    const rec = this.ensureRec(sessionId, now);
                    const ptype = typeof part.type === 'string' ? part.type : '';
                    if (ptype === 'text' && typeof part.text === 'string') {
                        rec.preview = this.clip(part.text);
                    }
                    if (rec.status !== 'waiting') {
                        rec.status = 'generating';
                    }
                    rec.updatedAt = now;
                    rec.lastSeen = now;
                    this.schedulePush();
                }
                return;
            }
            case 'message.updated': {
                const infoObj = props.info as { role?: string; modelID?: string; providerID?: string } | undefined;
                if (sessionId && infoObj) {
                    const rec = this.ensureRec(sessionId, now);
                    if (infoObj.role === 'assistant' && infoObj.modelID) {
                        rec.model = infoObj.modelID;
                    }
                    rec.lastSeen = now;
                }
                return;
            }
            case 'permission.asked':
            case 'permission.updated': {
                if (sessionId) {
                    const meta = props.metadata as Record<string, unknown> | undefined;
                    const detail = typeof meta?.command === 'string' ? meta.command
                        : typeof meta?.url === 'string' ? meta.url
                            : (typeof props.permission === 'string' ? props.permission : undefined);
                    const rec = this.ensureRec(sessionId, now);
                    rec.status = 'waiting';
                    rec.pendingPermission = detail;
                    rec.pendingPermissionId = typeof props.id === 'string' ? props.id : undefined;
                    rec.updatedAt = now;
                    rec.lastSeen = now;
                    this.schedulePush();
                }
                return;
            }
            default:
                return;
        }
    }

    protected updateStatus(
        sessionId: string | undefined, status: MaestroStatus, now: number, opts?: { clearPermission?: boolean }
    ): void {
        if (!sessionId) {
            return;
        }
        const rec = this.ensureRec(sessionId, now);
        rec.status = status;
        if (opts?.clearPermission) {
            rec.pendingPermission = undefined;
            rec.pendingPermissionId = undefined;
        }
        rec.updatedAt = now;
        rec.lastSeen = now;
        this.schedulePush();
    }

    /** Garantit un enregistrement pour une session vue dans un event (et planifie un refresh si neuve). */
    protected ensureRec(sessionId: string, now: number): FabiRec {
        let rec = this.fabi.get(sessionId);
        if (!rec) {
            rec = this.newRec(sessionId);
            this.fabi.set(sessionId, rec);
            // Métadonnées (titre/dir) inconnues → on les récupère depuis la liste.
            this.scheduleRefresh();
        }
        rec.lastSeen = now;
        return rec;
    }

    protected touch(sessionId: string, now: number): void {
        const rec = this.fabi.get(sessionId);
        if (rec) {
            rec.lastSeen = now;
        }
    }

    protected newRec(id: string): FabiRec {
        return { id, title: 'Nouveau chat', status: 'idle', updatedAt: Date.now(), lastSeen: Date.now() };
    }

    // ---- Construction du snapshot ----

    protected snapshot(): MaestroSnapshot {
        const surfaces = this.openSurfaces();
        const fabiSurfaces = surfaces.filter(surface => surface.kind === 'fabi-chat');
        const fabiSurfaceBySession = new Map(
            fabiSurfaces
                .filter(surface => !!surface.openCodeSessionId)
                .map(surface => [surface.openCodeSessionId!, surface])
        );
        const agents: MaestroAgent[] = [];
        // Chats Fabi AI : uniquement ceux portés par un widget actuellement ouvert.
        for (const rec of this.fabi.values()) {
            const surface = fabiSurfaceBySession.get(rec.id);
            if (!surface) {
                continue;
            }
            agents.push(this.toAgent(rec, surface));
        }
        // Un onglet Fabi neuf existe avant que sa session OpenCode soit créée.
        for (const surface of fabiSurfaces) {
            if (surface.openCodeSessionId) {
                continue;
            }
            agents.push({
                key: `fabi-surface:${surface.ownerId}:${surface.widgetId}`,
                source: 'fabi',
                id: surface.theiaSessionId || surface.widgetId,
                title: surface.title,
                status: 'idle',
                directory: surface.directory,
                workspaceName: surface.workspaceName,
                preview: 'Aucun tour lancé',
                updatedAt: surface.updatedAt,
                surface
            });
        }
        // Agents CLI externes : déjà limités aux terminaux ouverts par le monitor.
        agents.push(...this.external);
        agents.sort((a, b) => b.updatedAt - a.updatedAt);
        return {
            engine: this.engineStatus,
            agents: agents.slice(0, MAX_AGENTS)
        };
    }

    protected toAgent(rec: FabiRec, surface: MaestroSurface): MaestroAgent {
        return {
            key: `fabi:${rec.id}`,
            source: 'fabi',
            id: rec.id,
            title: rec.title,
            status: rec.status,
            directory: rec.directory,
            workspaceName: rec.directory ? this.basename(rec.directory) : undefined,
            preview: rec.preview,
            model: rec.model,
            updatedAt: rec.updatedAt,
            pendingPermission: rec.pendingPermission,
            pendingPermissionId: rec.pendingPermissionId,
            edits: rec.edits,
            surface
        };
    }

    /** Aplatit les heartbeats encore vivants et purge les frontends disparus. */
    protected openSurfaces(): MaestroSurface[] {
        const now = Date.now();
        const out: MaestroSurface[] = [];
        for (const [ownerId, report] of [...this.surfaces]) {
            if (now - report.updatedAt > 10_000) {
                this.surfaces.delete(ownerId);
                continue;
            }
            out.push(...report.items);
        }
        return out;
    }

    // ---- Parsing des messages (détail) ----

    protected parseMessages(raw: string): MaestroMessage[] {
        let arr: Array<{ info?: Record<string, unknown>; parts?: Array<Record<string, unknown>> }>;
        try {
            const parsed = JSON.parse(raw);
            arr = Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
        const out: MaestroMessage[] = [];
        for (const entry of arr) {
            const info = entry.info ?? {};
            const role = info.role === 'assistant' ? 'assistant' : info.role === 'user' ? 'user' : undefined;
            if (!role) {
                continue;
            }
            const parts = Array.isArray(entry.parts) ? entry.parts : [];
            let text = '';
            const tools: MaestroMessage['tools'] = [];
            for (const p of parts) {
                const ptype = typeof p.type === 'string' ? p.type : '';
                if (ptype === 'text' && typeof p.text === 'string') {
                    text += (text ? '\n' : '') + p.text;
                } else if (ptype === 'tool' && typeof p.tool === 'string') {
                    const state = p.state as { status?: string; title?: string } | undefined;
                    tools.push({ name: p.tool, title: state?.title, state: state?.status });
                }
            }
            if (!text && tools.length === 0) {
                continue;
            }
            const time = info.time as { created?: number } | undefined;
            out.push({
                id: typeof info.id === 'string' ? info.id : undefined,
                role,
                text,
                tools: tools.length ? tools : undefined,
                ts: time?.created
            });
        }
        return out;
    }

    // ---- Utilitaires ----

    protected parseKey(key: string): { source: string; id: string } {
        const i = key.indexOf(':');
        return i < 0 ? { source: 'fabi', id: key } : { source: key.slice(0, i), id: key.slice(i + 1) };
    }

    protected cleanTitle(title: string): string {
        const t = (title ?? '').trim();
        if (!t || /^New session\b/i.test(t)) {
            return 'Nouveau chat';
        }
        return t;
    }

    protected clip(text: string, max = 160): string {
        const t = text.replace(/\s+/g, ' ').trim();
        return t.length > max ? t.slice(0, max - 1) + '…' : t;
    }

    protected basename(p: string): string {
        const parts = p.split(/[/\\]/).filter(Boolean);
        return parts[parts.length - 1] ?? p;
    }

    protected delay(ms: number): Promise<void> {
        return new Promise(resolve => { const t = setTimeout(resolve, ms); t.unref?.(); });
    }

    /**
     * Appel HTTP au sidecar OpenCode (notre propre client → AUCUNE interférence avec
     * le flux SSE du chat). `directory` cible un workspace (header + query, comme
     * OpenCode l'attend). Le sidecar est toujours en http local.
     */
    protected async http(method: string, path: string, body?: unknown, directory?: string): Promise<string> {
        if (!this.baseUrl) {
            throw new Error('moteur fabi-code non prêt');
        }
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        let url = `${this.baseUrl}${path}`;
        if (directory) {
            headers['x-opencode-directory'] = directory;
            url += `${path.includes('?') ? '&' : '?'}directory=${encodeURIComponent(directory)}`;
        }
        const res = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        const txt = await res.text();
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${path}: ${txt.slice(0, 200)}`);
        }
        return txt;
    }

    protected scheduleRefresh(): void {
        if (this.refreshTimer) {
            return;
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            void this.refreshSessions();
        }, 400);
        this.refreshTimer.unref?.();
    }

    protected schedulePush(): void {
        if (this.pushTimer) {
            return;
        }
        this.pushTimer = setTimeout(() => {
            this.pushTimer = undefined;
            this.safePush(this.snapshot());
        }, 120);
        this.pushTimer.unref?.();
    }

    protected safePush(snapshot: MaestroSnapshot): void {
        try {
            this.client?.onSnapshot(snapshot);
        } catch {
            // Client mort (frontend fermé/suspendu) → on l'oublie ; il se ré-attachera.
            this.client = undefined;
        }
    }
}
