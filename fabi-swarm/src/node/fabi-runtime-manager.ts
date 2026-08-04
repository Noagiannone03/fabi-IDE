// RuntimeManager — fin wrapper au-dessus de fabi-runtime-install (la logique
// canonique, partagée avec le launcher electron-main). Il ne fait que :
//   - exposer le statut (installé ? où ? quelle plateforme/accel ?)
//   - localiser le binaire parallax
//   - déclencher l'install avec remontée de progression
//
// Source unique d'install = fabi-runtime-install.ts (réplique de install.sh).

import {
    configuredRuntimeVersion, detectPlatform, findParallax, findRequestAgent,
    installedRuntimeProblem, installRuntime, InstallProgress, LocatedRuntimeCommand
} from './fabi-runtime-install';
import { RuntimeStatus } from '../common/fabi-swarm-protocol';

export class FabiRuntimeManager {

    private downloading = false;
    private progress = 0;
    private phase: RuntimeStatus['phase'];
    private lastMessage: string | undefined;

    /** Localise le binaire parallax sur la machine (sans rien télécharger). */
    findParallax(): LocatedRuntimeCommand | undefined {
        return findParallax();
    }

    /** Localise le frontend OpenAI local du runtime qualifié. */
    findRequestAgent(): LocatedRuntimeCommand | undefined {
        return findRequestAgent();
    }

    status(): RuntimeStatus {
        const plat = detectPlatform();
        const found = findParallax();
        const requestAgent = findRequestAgent();
        return {
            installed: !!found && !!requestAgent,
            downloading: this.downloading,
            progress: this.downloading ? this.progress : undefined,
            phase: this.downloading ? this.phase : undefined,
            location: found && requestAgent ? found.location : 'none',
            platform: plat.tag,
            accel: plat.accel,
            version: configuredRuntimeVersion(),
            binary: found && requestAgent ? found.binary : undefined,
            message: this.lastMessage ?? (found && requestAgent
                ? undefined
                : installedRuntimeProblem())
        };
    }

    /**
     * Garantit la présence du runtime. Idempotent : si déjà installé, renvoie
     * le statut sans rien faire. `onStatus` est appelé à chaque progression.
     */
    async ensureRuntime(onStatus?: (s: RuntimeStatus) => void): Promise<RuntimeStatus> {
        if (findParallax() && findRequestAgent()) {
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
        } catch (e) {
            this.lastMessage = e instanceof Error ? e.message : String(e);
        } finally {
            this.downloading = false;
        }
        // Snapshot terminal APRES `downloading=false`. Sans ce push, l'UI
        // restait bloquée sur « Installation… » après succès comme après erreur.
        const status = this.status();
        onStatus?.(status);
        return status;
    }
}
