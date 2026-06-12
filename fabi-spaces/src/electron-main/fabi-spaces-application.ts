// FabiSpacesApplication — l'application electron-main qui transforme Fabi en
// « Arc des IDE ». Sous-classe de FabiElectronMainApplication (qui apporte déjà
// le launcher de 1er lancement + le branding) : on garde tout ça, et on remplace
// la SURFACE INITIALE par une fenêtre-hôte multi-Spaces (cf. SpaceManager).
//
// Flux :
//   showInitialWindow → (parent) applyBranding + launcher → openInitialSurface (NOUS)
//     openInitialSurface : si Spaces activés → boot du SpaceManager ; sinon/échec → IDE classique.
//   handleMainCommand : neutralisé en mode Spaces (le SpaceManager possède les fenêtres),
//     sauf si le boot a échoué → on laisse le flux classique ouvrir une fenêtre IDE.

import { injectable } from '@theia/core/shared/inversify';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { FabiElectronMainApplication } from 'fabi-swarm/lib/electron-main/fabi-electron-main-application';
import { ElectronMainCommandOptions } from '@theia/core/lib/electron-main/electron-main-application';
import { SpaceManager } from './space-manager';

type SpacesOutcome = 'active' | 'failed';

@injectable()
export class FabiSpacesApplication extends FabiElectronMainApplication {

    protected spaceManager?: SpaceManager;
    protected readonly spacesDecision = new Deferred<SpacesOutcome>();

    /** Spaces actifs sauf si désactivés explicitement par flag (filet de sécurité). */
    protected spacesEnabled(): boolean {
        return process.env.FABI_SPACES !== 'off';
    }

    protected override async openInitialSurface(urlToOpen: string | undefined): Promise<void> {
        if (!this.spacesEnabled()) {
            this.spacesDecision.resolve('failed');
            return super.openInitialSurface(urlToOpen);
        }
        try {
            const port = await this.backendPort;
            // Garantit le cookie de security token sur localhost:port AVANT de charger
            // les frontends embarqués (sinon ils ne peuvent pas joindre le backend).
            await this.attachElectronSecurityToken(port);

            const railDir = this.resolveRailDir();
            this.spaceManager = new SpaceManager({
                appName: this.config.applicationName,
                backendPort: port,
                frontendHtmlPath: this.globals.THEIA_FRONTEND_HTML_PATH,
                preloadPath: resolve(this.globals.THEIA_APP_PROJECT_PATH, 'lib', 'frontend', 'preload.js'),
                railHtmlPath: join(railDir, 'rail.html'),
                topbarHtmlPath: join(railDir, 'topbar.html'),
                modalHtmlPath: join(railDir, 'modal.html'),
                railPreloadPath: join(railDir, 'preload.js')
            });
            await this.spaceManager.boot();
            this.spacesDecision.resolve('active');
        } catch (err) {
            console.error('[fabi-spaces] boot de la fenêtre-hôte échoué → fallback IDE classique :', err);
            this.spacesDecision.resolve('failed');
            // Le flux classique (handleMainCommand) ouvrira une fenêtre IDE standard.
        }
    }

    /**
     * Localise le dossier `resources/rail` de fabi-spaces. Le code electron-main est
     * webpack-bundlé dans electron-app (donc __dirname ≠ fabi-spaces) : on essaie
     * plusieurs emplacements et on garde celui qui contient réellement rail.html.
     */
    protected resolveRailDir(): string {
        const appRoot = this.globals.THEIA_APP_PROJECT_PATH; // = .../electron-app
        const candidates = [
            join(appRoot, '..', 'fabi-spaces', 'resources', 'rail'),          // dev monorepo (sibling)
            join(appRoot, 'node_modules', 'fabi-spaces', 'resources', 'rail'),// dépendance installée
            join(appRoot, 'resources', 'rail'),                               // copié dans l'app (packagé)
            join(__dirname, '..', '..', 'resources', 'rail')                  // co-localisé
        ];
        for (const dir of candidates) {
            if (existsSync(join(dir, 'rail.html'))) {
                return dir;
            }
        }
        console.warn('[fabi-spaces] resources/rail introuvable, candidats :', candidates);
        return candidates[0];
    }

    protected override async handleMainCommand(options: ElectronMainCommandOptions): Promise<void> {
        if (!this.spacesEnabled()) {
            return super.handleMainCommand(options);
        }
        // Attend la décision du boot Spaces pour éviter toute course (ouverture d'une
        // fenêtre IDE parasite pendant que le SpaceManager démarre).
        const outcome = await this.spacesDecision.promise;
        if (outcome === 'active') {
            return; // le SpaceManager possède les fenêtres.
        }
        return super.handleMainCommand(options); // boot échoué → IDE classique.
    }
}
