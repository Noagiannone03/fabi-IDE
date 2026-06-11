// Gestion du sous-process `parallax join`. Argv + env tunés selon le matériel
// (cf. fabi-worker-tuning), parsing des events `[FABI] {...}` émis sur stdout
// pour remonter l'étape live (handshake → join → chargement poids → prêt),
// AUTO-RESTART 30 s sur crash inattendu (comme le CLI), et arrêt propre du
// process group (SIGTERM puis SIGKILL après le délai de grâce).

import { spawn, type ChildProcess } from 'child_process';
import { WorkerState, WorkerStage } from '../common/fabi-swarm-protocol';
import { buildJoinArgs, buildWorkerEnv, killOrphanedWorkers } from './fabi-worker-tuning';

/** Délai de grâce avant SIGKILL (aligné sur le CLI : workerShutdownGraceMs). */
const SHUTDOWN_GRACE_MS = 1500;
/** Délai avant re-spawn après un crash inattendu (aligné sur le CLI). */
const RESTART_DELAY_MS = 30_000;
const EVENT_PREFIX = '[FABI] ';

export interface WorkerHandle {
    /** PID courant (change après un auto-restart). */
    readonly pid: number | undefined;
    stop: () => Promise<void>;
}

/**
 * Spawn `parallax join` depuis `bin`, rattaché au swarm `swarmId`. `onUpdate`
 * est appelé à chaque changement d'état. Sur crash inattendu, re-spawn auto
 * après 30 s (sauf si on a demandé l'arrêt). `stop()` annule le restart.
 */
export function spawnWorker(
    bin: string,
    peer: string,
    swarmId: string,
    onUpdate: (state: WorkerState) => void
): WorkerHandle {
    let stopped = false;
    let child: ChildProcess | undefined;
    let currentPid: number | undefined;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;

    const startChild = (): void => {
        const args = buildJoinArgs(peer);
        const env = buildWorkerEnv();
        const proc = spawn(bin, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            env
        });
        child = proc;
        currentPid = proc.pid;
        if (typeof currentPid !== 'number') {
            onUpdate({ kind: 'error', swarmId, message: 'spawn parallax sans PID' });
            return;
        }
        try {
            killOrphanedWorkers(currentPid);
        } catch {
            /* best-effort */
        }

        const state: WorkerState = { kind: 'running', pid: currentPid, swarmId };
        onUpdate({ ...state });
        const push = () => onUpdate({ ...state });

        let buf = '';
        const onChunk = (chunk: Buffer) => {
            buf += chunk.toString('utf-8');
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                handleLine(line, state, push);
            }
        };
        proc.stdout?.on('data', onChunk);
        proc.stderr?.on('data', onChunk);

        proc.on('error', err => onUpdate({ kind: 'error', swarmId, message: err.message }));
        proc.on('close', (code, signal) => {
            if (stopped) {
                onUpdate({ kind: 'stopped', swarmId, message: `worker arrêté (code=${code} signal=${signal})` });
                return;
            }
            // Crash inattendu → on signale puis on re-spawn dans 30 s.
            onUpdate({ kind: 'error', swarmId, message: `worker arrêté (code=${code}${signal ? ` signal=${signal}` : ''}) — redémarrage auto` });
            restartTimer = setTimeout(() => {
                if (!stopped) {
                    onUpdate({ kind: 'starting', swarmId });
                    startChild();
                }
            }, RESTART_DELAY_MS);
            restartTimer.unref?.();
        });
    };

    startChild();

    const stop = (): Promise<void> => {
        if (stopped) {
            return Promise.resolve();
        }
        stopped = true;
        if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = undefined;
        }
        const proc = child;
        const pid = currentPid;
        if (!proc || !pid) {
            return Promise.resolve();
        }
        return new Promise<void>(resolve => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            proc.once('close', finish);
            try {
                if (process.platform !== 'win32') {
                    process.kill(-pid, 'SIGTERM');
                } else {
                    proc.kill('SIGTERM');
                }
            } catch {
                finish();
                return;
            }
            setTimeout(() => {
                if (done) {
                    return;
                }
                try {
                    if (process.platform !== 'win32') {
                        process.kill(-pid, 'SIGKILL');
                    } else {
                        proc.kill('SIGKILL');
                    }
                } catch { /* déjà mort */ }
                finish();
            }, SHUTDOWN_GRACE_MS).unref();
        });
    };

    return { get pid() { return currentPid; }, stop };
}

/** Applique un event `[FABI] {...}` à l'état du worker (port de events.ts). */
function handleLine(line: string, state: WorkerState, push: () => void): void {
    if (!line.startsWith(EVENT_PREFIX)) {
        return;
    }
    let evt: Record<string, unknown>;
    try {
        evt = JSON.parse(line.slice(EVENT_PREFIX.length)) as Record<string, unknown>;
    } catch {
        return;
    }
    const name = typeof evt.event === 'string' ? evt.event : undefined;
    if (!name) {
        return;
    }
    const num = (k: string): number | undefined => typeof evt[k] === 'number' ? evt[k] as number : undefined;
    const str = (k: string): string | undefined => typeof evt[k] === 'string' ? evt[k] as string : undefined;
    const setStage = (stage: WorkerStage) => { state.stage = stage; };

    switch (name) {
        case 'peer_id':
            state.peerId = str('peer_id') ?? state.peerId;
            setStage('handshake');
            break;
        case 'joining_scheduler':
            setStage('joining');
            break;
        case 'allocated':
            setStage('loading-weights');
            state.startLayer = num('start_layer');
            state.endLayer = num('end_layer');
            break;
        case 'alloc_timeout':
            setStage('alloc-timeout');
            state.message = "le scheduler n'a pas pu allouer de couches (300s)";
            break;
        case 'weights_load_start':
            setStage('loading-weights');
            state.weightsFilesDone = 0;
            state.weightsFilesTotal = num('files_total');
            break;
        case 'weights_load_progress':
            setStage('loading-weights');
            state.weightsFilesDone = num('files_done');
            state.weightsFilesTotal = num('files_total');
            state.weightsCurrentFile = str('file_name');
            break;
        case 'weights_load_done':
            setStage('ready');
            state.weightsFilesTotal = num('files_total');
            state.weightsFilesDone = num('files_total');
            state.weightsCurrentFile = undefined;
            break;
        default:
            return; // event inconnu (ex. 'pressure') → pas de changement d'étape
    }
    push();
}

/** Extrait le peer du scheduler depuis node_join_command (repli ponctuel si le
 *  registry n'a pas encore le peer — PAS un poll, un seul appel au connect). */
export async function fetchSchedulerPeer(scheduler: string, timeoutMs = 4000): Promise<string | undefined> {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetch(`${scheduler.replace(/\/+$/, '')}/cluster/status_json`, { method: 'GET', signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) {
            return undefined;
        }
        const json = await res.json() as { data?: { node_join_command?: { command?: string } } };
        const match = json.data?.node_join_command?.command?.match(/-s\s+(\S+)/);
        return match?.[1];
    } catch {
        return undefined;
    }
}
