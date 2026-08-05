/** Politique d'approbation choisie pour une session de chat Fabi. */
export type FabiCodePermissionMode = 'ask' | 'auto';

export const FABI_CODE_PERMISSION_MODE_SETTING = 'fabiPermissionMode';
export const FABI_CODE_DEFAULT_PERMISSION_MODE: FabiCodePermissionMode = 'ask';

export function normalizeFabiCodePermissionMode(value: unknown): FabiCodePermissionMode {
    return value === 'auto' ? 'auto' : FABI_CODE_DEFAULT_PERMISSION_MODE;
}

/**
 * Réponse OpenCode correspondant au mode sans confirmation de Fabi.
 *
 * `once` est volontaire : le broker conserve la politique du chat racine et
 * acquitte chaque demande, y compris celles des sous-tâches, sans inscrire de
 * règle persistante OpenCode qui survivrait à un retour vers Ask edits. Le
 * mode plan reste non-élevable.
 */
export function automaticPermissionReply(
    mode: FabiCodePermissionMode,
    agent: string
): 'once' | undefined {
    return mode === 'auto' && agent !== 'plan' ? 'once' : undefined;
}

/** Partie minimale de Session.Info dont le broker d'approbation a besoin. */
export interface OpenCodeSessionParent {
    id: string;
    parentID?: string;
}

/**
 * Remonte une session OpenCode (y compris une sous-tâche) jusqu'au chat racine.
 *
 * La limite et la détection de cycle protègent le backend d'un graphe de
 * sessions corrompu. Si un parent manque de la vue courante, la dernière
 * session connue est retournée plutôt que d'associer l'interaction à un autre
 * chat.
 */
export function resolveOpenCodeRootSessionId(
    sessionId: string,
    sessions: readonly OpenCodeSessionParent[],
    maxDepth = 64
): string {
    const byId = new Map(sessions.map(session => [session.id, session]));
    const visited = new Set<string>();
    let current = sessionId;
    for (let depth = 0; depth < maxDepth; depth++) {
        if (visited.has(current)) {
            return sessionId;
        }
        visited.add(current);
        const parent = byId.get(current)?.parentID;
        if (!parent) {
            return current;
        }
        current = parent;
    }
    return sessionId;
}
