// Jeton de compte Fabi — identité unique partagée entre le worker (contribution)
// et le client (consommation). La porte de contribution du scheduler
// (FABI_GATE) débloque la consommation tant que ce compte a un worker actif.
//
// Le jeton est généré une seule fois et stocké dans `~/.config/fabi/account-token`
// (même emplacement que le CLI fabi → un seul compte pour le CLI ET l'IDE).
// Ce n'est PAS un secret de haute sécurité : juste un identifiant de compte ;
// il transite uniquement par des canaux chiffrés (TLS vers /v1, RPC lattica
// pour le worker).

import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

let cached: string | undefined;

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
    try {
        if (existsSync(path)) {
            const existing = readFileSync(path, 'utf-8').trim();
            if (existing) {
                cached = existing;
                return cached;
            }
        }
    } catch {
        /* illisible → on régénère */
    }
    const token = randomBytes(32).toString('hex');
    try {
        mkdirSync(join(homedir(), '.config', 'fabi'), { recursive: true });
        writeFileSync(path, token + '\n', { encoding: 'utf-8' });
        try {
            chmodSync(path, 0o600);
        } catch {
            /* chmod best-effort (NTFS/Windows) */
        }
    } catch {
        /* FS non inscriptible → jeton éphémère de session (toujours cohérent
           worker↔client car mis en cache pour le process) */
    }
    cached = token;
    return cached;
}
