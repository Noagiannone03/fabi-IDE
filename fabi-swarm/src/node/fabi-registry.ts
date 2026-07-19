// Client du fabi-registry : liste les swarms (`GET /v1/swarms`) et s'abonne à
// son flux SSE (`/v1/swarms/stream`) pour des mises à jour live (join/leave,
// peer count) SANS polling lourd. Si le SSE tombe, reconnexion avec backoff ;
// en dernier recours, poll périodique. Tourne côté Node (backend Theia).

import { SwarmEntry } from '../common/fabi-swarm-protocol';
import { createParser } from 'eventsource-parser';

interface SwarmsResponse {
    apiVersion: string;
    generatedAt: string;
    host: string;
    swarms: SwarmEntry[];
}

/** Récupère la liste des swarms une fois (avec timeout). */
export async function fetchSwarmsOnce(registryUrl: string, timeoutMs = 3000): Promise<SwarmEntry[]> {
    const url = `${registryUrl.replace(/\/+$/, '')}/v1/swarms`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
        if (!res.ok) {
            throw new Error(`registry ${res.status}`);
        }
        const json = await res.json() as SwarmsResponse;
        return Array.isArray(json.swarms) ? json.swarms : [];
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Abonnement live à la liste des swarms. Émet `onChange` au démarrage (snapshot
 * initial) puis à chaque changement poussé par le SSE. `start()`/`stop()`
 * idempotents. Anti-bruit : n'émet que si le JSON a réellement changé.
 */
export class RegistryFeed {

    private readonly registryUrl: string;
    private readonly onChange: (swarms: SwarmEntry[]) => void;
    private cache: SwarmEntry[] = [];
    private lastJson = '';
    private abort?: AbortController;
    private pollTimer?: ReturnType<typeof setInterval>;
    private stopped = true;
    private backoffMs = 1000;

    constructor(registryUrl: string, onChange: (swarms: SwarmEntry[]) => void) {
        this.registryUrl = registryUrl.replace(/\/+$/, '');
        this.onChange = onChange;
    }

    snapshot(): SwarmEntry[] {
        return this.cache;
    }

    start(): void {
        if (!this.stopped) {
            return;
        }
        this.stopped = false;
        // Snapshot initial immédiat (au cas où le SSE met du temps à pousser).
        void this.pollOnce();
        void this.connectStream();
    }

    stop(): void {
        this.stopped = true;
        this.abort?.abort();
        this.abort = undefined;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }

    private emit(swarms: SwarmEntry[]): void {
        const json = JSON.stringify(swarms);
        if (json === this.lastJson) {
            return;
        }
        this.lastJson = json;
        this.cache = swarms;
        try {
            this.onChange(swarms);
        } catch {
            /* un abonné qui throw ne doit pas casser le feed */
        }
    }

    private async pollOnce(): Promise<void> {
        try {
            this.emit(await fetchSwarmsOnce(this.registryUrl));
        } catch {
            /* registry injoignable → on garde le cache */
        }
    }

    /** Filet de sécurité : poll lent tant que le SSE n'est pas (re)connecté. */
    private startPollFallback(): void {
        if (this.pollTimer || this.stopped) {
            return;
        }
        this.pollTimer = setInterval(() => void this.pollOnce(), 15_000);
    }

    private stopPollFallback(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }

    private async connectStream(): Promise<void> {
        if (this.stopped) {
            return;
        }
        const url = `${this.registryUrl}/v1/swarms/stream`;
        this.abort = new AbortController();
        try {
            const res = await fetch(url, {
                headers: { Accept: 'text/event-stream' },
                signal: this.abort.signal
            });
            if (!res.ok || !res.body) {
                throw new Error(`stream ${res.status}`);
            }
            this.backoffMs = 1000;     // connecté → reset backoff
            this.stopPollFallback();   // le SSE prend le relais
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            const parser = createParser({
                maxBufferSize: 4 * 1024 * 1024,
                onRetry: retryMs => {
                    this.backoffMs = Math.max(1_000, Math.min(retryMs, 30_000));
                },
                onEvent: event => this.handleData(event.data)
            });
            for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                    parser.feed(decoder.decode());
                    parser.reset({ consume: true });
                    break;
                }
                parser.feed(decoder.decode(value, { stream: true }));
            }
        } catch {
            /* coupure réseau → reconnexion plus bas */
        }
        if (this.stopped) {
            return;
        }
        // SSE coupé : poll de secours + reconnexion en backoff (max 30s).
        this.startPollFallback();
        const wait = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
        setTimeout(() => void this.connectStream(), wait);
    }

    private handleData(data: string): void {
        if (!data) {
            return;
        }
        try {
            const parsed = JSON.parse(data) as SwarmsResponse;
            if (Array.isArray(parsed.swarms)) {
                this.emit(parsed.swarms);
            }
        } catch {
            /* bloc partiel / non-JSON → on ignore */
        }
    }
}
