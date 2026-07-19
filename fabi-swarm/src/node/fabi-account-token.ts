// Jeton de compte Fabi — identité unique partagée entre le worker (contribution)
// et le client (consommation). La porte de contribution du scheduler
// (FABI_GATE) débloque la consommation tant que ce compte a un worker actif.
//
// Le jeton est généré une seule fois et stocké dans `~/.config/fabi/account-token`
// (même emplacement que le CLI fabi → un seul compte pour le CLI ET l'IDE).
// C'est une vraie credential bearer : elle ouvre l'admission tant qu'un worker
// du compte contribue. Elle ne doit donc jamais apparaître dans l'UI ou les
// logs et transite uniquement via TLS / le RPC Lattica chiffré.

import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

let cached: string | undefined;
const VALID_TOKEN = /^[0-9a-f]{64}$/i;

function tokenPath(): string {
    return join(homedir(), '.config', 'fabi', 'account-token');
}

/**
 * Renvoie le jeton de compte, en le générant (32 octets hex) au premier appel.
 * Idempotent et mis en cache. Best-effort : si l'écriture échoue (FS en lecture
 * seule…), renvoie quand même un jeton éphémère pour la session.
 */
export function getAccountToken(): string {
    if (cached) {
        return cached;
    }
    const path = tokenPath();
    const fromEnvironment = process.env.FABI_ACCOUNT_TOKEN?.trim();
    if (fromEnvironment) {
        if (!VALID_TOKEN.test(fromEnvironment)) {
            throw new Error('FABI_ACCOUNT_TOKEN doit contenir exactement 32 octets hexadécimaux.');
        }
        cached = fromEnvironment.toLowerCase();
        return cached;
    }
    if (existsSync(path)) {
        try {
            const existing = readFileSync(path, 'utf-8').trim();
            if (VALID_TOKEN.test(existing)) {
                cached = existing.toLowerCase();
                return cached;
            }
            throw new Error(`Credential Fabi invalide dans ${path}; refuse de changer silencieusement d'identité.`);
        } catch (error) {
            throw new Error(`Impossible de lire la credential Fabi ${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const token = randomBytes(32).toString('hex');
    try {
        mkdirSync(join(homedir(), '.config', 'fabi'), { recursive: true, mode: 0o700 });
        writeFileSync(path, token + '\n', { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
        try {
            chmodSync(path, 0o600);
        } catch {
            /* chmod best-effort (NTFS/Windows) */
        }
    } catch (error) {
        // Deux processus peuvent démarrer ensemble. Celui qui perd la création
        // exclusive reprend la credential gagnante au lieu d'inventer une
        // identité éphémère différente pour son worker.
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            const existing = readFileSync(path, 'utf-8').trim();
            if (VALID_TOKEN.test(existing)) {
                cached = existing.toLowerCase();
                return cached;
            }
        }
        /* FS non inscriptible → credential éphémère de session (toujours
           cohérente worker↔client car mise en cache pour le process). */
    }
    cached = token;
    return cached;
}
