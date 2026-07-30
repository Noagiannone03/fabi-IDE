import * as http from 'node:http';
import { createParser } from 'eventsource-parser';
import {
    RequestAgentActivity, RequestAgentPhase, RequestAgentPhaseEvent
} from '../common/fabi-swarm-protocol';

const PHASES = new Set<RequestAgentPhase>([
    'planning', 'authorizing', 'reserving', 'prefilling', 'decoding',
    'recovering', 'replaying', 'completed', 'failed', 'aborted', 'released'
]);
const TERMINAL = new Set<RequestAgentPhase>(['completed', 'failed', 'aborted', 'released']);
const MAX_EVENT_BYTES = 1024 * 1024;

export class RequestAgentPhaseTracker {
    protected lastEventId = 0;
    protected readonly active = new Map<string, RequestAgentPhaseEvent>();
    protected latest: RequestAgentPhaseEvent | undefined;

    snapshot(): RequestAgentActivity {
        return {
            lastEventId: this.lastEventId,
            activeRequests: [...this.active.values()].sort((a, b) => a.requestId.localeCompare(b.requestId)),
            latest: this.latest
        };
    }

    apply(event: string, eventId: string | undefined, data: string): RequestAgentActivity {
        const id = this.parseEventId(eventId);
        let payload: unknown;
        try {
            payload = JSON.parse(data);
        } catch {
            throw new Error('event Request Agent JSON invalide');
        }
        if (event === 'snapshot' || event === 'reset') {
            const root = payload as { last_event_id?: unknown; active_requests?: unknown };
            if (!Number.isSafeInteger(root.last_event_id) || (root.last_event_id as number) < 0
                || !Array.isArray(root.active_requests) || id !== root.last_event_id) {
                throw new Error('snapshot Request Agent invalide');
            }
            this.active.clear();
            for (const raw of root.active_requests) {
                const phase = this.parsePhase(raw);
                if (!TERMINAL.has(phase.phase)) {
                    this.active.set(phase.requestId, phase);
                }
            }
            this.lastEventId = id;
            this.latest = undefined;
            return this.snapshot();
        }
        if (event !== 'request-phase') {
            return this.snapshot();
        }
        const phase = this.parsePhase(payload);
        if (phase.eventId !== id || id <= this.lastEventId) {
            throw new Error('ordre des phases Request Agent invalide');
        }
        this.lastEventId = id;
        this.latest = phase;
        if (TERMINAL.has(phase.phase)) {
            this.active.delete(phase.requestId);
        } else {
            this.active.set(phase.requestId, phase);
        }
        return this.snapshot();
    }

    protected parseEventId(value: string | undefined): number {
        if (!value || !/^[0-9]{1,20}$/.test(value)) {
            throw new Error('id SSE Request Agent invalide');
        }
        const id = Number(value);
        if (!Number.isSafeInteger(id) || id < 0) {
            throw new Error('id SSE Request Agent invalide');
        }
        return id;
    }

    protected parsePhase(raw: unknown): RequestAgentPhaseEvent {
        const value = raw as Record<string, unknown>;
        const phase = value?.phase;
        const requestId = value?.request_id;
        const eventId = value?.event_id;
        const occurredAtMs = value?.occurred_at_ms;
        if (!PHASES.has(phase as RequestAgentPhase)
            || typeof requestId !== 'string' || !requestId
            || !Number.isSafeInteger(eventId) || (eventId as number) < 1
            || !Number.isSafeInteger(occurredAtMs) || (occurredAtMs as number) < 0) {
            throw new Error('phase Request Agent invalide');
        }
        const optionalNumber = (name: string): number | undefined => {
            const item = value[name];
            return Number.isSafeInteger(item) && (item as number) >= 0 ? item as number : undefined;
        };
        const optionalString = (name: string): string | undefined => {
            const item = value[name];
            return typeof item === 'string' && item ? item : undefined;
        };
        return {
            eventId: eventId as number,
            requestId,
            phase: phase as RequestAgentPhase,
            occurredAtMs: occurredAtMs as number,
            epoch: optionalNumber('epoch'),
            routeId: optionalString('route_id'),
            detail: optionalString('detail')
        };
    }
}

/** Flux SSE loopback reconnectable grâce à Last-Event-ID. */
export class RequestAgentEventFeed {
    protected stopped = false;
    protected request: http.ClientRequest | undefined;
    protected reconnect: ReturnType<typeof setTimeout> | undefined;
    protected readonly tracker = new RequestAgentPhaseTracker();

    constructor(
        protected readonly baseUrl: string,
        protected readonly credential: string,
        protected readonly onChange: (activity: RequestAgentActivity) => void
    ) {}

    start(): void {
        if (!this.stopped && this.request) {
            return;
        }
        this.stopped = false;
        this.connect();
    }

    stop(): void {
        this.stopped = true;
        this.request?.destroy();
        this.request = undefined;
        if (this.reconnect) {
            clearTimeout(this.reconnect);
            this.reconnect = undefined;
        }
    }

    protected connect(): void {
        if (this.stopped) {
            return;
        }
        const snapshot = this.tracker.snapshot();
        const headers: Record<string, string> = {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${this.credential}`
        };
        if (snapshot.lastEventId > 0) {
            headers['Last-Event-ID'] = String(snapshot.lastEventId);
        }
        const parser = createParser({
            maxBufferSize: MAX_EVENT_BYTES,
            onEvent: message => {
                try {
                    this.onChange(this.tracker.apply(message.event ?? 'message', message.id, message.data));
                } catch {
                    this.request?.destroy();
                }
            }
        });
        const schedule = () => {
            this.request = undefined;
            if (!this.stopped && !this.reconnect) {
                this.reconnect = setTimeout(() => {
                    this.reconnect = undefined;
                    this.connect();
                }, 1_000);
                this.reconnect.unref?.();
            }
        };
        this.request = http.get(
            `${this.baseUrl.replace(/\/+$/, '')}/v1/request-agent/events`,
            { headers },
            response => {
                if (response.statusCode !== 200
                    || !String(response.headers['content-type'] ?? '').includes('text/event-stream')) {
                    response.resume();
                    schedule();
                    return;
                }
                response.setEncoding('utf8');
                response.on('data', chunk => parser.feed(chunk));
                response.on('end', schedule);
                response.on('error', schedule);
            }
        );
        this.request.on('error', schedule);
    }
}
