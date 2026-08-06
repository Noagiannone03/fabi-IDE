import {
    chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync,
    readFileSync, realpathSync, renameSync, rmSync, writeSync
} from 'fs';
import { access, opendir, realpath, stat, statfs } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'path';
import { randomUUID } from 'crypto';
import { ModelStorageLocation, ModelStorageSettings } from '../common/fabi-swarm-protocol';
import { workerDataRoot } from './fabi-worker-bootstrap';

const STORAGE_CONFIG_PATH = join(workerDataRoot(), 'config', 'model-storage.json');
const MAX_EXTRA_LOCATIONS = 8;
const MIN_FREE_FLOOR = 1024 ** 3;
const MIN_FREE_CAP = 10 * 1024 ** 3;

interface PersistedModelStorage {
    version: 1;
    extraRoots: string[];
}

export interface ModelStorageEnvironment {
    primaryPath: string;
    extraPaths: string[];
}

/**
 * Persistance locale des volumes explicitement autorisés dans Fabi Desktop.
 *
 * Aucun volume détecté par l'OS n'est inscrit automatiquement. Cela évite
 * d'écrire silencieusement sur une clé USB, un NAS ou un disque chiffré. Un
 * chemin supplémentaire ne peut apparaître qu'après le sélecteur natif.
 */
export class FabiModelStorage {
    protected restartPending = false;

    constructor(
        protected readonly configPath = STORAGE_CONFIG_PATH,
        protected readonly env: NodeJS.ProcessEnv = process.env
    ) { }

    environment(): ModelStorageEnvironment {
        return {
            primaryPath: configuredPrimaryRoot(this.env),
            extraPaths: this.readExtraRoots()
        };
    }

    setRestartPending(value: boolean): void {
        this.restartPending = value;
    }

    isRestartPending(): boolean {
        return this.restartPending;
    }

    async snapshot(): Promise<ModelStorageSettings> {
        const environment = this.environment();
        const locations = await Promise.all([
            this.inspectLocation(environment.primaryPath, 'primary', true),
            ...environment.extraPaths.map(path => this.inspectLocation(path, 'extra', false))
        ]);
        return { locations, workerRestartPending: this.restartPending };
    }

    async addParent(parentPath: string): Promise<ModelStorageSettings> {
        const selected = await validateSelectedDirectory(parentPath);
        const alreadyCacheRoot = basename(selected) === 'model-cache'
            && basename(dirname(selected)) === 'Fabi';
        const target = normalize(alreadyCacheRoot ? selected : join(selected, 'Fabi', 'model-cache'));
        mkdirSync(target, { recursive: true });
        await access(target, constants.R_OK | constants.W_OK);
        const canonicalTarget = await realpath(target);

        const environment = this.environment();
        const existing = [environment.primaryPath, ...environment.extraPaths];
        if (!existing.some(path => samePath(path, canonicalTarget))) {
            if (environment.extraPaths.length >= MAX_EXTRA_LOCATIONS) {
                throw new Error(`Fabi accepte au maximum ${MAX_EXTRA_LOCATIONS} emplacements supplémentaires.`);
            }
            this.writeExtraRoots([...environment.extraPaths, canonicalTarget]);
        }
        return this.snapshot();
    }

    async remove(path: string): Promise<ModelStorageSettings> {
        const environment = this.environment();
        if (samePath(path, environment.primaryPath)) {
            throw new Error("L'emplacement système de Fabi ne peut pas être retiré.");
        }
        const next = environment.extraPaths.filter(item => !samePath(item, path));
        if (next.length === environment.extraPaths.length) {
            throw new Error('Cet emplacement de stockage n’est pas configuré.');
        }
        // Retirer une autorisation ne supprime jamais les poids présents.
        this.writeExtraRoots(next);
        return this.snapshot();
    }

    protected readExtraRoots(): string[] {
        try {
            if (!existsSync(this.configPath)) {
                return [];
            }
            const parsed = JSON.parse(readFileSync(this.configPath, 'utf8')) as Partial<PersistedModelStorage>;
            if (parsed.version !== 1 || !Array.isArray(parsed.extraRoots)) {
                return [];
            }
            const roots: string[] = [];
            for (const raw of parsed.extraRoots.slice(0, MAX_EXTRA_LOCATIONS)) {
                if (typeof raw !== 'string' || !isAbsolute(raw)) {
                    continue;
                }
                const path = normalize(raw);
                if (!roots.some(item => samePath(item, path))) {
                    roots.push(path);
                }
            }
            return roots;
        } catch {
            return [];
        }
    }

    protected writeExtraRoots(extraRoots: string[]): void {
        const payload: PersistedModelStorage = { version: 1, extraRoots };
        atomicOwnerOnlyWrite(this.configPath, Buffer.from(`${JSON.stringify(payload, undefined, 2)}\n`, 'utf8'));
    }

    protected async inspectLocation(
        path: string,
        kind: ModelStorageLocation['kind'],
        allowMissingRoot: boolean
    ): Promise<ModelStorageLocation> {
        let measurementPath = path;
        try {
            const metadata = await stat(path);
            if (!metadata.isDirectory()) {
                throw new Error('le chemin n’est pas un dossier');
            }
        } catch (error) {
            if (!allowMissingRoot) {
                return {
                    path, kind, available: false, writable: false, cacheBytes: 0,
                    message: 'Volume déconnecté ou dossier indisponible.'
                };
            }
            measurementPath = await nearestExistingAncestor(path);
        }

        try {
            await access(measurementPath, constants.R_OK | constants.W_OK);
            const filesystem = await statfs(measurementPath);
            const totalBytes = filesystem.blocks * filesystem.bsize;
            const freeBytes = filesystem.bavail * filesystem.bsize;
            const configured = parseNonNegativeBytes(this.env.FABI_MODEL_CACHE_MIN_FREE_BYTES);
            const minimumFreeBytes = configured
                ?? Math.max(MIN_FREE_FLOOR, Math.min(MIN_FREE_CAP, Math.floor(totalBytes / 50)));
            return {
                path,
                kind,
                available: true,
                writable: true,
                totalBytes,
                freeBytes,
                minimumFreeBytes,
                cacheBytes: await directorySize(path)
            };
        } catch (error) {
            return {
                path, kind, available: true, writable: false,
                cacheBytes: await directorySize(path),
                message: error instanceof Error ? error.message : String(error)
            };
        }
    }
}

export function configuredPrimaryRoot(env: NodeJS.ProcessEnv = process.env): string {
    const configured = env.FABI_MODEL_ARTIFACT_CACHE?.trim();
    return canonicalPath(configured ? resolve(configured) : join(homedir(), '.cache', 'fabi', 'models'));
}

async function validateSelectedDirectory(path: string): Promise<string> {
    if (typeof path !== 'string' || !path.trim() || !isAbsolute(path)) {
        throw new Error('Choisis un dossier local avec un chemin absolu.');
    }
    const canonical = await realpath(path);
    const metadata = await stat(canonical);
    if (!metadata.isDirectory()) {
        throw new Error('L’emplacement choisi n’est pas un dossier.');
    }
    await access(canonical, constants.R_OK | constants.W_OK);
    return canonical;
}

async function nearestExistingAncestor(path: string): Promise<string> {
    let candidate = normalize(path);
    while (true) {
        try {
            const metadata = await stat(candidate);
            if (metadata.isDirectory()) {
                return candidate;
            }
        } catch { /* remonte jusqu'au premier parent présent */ }
        const parent = dirname(candidate);
        if (parent === candidate) {
            throw new Error(`Aucun volume accessible pour ${path}`);
        }
        candidate = parent;
    }
}

async function directorySize(root: string): Promise<number> {
    let total = 0;
    try {
        const directory = await opendir(root);
        for await (const entry of directory) {
            const path = join(root, entry.name);
            if (entry.isDirectory()) {
                total += await directorySize(path);
            } else if (entry.isFile()) {
                try { total += (await stat(path)).size; } catch { /* fichier concurrent */ }
            }
            // Les liens sont ignorés : ils pourraient sortir du cache Fabi.
        }
    } catch { /* absent ou démonté */ }
    return total;
}

function samePath(left: string, right: string): boolean {
    const a = canonicalPath(left);
    const b = canonicalPath(right);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function canonicalPath(path: string): string {
    const absolute = normalize(resolve(path));
    try {
        return normalize(realpathSync.native(absolute));
    } catch {
        return absolute;
    }
}

function parseNonNegativeBytes(raw: string | undefined): number | undefined {
    if (!raw?.trim()) {
        return undefined;
    }
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function atomicOwnerOnlyWrite(path: string, bytes: Buffer): void {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
        descriptor = openSync(temporary, 'wx', 0o600);
        writeSync(descriptor, bytes);
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        if (process.platform === 'win32' && existsSync(path)) {
            rmSync(path, { force: true });
        }
        renameSync(temporary, path);
        try { chmodSync(path, 0o600); } catch { /* NTFS */ }
    } finally {
        if (descriptor !== undefined) {
            try { closeSync(descriptor); } catch { /* best effort */ }
        }
        rmSync(temporary, { force: true });
    }
}
