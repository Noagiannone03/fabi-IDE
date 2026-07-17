// Gestion du sous-process `parallax join`. Argv + env tunés selon le matériel
// (cf. fabi-worker-tuning), parsing des events `[FABI] {...}` émis sur stdout
// pour remonter l'étape live (handshake → join → chargement poids → prêt),
// AUTO-RESTART 30 s sur crash inattendu (comme le CLI), et arrêt propre du
// process group (SIGINT, puis SIGTERM/SIGKILL après les délais de grâce).

import { createWriteStream, mkdirSync, type WriteStream } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { WorkerState, WorkerStage } from '../common/fabi-swarm-protocol';
import { buildJoinArgs, buildWorkerEnv, killOrphanedWorkers } from './fabi-worker-tuning';

// Parallax intercepte SIGINT et accorde ensuite 5 s à SIGINT puis 5 s à SIGTERM
// avant son propre SIGKILL. Fabi attend cette séquence amont avant d'escalader.
const INTERRUPT_GRACE_MS = 12_000;
const TERMINATE_GRACE_MS = 5_000;
/** Délai avant re-spawn après un crash inattendu (aligné sur le CLI). */
const RESTART_DELAY_MS = 30_000;
const EVENT_PREFIX = '[FABI] ';
const WORKER_LOG_DIR = join(homedir(), 'Library', 'Logs', 'Fabi');

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
        const log = openWorkerLog(swarmId);
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
        writeWorkerLog(log, 'launcher', `spawn pid=${currentPid} cmd=${bin} ${args.join(' ')}`);
        try {
            killOrphanedWorkers(currentPid);
        } catch {
            /* best-effort */
        }

        const state: WorkerState = { kind: 'running', pid: currentPid, swarmId };
        onUpdate({ ...state });
        const push = () => onUpdate({ ...state });

        let buf = '';
        const onChunk = (source: 'stdout' | 'stderr', chunk: Buffer) => {
            const text = chunk.toString('utf-8');
            writeWorkerLog(log, source, text);
            buf += text;
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                handleLine(line, state, push);
            }
        };
        proc.stdout?.on('data', chunk => onChunk('stdout', chunk));
        proc.stderr?.on('data', chunk => onChunk('stderr', chunk));

        proc.on('error', err => {
            writeWorkerLog(log, 'launcher', `spawn error: ${err.stack ?? err.message}`);
            onUpdate({ kind: 'error', swarmId, message: err.message });
        });
        proc.on('close', (code, signal) => {
            writeWorkerLog(log, 'launcher', `close code=${code} signal=${signal}`);
            log?.end();
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

    // Filet anti-orphelin : si le backend (IDE) se termine sans qu'on ait appelé
    // stop() (fermeture de l'app → Theia fait process.exit), on envoie SIGINT au
    // worker. Comme il est `detached`, il survit au backend le temps d'exécuter
    // sa déconnexion propre (node_leave → le scheduler le retire tout de suite,
    // pas de nœud fantôme). Handler `exit` SYNCHRONE → aucune interférence avec
    // l'arrêt de Theia (qui passe par process.exit).
    const parentExitKill = () => {
        if (stopped) {
            return;
        }
        try {
            if (process.platform !== 'win32' && currentPid) {
                process.kill(-currentPid, 'SIGINT');
            } else {
                killWindowsProcessTree(currentPid, false);
            }
        } catch {
            /* déjà mort */
        }
    };
    process.on('exit', parentExitKill);

    const stop = (): Promise<void> => {
        if (stopped) {
            return Promise.resolve();
        }
        stopped = true;
        process.removeListener('exit', parentExitKill);
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
            let terminateTimer: ReturnType<typeof setTimeout> | undefined;
            let killTimer: ReturnType<typeof setTimeout> | undefined;
            const finish = () => { if (!done) { done = true; resolve(); } };
            const finishAndClear = () => {
                if (terminateTimer) {
                    clearTimeout(terminateTimer);
                }
                if (killTimer) {
                    clearTimeout(killTimer);
                }
                finish();
            };
            proc.once('close', finishAndClear);
            try {
                if (process.platform !== 'win32') {
                    process.kill(-pid, 'SIGINT');
                } else {
                    killWindowsProcessTree(pid, false);
                }
            } catch {
                finishAndClear();
                return;
            }
            terminateTimer = setTimeout(() => {
                if (done) {
                    return;
                }
                try {
                    if (process.platform !== 'win32') {
                        process.kill(-pid, 'SIGTERM');
                    } else {
                        killWindowsProcessTree(pid, false);
                    }
                } catch { /* déjà mort */ }
                killTimer = setTimeout(() => {
                    if (done) {
                        return;
                    }
                    try {
                        if (process.platform !== 'win32') {
                            process.kill(-pid, 'SIGKILL');
                        } else {
                            killWindowsProcessTree(pid, true);
                        }
                    } catch { /* déjà mort */ }
                    finish();
                }, TERMINATE_GRACE_MS);
            }, INTERRUPT_GRACE_MS);
        });
    };

    return { get pid() { return currentPid; }, stop };
}

function killWindowsProcessTree(pid: number | undefined, force: boolean): void {
    if (!pid) {
        return;
    }
    const args = ['/PID', String(pid), '/T'];
    if (force) {
        args.push('/F');
    }
    const result = spawnSync('taskkill.exe', args, { stdio: 'ignore', windowsHide: true });
    if (result.error) {
        throw result.error;
    }
}

function openWorkerLog(swarmId: string): WriteStream | undefined {
    try {
        mkdirSync(WORKER_LOG_DIR, { recursive: true });
        const safeSwarmId = swarmId.replace(/[^a-z0-9_.-]/gi, '_');
        const file = join(WORKER_LOG_DIR, `swarm-worker-${safeSwarmId}.log`);
        const stream = createWriteStream(file, { flags: 'a' });
        writeWorkerLog(stream, 'launcher', `--- worker launch ${new Date().toISOString()} ---`);
        return stream;
    } catch {
        return undefined;
    }
}

function writeWorkerLog(log: WriteStream | undefined, source: string, message: string): void {
    if (!log) {
        return;
    }
    const line = message.endsWith('\n') ? message : `${message}\n`;
    log.write(`[${new Date().toISOString()}] [${source}] ${line}`);
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
