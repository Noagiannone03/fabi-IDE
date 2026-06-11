// RuntimeManager — fin wrapper au-dessus de fabi-runtime-install (la logique
// canonique, partagée avec le launcher electron-main). Il ne fait que :
//   - exposer le statut (installé ? où ? quelle plateforme/accel ?)
//   - localiser le binaire parallax
//   - déclencher l'install avec remontée de progression
//
// Source unique d'install = fabi-runtime-install.ts (réplique de install.sh).

import {
    detectPlatform, findParallax, installRuntime, InstallProgress
} from './fabi-runtime-install';
import { RuntimeStatus } from '../common/fabi-swarm-protocol';

export class FabiRuntimeManager {

    private downloading = false;
    private progress = 0;
    private phase: RuntimeStatus['phase'];
    private lastMessage: string | undefined;

    /** Localise le binaire parallax sur la machine (sans rien télécharger). */
    findParallax(): { binary: string; location: 'bundled' | 'cached' } | undefined {
        return findParallax();
    }

    status(): RuntimeStatus {
        const plat = detectPlatform();
        const found = findParallax();
        return {
            installed: !!found,
            downloading: this.downloading,
            progress: this.downloading ? this.progress : undefined,
            phase: this.downloading ? this.phase : undefined,
            location: found?.location ?? 'none',
            platform: plat.tag,
            accel: plat.accel,
            version: process.env.FABI_RUNTIME_VERSION || 'latest',
            binary: found?.binary,
            message: this.lastMessage
        };
    }

    /**
     * Garantit la présence du runtime. Idempotent : si déjà installé, renvoie
     * le statut sans rien faire. `onStatus` est appelé à chaque progression.
     */
    async ensureRuntime(onStatus?: (s: RuntimeStatus) => void): Promise<RuntimeStatus> {
        if (findParallax()) {
            return this.status();
        }
        if (this.downloading) {
            return this.status();
        }
        this.downloading = true;
        this.lastMessage = undefined;
        try {
            await installRuntime((p: InstallProgress) => {
                this.progress = p.percent;
                this.phase = p.phase;
                this.lastMessage = p.message;
                onStatus?.(this.status());
            });
            return this.status();
        } catch (e) {
            this.lastMessage = e instanceof Error ? e.message : String(e);
            const s = this.status();
            onStatus?.(s);
            return s;
        } finally {
            this.downloading = false;
        }
    }
}
