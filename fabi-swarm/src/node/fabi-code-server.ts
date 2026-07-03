// Gestion du sous-process `opencode serve` (le sidecar moteur fabi-code).
// Calqué sur fabi-swarm-worker : spawn détaché, parsing stdout pour découvrir
// l'URL d'écoute, AUTO-RESTART sur crash, arrêt propre du process group
// (SIGTERM → SIGKILL), filet anti-orphelin sur process.exit du backend.
//
// La config OpenCode (provider swarm OpenAI-compatible + flags local) est
// injectée via l'env OPENCODE_CONFIG_CONTENT (JSON inline) — zéro fichier disque.

import { execFileSync, spawn, type ChildProcess } from 'child_process';

const SHUTDOWN_GRACE_MS = 4000;
const RESTART_DELAY_MS = 3000;
const FABI_CODE_PORT_MIN = 41960;
const FABI_CODE_PORT_MAX = 43960;
/** Ligne stdout d'OpenCode : "opencode server listening on http://127.0.0.1:PORT". */
const LISTEN_RE = /listening on\s+(https?:\/\/\S+)/i;

export interface ServerHandle {
    readonly pid: number | undefined;
    /** URL une fois découverte (sinon undefined). */
    readonly url: string | undefined;
    stop: () => Promise<void>;
}

export interface ServerOpts {
    binary: string;
    /** Config OpenCode complète (sérialisée dans OPENCODE_CONFIG_CONTENT). */
    config: Record<string, unknown>;
    hostname: string;
    port: number;
    /** Répertoire de travail par défaut (racine workspace). */
    cwd?: string;
    /** Appelé quand l'URL d'écoute est découverte. */
    onReady: (url: string) => void;
    /** Appelé sur crash / erreur (avec un message). */
    onError: (message: string) => void;
    /** Appelé quand le process s'arrête sur demande. */
    onStopped: () => void;
    /** Log brut (debug). */
    onLog?: (line: string) => void;
}

/**
 * Spawn `opencode serve`. Re-spawn auto après un crash inattendu (3 s). `stop()`
 * annule le restart et tue proprement le groupe de process.
 */
export function startServer(opts: ServerOpts): ServerHandle {
    let stopped = false;
    let child: ChildProcess | undefined;
    let currentPid: number | undefined;
    let url: string | undefined;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;

    const startChild = (): void => {
        const args = [
            'serve',
            `--hostname=${opts.hostname}`,
            `--port=${opts.port}`
        ];
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            OPENCODE_CONFIG_CONTENT: JSON.stringify(opts.config),
            OPENCODE_DISABLE_AUTOUPDATE: '1',
            OPENCODE_PURE: '1'
        };
        let proc: ChildProcess;
        try {
            proc = spawn(opts.binary, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: process.platform !== 'win32',
                cwd: opts.cwd,
                env
            });
        } catch (err) {
            opts.onError(`spawn fabi-code: ${(err as Error).message}`);
            return;
        }
        child = proc;
        currentPid = proc.pid;
        if (typeof currentPid === 'number') {
            killOrphanedSidecars(currentPid);
        }

        let buf = '';
        const onChunk = (chunk: Buffer): void => {
            buf += chunk.toString('utf-8');
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                opts.onLog?.(line);
                if (!url) {
                    const m = line.match(LISTEN_RE);
                    if (m) {
                        url = m[1].replace(/\/+$/, '');
                        opts.onReady(url);
                    }
                }
            }
        };
        proc.stdout?.on('data', onChunk);
        proc.stderr?.on('data', onChunk);

        proc.on('error', err => opts.onError(err.message));
        proc.on('close', (code, signal) => {
            url = undefined;
            if (stopped) {
                opts.onStopped();
                return;
            }
            opts.onError(`fabi-code arrêté (code=${code}${signal ? ` signal=${signal}` : ''}) — redémarrage`);
            restartTimer = setTimeout(() => {
                if (!stopped) {
                    startChild();
                }
            }, RESTART_DELAY_MS);
            restartTimer.unref?.();
        });
    };

    startChild();

    // Filet anti-orphelin : si le backend se termine sans stop() (fermeture app
    // → process.exit), on tue le groupe de process du sidecar.
    const parentExitKill = (): void => {
        if (stopped) {
            return;
        }
        try {
            if (process.platform !== 'win32' && currentPid) {
                process.kill(-currentPid, 'SIGTERM');
            } else {
                child?.kill('SIGTERM');
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
            const finish = (): void => { if (!done) { done = true; resolve(); } };
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

    return {
        get pid() { return currentPid; },
        get url() { return url; },
        stop
    };
}

/**
 * Nettoie les anciens sidecars Fabi qui auraient survécu à une fermeture dure
 * de l'IDE. On ne cible que les `opencode/fabi-code serve` orphelins (PPID=1)
 * sur la plage de ports réservée par FabiCodeService, afin d'éviter de tuer un
 * OpenCode lancé manuellement par l'utilisateur.
 */
function killOrphanedSidecars(currentPid: number): void {
    if (process.platform === 'win32') {
        return;
    }
    let output = '';
    try {
        output = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
    } catch {
        return;
    }
    for (const rawLine of output.split('\n')) {
        const line = rawLine.trim();
        const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (!match) {
            continue;
        }
        const pid = Number(match[1]);
        const ppid = Number(match[2]);
        const command = match[3];
        if (!pid || pid === currentPid || ppid !== 1) {
            continue;
        }
        if (!/\b(?:opencode|fabi-code)\b.*\bserve\b/.test(command) || !command.includes('--hostname=127.0.0.1')) {
            continue;
        }
        const portMatch = command.match(/(?:^|\s)--port=(\d+)(?:\s|$)/);
        const port = portMatch ? Number(portMatch[1]) : 0;
        if (port < FABI_CODE_PORT_MIN || port >= FABI_CODE_PORT_MAX) {
            continue;
        }
        try {
            process.kill(-pid, 'SIGTERM');
        } catch {
            try {
                process.kill(pid, 'SIGTERM');
            } catch {
                /* déjà mort */
            }
        }
    }
}
