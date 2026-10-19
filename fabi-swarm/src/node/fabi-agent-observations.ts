import { isAbsolute, relative, normalize } from 'node:path';
import { MaestroToolObservation } from '../common/fabi-maestro-protocol';

/** Extract only verifiable envelope metadata. Never retain command arguments or reasoning. */
export function observationPath(root: string, value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 1000) return;
    const file = normalize(isAbsolute(value) ? relative(root, value) : value);
    if (isAbsolute(file) || file.split(/[\\/]/).some(part => /^(?:\.\.|\.git|\.env.*|\.ssh|\.secrets|credentials.*|id_rsa|id_ed25519|.*\.(?:pem|key|p12))$/i.test(part))) return;
    return file;
}
export function codexObservations(rows: Record<string, unknown>[], sessionId: string, root: string): MaestroToolObservation[] {
    const calls = new Map<string, MaestroToolObservation[]>(), result: MaestroToolObservation[] = [];
    for (const row of rows) {
        if (row.type !== 'response_item') continue;
        const payload = row.payload as Record<string, unknown> | undefined;
        if (!payload || typeof payload.call_id !== 'string') continue;
        const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
        if (!Number.isFinite(at)) continue;
        if (['function_call', 'custom_tool_call'].includes(String(payload.type)) && typeof payload.name === 'string') {
            const paths: string[] = [];
            if (typeof payload.arguments === 'string') {
                try { const args = JSON.parse(payload.arguments); const file = observationPath(root, args.file_path ?? args.filePath ?? args.path); if (file) paths.push(file); } catch { /* Unknown schemas remain tool-only observations. */ }
            }
            if (payload.name === 'apply_patch' && typeof payload.input === 'string') {
                for (const match of payload.input.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) { const file = observationPath(root, match[1]); if (file) paths.push(file); }
            }
            const observations: MaestroToolObservation[] = (paths.length ? [...new Set(paths)].slice(0, 20) : [undefined]).map(file => ({ at, sessionId, source: 'codex', origin: 'rollout', eventId: payload.call_id as string,
                phase: 'started', tool: String(payload.name).slice(0, 100), ...(file ? { path: file } : {}) }));
            calls.set(payload.call_id, observations); result.push(...observations);
        }
        if (['function_call_output', 'custom_tool_call_output'].includes(String(payload.type))) {
            const observed = calls.get(payload.call_id);
            if (!observed) continue; // A clipped transcript cannot establish the corresponding tool.
            let failed = false;
            if (typeof payload.output === 'string') {
                try { const output = JSON.parse(payload.output); failed = typeof output.exit_code === 'number' && output.exit_code !== 0; } catch { /* An output event alone does not prove success. */ }
            }
            result.push(...observed.map(item => ({ ...item, at, phase: failed ? 'failed' as const : 'completed' as const })));
        }
    }
    const unique = new Map(result.map(item => [`${item.eventId}:${item.phase}:${item.path ?? ''}`, item]));
    return [...unique.values()].sort((a, b) => a.at - b.at).slice(-40);
}

/** Native lifecycle events survive periods without output; filesystem mtime is not a turn state. */
export function codexLifecycle(rows: Record<string, unknown>[]): { status: 'generating' | 'waiting'; waitingKind?: 'input'; activityAt: number; turnStartedAt?: number } | undefined {
    let latest: ReturnType<typeof codexLifecycle>;
    for (const row of rows) {
        if (row.type !== 'event_msg') continue;
        const type = (row.payload as Record<string, unknown> | undefined)?.type;
        if (!['task_started', 'task_complete', 'turn_aborted'].includes(String(type))) continue;
        const activityAt = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
        if (!Number.isFinite(activityAt) || (latest && activityAt < latest.activityAt)) continue;
        latest = type === 'task_started' ? { status: 'generating', activityAt, turnStartedAt: activityAt } : { status: 'waiting', waitingKind: 'input', activityAt };
    }
    return latest;
}
