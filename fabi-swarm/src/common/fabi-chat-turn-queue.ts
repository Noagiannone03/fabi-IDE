/**
 * File FIFO used by the Fabi chat bridge.
 *
 * Theia invokes chat agents concurrently and, by default, cancels the previous
 * request. OpenCode sessions are sequential conversations, so Fabi admits one
 * request at a time per Theia chat while leaving different chats independent.
 */

export type FabiChatTurnPositionListener = (position: number) => void;

export interface FabiChatTurnTicket {
    /** Resolves true when this ticket owns the session, false when cancelled first. */
    readonly ready: Promise<boolean>;
    /** Zero means active; positive values are the live FIFO position. */
    readonly position: number;
    readonly active: boolean;
    readonly settled: boolean;
    cancel(): void;
    finish(): void;
}

interface MutableTicket extends FabiChatTurnTicket {
    _position: number;
    _active: boolean;
    _settled: boolean;
    _resolveReady: (active: boolean) => void;
    _onPosition?: FabiChatTurnPositionListener;
}

export class FabiChatTurnQueue {
    protected readonly queues = new Map<string, MutableTicket[]>();

    enqueue(sessionId: string, onPosition?: FabiChatTurnPositionListener): FabiChatTurnTicket {
        let resolveReady: (active: boolean) => void = () => undefined;
        const ready = new Promise<boolean>(resolve => {
            resolveReady = resolve;
        });
        const ticket: MutableTicket = {
            ready,
            _position: -1,
            _active: false,
            _settled: false,
            _resolveReady: resolveReady,
            _onPosition: onPosition,
            get position(): number {
                return this._position;
            },
            get active(): boolean {
                return this._active;
            },
            get settled(): boolean {
                return this._settled;
            },
            cancel: () => this.remove(sessionId, ticket, false),
            finish: () => this.remove(sessionId, ticket, true)
        };

        const queue = this.queues.get(sessionId) ?? [];
        queue.push(ticket);
        this.queues.set(sessionId, queue);
        this.refresh(sessionId, queue);
        return ticket;
    }

    protected remove(sessionId: string, ticket: MutableTicket, finished: boolean): void {
        if (ticket._settled) {
            return;
        }
        const queue = this.queues.get(sessionId);
        const index = queue?.indexOf(ticket) ?? -1;
        if (!queue || index < 0) {
            ticket._settled = true;
            if (!ticket._active) {
                ticket._resolveReady(false);
            }
            return;
        }
        // Only the owner may finish. A queued cancellation is always allowed;
        // cancelling an active turn is completed by the agent after OpenCode's
        // abort has settled, which then calls finish().
        if (ticket._active && !finished) {
            return;
        }
        queue.splice(index, 1);
        ticket._settled = true;
        if (!ticket._active) {
            ticket._resolveReady(false);
        }
        if (queue.length === 0) {
            this.queues.delete(sessionId);
            return;
        }
        this.refresh(sessionId, queue);
    }

    protected refresh(sessionId: string, queue: MutableTicket[]): void {
        for (let index = 0; index < queue.length; index++) {
            const ticket = queue[index];
            const changed = ticket._position !== index;
            ticket._position = index;
            if (changed) {
                ticket._onPosition?.(index);
            }
            if (index === 0 && !ticket._active) {
                ticket._active = true;
                ticket._resolveReady(true);
            }
        }
        if (queue.length === 0) {
            this.queues.delete(sessionId);
        }
    }
}
