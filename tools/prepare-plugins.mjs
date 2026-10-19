import { readFile, readdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

/** Validate the pinned local extensions and their transitive manifest dependencies. */
export async function checkPlugins(project) {
    const config = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
    if (!config.theiaPlugins || typeof config.theiaPlugins !== 'object' || !Object.keys(config.theiaPlugins).length) throw new Error('Liste des extensions déclarées absente : vérification impossible.');
    const directory = resolve(project, config.theiaPluginsDir || 'plugins');
    const installed = new Map(), issues = [];
    for (const folder of await readdir(directory).catch(() => [])) {
        const root = join(directory, folder, 'extension');
        try {
            const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
            if (manifest.publisher && manifest.name) installed.set(`${manifest.publisher}.${manifest.name}`.toLowerCase(), { manifest, root });
        } catch { /* Missing/incomplete extensions are reported below by their declared id. */ }
    }
    const pending = [];
    const excluded = new Set((config.theiaPluginsExcludeIds || []).map(id => id.toLowerCase()));
    for (const [id, url] of Object.entries(config.theiaPlugins || {})) {
        if (excluded.has(id.toLowerCase())) continue;
        const extension = installed.get(id.toLowerCase());
        // Fabi's manifest pins Open VSX versions; mutable/latest URLs cannot certify a cache.
        let version;
        try {
            const parts = new URL(url).pathname.split('/').filter(Boolean);
            if (parts[0] === 'api' && parts[4] === 'file' && /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(parts[3])) version = parts[3];
        } catch { /* Invalid/unsupported references remain explicit failures. */ }
        if (!version) issues.push(`${id}: URL de version fixe non reconnue`);
        else if (extension && extension.manifest.version !== version) issues.push(`${id}: version ${extension.manifest.version}, attendue ${version}`);
        pending.push(id.toLowerCase());
    }
    const visited = new Set();
    while (pending.length) {
        const id = pending.pop();
        if (visited.has(id) || excluded.has(id)) continue;
        visited.add(id);
        const extension = installed.get(id);
        if (!extension) { issues.push(`${id}: extension absente ou manifeste illisible`); continue; }
        const { manifest, root } = extension;
        for (const entry of [manifest.main, manifest.browser].filter(value => typeof value === 'string')) {
            // Extension entry points may omit the .js suffix (Node resolution).
            if (!(await Promise.all([entry, entry + '.js', join(entry, 'index.js')].map(file => access(resolve(root, file)).then(() => true, () => false)))).some(Boolean)) issues.push(`${id}: point d’entrée absent (${entry})`);
        }
        for (const dependency of [...manifest.extensionDependencies || [], ...manifest.extensionPack || []]) pending.push(dependency.toLowerCase());
    }
    return { issues, count: visited.size };
}

export async function preparePlugins(project, download) {
    let result = await checkPlugins(project);
    if (!result.issues.length) return result;
    console.info('Extensions locales à préparer :\n' + result.issues.join('\n'));
    await download();
    result = await checkPlugins(project);
    if (result.issues.length) throw new Error('Extensions incomplètes après téléchargement :\n' + result.issues.join('\n'));
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const project = fileURLToPath(new URL('../electron-app/', import.meta.url));
    try {
        const result = await preparePlugins(project, () => new Promise((resolveDownload, reject) => {
            const cli = createRequire(import.meta.url).resolve('@theia/cli/bin/theia.js');
            const child = spawn(process.execPath, [cli, 'download:plugins'], { cwd: project, stdio: 'inherit' });
            child.once('error', reject);
            child.once('exit', code => code === 0 ? resolveDownload() : reject(new Error('Téléchargement des extensions interrompu. Corrige la connexion puis relance le packaging.')));
        }));
        console.info(`Extensions vérifiées : ${result.count} présentes, versions déclarées et dépendances disponibles.`);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
