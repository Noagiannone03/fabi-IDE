/** Minimal durable view returned by OpenCode's GET /session/status endpoint. */
export type OpenCodeSessionStatuses = Record<string, { type?: string }>;

/**
 * OpenCode removes idle sessions from its live status map. Therefore an
 * accepted turn is settled when its entry is absent or explicitly idle.
 * Unknown future states remain active so a schema change cannot truncate a
 * real generation.
 */
export function isOpenCodeTurnSettled(
    statuses: OpenCodeSessionStatuses,
    sessionId: string
): boolean {
    const status = statuses[sessionId];
    return status === undefined || status.type === 'idle';
}
