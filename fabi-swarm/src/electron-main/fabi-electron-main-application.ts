// Launcher de 1er lancement — sous-classe d'ElectronMainApplication.
//
// Theia crée la fenêtre IDE (+ son splash) tôt, dans `showInitialWindow()`
// (appelé par start() sur app.whenReady). On surcharge CE point : si le moteur
// Parallax n'est pas encore installé ET que la machine peut contribuer (GPU),
// on affiche d'abord une petite fenêtre launcher brandée qui télécharge le
// moteur (barre de progression), PUIS on laisse Theia ouvrir l'IDE normalement.
// Sinon (moteur présent, machine sans GPU, ou launcher désactivé) → boot direct.
//
// Le téléchargement réutilise fabi-runtime-install.ts (même logique que le CLI).
// Assets (html + preload) écrits dans un dossier temp au runtime → aucun étape
// de copie au build, comportement identique en dev et packagé.

import { injectable } from '@theia/core/shared/inversify';
import * as electron from '@theia/core/electron-shared/electron';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import { TheiaRendererAPI } from '@theia/core/lib/electron-main/electron-api-main';
import { CancellationTokenSource } from '@theia/core/lib/common/cancellation';
import { timeout } from '@theia/core/lib/common/promise-util';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve as resolvePath } from 'path';
import { detectPlatform, findParallax, installedRuntimeProblem, installRuntime } from '../node/fabi-runtime-install';
import { shouldGateRuntime } from '../common/fabi-runtime-launcher-policy';
import { FABI_FOX_DATA_URI } from './fabi-launcher-logo';
import { FabiMandatoryAppUpdater } from './fabi-mandatory-app-updater';

@injectable()
export class FabiElectronMainApplication extends ElectronMainApplication {

    protected launcherHandled = false;

    /**
     * Backport du correctif déjà présent dans Theia amont : quand le frontend
     * devient prêt, l'annulation du timer maximal est normale et ne doit pas
     * devenir un `unhandledRejection`. À retirer lors de la montée de Theia
     * vers une version qui contient ce changement.
     */
    protected override async configureAndShowSplashScreen(mainWindow: electron.BrowserWindow): Promise<electron.BrowserWindow> {
        const splashScreenOptions = this.getSplashScreenOptions()!;
        const splashScreenBounds = await this.determineSplashScreenBounds(mainWindow.getBounds());
        const splashScreenWindow = new electron.BrowserWindow({
            ...splashScreenBounds,
            frame: false,
            alwaysOnTop: true,
            show: false,
            transparent: true,
            webPreferences: {
                backgroundThrottling: false
            }
        });

        if (this.isShowWindowEarly()) {
            splashScreenWindow.show();
        } else {
            splashScreenWindow.on('ready-to-show', () => splashScreenWindow.show());
        }
        void splashScreenWindow.loadFile(resolvePath(
            this.globals.THEIA_APP_PROJECT_PATH,
            splashScreenOptions.content!
        ));

        const cancelTokenSource = new CancellationTokenSource();
        const minTime = timeout(splashScreenOptions.minDuration ?? 0, cancelTokenSource.token);
        const maxTime = timeout(splashScreenOptions.maxDuration ?? 30_000, cancelTokenSource.token);
        const ignoreExpectedCancellation = () => undefined;
        let settled = false;
        const showWindowAndCloseSplashScreen = () => {
            if (settled) {
                return;
            }
            settled = true;
            cancelTokenSource.cancel();
            if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
                mainWindow.show();
            }
            if (!splashScreenWindow.isDestroyed()) {
                splashScreenWindow.close();
            }
        };
        TheiaRendererAPI.onApplicationStateChanged(mainWindow.webContents, state => {
            if (state === 'ready') {
                minTime.then(showWindowAndCloseSplashScreen, ignoreExpectedCancellation);
            }
        });
        maxTime.then(showWindowAndCloseSplashScreen, ignoreExpectedCancellation);
        return splashScreenWindow;
    }

    protected override showInitialWindow(urlToOpen: string | undefined): void {
        electron.app.whenReady().then(async () => {
            this.applyBranding();
            try {
                // L'application distribuée se met à jour avant de créer la
                // moindre surface IDE/Spaces ou d'installer un nouveau runtime.
                await new FabiMandatoryAppUpdater().run();
            } catch (err) {
                // La découverte des mises à jour est déjà fail-open ; ce filet
                // protège uniquement une erreur d'initialisation inattendue.
                console.error('[fabi-update] initialisation impossible, démarrage conservé :', err);
            }
            if (!await this.ensureQualifiedRuntime()) {
                return;
            }
            // Surface initiale APRÈS le launcher. Point d'extension : une sous-classe
            // (ex. fabi-spaces) peut ici ouvrir une fenêtre-hôte multi-Spaces plutôt
            // que la fenêtre IDE standard.
            await this.openInitialSurface(urlToOpen);
        });
    }

    /**
     * Ne laisse jamais une distribution ouvrir l'IDE avec un moteur incompatible.
     * Même une panne de création de la fenêtre du launcher mène à un choix clair
     * Réessayer/Quitter, et non au panneau technique du runtime.
     */
    protected async ensureQualifiedRuntime(): Promise<boolean> {
        if (this.launcherHandled || !this.shouldRunLauncher()) {
            return true;
        }
        this.launcherHandled = true;
        while (this.shouldRunLauncher()) {
            try {
                await this.runLauncher();
            } catch (error) {
                console.error('[fabi-launcher] initialisation impossible :', error);
                if (!electron.app.isPackaged) {
                    return true;
                }
                const choice = await electron.dialog.showMessageBox({
                    type: 'error',
                    title: 'Fabi ne peut pas préparer son moteur',
                    message: 'La mise à niveau du moteur n’a pas pu démarrer.',
                    detail: 'Vérifie ta connexion, puis réessaie. Aucun composant incompatible ne sera lancé.',
                    buttons: ['Réessayer', 'Quitter'],
                    defaultId: 0,
                    cancelId: 1,
                    noLink: true
                });
                if (choice.response === 1) {
                    electron.app.quit();
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Ouvre la surface initiale de l'app. Par défaut : la fenêtre IDE standard de
     * Theia (+ splash). Surchargeable pour composer une autre UI au-dessus du frontend.
     */
    protected async openInitialSurface(urlToOpen: string | undefined): Promise<void> {
        super.showInitialWindow(urlToOpen);
    }

    /**
     * Force le nom + l'icône Fabi sur le dock/menu, même en DEV (où l'app tourne
     * depuis le binaire Electron générique). En app packagée, electron-builder
     * grave déjà tout dans le bundle — ceci ne fait alors que confirmer.
     */
    protected applyBranding(): void {
        try {
            electron.app.setName('Fabi');
            if (process.platform === 'darwin' && electron.app.dock) {
                const img = electron.nativeImage.createFromDataURL(FABI_FOX_DATA_URI);
                if (!img.isEmpty()) {
                    electron.app.dock.setIcon(img);
                }
            }
        } catch {
            /* best-effort — ne jamais bloquer le boot pour du cosmétique */
        }
    }

    /**
     * En distribution, un runtime absent ou incompatible bloque le démarrage de
     * la surface IA jusqu'à sa mise à niveau. Les flags de contournement restent
     * strictement réservés au développement non packagé.
     */
    protected shouldRunLauncher(): boolean {
        return shouldGateRuntime({
            packaged: electron.app.isPackaged,
            forcedInDevelopment: process.env.FABI_FORCE_LAUNCHER === '1',
            disabledInDevelopment: process.env.FABI_NO_LAUNCHER === '1',
            runtimeQualified: !!findParallax(),
            acceleratorSupported: detectPlatform().accel !== 'cpu'
        });
    }

    /**
     * Affiche la fenêtre launcher et télécharge le moteur. Dans une application
     * distribuée, la gate est obligatoire et offre un vrai retry ; en
     * développement forcé, « continuer sans moteur » reste disponible.
     */
    protected runLauncher(): Promise<void> {
        return new Promise<void>(resolve => {
            const mandatory = electron.app.isPackaged;
            const upgrading = !!installedRuntimeProblem();
            const dir = mkdtempSync(join(tmpdir(), 'fabi-launcher-'));
            const htmlPath = join(dir, 'launcher.html');
            const preloadPath = join(dir, 'preload.js');
            writeFileSync(htmlPath, launcherHtml({ mandatory, upgrading }));
            writeFileSync(preloadPath, PRELOAD_JS);

            const win = new electron.BrowserWindow({
                width: 520,
                height: 360,
                frame: false,
                resizable: false,
                transparent: true,
                alwaysOnTop: true,
                center: true,
                show: false,
                backgroundColor: '#00000000',
                title: 'Fabi',
                webPreferences: {
                    preload: preloadPath,
                    contextIsolation: true,
                    nodeIntegration: false,
                    sandbox: true,
                    backgroundThrottling: false
                }
            });
            win.once('ready-to-show', () => win.show());

            let settled = false;
            let installing = false;
            let allowClose = false;
            const onSkip = () => finish();
            const onRetry = () => { void attemptInstall(); };
            const cleanup = () => {
                electron.ipcMain.removeListener('fabi-launcher:skip', onSkip);
                electron.ipcMain.removeListener('fabi-launcher:retry', onRetry);
                try { win.setProgressBar(-1); } catch { /* ignore */ }
                try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
            };
            const finish = () => {
                if (settled) {
                    return;
                }
                settled = true;
                allowClose = true;
                cleanup();
                if (!win.isDestroyed()) {
                    win.close();
                }
                resolve();
            };
            if (!mandatory) {
                electron.ipcMain.on('fabi-launcher:skip', onSkip);
            }
            electron.ipcMain.on('fabi-launcher:retry', onRetry);
            win.on('close', event => {
                if (mandatory && !allowClose) {
                    event.preventDefault();
                }
            });
            win.on('closed', () => {
                if (!settled) {
                    settled = true;
                    cleanup();
                    resolve();
                }
            });

            const attemptInstall = async () => {
                if (installing || settled) {
                    return;
                }
                installing = true;
                if (!win.isDestroyed()) {
                    win.webContents.send('fabi-launcher:starting');
                }
                try {
                    await installRuntime(p => {
                        if (win.isDestroyed()) {
                            return;
                        }
                        win.webContents.send('fabi-launcher:progress', p);
                        if (p.phase === 'download') {
                            try { win.setProgressBar(Math.max(0, Math.min(1, p.percent / 100))); } catch { /* ignore */ }
                        } else {
                            try { win.setProgressBar(-1); } catch { /* ignore */ }
                        }
                    });
                    if (!win.isDestroyed()) {
                        win.webContents.send('fabi-launcher:done', {});
                    }
                    setTimeout(finish, 1000);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    if (!win.isDestroyed()) {
                        win.webContents.send('fabi-launcher:error', { message });
                    }
                } finally {
                    installing = false;
                }
            };

            // Démarre l'installation dès que la page est chargée. En cas
            // d'échec, le même chemin idempotent est rappelé par le bouton retry.
            win.webContents.once('did-finish-load', () => { void attemptInstall(); });

            win.loadFile(htmlPath);
        });
    }
}

// ---------------------------------------------------------------------------
// Assets du launcher (écrits en temp au runtime). HTML brandé Fabi + preload
// sécurisé (contextBridge, contextIsolation activé).
// ---------------------------------------------------------------------------

const PRELOAD_JS = `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fabi', {
    onProgress: cb => ipcRenderer.on('fabi-launcher:progress', (_e, p) => cb(p)),
    onStarting: cb => ipcRenderer.on('fabi-launcher:starting', () => cb()),
    onDone: cb => ipcRenderer.on('fabi-launcher:done', () => cb()),
    onError: cb => ipcRenderer.on('fabi-launcher:error', (_e, e) => cb(e)),
    skip: () => ipcRenderer.send('fabi-launcher:skip'),
    retry: () => ipcRenderer.send('fabi-launcher:retry')
});
`;

function launcherHtml(options: { mandatory: boolean; upgrading: boolean }): string {
    const title = options.upgrading ? 'Mise à niveau du moteur' : 'Préparation de Fabi';
    const copy = options.upgrading
        ? 'Une version compatible du moteur est requise. Fabi reprend automatiquement le téléchargement.'
        : 'Installation du moteur d’inférence. Cette opération n’a lieu qu’une fois.';
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden;
    font-family: -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-user-select: none; cursor: default; }
  .card {
    -webkit-app-region: drag;
    height: 100%; box-sizing: border-box; border-radius: 18px;
    background: radial-gradient(120% 120% at 50% 0%, #242730 0%, #181a1d 55%, #101114 100%);
    border: 1px solid rgba(255,255,255,0.07);
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    color: #f3ece6; padding: 30px 30px 26px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
  }
  .fox { width: 64px; height: 64px; object-fit: contain; line-height: 1; filter: drop-shadow(0 6px 14px rgba(0,0,0,0.45)); }
  h1 { margin: 14px 0 2px; font-size: 21px; font-weight: 650; letter-spacing: .3px; }
  .sub { font-size: 12.5px; opacity: .62; margin: 0 0 22px; line-height: 1.5; max-width: 360px; }
  .track { width: 320px; height: 8px; border-radius: 9999px; background: rgba(255,255,255,0.08); overflow: hidden; }
  .bar { height: 100%; width: 0%; border-radius: 9999px;
    background: linear-gradient(90deg, #6b7280, #aab0b8); transition: width .3s ease; }
  .status { margin-top: 12px; font-size: 12px; opacity: .8; min-height: 16px; }
  .pct { font-variant-numeric: tabular-nums; font-weight: 700; }
  .actions { -webkit-app-region: no-drag; display: flex; align-items: center; gap: 12px; margin-top: 20px; }
  .retry { display: none; border: 0; border-radius: 8px; padding: 8px 14px; background: #ec5b2b;
    color: #fff; font-size: 11.5px; font-weight: 650; cursor: pointer; }
  .skip { font-size: 11.5px; opacity: .5;
    text-decoration: underline; cursor: pointer; background: none; border: none; color: inherit; }
  .skip:hover { opacity: .85; }
  .err { color: #ff8a8a; }
</style>
</head>
<body>
  <div class="card">
    <img class="fox" src="${FABI_FOX_DATA_URI}" alt="Fabi" />
    <h1>${title}</h1>
    <p class="sub" id="sub">${copy}</p>
    <div class="track"><div class="bar" id="bar"></div></div>
    <div class="status"><span class="pct" id="pct">0%</span> · <span id="phase">démarrage…</span></div>
    <div class="actions">
      <button class="retry" id="retry">Réessayer</button>
      <button class="skip" id="skip"${options.mandatory ? ' hidden' : ''}>Continuer sans le moteur</button>
    </div>
  </div>
<script>
  const bar = document.getElementById('bar');
  const pct = document.getElementById('pct');
  const phase = document.getElementById('phase');
  const sub = document.getElementById('sub');
  const retry = document.getElementById('retry');
  const initialCopy = ${JSON.stringify(copy)};
  const PHASES = { download: 'téléchargement', verify: 'vérification', extract: 'extraction', done: 'prêt' };
  window.fabi.onStarting(() => {
    retry.style.display = 'none';
    phase.className = '';
    phase.textContent = 'connexion…';
    sub.className = 'sub';
    sub.textContent = initialCopy;
  });
  window.fabi.onProgress(p => {
    bar.style.width = (p.percent || 0) + '%';
    pct.textContent = (p.percent || 0) + '%';
    phase.textContent = p.message || PHASES[p.phase] || p.phase;
  });
  window.fabi.onDone(() => {
    bar.style.width = '100%'; pct.textContent = '100%'; phase.textContent = 'prêt 🦦';
    sub.textContent = 'Moteur installé — ouverture de Fabi…';
  });
  window.fabi.onError(e => {
    phase.className = 'err';
    phase.textContent = 'échec';
    sub.className = 'sub err';
    sub.textContent = e && e.message ? e.message : 'erreur';
    retry.style.display = 'inline-flex';
    document.getElementById('skip').textContent = 'Ouvrir Fabi sans IA';
  });
  document.getElementById('skip').addEventListener('click', () => window.fabi.skip());
  retry.addEventListener('click', () => window.fabi.retry());
</script>
</body>
</html>`;
}
