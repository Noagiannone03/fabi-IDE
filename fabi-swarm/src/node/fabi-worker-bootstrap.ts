import { createHash, randomUUID } from 'crypto';
import {
    chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
    renameSync, rmSync, statSync, writeSync
} from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import {
    FABI_QUALIFIED_CATALOG_SCHEMA_VERSION,
    FABI_QUALIFIED_MODEL_ROOT_SHA256,
    WorkerConnectionProfile
} from '../common/fabi-swarm-protocol';

const MAX_TUF_ROOT_BYTES = 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export interface PreparedWorkerBootstrap {
    rootPath: string;
    dataRoot: string;
}

export function workerDataRoot(env: NodeJS.ProcessEnv = process.env): string {
    if (process.platform === 'win32') {
        return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'fabi');
    }
    return join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'fabi');
}

/**
 * Validate the registry response and materialize the independently pinned TUF
 * root. The hash advertised by the registry is never sufficient on its own:
 * it must equal the digest compiled into this qualified IDE release.
 */
export async function prepareWorkerBootstrap(
    profile: WorkerConnectionProfile,
    env: NodeJS.ProcessEnv = process.env
): Promise<PreparedWorkerBootstrap> {
    validateWorkerConnectionProfile(profile);
    const expectedRoot = (
        env.FABI_MODEL_REGISTRY_ROOT_SHA256?.trim().toLowerCase()
        || FABI_QUALIFIED_MODEL_ROOT_SHA256
    );
    if (profile.modelRegistry.rootSha256 !== expectedRoot) {
        throw new Error('racine TUF du swarm non qualifiée par cette version de Fabi');
    }

    const dataRoot = workerDataRoot(env);
    const rootPath = join(dataRoot, 'trust', `model-registry-root-${expectedRoot}.json`);
    if (fileHasDigest(rootPath, expectedRoot)) {
        return { rootPath, dataRoot };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    timer.unref?.();
    let bytes: Buffer;
    try {
        const response = await fetch(profile.modelRegistry.rootUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`téléchargement de la racine TUF échoué (HTTP ${response.status})`);
        }
        const declared = Number(response.headers.get('content-length') ?? '0');
        if (Number.isFinite(declared) && declared > MAX_TUF_ROOT_BYTES) {
            throw new Error('racine TUF trop volumineuse');
        }
        bytes = Buffer.from(await response.arrayBuffer());
    } finally {
        clearTimeout(timer);
    }
    if (bytes.length === 0 || bytes.length > MAX_TUF_ROOT_BYTES) {
        throw new Error('taille de racine TUF invalide');
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== expectedRoot) {
        throw new Error(`racine TUF corrompue (SHA-256 ${digest})`);
    }
    validateTufRoot(bytes);
    atomicOwnerOnlyWrite(rootPath, bytes);
    return { rootPath, dataRoot };
}

export function validateWorkerConnectionProfile(profile: WorkerConnectionProfile): void {
    if (!profile || profile.protocolVersion !== 3 || profile.transport !== 'iroh') {
        throw new Error('ce swarm ne publie pas un profil worker V3 Iroh compatible');
    }
    if (profile.catalogSchemaVersion !== FABI_QUALIFIED_CATALOG_SCHEMA_VERSION) {
        throw new Error(
            `catalogue DHT incompatible : schéma=${String(profile.catalogSchemaVersion)}`
            + ` (attendu ${FABI_QUALIFIED_CATALOG_SCHEMA_VERSION}) — mise à jour du moteur requise`
        );
    }
    for (const [name, value] of [
        ['relayUrl', profile.relayUrl],
        ['enrollmentUrl', profile.enrollmentUrl],
        ['rootUrl', profile.modelRegistry?.rootUrl],
        ['metadataUrl', profile.modelRegistry?.metadataUrl],
        ['targetsUrl', profile.modelRegistry?.targetsUrl]
    ] as Array<[string, string | undefined]>) {
        try {
            const parsed = new URL(value ?? '');
            if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
                throw new Error();
            }
        } catch {
            throw new Error(`profil worker invalide : ${name} doit être une URL HTTPS publique`);
        }
    }
    if (!/^[0-9a-f]{64}$/.test(profile.modelRegistry.rootSha256)) {
        throw new Error('profil worker invalide : empreinte de racine TUF');
    }
    if (!Array.isArray(profile.catalogDhtBootstraps) || profile.catalogDhtBootstraps.length === 0
        || profile.catalogDhtBootstraps.some(address => typeof address !== 'string'
            || !address.startsWith('/') || !address.includes('/p2p/'))) {
        throw new Error('profil worker invalide : bootstrap DHT libp2p absent');
    }
}

function fileHasDigest(path: string, expected: string): boolean {
    try {
        const stat = statSync(path);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_TUF_ROOT_BYTES) {
            return false;
        }
        const bytes = readFileSync(path);
        if (createHash('sha256').update(bytes).digest('hex') !== expected) {
            return false;
        }
        validateTufRoot(bytes);
        return true;
    } catch {
        return false;
    }
}

function validateTufRoot(bytes: Buffer): void {
    let document: unknown;
    try {
        document = JSON.parse(bytes.toString('utf8'));
    } catch {
        throw new Error('racine TUF invalide : JSON illisible');
    }
    const root = document as { signed?: { _type?: unknown; version?: unknown }; signatures?: unknown };
    if (root?.signed?._type !== 'root'
        || !Number.isSafeInteger(root.signed.version)
        || !Array.isArray(root.signatures)
        || root.signatures.length === 0) {
        throw new Error('racine TUF invalide : métadonnées root/signatures absentes');
    }
}

function atomicOwnerOnlyWrite(path: string, bytes: Buffer): void {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
        fd = openSync(temporary, 'wx', 0o600);
        writeSync(fd, bytes);
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        if (process.platform === 'win32' && existsSync(path)) {
            rmSync(path, { force: true });
        }
        renameSync(temporary, path);
        try { chmodSync(path, 0o600); } catch { /* NTFS : best-effort */ }
    } finally {
        if (fd !== undefined) {
            try { closeSync(fd); } catch { /* best-effort */ }
        }
        rmSync(temporary, { force: true });
    }
}
