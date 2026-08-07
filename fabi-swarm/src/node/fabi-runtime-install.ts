// Install du runtime moteur (Parallax) — réplique FIDÈLE de install.sh /
// install.ps1 du repo `fabi`, en TypeScript, pour que l'IDE installe au même
// endroit et de la même façon que le CLI (un seul moteur partagé sur le disque).
//
// Logique (identique aux scripts éprouvés) :
//   1. Plateforme = `${os}-${arch}-${accel}` (os ∈ linux|darwin|windows).
//   2. Tarball = `fabi-<plateforme>.tar.zst` sur la release `fabi` (GitHub).
//   3. Si un manifeste `.parts` existe (asset > 2 Gio splitté) → télécharger
//      chaque partie et réassembler (cat). Sinon téléchargement direct.
//   4. Vérif SHA-256 (`.sha256`).
//   5. Extraction `--strip-components=1` → bin/ + runtime/ sous l'install root.
//   6. Relocalisation : `__FABI_INSTALL_ROOT__` → vrai chemin dans runtime/.
//   7. Sur POSIX, les entrypoints du venv sont exécutés directement. Sous
//      Windows, le Python embarqué exécute les modules avec `-m` : les launchers
//      distlib `.exe` mémorisent le chemin de build et ne sont pas relocalisables.
//
// Module PLAIN (sans inversify) → réutilisable depuis electron-main (launcher)
// comme depuis le service backend (bouton « Installer le moteur »).

import { spawn } from 'child_process';
import { once } from 'events';
import {
    chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync,
    readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync
} from 'fs';
import { createHash } from 'crypto';
import { homedir, platform as osPlatform, arch as osArch, tmpdir } from 'os';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { Writable } from 'stream';

export type Accel = 'mlx' | 'cuda' | 'cpu';

/** Contrat immuable du runtime qualifié avec le swarm Mac/Windows réel. */
export const FABI_REPO = process.env.FABI_RUNTIME_REPO || 'Noagiannone03/fabi';
export const QUALIFIED_RUNTIME_VERSION = 'v2.7.0-rc49';
export const QUALIFIED_OPENCODE_COMMIT = 'f6e8b01063e1b455b708d8bae0c1dc7a0e84688f';
export const QUALIFIED_PARALLAX_COMMIT = '7296313eade6cde5ac80c878770f604910256143';
export const QUALIFIED_NATIVE_NETWORK_VERSION = '0.1.0';
const RELOCATE_PLACEHOLDER = '__FABI_INSTALL_ROOT__';

export interface RuntimeManifest {
    version: string;
    values: Readonly<Record<string, string>>;
}

export type RuntimeExecutionDevice = 'cpu' | 'cuda' | 'metal' | 'rocm' | 'vulkan';

/** Execution contract authenticated by the qualified runtime MANIFEST. */
export interface ManagedRuntimeProfile {
    accelerator: string | null;
    engine: 'skippy' | null;
    executionDevice: RuntimeExecutionDevice | null;
}

export interface RuntimeContract {
    version: string;
    opencodeRevision: string;
    parallaxRevision: string;
    nativeNetworkVersion: string;
    target?: string;
    accel?: Accel;
    executionEngine?: 'skippy';
}

export interface PlatformInfo {
    os: 'darwin' | 'linux' | 'windows';
    arch: 'x64' | 'arm64';
    accel: Accel;
    /** ex "windows-x64-cuda" — exactement le tag produit par la CI. */
    tag: string;
    /** ex "fabi-windows-x64-cuda.tar.zst". */
    artifact: string;
}

/** Petit actif autonome publié à côté du tarball pour les machines sans zstd. */
export function zstdHelperArtifactFor(platform: PlatformInfo): string {
    const suffix = platform.os === 'windows' ? '.exe' : '';
    return `fabi-unzstd-${platform.tag}${suffix}`;
}

export interface InstallProgress {
    phase: 'download' | 'verify' | 'extract' | 'done';
    /** 0-100 pour la phase download, sinon indicatif. */
    percent: number;
    message?: string;
}

/** Déduplique les callbacks réseau : au plus un événement par pourcentage/message. */
export function createDownloadProgressReporter(
    onProgress: (progress: InstallProgress) => void
): (percent: number, message?: string) => void {
    let lastPercent = -1;
    let lastMessage: string | undefined;
    return (percent: number, message?: string): void => {
        const bounded = Math.max(0, Math.min(100, Math.round(percent)));
        if (bounded === lastPercent && message === lastMessage) {
            return;
        }
        lastPercent = bounded;
        lastMessage = message;
        onProgress({ phase: 'download', percent: bounded, message });
    };
}

/** Commande exécutable du runtime, indépendante du type d'entrypoint de l'OS. */
export interface RuntimeCommand {
    binary: string;
    argsPrefix: string[];
    /** Present for packaged runtimes; absent only for an explicit dev checkout. */
    runtimeProfile?: ManagedRuntimeProfile;
}

export interface LocatedRuntimeCommand extends RuntimeCommand {
    location: 'bundled' | 'cached';
}

/** Version choisie par le produit. Une surcharge explicite reste disponible en labo. */
export function configuredRuntimeVersion(): string {
    return process.env.FABI_RUNTIME_VERSION?.trim() || QUALIFIED_RUNTIME_VERSION;
}

/**
 * Contrat attendu. Les révisions ne deviennent configurables que par des env
 * explicites : changer seulement le tag ne doit jamais accepter silencieusement
 * un moteur différent de celui qualifié.
 */
export function configuredRuntimeContract(version = configuredRuntimeVersion()): RuntimeContract {
    return {
        version,
        opencodeRevision: process.env.FABI_RUNTIME_OPENCODE_COMMIT?.trim() || QUALIFIED_OPENCODE_COMMIT,
        parallaxRevision: process.env.FABI_RUNTIME_PARALLAX_COMMIT?.trim() || QUALIFIED_PARALLAX_COMMIT,
        nativeNetworkVersion:
            process.env.FABI_RUNTIME_NATIVE_NETWORK_VERSION?.trim() || QUALIFIED_NATIVE_NETWORK_VERSION,
        executionEngine: 'skippy'
    };
}

/** Parse le MANIFEST produit par scripts/release-build.sh, en refusant les doublons. */
export function parseRuntimeManifest(raw: string): RuntimeManifest {
    const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const header = /^fabi\s+(\S+)$/.exec(lines.shift() ?? '');
    if (!header) {
        throw new Error('MANIFEST runtime invalide : en-tête fabi absent');
    }
    const values: Record<string, string> = {};
    for (const line of lines) {
        const entry = /^([a-z][a-z0-9_]*)=(.*)$/.exec(line);
        if (!entry || !entry[2]) {
            throw new Error(`MANIFEST runtime invalide : entrée ${JSON.stringify(line)}`);
        }
        if (Object.prototype.hasOwnProperty.call(values, entry[1])) {
            throw new Error(`MANIFEST runtime invalide : clé dupliquée ${entry[1]}`);
        }
        values[entry[1]] = entry[2];
    }
    return { version: header[1], values };
}

/** Vérifie qu'un manifeste correspond exactement au runtime qualifié attendu. */
export function validateRuntimeManifest(raw: string, expected: RuntimeContract): RuntimeManifest {
    const manifest = parseRuntimeManifest(raw);
    const mismatches: string[] = [];
    const check = (label: string, actual: string | undefined, wanted: string | undefined) => {
        if (wanted !== undefined && actual !== wanted) {
            mismatches.push(`${label}=${actual ?? '<absent>'} (attendu ${wanted})`);
        }
    };
    check('version', manifest.version, expected.version);
    check('opencode_revision', manifest.values.opencode_revision, expected.opencodeRevision);
    check('parallax_revision', manifest.values.parallax_revision, expected.parallaxRevision);
    check('native_network_version', manifest.values.native_network_version, expected.nativeNetworkVersion);
    check('target', manifest.values.target, expected.target);
    check('accel', manifest.values.accel, expected.accel);
    check('execution_engine', manifest.values.execution_engine, expected.executionEngine);
    if (expected.executionEngine === 'skippy' && !parseManagedRuntimeProfile(raw).executionDevice) {
        mismatches.push(
            `execution_device=${manifest.values.execution_device ?? '<absent>'} `
            + '(attendu cpu|cuda|metal|rocm|vulkan)'
        );
    }
    if (mismatches.length > 0) {
        throw new Error(`runtime non qualifié : ${mismatches.join(', ')}`);
    }
    return manifest;
}

/**
 * Read the backend selected by the release builder. The archive manifest wins
 * over hardware probing: it describes the native libraries actually shipped.
 */
export function parseManagedRuntimeProfile(raw: string): ManagedRuntimeProfile {
    const manifest = parseRuntimeManifest(raw);
    const accelerator = manifest.values.accel?.trim().toLowerCase() || null;
    const engine = manifest.values.execution_engine?.trim().toLowerCase() === 'skippy'
        ? 'skippy'
        : null;
    const rawDevice = manifest.values.execution_device?.trim().toLowerCase();
    const executionDevice: RuntimeExecutionDevice | null =
        rawDevice === 'cpu'
        || rawDevice === 'cuda'
        || rawDevice === 'metal'
        || rawDevice === 'rocm'
        || rawDevice === 'vulkan'
            ? rawDevice
            : null;
    return { accelerator, engine, executionDevice };
}

function managedRuntimeProfileIn(root: string): ManagedRuntimeProfile | undefined {
    try {
        return parseManagedRuntimeProfile(readFileSync(join(root, 'MANIFEST'), 'utf8'));
    } catch {
        return undefined;
    }
}

export function runtimeManifestIsQualified(root: string): boolean {
    return runtimeQualificationError(root) === undefined;
}

/**
 * Explique pourquoi une installation présente est refusée. La résolution du
 * runtime reste fail-closed, mais l'UI ne doit pas confondre un binaire absent
 * avec une ancienne release (ou un candidat de qualification explicite).
 */
export function runtimeQualificationError(root: string): string | undefined {
    try {
        const manifest = readFileSync(join(root, 'MANIFEST'), 'utf8');
        validateRuntimeManifest(manifest, configuredRuntimeContract());
        return undefined;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

function hasNvidia(): boolean {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { spawnSync } = require('child_process');
        const bin = osPlatform() === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi';
        return spawnSync(bin, [], { stdio: 'ignore' }).status === 0;
    } catch {
        return false;
    }
}

/** Détecte os/arch/accel et le nom d'artefact attendu (tag CI exact). */
export function detectPlatform(): PlatformInfo {
    const raw = osPlatform();
    const os: PlatformInfo['os'] = raw === 'win32' ? 'windows' : raw === 'darwin' ? 'darwin' : 'linux';
    const arch: PlatformInfo['arch'] = osArch() === 'arm64' ? 'arm64' : 'x64';
    let accel: Accel;
    if (os === 'darwin') {
        accel = arch === 'arm64' ? 'mlx' : 'cpu';
    } else {
        // Linux ET Windows : NVIDIA → vLLM (cuda). Sinon cpu (pas de contribution).
        accel = (process.env.FABI_ACCEL as Accel) || (hasNvidia() ? 'cuda' : 'cpu');
    }
    const tag = `${os}-${arch}-${accel}`;
    return { os, arch, accel, tag, artifact: `fabi-${tag}.tar.zst` };
}

/** Racine d'install PARTAGÉE avec le CLI (cf. install.sh / install.ps1). */
export function installRoot(): string {
    if (process.env.FABI_INSTALL) {
        return process.env.FABI_INSTALL;
    }
    if (osPlatform() === 'win32') {
        return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'fabi');
    }
    return join(homedir(), '.local', 'share', 'fabi');
}

function runtimePythonIn(
    root: string,
    runtimePlatform: NodeJS.Platform = osPlatform()
): string | undefined {
    const candidate = runtimePlatform === 'win32'
        ? join(root, 'runtime', 'parallax-venv', 'Scripts', 'python.exe')
        : join(root, 'runtime', 'parallax-venv', 'bin', 'python');
    return existsSync(candidate) ? candidate : undefined;
}

/** Commande Parallax relocalisable dans une racine d'installation. */
export function parallaxCommandIn(
    root: string,
    runtimePlatform: NodeJS.Platform = osPlatform()
): RuntimeCommand | undefined {
    const runtimeProfile = managedRuntimeProfileIn(root);
    if (runtimePlatform === 'win32') {
        const python = runtimePythonIn(root, runtimePlatform);
        return python ? {
            binary: python,
            argsPrefix: ['-m', 'parallax.cli'],
            ...(runtimeProfile ? { runtimeProfile } : {})
        } : undefined;
    }
    const entrypoint = join(root, 'runtime', 'parallax-venv', 'bin', 'parallax');
    return existsSync(entrypoint) ? {
        binary: entrypoint,
        argsPrefix: [],
        ...(runtimeProfile ? { runtimeProfile } : {})
    } : undefined;
}

/** Commande du frontend OpenAI local, relocalisable sous Windows. */
export function requestAgentCommandIn(
    root: string,
    runtimePlatform: NodeJS.Platform = osPlatform()
): RuntimeCommand | undefined {
    if (runtimePlatform === 'win32') {
        const python = runtimePythonIn(root, runtimePlatform);
        return python
            ? {
                binary: python,
                argsPrefix: ['-m', 'backend.server.request_agent_frontend']
            }
            : undefined;
    }
    const entrypoint = join(root, 'runtime', 'parallax-venv', 'bin', 'fabi-request-agent');
    return existsSync(entrypoint) ? { binary: entrypoint, argsPrefix: [] } : undefined;
}

/** Compatibilité API : renvoie l'exécutable réel, Python sous Windows. */
export function parallaxBinaryIn(root: string): string | undefined {
    return parallaxCommandIn(root)?.binary;
}

/** Compatibilité API : renvoie l'exécutable réel, Python sous Windows. */
export function requestAgentBinaryIn(root: string): string | undefined {
    return requestAgentCommandIn(root)?.binary;
}

const REQUIRED_MANAGED_RUNTIME_PATHS = [
    'bin', 'runtime', 'MANIFEST', '.fabi-managed-paths'
] as const;
const ALLOWED_MANAGED_RUNTIME_PATHS = new Set([
    ...REQUIRED_MANAGED_RUNTIME_PATHS,
    // Documentation légale livrée par le runtime, sans état ni exécutable.
    'LICENSE',
    'NOTICE'
]);

/** Valide le contrat de mise à jour : aucun état utilisateur ne peut devenir géré. */
export function managedRuntimePathsIn(stagingRoot: string): string[] {
    const manifest = join(stagingRoot, '.fabi-managed-paths');
    if (!existsSync(manifest) || !statSync(manifest).isFile()) {
        throw new Error('manifeste des chemins runtime gérés absent');
    }
    const paths = readFileSync(manifest, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    if (new Set(paths).size !== paths.length) {
        throw new Error('chemins runtime gérés invalides : doublon');
    }
    if (REQUIRED_MANAGED_RUNTIME_PATHS.some(required => !paths.includes(required))) {
        throw new Error(
            `chemins runtime gérés invalides : requis ${REQUIRED_MANAGED_RUNTIME_PATHS.join(', ')}`
        );
    }
    for (const relative of paths) {
        if (
            !ALLOWED_MANAGED_RUNTIME_PATHS.has(relative)
            || isAbsolute(relative)
            || relative === '.'
            || relative === '..'
            || relative.includes('/')
            || relative.includes('\\')
            || !existsSync(join(stagingRoot, relative))
        ) {
            throw new Error(`chemin runtime géré invalide : ${relative}`);
        }
    }
    return paths;
}

/**
 * Conserve uniquement le rollback produit par la dernière activation réussie.
 * Les liens symboliques sont ignorés et les erreurs de nettoyage ne remettent
 * jamais en cause un runtime déjà validé.
 */
export function pruneManagedRuntimeBackups(finalRoot: string, keep: string): string[] {
    const parent = dirname(finalRoot);
    const prefix = `${basename(finalRoot)}.backup-`;
    const kept = resolve(keep);
    const removed: string[] = [];
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith(prefix)) {
            continue;
        }
        const candidate = join(parent, entry.name);
        if (resolve(candidate) === kept) {
            continue;
        }
        try {
            rmSync(candidate, { recursive: true, force: true });
            removed.push(candidate);
        } catch {
            // Une rétention trop longue est préférable à l'échec d'une mise à
            // jour dont le nouveau runtime a déjà passé sa validation.
        }
    }
    return removed;
}

/**
 * Active uniquement les fichiers possédés par une release. Les identités
 * réseau, racines TUF, bases DHT/fencing et journaux locaux restent dans la
 * racine d'installation. Toute faute restaure les anciens chemins gérés.
 */
export async function activateManagedRuntime(
    stagingRoot: string,
    finalRoot: string,
    validate: (root: string) => Promise<void> = validateRuntimeModules
): Promise<string | undefined> {
    const managedPaths = managedRuntimePathsIn(stagingRoot);
    mkdirSync(finalRoot, { recursive: true });
    const backup = `${finalRoot}.backup-${Date.now()}-${process.pid}`;
    mkdirSync(backup, { recursive: true });
    const previous: string[] = [];
    const activated: string[] = [];
    try {
        for (const relative of managedPaths) {
            const current = join(finalRoot, relative);
            if (existsSync(current)) {
                renameSync(current, join(backup, relative));
                previous.push(relative);
            }
        }
        for (const relative of managedPaths) {
            renameSync(join(stagingRoot, relative), join(finalRoot, relative));
            activated.push(relative);
        }
        await validate(finalRoot);
    } catch (error) {
        for (const relative of activated) {
            rmSync(join(finalRoot, relative), { recursive: true, force: true });
        }
        for (const relative of previous) {
            renameSync(join(backup, relative), join(finalRoot, relative));
        }
        rmSync(backup, { recursive: true, force: true });
        throw error;
    }
    if (previous.length === 0) {
        rmSync(backup, { recursive: true, force: true });
        return undefined;
    }
    pruneManagedRuntimeBackups(finalRoot, backup);
    return backup;
}

/** Vérifie les deux modules réellement lancés par le produit après activation. */
async function validateRuntimeModules(root: string): Promise<void> {
    const python = runtimePythonIn(root);
    if (!python) {
        throw new Error('Python du runtime relocalisé absent');
    }
    const source = [
        'from parallax.cli import main as parallax_main',
        'from backend.server.request_agent_frontend import main as request_agent_main'
    ].join('; ');
    await new Promise<void>((resolve, reject) => {
        const child = spawn(python, ['-c', source], {
            stdio: ['ignore', 'ignore', 'pipe'],
            windowsHide: true
        });
        let stderr = '';
        child.stderr?.on('data', chunk => {
            if (stderr.length < 4096) {
                stderr += chunk.toString('utf8');
            }
        });
        child.once('error', reject);
        child.once('close', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(
                    `modules runtime impossibles à importer (code ${code})`
                    + (stderr.trim() ? ` : ${stderr.trim().slice(-2048)}` : '')
                ));
            }
        });
    });
}

/** Chemin du binaire OpenCode/Fabi dans le layout exact d'une release. */
export function fabiCodeBinaryIn(root: string): string | undefined {
    const name = osPlatform() === 'win32' ? 'fabi.exe' : 'fabi';
    const candidate = join(root, 'bin', name);
    return existsSync(candidate) ? candidate : undefined;
}

/** Diagnostic actionnable pour un runtime visible sur disque mais inutilisable. */
export function installedRuntimeProblem(): string | undefined {
    const roots: string[] = [];
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
        roots.push(join(resourcesPath, 'runtime'));
    }
    roots.push(installRoot());

    for (const root of roots) {
        const hasManifest = existsSync(join(root, 'MANIFEST'));
        const parallax = parallaxCommandIn(root);
        const requestAgent = requestAgentCommandIn(root);
        const code = fabiCodeBinaryIn(root);
        if (!hasManifest && !parallax && !requestAgent && !code) {
            continue;
        }
        if (!parallax) {
            return 'runtime incomplet : worker Parallax absent';
        }
        if (!requestAgent) {
            return 'runtime incomplet : Request Agent V3 absent';
        }
        if (!code) {
            return 'runtime incomplet : moteur OpenCode absent';
        }
        const qualificationError = runtimeQualificationError(root);
        if (qualificationError) {
            return `mise à jour du moteur requise : ${qualificationError}`;
        }
    }
    return undefined;
}

/** Localise parallax sans rien télécharger : override env > bundlé > install partagé. */
export function findParallax(): LocatedRuntimeCommand | undefined {
    // Un chemin explicite est un override développeur : il peut pointer vers un
    // checkout local sans MANIFEST de release.
    if (process.env.FABI_RUNTIME_DIR) {
        const command = parallaxCommandIn(process.env.FABI_RUNTIME_DIR);
        if (command) {
            return { ...command, location: 'cached' };
        }
    }
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
        const root = join(resourcesPath, 'runtime');
        const command = parallaxCommandIn(root);
        if (command && runtimeManifestIsQualified(root)) {
            return { ...command, location: 'bundled' };
        }
    }
    const root = installRoot();
    const command = parallaxCommandIn(root);
    return command && runtimeManifestIsQualified(root)
        ? { ...command, location: 'cached' }
        : undefined;
}

/** Localise le Request Agent dans le même runtime qualifié que le worker. */
export function findRequestAgent(): LocatedRuntimeCommand | undefined {
    if (process.env.FABI_RUNTIME_DIR) {
        const command = requestAgentCommandIn(process.env.FABI_RUNTIME_DIR);
        if (command) {
            return { ...command, location: 'cached' };
        }
    }
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
        const root = join(resourcesPath, 'runtime');
        const command = requestAgentCommandIn(root);
        if (command && runtimeManifestIsQualified(root)) {
            return { ...command, location: 'bundled' };
        }
    }
    const root = installRoot();
    const command = requestAgentCommandIn(root);
    return command && runtimeManifestIsQualified(root)
        ? { ...command, location: 'cached' }
        : undefined;
}

// ---------------------------------------------------------------------------
// Résolution de version + téléchargement
// ---------------------------------------------------------------------------

/** Résout le tag immuable du produit (ou sa surcharge labo explicite). */
export async function resolveVersion(): Promise<string> {
    return configuredRuntimeVersion();
}

export interface DownloadRetryPolicy {
    attempts?: number;
    delayMs?: (failedAttempt: number) => number;
}

class NonRetryableDownloadError extends Error {
}

/** GET court avec la même politique bornée que les gros actifs runtime. */
export async function fetchRuntimeMetadata(
    url: string,
    retryPolicy: DownloadRetryPolicy = {},
    fetchImpl: typeof fetch = fetch
): Promise<Response> {
    const attempts = Math.max(1, Math.floor(retryPolicy.attempts ?? 6));
    const delayMs = retryPolicy.delayMs ?? (attempt => Math.min(10_000, attempt * 2_000));
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await fetchImpl(url);
            const transient = response.status === 408
                || response.status === 429
                || response.status >= 500;
            if (!transient || attempt === attempts) {
                return response;
            }
            await response.body?.cancel().catch(() => undefined);
            lastError = new Error(`métadonnée runtime indisponible (${response.status}) : ${url}`);
        } catch (error) {
            lastError = error;
            if (attempt === attempts) {
                break;
            }
        }
        const delay = Math.max(0, Math.floor(delayMs(attempt)));
        if (delay > 0) {
            await new Promise<void>(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Télécharge `url` vers `dest` avec retries bornés et reprise RFC 9110.
 * Une portion n'est réutilisée qu'avec un ETag fort envoyé dans `If-Range`.
 * Sans validateur, ou si le serveur renvoie 200, le fichier est réécrit.
 */
export async function downloadResumable(
    url: string,
    dest: string,
    onBytes: (received: number, total: number) => void,
    retryPolicy: DownloadRetryPolicy = {}
): Promise<void> {
    const attempts = Math.max(1, Math.floor(retryPolicy.attempts ?? 6));
    const delayMs = retryPolicy.delayMs ?? (attempt => Math.min(10_000, attempt * 2_000));
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await downloadAttempt(url, dest, onBytes);
            return;
        } catch (error) {
            lastError = error;
            if (error instanceof NonRetryableDownloadError || attempt === attempts) {
                break;
            }
            const delay = Math.max(0, Math.floor(delayMs(attempt)));
            if (delay > 0) {
                await new Promise<void>(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function downloadAttempt(
    url: string,
    dest: string,
    onBytes: (received: number, total: number) => void
): Promise<void> {
    const partFile = dest + '.part';
    const etagFile = partFile + '.etag';
    let existing = 0;
    if (existsSync(partFile)) {
        try { existing = statSync(partFile).size; } catch { existing = 0; }
    }
    let etag: string | undefined;
    if (existing > 0 && existsSync(etagFile)) {
        try {
            const candidate = readFileSync(etagFile, 'utf8').trim();
            if (candidate && !candidate.startsWith('W/')) {
                etag = candidate;
            }
        } catch {
            etag = undefined;
        }
    }
    // RFC 9110 exige un validateur fort pour If-Range. Sans lui, ne jamais
    // concaténer une ancienne portion avec une représentation potentiellement
    // différente.
    if (existing > 0 && !etag) {
        rmSync(partFile, { force: true });
        existing = 0;
    }
    const headers: Record<string, string> = {};
    if (existing > 0 && etag) {
        headers['Range'] = `bytes=${existing}-`;
        headers['If-Range'] = etag;
    }
    const res = await fetch(url, { headers });
    // 200 = pas de reprise (on repart de zéro) ; 206 = reprise acceptée.
    if (res.status === 200 && existing > 0) {
        existing = 0;
    } else if (res.status !== 200 && res.status !== 206) {
        await res.body?.cancel().catch(() => undefined);
        const ErrorType = res.status >= 400
            && res.status < 500
            && res.status !== 408
            && res.status !== 429
            ? NonRetryableDownloadError
            : Error;
        throw new ErrorType(`téléchargement échoué (${res.status}) : ${url}`);
    }
    if (res.status === 206) {
        const contentRange = res.headers.get('content-range') ?? '';
        if (!contentRange.startsWith(`bytes ${existing}-`)) {
            await res.body?.cancel().catch(() => undefined);
            rmSync(partFile, { force: true });
            rmSync(etagFile, { force: true });
            throw new Error(`Content-Range incohérent pour ${url}`);
        }
    }
    if (!res.body) {
        throw new Error('réponse sans corps : ' + url);
    }
    if (res.status === 200) {
        const responseEtag = res.headers.get('etag')?.trim();
        if (responseEtag && !responseEtag.startsWith('W/')) {
            writeFileSync(etagFile, responseEtag, 'utf8');
        } else {
            rmSync(etagFile, { force: true });
        }
    }
    const lenHeader = Number(res.headers.get('content-length') ?? 0);
    const total = existing + lenHeader;
    let received = existing;
    const out = createWriteStream(partFile, { flags: existing > 0 ? 'a' : 'w' });
    let outputError: Error | undefined;
    out.on('error', error => {
        outputError = error;
    });
    const reader = res.body.getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (outputError) {
                throw outputError;
            }
            if (done) {
                break;
            }
            await writeWithBackpressure(out, Buffer.from(value));
            received += value.length;
            onBytes(received, total);
        }
        if (outputError) {
            throw outputError;
        }
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        out.destroy();
        if (!out.closed) {
            await once(out, 'close').catch(() => undefined);
        }
        throw error;
    }
    const finished = once(out, 'finish');
    try {
        out.end();
        await finished;
    } catch (error) {
        out.destroy();
        throw error;
    }
    renameSync(partFile, dest);
    rmSync(etagFile, { force: true });
}

/**
 * Respecte le contrat Writable de Node : après `write() === false`, attendre
 * `drain` avant de lire le prochain chunk évite de bufferiser une archive de
 * plusieurs Gio en RAM.
 */
export async function writeWithBackpressure(destination: Writable, chunk: Buffer): Promise<void> {
    if (!destination.write(chunk)) {
        await once(destination, 'drain');
    }
}

/** Concatène plusieurs fichiers en un seul (réassemblage des parts). */
async function concatFiles(parts: string[], dest: string): Promise<void> {
    const out = createWriteStream(dest);
    for (const p of parts) {
        await new Promise<void>((resolve, reject) => {
            const inp = createReadStream(p);
            inp.on('error', reject);
            inp.on('end', () => resolve());
            inp.pipe(out, { end: false });
        });
    }
    await new Promise<void>((resolve, reject) => {
        out.end();
        out.on('finish', () => resolve());
        out.on('error', reject);
    });
}

function sha256File(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const s = createReadStream(path);
        s.on('error', reject);
        s.on('data', d => hash.update(d));
        s.on('end', () => resolve(hash.digest('hex')));
    });
}

/** Extraction tar.zst SANS shell (arg arrays) — réplique install.sh/.ps1. */
function extractTarZst(archive: string, destDir: string, zstdBinary: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const run = (cmd: string, args: string[], next: () => void) => {
            const child = spawn(cmd, args, { stdio: 'ignore' });
            child.on('error', reject);
            child.on('close', code => code === 0 ? next() : reject(new Error(`${cmd} a échoué (code ${code})`)));
        };
        const tarPath = archive.replace(/\.zst$/, '');
        run(zstdBinary, ['-q', '-f', '-d', archive, '-o', tarPath], () => {
            run('tar', ['-xf', tarPath, '-C', destDir, '--strip-components=1'], () => {
                try { rmSync(tarPath, { force: true }); } catch { /* ignore */ }
                resolve();
            });
        });
    });
}

/** Relocalise uniquement les fichiers texte déclarés par le build qualifié. */
export function relocateBundledRuntime(extractedRoot: string, finalRoot: string): number {
    const manifestPath = join(extractedRoot, 'runtime', 'relocation-manifest.txt');
    if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
        throw new Error('manifeste de relocalisation runtime absent');
    }

    const entries = readFileSync(manifestPath, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    if (entries.length === 0) {
        throw new Error('manifeste de relocalisation runtime vide');
    }

    for (const relative of entries) {
        const segments = relative.split(/[\\/]/);
        if (
            isAbsolute(relative)
            || segments[0] !== 'runtime'
            || segments.some(segment => !segment || segment === '.' || segment === '..')
        ) {
            throw new Error(`chemin de relocalisation runtime invalide : ${relative}`);
        }
        const file = join(extractedRoot, ...segments);
        if (!existsSync(file) || !statSync(file).isFile()) {
            throw new Error(`fichier de relocalisation runtime absent : ${relative}`);
        }
        const content = readFileSync(file, 'utf8');
        if (!content.includes(RELOCATE_PLACEHOLDER)) {
            throw new Error(`placeholder de relocalisation runtime absent : ${relative}`);
        }
        writeFileSync(file, content.split(RELOCATE_PLACEHOLDER).join(finalRoot), 'utf8');
    }
    return entries.length;
}

/**
 * Installe le runtime de bout en bout (download → vérif → extraction atomique
 * → relocalisation). Idempotent côté appelant (vérifier findParallax() avant).
 * Extraction dans un staging puis rename → jamais d'install à moitié.
 */
export async function installRuntime(onProgress: (p: InstallProgress) => void): Promise<string> {
    const plat = detectPlatform();
    if (plat.accel === 'cpu') {
        throw new Error(
            `Ta machine (${plat.tag}) n'a pas d'accélérateur supporté (Apple Silicon ou NVIDIA) — `
            + 'elle ne peut pas rejoindre le swarm. La contribution nécessite un GPU.'
        );
    }
    const version = await resolveVersion();
    const root = installRoot();
    const base = `https://github.com/${FABI_REPO}/releases/download/${version}`;
    const tarballUrl = `${base}/${plat.artifact}`;

    const work = join(tmpdir(), `fabi-runtime-${process.pid}-${version}`);
    const staging = root + '.staging-' + process.pid;
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    const archive = join(work, plat.artifact);
    const reportDownload = createDownloadProgressReporter(onProgress);

    try {
        // 1. Asset splitté ? (manifeste .parts) → parties + réassemblage.
        reportDownload(0, 'téléchargement du moteur…');
        const partsRes = await fetchRuntimeMetadata(`${tarballUrl}.parts`);
        if (partsRes.ok) {
            const list = (await partsRes.text()).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            const partPaths: string[] = [];
            // Progression globale approximée sur le nombre de parties.
            for (let i = 0; i < list.length; i++) {
                const partPath = join(work, list[i]);
                await downloadResumable(`${base}/${list[i]}`, partPath, (recv, tot) => {
                    const within = tot > 0 ? recv / tot : 0;
                    reportDownload(
                        ((i + within) / list.length) * 100,
                        `partie ${i + 1}/${list.length}`
                    );
                });
                partPaths.push(partPath);
            }
            await concatFiles(partPaths, archive);
            partPaths.forEach(p => { try { rmSync(p, { force: true }); } catch { /* ignore */ } });
        } else {
            await downloadResumable(tarballUrl, archive, (recv, tot) => {
                reportDownload(tot > 0 ? (recv / tot) * 100 : 0);
            });
        }

        // 2. Vérif SHA-256 obligatoire : une release sans somme n'est pas installable.
        onProgress({ phase: 'verify', percent: 100, message: 'vérification de l\'intégrité…' });
        const shaRes = await fetchRuntimeMetadata(`${tarballUrl}.sha256`);
        if (!shaRes.ok) {
            throw new Error(`somme SHA256 absente pour ${plat.artifact} (${shaRes.status})`);
        }
        const expectedSha = (await shaRes.text()).trim().split(/\s+/)[0]?.toLowerCase();
        if (!expectedSha || !/^[0-9a-f]{64}$/.test(expectedSha)) {
            throw new Error(`somme SHA256 invalide pour ${plat.artifact}`);
        }
        const actualSha = (await sha256File(archive)).toLowerCase();
        if (expectedSha !== actualSha) {
            throw new Error(`SHA256 incohérent — fichier corrompu ou altéré (attendu ${expectedSha}, reçu ${actualSha})`);
        }

        // 3. Décompresseur autonome : zstd n'est pas présent sur un macOS neuf
        // et ne doit jamais nécessiter Homebrew/apt/winget. Comme le tarball,
        // ce petit actif est refusé si son sidecar SHA256 manque ou diverge.
        const helperArtifact = zstdHelperArtifactFor(plat);
        const helperUrl = `${base}/${helperArtifact}`;
        const helperPath = join(work, helperArtifact);
        reportDownload(100, 'préparation du décompresseur…');
        await downloadResumable(helperUrl, helperPath, () => undefined);
        const helperShaRes = await fetchRuntimeMetadata(`${helperUrl}.sha256`);
        if (!helperShaRes.ok) {
            throw new Error(`somme SHA256 absente pour ${helperArtifact} (${helperShaRes.status})`);
        }
        const expectedHelperSha = (await helperShaRes.text()).trim().split(/\s+/)[0]?.toLowerCase();
        if (!expectedHelperSha || !/^[0-9a-f]{64}$/.test(expectedHelperSha)) {
            throw new Error(`somme SHA256 invalide pour ${helperArtifact}`);
        }
        const actualHelperSha = (await sha256File(helperPath)).toLowerCase();
        if (expectedHelperSha !== actualHelperSha) {
            throw new Error(
                `SHA256 du décompresseur incohérent (attendu ${expectedHelperSha}, reçu ${actualHelperSha})`
            );
        }
        if (plat.os !== 'windows') {
            chmodSync(helperPath, 0o700);
        }

        // 4. Extraction atomique : staging → rename.
        onProgress({ phase: 'extract', percent: 100, message: 'extraction…' });
        rmSync(staging, { recursive: true, force: true });
        mkdirSync(staging, { recursive: true });
        await extractTarZst(archive, staging, helperPath);

        const binName = osPlatform() === 'win32' ? join('bin', 'fabi.exe') : join('bin', 'fabi');
        if (!existsSync(join(staging, binName))) {
            throw new Error('binaire fabi absent après extraction — tarball invalide');
        }
        const manifestPath = join(staging, 'MANIFEST');
        if (!existsSync(manifestPath)) {
            throw new Error('MANIFEST absent après extraction — tarball invalide');
        }
        validateRuntimeManifest(readFileSync(manifestPath, 'utf8'), {
            ...configuredRuntimeContract(version),
            target: `bun-${plat.os}-${plat.arch}`,
            accel: plat.accel
        });
        relocateBundledRuntime(staging, root);
        if (!parallaxCommandIn(staging)) {
            throw new Error('commande parallax introuvable après extraction — layout inattendu');
        }
        if (!requestAgentCommandIn(staging)) {
            throw new Error('commande fabi-request-agent introuvable après extraction — layout inattendu');
        }

        await activateManagedRuntime(staging, root);

        const bin = parallaxCommandIn(root)!.binary;
        onProgress({ phase: 'done', percent: 100, message: 'moteur prêt' });
        return bin;
    } finally {
        rmSync(staging, { recursive: true, force: true });
        rmSync(work, { recursive: true, force: true });
    }
}
