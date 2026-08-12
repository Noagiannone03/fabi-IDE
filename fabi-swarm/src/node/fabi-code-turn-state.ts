/** Minimal durable view returned by OpenCode's GET /session/status endpoint. */
export type OpenCodeSessionStatuses = Record<string, { type?: string }>;

/** Minimal message projection needed to reconcile a turn after an SSE gap. */
export interface OpenCodeMessageState {
    info?: {
        id?: string;
        role?: string;
        finish?: string;
        error?: unknown;
        time?: { completed?: number };
    };
}

export type OpenCodeTurnStatus = 'active' | 'settled' | 'unobserved';
export type FabiGoalTurnStatus = 'active' | 'settled' | 'missing';
export type FabiGoalIdleDecision = 'continued' | 'wrapup' | 'settled' | undefined;

export interface FabiGoalTurnTransition {
    state: FabiGoalTurnStatus;
    continuationPending: boolean;
    continuationObservedActive: boolean;
}

const SETTLED_GOAL_STATUSES = new Set([
    'complete', 'unmet', 'paused', 'budgetLimited', 'usageLimited'
]);

/** Unknown future states stay active so a plugin upgrade cannot truncate work. */
export function classifyFabiGoalTurnStatus(status: string | null): FabiGoalTurnStatus {
    if (status === null) {
        return 'missing';
    }
    return SETTLED_GOAL_STATUSES.has(status) ? 'settled' : 'active';
}

/**
 * Reduce one post-idle Goal decision. OpenCode 1 publishes modern and legacy
 * idle events, so a duplicate stable snapshot cannot settle a continuation
 * until that continuation has actually reached `busy`.
 */
export function reduceFabiGoalTurn(
    status: string | null,
    decision: FabiGoalIdleDecision,
    continuationPending: boolean,
    continuationObservedActive: boolean
): FabiGoalTurnTransition {
    if (decision === 'continued' || decision === 'wrapup') {
        return { state: 'active', continuationPending: true, continuationObservedActive: false };
    }
    if (continuationPending && !continuationObservedActive) {
        return { state: 'active', continuationPending, continuationObservedActive };
    }
    return {
        state: classifyFabiGoalTurnStatus(status),
        continuationPending,
        continuationObservedActive
    };
}

/**
 * OpenCode removes idle sessions from its live status map. An absent entry is
 * therefore terminal only after this client has observed the turn active.
 * `prompt_async` returns before OpenCode publishes `busy`, so treating the
 * initial absence as idle would complete every turn before it starts.
 * Unknown future states remain active so a schema change cannot truncate a
 * real generation.
 */
export function classifyOpenCodeTurnStatus(
    statuses: OpenCodeSessionStatuses,
    sessionId: string,
    observedActive: boolean
): OpenCodeTurnStatus {
    const status = statuses[sessionId];
    if (status?.type === 'idle') {
        return observedActive ? 'settled' : 'unobserved';
    }
    if (status !== undefined) {
        return 'active';
    }
    return observedActive ? 'settled' : 'unobserved';
}

/** Assistant messages present before submitting a new prompt. */
export function snapshotAssistantMessageIds(messages: OpenCodeMessageState[]): Set<string> {
    return new Set(messages
        .filter(message => message.info?.role === 'assistant' && typeof message.info.id === 'string')
        .map(message => message.info!.id!));
}

/**
 * Durable fallback when both `busy` and `idle` SSE edges were missed. A new
 * assistant message is terminal only once OpenCode persisted a finish reason,
 * completion timestamp or error.
 */
export function hasNewCompletedAssistantMessage(
    messages: OpenCodeMessageState[],
    previousAssistantIds: ReadonlySet<string>
): boolean {
    return messages.some(message => {
        const info = message.info;
        return info?.role === 'assistant'
            && typeof info.id === 'string'
            && !previousAssistantIds.has(info.id)
            && (typeof info.finish === 'string'
                || typeof info.time?.completed === 'number'
                || info.error !== undefined);
    });
}
