// Résolution du binaire moteur « fabi-code » (fork d'OpenCode, compilé Bun en
// binaire autonome). Précédence calquée sur findParallax (fabi-runtime-install) :
//   1. override env FABI_CODE_BIN
//   2. binaire bundlé dans l'app  (process.resourcesPath/runtime)
//   3. install OpenCode de l'utilisateur (~/.opencode/bin/opencode) — DEV
//   4. PATH (`opencode`)  — DEV
//
// Au shipping, on remplace (3)/(4) par notre binaire `fabi-code` bundlé en (2).

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface FabiCodeBinary {
    binary: string;
    location: 'env' | 'bundled' | 'user-opencode' | 'path';
}

const EXE = process.platform === 'win32' ? '.exe' : '';

function isFile(p: string): boolean {
    try {
        return existsSync(p);
    } catch {
        return false;
    }
}

/**
 * Localise le binaire moteur. Retourne `undefined` si introuvable (le service
 * remonte alors un statut 'error' avec un message clair plutôt que de crasher).
 */
export function findFabiCode(): FabiCodeBinary | undefined {
    // 1. Override explicite (debug / CI).
    const override = process.env.FABI_CODE_BIN;
    if (override && isFile(override)) {
        return { binary: override, location: 'env' };
    }

    // 2. Bundlé dans l'app packagée (Electron : Contents/Resources/runtime).
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
        for (const name of [`fabi-code${EXE}`, `opencode${EXE}`]) {
            const bin = join(resourcesPath, 'runtime', name);
            if (isFile(bin)) {
                return { binary: bin, location: 'bundled' };
            }
        }
    }

    // 3. Install OpenCode de l'utilisateur (DEV sur la machine du dev).
    const userBin = join(homedir(), '.opencode', 'bin', `opencode${EXE}`);
    if (isFile(userBin)) {
        return { binary: userBin, location: 'user-opencode' };
    }

    // 4. Sur le PATH (DEV).
    //    On ne résout pas le PATH ici (le spawn s'en charge) ; on tente le nom nu
    //    seulement si rien d'autre n'a été trouvé — le spawn échouera proprement
    //    (ENOENT) si absent, et le service remontera 'missing-binary'.
    return { binary: `opencode${EXE}`, location: 'path' };
}
