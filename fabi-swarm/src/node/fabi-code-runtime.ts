// Résolution du binaire moteur « fabi-code » (fork d'OpenCode, compilé Bun en
// binaire autonome). Précédence calquée sur findParallax (fabi-runtime-install) :
//   1. override env FABI_CODE_BIN
//   2. runtime qualifié bundlé dans l'app (process.resourcesPath/runtime)
//   3. runtime qualifié partagé avec le CLI (~/.local/share/fabi)
//   4. install OpenCode de l'utilisateur / PATH — DEV uniquement

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
    fabiCodeBinaryIn, installRoot, runtimeManifestIsQualified
} from './fabi-runtime-install';

export interface FabiCodeBinary {
    binary: string;
    location: 'env' | 'bundled' | 'cached' | 'user-opencode' | 'path';
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

    // Un runtime de labo explicitement choisi est autorisé sans manifeste.
    if (process.env.FABI_RUNTIME_DIR) {
        const binary = fabiCodeBinaryIn(process.env.FABI_RUNTIME_DIR);
        if (binary) {
            return { binary, location: 'cached' };
        }
    }

    // 2. Release complète bundlée (Electron : Contents/Resources/runtime).
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
        const root = join(resourcesPath, 'runtime');
        const binary = fabiCodeBinaryIn(root);
        if (binary && runtimeManifestIsQualified(root)) {
            return { binary, location: 'bundled' };
        }
    }

    // 3. Même release immuable que le worker Parallax, installée par l'IDE/CLI.
    const sharedRoot = installRoot();
    const sharedBinary = fabiCodeBinaryIn(sharedRoot);
    if (sharedBinary && runtimeManifestIsQualified(sharedRoot)) {
        return { binary: sharedBinary, location: 'cached' };
    }

    // Une app packagée ne doit jamais exécuter silencieusement un OpenCode non
    // qualifié trouvé sur la machine. L'override reste explicite pour le labo.
    if (resourcesPath && process.env.FABI_ALLOW_SYSTEM_OPENCODE !== '1') {
        return undefined;
    }

    // 4. Replis DEV.
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
