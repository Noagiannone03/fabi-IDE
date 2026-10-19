import { SpaceDescriptor, SPACE_COLORS } from './space-types';
import { parseRemoteSpace } from './remote-space';

export interface PersistedSpaces {
    version: 1;
    spaces: SpaceDescriptor[];
    activeId?: string;
}

/** Recover records independently and never reinterpret a malformed SSH Space as local. */
export function parsePersistedSpaces(value: unknown): PersistedSpaces {
    if (!value || typeof value !== 'object' || !Array.isArray((value as PersistedSpaces).spaces)) {
        throw new Error('Invalid Spaces document');
    }
    const raw = value as { spaces: unknown[]; activeId?: unknown };
    const ids = new Set<string>();
    const spaces: SpaceDescriptor[] = [];
    for (const item of raw.spaces) {
        if (!item || typeof item !== 'object') { continue; }
        const record = item as Record<string, unknown>;
        if (typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id)
            || typeof record.workspacePath !== 'string' || record.kind === 'maestro') { continue; }
        const remote = record.remote === undefined ? undefined : parseRemoteSpace(record.remote);
        if (record.remote !== undefined && (!remote || (record.workspacePath !== '' && !record.workspacePath.startsWith('/'))
            || /[\0\r\n]/.test(record.workspacePath))) { continue; }
        ids.add(record.id);
        spaces.push({
            id: record.id, workspacePath: record.workspacePath,
            name: typeof record.name === 'string' ? record.name : '',
            emoji: typeof record.emoji === 'string' ? record.emoji : '',
            color: typeof record.color === 'string' && /^#[0-9a-f]{6}$/i.test(record.color) ? record.color : SPACE_COLORS[0],
            lastActive: typeof record.lastActive === 'number' && Number.isFinite(record.lastActive) ? record.lastActive : 0,
            ...(remote ? { remote } : {})
        });
    }
    return { version: 1, spaces, activeId: typeof raw.activeId === 'string' && ids.has(raw.activeId) ? raw.activeId : undefined };
}
