// Usage: node tools/configure-assist-jarvis.mjs https://POD-8000.proxy.runpod.net/v1
// Uses the existing private inference key. Never accepts a secret on the command line.
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const home = join(homedir(), '.config/fabi/assist');
const file = join(home, 'jarvis-provider.json');
try {
    const url = new URL(process.argv[2]);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        !/^[a-z0-9]+-8000\.proxy\.runpod\.net$/.test(url.hostname) || !/^\/v1\/?$/.test(url.pathname)) {
        throw new Error('Indique l’URL HTTPS /v1 du nouveau pod Jarvis (port 8000).');
    }
    const previous = JSON.parse(await readFile(file, 'utf8'));
    if (!previous.apiKey || !previous.model) { throw new Error('La clé privée d’inférence et le modèle doivent être configurés avant cette étape.'); }
    const baseURL = url.href.replace(/\/$/, '');
    const response = await fetch(`${baseURL}/models`, {
        headers: { Authorization: `Bearer ${previous.apiKey}` }, signal: AbortSignal.timeout(15000), redirect: 'error'
    });
    if (!response.ok) { throw new Error(`Le pod ne valide pas encore l’accès au modèle (HTTP ${response.status}). Configuration conservée.`); }
    const catalog = await response.json();
    if (!catalog.data?.some(item => item.id === previous.model)) { throw new Error('Le modèle Jarvis attendu n’est pas chargé. Configuration conservée.'); }
    const temp = `${file}.${randomUUID()}.tmp`;
    await mkdir(home, { recursive: true, mode: 0o700 });
    try {
        await writeFile(temp, JSON.stringify({ baseURL, model: previous.model, apiKey: previous.apiKey }, null, 2), { mode: 0o600, flag: 'wx' });
        await rename(temp, file);
    } finally { await rm(temp, { force: true }); }
    console.log('GPU Jarvis vérifié et configuré. Dans Fabi Assist : Vérifier le GPU.');
} catch (error) {
    // No server response, credentials, SDK request or cause is ever printed.
    const message = error instanceof Error ? error.message : '';
    console.error(/^(Indique|La clé|Le pod|Le modèle)/.test(message) ? message : 'Configuration impossible. Vérifie le fichier privé, le réseau et le démarrage du GPU.');
    process.exitCode = 1;
}
