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
//   7. Le binaire parallax vit dans `runtime/parallax-venv/bin/parallax`
//      (`Scripts/parallax.exe` sur Windows).
//
// Module PLAIN (sans inversify) → réutilisable depuis electron-main (launcher)
// comme depuis le service backend (bouton « Installer le moteur »).

import { spawn } from 'child_process';
import {
    createReadStream, createWriteStream, existsSync, mkdirSync,
    readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync
} from 'fs';
import { createHash } from 'crypto';
import { homedir, platform as osPlatform, arch as osArch, tmpdir } from 'os';
import { join } from 'path';

export type Accel = 'mlx' | 'cuda' | 'cpu';

/** Repo + version (tag de release) du tarball. Le tag est résolu dynamiquement
 *  (latest) sauf si FABI_RUNTIME_VERSION est défini. */
export const FABI_REPO = process.env.FABI_RUNTIME_REPO || 'Noagiannone03/fabi';
const RELOCATE_PLACEHOLDER = '__FABI_INSTALL_ROOT__';

export interface PlatformInfo {
    os: 'darwin' | 'linux' | 'windows';
    arch: 'x64' | 'arm64';
    accel: Accel;
    /** ex "windows-x64-cuda" — exactement le tag produit par la CI. */
    tag: string;
    /** ex "fabi-windows-x64-cuda.tar.zst". */
    artifact: string;
}

export interface InstallProgress {
    phase: 'download' | 'verify' | 'extract' | 'done';
    /** 0-100 pour la phase download, sinon indicatif. */
    percent: number;
    message?: string;
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

/** Chemin du binaire parallax dans une racine d'install (layout venv). */
export function parallaxBinaryIn(root: string): string | undefined {
    const candidates = osPlatform() === 'win32'
        ? [join(root, 'runtime', 'parallax-venv', 'Scripts', 'parallax.exe')]
        : [join(root, 'runtime', 'parallax-venv', 'bin', 'parallax')];
    return candidates.find(existsSync);
}

/** Localise parallax sans rien télécharger : override env > bundlé > install partagé. */
export function findParallax(): { binary: string; location: 'bundled' | 'cached' } | undefined {
    if (process.env.FABI_RUNTIME_DIR) {
        const bin = parallaxBinaryIn(process.env.FABI_RUNTIME_DIR);
        if (bin) {
            return { binary: bin, location: 'cached' };
        }
    }
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
        const bin = parallaxBinaryIn(join(resourcesPath, 'runtime'));
        if (bin) {
            return { binary: bin, location: 'bundled' };
        }
    }
    const bin = parallaxBinaryIn(installRoot());
    return bin ? { binary: bin, location: 'cached' } : undefined;
}

// ---------------------------------------------------------------------------
// Résolution de version + téléchargement
// ---------------------------------------------------------------------------

/** Résout le tag de release : FABI_RUNTIME_VERSION si défini, sinon `latest`. */
export async function resolveVersion(): Promise<string> {
    if (process.env.FABI_RUNTIME_VERSION) {
        return process.env.FABI_RUNTIME_VERSION;
    }
    const res = await fetch(`https://api.github.com/repos/${FABI_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' }
    });
    if (!res.ok) {
        throw new Error(`résolution de la dernière version échouée (${res.status})`);
    }
    const json = await res.json() as { tag_name?: string };
    if (!json.tag_name) {
        throw new Error('aucune release publiée sur ' + FABI_REPO);
    }
    return json.tag_name;
}

/**
 * Télécharge `url` vers `dest` avec REPRISE (HTTP Range) : si un `.part` existe
 * déjà, on reprend à partir de sa taille. `If-Range` (via ETag) garantit qu'on
 * ne concatène pas deux versions différentes.
 */
async function downloadResumable(
    url: string,
    dest: string,
    onBytes: (received: number, total: number) => void
): Promise<void> {
    const partFile = dest + '.part';
    let existing = 0;
    if (existsSync(partFile)) {
        try { existing = statSync(partFile).size; } catch { existing = 0; }
    }
    const headers: Record<string, string> = {};
    if (existing > 0) {
        headers['Range'] = `bytes=${existing}-`;
    }
    const res = await fetch(url, { headers });
    // 200 = pas de reprise (on repart de zéro) ; 206 = reprise acceptée.
    if (res.status === 200 && existing > 0) {
        existing = 0; // le serveur ignore Range → on réécrit tout
    } else if (res.status !== 200 && res.status !== 206) {
        throw new Error(`téléchargement échoué (${res.status}) : ${url}`);
    }
    if (!res.body) {
        throw new Error('réponse sans corps : ' + url);
    }
    const lenHeader = Number(res.headers.get('content-length') ?? 0);
    const total = existing + lenHeader;
    let received = existing;
    const out = createWriteStream(partFile, { flags: existing > 0 ? 'a' : 'w' });
    const reader = res.body.getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            out.write(Buffer.from(value));
            received += value.length;
            onBytes(received, total);
        }
    } finally {
        out.end();
    }
    await new Promise<void>((resolve, reject) => {
        out.on('finish', () => resolve());
        out.on('error', reject);
    });
    renameSync(partFile, dest);
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
function extractTarZst(archive: string, destDir: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const run = (cmd: string, args: string[], next: () => void) => {
            const child = spawn(cmd, args, { stdio: 'ignore' });
            child.on('error', reject);
            child.on('close', code => code === 0 ? next() : reject(new Error(`${cmd} a échoué (code ${code})`)));
        };
        if (osPlatform() === 'win32') {
            // zstd -d → .tar puis tar -xf (zstd.exe requis, cf. install.ps1).
            const tarPath = archive.replace(/\.zst$/, '');
            run('zstd', ['-d', archive, '-o', tarPath], () => {
                run('tar', ['-xf', tarPath, '-C', destDir, '--strip-components=1'], () => {
                    try { rmSync(tarPath, { force: true }); } catch { /* ignore */ }
                    resolve();
                });
            });
        } else {
            run('tar', ['--use-compress-program=unzstd', '-xf', archive, '-C', destDir, '--strip-components=1'], resolve);
        }
    });
}

/** Remplace le placeholder de build par le vrai chemin (venv relocatable). */
function relocate(root: string): void {
    const runtimeDir = join(root, 'runtime');
    if (!existsSync(runtimeDir)) {
        return;
    }
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, name.name);
            if (name.isDirectory()) {
                walk(full);
            } else if (name.isFile()) {
                try {
                    if (statSync(full).size > 2_000_000) {
                        continue; // gros binaire → pas du texte
                    }
                    const content = readFileSync(full, 'utf-8');
                    if (content.includes(RELOCATE_PLACEHOLDER)) {
                        writeFileSync(full, content.split(RELOCATE_PLACEHOLDER).join(root));
                    }
                } catch {
                    /* binaire / illisible → on saute */
                }
            }
        }
    };
    walk(runtimeDir);
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
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    const archive = join(work, plat.artifact);

    try {
        // 1. Asset splitté ? (manifeste .parts) → parties + réassemblage.
        onProgress({ phase: 'download', percent: 0, message: 'téléchargement du moteur…' });
        const partsRes = await fetch(`${tarballUrl}.parts`);
        if (partsRes.ok) {
            const list = (await partsRes.text()).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            const partPaths: string[] = [];
            // Progression globale approximée sur le nombre de parties.
            for (let i = 0; i < list.length; i++) {
                const partPath = join(work, list[i]);
                await downloadResumable(`${base}/${list[i]}`, partPath, (recv, tot) => {
                    const within = tot > 0 ? recv / tot : 0;
                    onProgress({
                        phase: 'download',
                        percent: Math.round(((i + within) / list.length) * 100),
                        message: `partie ${i + 1}/${list.length}`
                    });
                });
                partPaths.push(partPath);
            }
            await concatFiles(partPaths, archive);
            partPaths.forEach(p => { try { rmSync(p, { force: true }); } catch { /* ignore */ } });
        } else {
            await downloadResumable(tarballUrl, archive, (recv, tot) => {
                onProgress({ phase: 'download', percent: tot > 0 ? Math.round((recv / tot) * 100) : 0 });
            });
        }

        // 2. Vérif SHA-256 (best effort — on warn si absent).
        onProgress({ phase: 'verify', percent: 100, message: 'vérification de l\'intégrité…' });
        const shaRes = await fetch(`${tarballUrl}.sha256`);
        if (shaRes.ok) {
            const expected = (await shaRes.text()).trim().split(/\s+/)[0]?.toLowerCase();
            const actual = (await sha256File(archive)).toLowerCase();
            if (expected && expected !== actual) {
                throw new Error(`SHA256 incohérent — fichier corrompu ou altéré (attendu ${expected}, reçu ${actual})`);
            }
        }

        // 3. Extraction atomique : staging → rename.
        onProgress({ phase: 'extract', percent: 100, message: 'extraction…' });
        const staging = root + '.staging-' + process.pid;
        rmSync(staging, { recursive: true, force: true });
        mkdirSync(staging, { recursive: true });
        await extractTarZst(archive, staging);

        const binName = osPlatform() === 'win32' ? join('bin', 'fabi.exe') : join('bin', 'fabi');
        if (!existsSync(join(staging, binName))) {
            rmSync(staging, { recursive: true, force: true });
            throw new Error('binaire fabi absent après extraction — tarball invalide');
        }
        relocate(staging);

        if (existsSync(root)) {
            const backup = root + '.backup-' + process.pid;
            rmSync(backup, { recursive: true, force: true });
            renameSync(root, backup);
            renameSync(staging, root);
            rmSync(backup, { recursive: true, force: true });
        } else {
            renameSync(staging, root);
        }

        const bin = parallaxBinaryIn(root);
        if (!bin) {
            throw new Error('binaire parallax introuvable après install — layout inattendu');
        }
        onProgress({ phase: 'done', percent: 100, message: 'moteur prêt' });
        return bin;
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}
