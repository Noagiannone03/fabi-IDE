import type { FabiCodeTurnQueueState } from './fabi-code-protocol';

/**
 * Binds one Theia response to the machine-wide backend ticket that owns the
 * OpenCode session at that instant.
 *
 * Multiple requests from the same chat intentionally subscribe before they
 * enter the backend FIFO. Session id alone is therefore insufficient: without
 * this gate, the queued response would render the active response's parts.
 */
export class FabiCodeTurnEventGate {
    protected active = false;

    constructor(
        readonly turnId: string,
        readonly sessionId: string
    ) {}

    /** Returns true only for queue updates belonging to this UI request. */
    update(state: FabiCodeTurnQueueState): boolean {
        if (state.turnId !== this.turnId) {
            return false;
        }
        this.active = state.state === 'active';
        return true;
    }

    /** Session-scoped OpenCode events are visible only while this ticket owns the FIFO. */
    accepts(sessionId: string): boolean {
        return this.active && sessionId === this.sessionId;
    }
}
