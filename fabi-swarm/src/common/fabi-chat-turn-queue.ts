/**
 * File FIFO used by the Fabi chat bridge.
 *
 * Theia invokes chat agents concurrently and, by default, cancels the previous
 * request. A Fabi installation deliberately exposes a single consumer slot:
 * turns from every chat/workspace therefore share this machine-wide FIFO.
 *
 * The backend owns the authoritative instance. Keeping this dependency-free
 * primitive in `common` also makes its fairness/cancellation semantics directly
 * testable without booting Electron or OpenCode.
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
    protected readonly queue: MutableTicket[] = [];

    get size(): number {
        return this.queue.length;
    }

    enqueue(_turnId: string, onPosition?: FabiChatTurnPositionListener): FabiChatTurnTicket {
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
            cancel: () => this.remove(ticket, false),
            finish: () => this.remove(ticket, true)
        };

        this.queue.push(ticket);
        this.refresh();
        return ticket;
    }

    protected remove(ticket: MutableTicket, finished: boolean): void {
        if (ticket._settled) {
            return;
        }
        const index = this.queue.indexOf(ticket);
        if (index < 0) {
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
        this.queue.splice(index, 1);
        ticket._settled = true;
        if (!ticket._active) {
            ticket._resolveReady(false);
        }
        this.refresh();
    }

    protected refresh(): void {
        for (let index = 0; index < this.queue.length; index++) {
            const ticket = this.queue[index];
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
    }
}
