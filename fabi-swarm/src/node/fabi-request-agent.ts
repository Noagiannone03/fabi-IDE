// Supervision du frontend OpenAI local V3.
//
// Le Request Agent choisit et réserve lui-même une route depuis la DHT ; il ne
// demande jamais au scheduler de lui attribuer des couches. Le scheduler reste
// l'autorité de permis/epoch pour une requête précise.

import { ChildProcess, spawn, spawnSync } from 'child_process';
import {
    createWriteStream, mkdirSync, readFileSync, rmSync, unwatchFile, watchFile,
    type WriteStream
} from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import {
    RequestAgentActivity, RequestAgentState, SwarmEntry, WorkerConnectionProfile
} from '../common/fabi-swarm-protocol';
import { PreparedWorkerBootstrap } from './fabi-worker-bootstrap';
import { getAccountToken } from './fabi-account-token';
import { RequestAgentEventFeed } from './fabi-request-agent-events';
import type { RuntimeCommand } from './fabi-runtime-install';

const INTERRUPT_GRACE_MS = 12_000;
const TERMINATE_GRACE_MS = 5_000;
const KILL_CLOSE_GRACE_MS = 2_000;
const RESTART_MAX_MS = 30_000;

export function requestAgentRestartDelay(attempt: number): number {
    return Math.min(
        RESTART_MAX_MS,
        1_000 * Math.pow(2, Math.max(0, Math.floor(attempt) - 1))
    );
}

export interface RequestAgentHandle {
    readonly pid: number | undefined;
    readonly ready: Promise<RequestAgentState>;
    /** Résolu uniquement après la fermeture du process et de ses stdio. */
    readonly closed: Promise<void>;
    stop(): Promise<void>;
}

export type RequestAgentSpawner = typeof spawn;

interface ReadyDocument {
    schema_version: number;
    pid: number;
    base_url: string;
}

function safeSwarmId(swarmId: string): string {
    return swarmId.replace(/[^a-z0-9_.-]/gi, '_');
}

/** Environnement séparé du worker : identités réseau/DHT propres, état durable propre. */
export function buildRequestAgentEnv(
    swarm: SwarmEntry,
    profile: WorkerConnectionProfile,
    bootstrap: PreparedWorkerBootstrap
): NodeJS.ProcessEnv {
    if (!/^[0-9a-f]{64}$/.test(swarm.modelSwarmId ?? '')) {
        throw new Error('ce swarm ne publie pas une identité modelSwarmId V3 valide');
    }
    if (!swarm.schedulerUrl) {
        throw new Error('ce swarm ne publie pas son autorité de requête');
    }
    const env = { ...process.env };
    const id = safeSwarmId(swarm.id);
    const networkRoot = join(bootstrap.dataRoot, 'network');
    const stateRoot = join(bootstrap.dataRoot, 'request-agent', id);

    delete env.FABI_RELAY_TOKEN;
    delete env.FABI_RELAY_TOKEN_FILE;
    env.FABI_ACCOUNT_TOKEN = getAccountToken();
    env.FABI_NETWORK_TRANSPORT = 'iroh';
    env.FABI_RELAY_URL = profile.relayUrl;
    env.FABI_RELAY_ENROLLMENT_URL = profile.enrollmentUrl;
    env.FABI_NETWORK_IDENTITY_PATH = join(networkRoot, `request-agent-${id}.key`);
    env.FABI_CATALOG_DHT_MODE = 'client';
    env.FABI_CATALOG_DHT_BOOTSTRAPS = JSON.stringify(profile.catalogDhtBootstraps);
    env.FABI_CATALOG_DHT_IDENTITY_PATH = join(networkRoot, `request-agent-catalog-${id}.key`);
    env.FABI_CATALOG_DHT_LISTEN_ADDRESS = '/ip4/127.0.0.1/tcp/0';
    env.FABI_MODEL_REGISTRY_ROOT = bootstrap.rootPath;
    env.FABI_MODEL_REGISTRY_METADATA_URL = profile.modelRegistry.metadataUrl;
    env.FABI_MODEL_REGISTRY_TARGETS_URL = profile.modelRegistry.targetsUrl;
    env.FABI_REQUEST_AGENT_MODEL_SWARM_ID = swarm.modelSwarmId!;
    env.FABI_REQUEST_AGENT_AUTHORITY_URL = swarm.schedulerUrl.replace(/\/+$/, '');
    env.FABI_REQUEST_AGENT_STATE_DIR = stateRoot;
    env.FABI_FORCE_RELAY = '0';
    return env;
}

export function parseRequestAgentReady(raw: string, expectedPid: number): ReadyDocument {
    let document: unknown;
    try {
        document = JSON.parse(raw);
    } catch {
        throw new Error('readiness Request Agent illisible');
    }
    const ready = document as Partial<ReadyDocument>;
    if (ready.schema_version !== 1 || ready.pid !== expectedPid) {
        throw new Error('readiness Request Agent obsolète ou étrangère');
    }
    let url: URL;
    try {
        url = new URL(ready.base_url ?? '');
    } catch {
        throw new Error('URL Request Agent invalide');
    }
    if (
        url.protocol !== 'http:'
        || (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]' && url.hostname !== '::1')
        || url.username
        || url.password
        || url.pathname !== '/'
        || url.search
        || url.hash
        || !url.port
    ) {
        throw new Error('le Request Agent doit écouter uniquement en loopback');
    }
    return {
        schema_version: 1,
        pid: expectedPid,
        base_url: url.origin
    };
}

export function spawnRequestAgent(
    command: RuntimeCommand,
    swarm: SwarmEntry,
    profile: WorkerConnectionProfile,
    bootstrap: PreparedWorkerBootstrap,
    onUpdate: (state: RequestAgentState) => void,
    onActivity: (activity: RequestAgentActivity) => void,
    spawnChild: RequestAgentSpawner = spawn
): RequestAgentHandle {
    const id = safeSwarmId(swarm.id);
    const frontendRoot = join(bootstrap.dataRoot, 'request-agent', id, 'frontend');
    mkdirSync(frontendRoot, { recursive: true });
    const readyFile = join(frontendRoot, `ready-${randomUUID()}.json`);
    const log = openLog(bootstrap.dataRoot, id);
    let child: ChildProcess | undefined;
    let watchingReadyFile = false;
    let eventFeed: RequestAgentEventFeed | undefined;
    let stopped = false;
    let settled = false;
    let errorReported = false;
    let closedSettled = false;
    let resolveReady!: (state: RequestAgentState) => void;
    let rejectReady!: (error: Error) => void;
    let resolveClosed!: () => void;
    const ready = new Promise<RequestAgentState>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    const closed = new Promise<void>(resolve => {
        resolveClosed = resolve;
    });
    const settleClosed = () => {
        if (!closedSettled) {
            closedSettled = true;
            resolveClosed();
        }
    };
    const settleError = (message: string) => {
        if (errorReported) {
            return;
        }
        errorReported = true;
        const error = new Error(message);
        if (!settled) {
            settled = true;
            rejectReady(error);
        }
        onUpdate({ kind: 'error', swarmId: swarm.id, pid: child?.pid, message });
    };
    const stopWatchingReadyFile = () => {
        if (watchingReadyFile) {
            unwatchFile(readyFile);
            watchingReadyFile = false;
        }
    };

    try {
        const env = buildRequestAgentEnv(swarm, profile, bootstrap);
        // Le fichier n'existe pas au démarrage. StatWatcher notifie aussi sa
        // création ultérieure et évite les divergences fs.watch entre
        // ReadDirectoryChangesW, kqueue et inotify. Ce polling ne décide
        // jamais qu'un process est mort : seul exit/close le fait.
        watchFile(readyFile, { interval: 100, persistent: false }, current => {
            if (settled || !child?.pid || !current.isFile()) {
                return;
            }
            try {
                const document = parseRequestAgentReady(readFileSync(readyFile, 'utf8'), child.pid);
                settled = true;
                const state: RequestAgentState = {
                    kind: 'ready',
                    swarmId: swarm.id,
                    pid: child.pid,
                    baseUrl: document.base_url
                };
                resolveReady(state);
                onUpdate(state);
                eventFeed = new RequestAgentEventFeed(
                    document.base_url,
                    getAccountToken(),
                    onActivity
                );
                eventFeed.start();
                stopWatchingReadyFile();
            } catch (error) {
                // Le moteur publie par rename atomique. Un fichier final
                // invalide est donc une faute de contrat, pas une condition
                // transitoire à masquer.
                const message = `readiness invalide: ${
                    error instanceof Error ? error.message : String(error)
                }`;
                writeLog(log, 'launcher', message);
                stopWatchingReadyFile();
                settleError(message);
                void stopProcess(child);
            }
        });
        watchingReadyFile = true;
        const args = [
            ...command.argsPrefix,
            '--host', '127.0.0.1',
            '--port', '0',
            '--ready-file', readyFile
        ];
        child = spawnChild(command.binary, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            env,
            windowsHide: true
        });
        if (!child.pid) {
            throw new Error('spawn fabi-request-agent sans PID');
        }
        onUpdate({ kind: 'starting', swarmId: swarm.id, pid: child.pid });
        writeLog(log, 'launcher', `spawn pid=${child.pid} cmd=${command.binary} ${args.join(' ')}`);
        child.stdout?.on('data', chunk => writeLog(log, 'stdout', chunk.toString('utf8')));
        child.stderr?.on('data', chunk => writeLog(log, 'stderr', chunk.toString('utf8')));
        child.once('error', error => settleError(`Request Agent impossible à lancer: ${error.message}`));
        child.once('close', (code, signal) => {
            stopWatchingReadyFile();
            eventFeed?.stop();
            eventFeed = undefined;
            rmSync(readyFile, { force: true });
            log?.end();
            if (stopped) {
                onUpdate({ kind: 'stopped', swarmId: swarm.id });
            } else {
                settleError(
                    `Request Agent arrêté (code=${code}${signal ? ` signal=${signal}` : ''})`
                );
            }
            settleClosed();
        });
    } catch (error) {
        stopWatchingReadyFile();
        rmSync(readyFile, { force: true });
        log?.end();
        settleError(error instanceof Error ? error.message : String(error));
        settleClosed();
    }

    return {
        get pid() { return child?.pid; },
        ready,
        closed,
        stop: async () => {
            if (stopped) {
                return closed;
            }
            stopped = true;
            stopWatchingReadyFile();
            eventFeed?.stop();
            eventFeed = undefined;
            rmSync(readyFile, { force: true });
            if (!settled) {
                settled = true;
                rejectReady(new Error('Request Agent arrêté avant readiness'));
            }
            const processToStop = child;
            if (!processToStop?.pid) {
                settleClosed();
                return;
            }
            if (processToStop.exitCode !== null || processToStop.signalCode !== null) {
                await closed;
                return;
            }
            await stopProcess(processToStop, settleClosed);
            await closed;
        }
    };
}

function stopProcess(child: ChildProcess, settleAfterKillTimeout?: () => void): Promise<void> {
    return new Promise(resolve => {
        let finished = false;
        let terminateTimer: ReturnType<typeof setTimeout> | undefined;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        let closeTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
            if (finished) {
                return;
            }
            finished = true;
            if (terminateTimer) {
                clearTimeout(terminateTimer);
            }
            if (killTimer) {
                clearTimeout(killTimer);
            }
            if (closeTimer) {
                clearTimeout(closeTimer);
            }
            resolve();
        };
        child.once('close', finish);
        signalProcess(child.pid, 'SIGINT', false);
        terminateTimer = setTimeout(() => {
            signalProcess(child.pid, 'SIGTERM', false);
            killTimer = setTimeout(() => {
                signalProcess(child.pid, 'SIGKILL', true);
                // Node garantit `close` après la fin du process et des stdio.
                // Ce dernier garde-fou protège toutefois la fermeture de l'IDE
                // d'un runtime/OS défaillant après le kill forcé.
                closeTimer = setTimeout(() => {
                    settleAfterKillTimeout?.();
                    finish();
                }, KILL_CLOSE_GRACE_MS);
            }, TERMINATE_GRACE_MS);
        }, INTERRUPT_GRACE_MS);
    });
}

function signalProcess(
    pid: number | undefined,
    signal: NodeJS.Signals,
    force: boolean
): void {
    if (!pid) {
        return;
    }
    try {
        if (process.platform === 'win32') {
            const args = ['/PID', String(pid), '/T'];
            if (force) {
                args.push('/F');
            }
            spawnSync('taskkill.exe', args, { stdio: 'ignore', windowsHide: true });
        } else {
            process.kill(-pid, signal);
        }
    } catch {
        /* déjà mort */
    }
}

function openLog(dataRoot: string, swarmId: string): WriteStream | undefined {
    try {
        const directory = join(dataRoot, 'logs');
        mkdirSync(directory, { recursive: true });
        const stream = createWriteStream(
            join(directory, `request-agent-${swarmId}.log`),
            { flags: 'a' }
        );
        // createWriteStream ouvre le fichier de façon asynchrone : un disque
        // plein, un volume démonté ou une permission tardive échappe au
        // try/catch ci-dessus sans listener explicite.
        stream.on('error', () => undefined);
        writeLog(stream, 'launcher', `--- Request Agent ${new Date().toISOString()} ---`);
        return stream;
    } catch {
        return undefined;
    }
}

function writeLog(log: WriteStream | undefined, source: string, message: string): void {
    if (!log) {
        return;
    }
    log.write(
        `[${new Date().toISOString()}] [${source}] ${
            message.endsWith('\n') ? message : `${message}\n`
        }`
    );
}
