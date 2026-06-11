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
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectPlatform, findParallax, installRuntime } from '../node/fabi-runtime-install';
import { FABI_FOX_DATA_URI } from './fabi-launcher-logo';

@injectable()
export class FabiElectronMainApplication extends ElectronMainApplication {

    protected launcherHandled = false;

    protected override showInitialWindow(urlToOpen: string | undefined): void {
        electron.app.whenReady().then(async () => {
            this.applyBranding();
            try {
                if (!this.launcherHandled && this.shouldRunLauncher()) {
                    this.launcherHandled = true;
                    await this.runLauncher();
                }
            } catch (err) {
                console.error('[fabi-launcher] erreur (on ouvre l\'IDE quand même) :', err);
            }
            // Boot normal de Theia (fenêtre IDE + splash).
            super.showInitialWindow(urlToOpen);
        });
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

    /** Lance le launcher ? Non si désactivé, en dev, déjà installé, ou machine non éligible. */
    protected shouldRunLauncher(): boolean {
        if (process.env.FABI_NO_LAUNCHER) {
            return false;
        }
        // Uniquement dans l'app packagée et distribuée — jamais en dev (`theia
        // start`), pour ne pas popper à chaque lancement pendant le développement.
        // FABI_FORCE_LAUNCHER permet de le tester volontairement en dev.
        if (!electron.app.isPackaged && !process.env.FABI_FORCE_LAUNCHER) {
            return false;
        }
        if (findParallax()) {
            return false; // moteur déjà présent → rien à faire
        }
        if (detectPlatform().accel === 'cpu') {
            return false; // pas de GPU supporté → l'IDE s'ouvre, le panel expliquera
        }
        return true;
    }

    /**
     * Affiche la fenêtre launcher, télécharge le moteur, se ferme une fois prêt
     * (ou si l'utilisateur choisit de continuer sans). Résout toujours — un
     * échec n'empêche jamais l'IDE de s'ouvrir.
     */
    protected runLauncher(): Promise<void> {
        return new Promise<void>(resolve => {
            const dir = mkdtempSync(join(tmpdir(), 'fabi-launcher-'));
            const htmlPath = join(dir, 'launcher.html');
            const preloadPath = join(dir, 'preload.js');
            writeFileSync(htmlPath, LAUNCHER_HTML);
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
                    backgroundThrottling: false
                }
            });
            win.once('ready-to-show', () => win.show());

            let settled = false;
            const onSkip = () => finish();
            const cleanup = () => {
                electron.ipcMain.removeListener('fabi-launcher:skip', onSkip);
                try { win.setProgressBar(-1); } catch { /* ignore */ }
                try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
            };
            const finish = () => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                if (!win.isDestroyed()) {
                    win.close();
                }
                resolve();
            };
            electron.ipcMain.on('fabi-launcher:skip', onSkip);
            // Fenêtre fermée par l'utilisateur (croix OS) → on continue sans moteur.
            win.on('closed', () => {
                if (!settled) {
                    settled = true;
                    cleanup();
                    resolve();
                }
            });

            // Démarre l'install dès que la page est chargée.
            win.webContents.once('did-finish-load', async () => {
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
                    // On laisse la fenêtre ouverte : l'utilisateur lit l'erreur et
                    // peut « continuer sans le moteur » (skip) pour entrer dans l'IDE.
                }
            });

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
    onDone: cb => ipcRenderer.on('fabi-launcher:done', () => cb()),
    onError: cb => ipcRenderer.on('fabi-launcher:error', (_e, e) => cb(e)),
    skip: () => ipcRenderer.send('fabi-launcher:skip')
});
`;

const LAUNCHER_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden;
    font-family: -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-user-select: none; cursor: default; }
  .card {
    -webkit-app-region: drag;
    height: 100%; box-sizing: border-box; border-radius: 18px;
    background: radial-gradient(120% 120% at 50% 0%, #2a1d18 0%, #1b1410 55%, #140f0c 100%);
    border: 1px solid rgba(255,255,255,0.07);
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    color: #f3ece6; padding: 30px 30px 26px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
  }
  .fox { width: 64px; height: 64px; object-fit: contain; line-height: 1; filter: drop-shadow(0 6px 14px rgba(236,91,43,0.45)); }
  h1 { margin: 14px 0 2px; font-size: 21px; font-weight: 650; letter-spacing: .3px; }
  .sub { font-size: 12.5px; opacity: .62; margin: 0 0 22px; line-height: 1.5; max-width: 360px; }
  .track { width: 320px; height: 8px; border-radius: 9999px; background: rgba(255,255,255,0.08); overflow: hidden; }
  .bar { height: 100%; width: 0%; border-radius: 9999px;
    background: linear-gradient(90deg, #EC5B2B, #FF7A4F); transition: width .3s ease; }
  .status { margin-top: 12px; font-size: 12px; opacity: .8; min-height: 16px; }
  .pct { font-variant-numeric: tabular-nums; font-weight: 700; }
  .skip { -webkit-app-region: no-drag; margin-top: 20px; font-size: 11.5px; opacity: .5;
    text-decoration: underline; cursor: pointer; background: none; border: none; color: inherit; }
  .skip:hover { opacity: .85; }
  .err { color: #ff8a8a; }
</style>
</head>
<body>
  <div class="card">
    <img class="fox" src="${FABI_FOX_DATA_URI}" alt="Fabi" />
    <h1>Préparation de Fabi</h1>
    <p class="sub" id="sub">Installation du moteur d'inférence (une seule fois). Aucune action requise.</p>
    <div class="track"><div class="bar" id="bar"></div></div>
    <div class="status"><span class="pct" id="pct">0%</span> · <span id="phase">démarrage…</span></div>
    <button class="skip" id="skip">Continuer sans le moteur</button>
  </div>
<script>
  const bar = document.getElementById('bar');
  const pct = document.getElementById('pct');
  const phase = document.getElementById('phase');
  const sub = document.getElementById('sub');
  const PHASES = { download: 'téléchargement', verify: 'vérification', extract: 'extraction', done: 'prêt' };
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
    phase.innerHTML = '<span class="err">échec</span>';
    sub.innerHTML = '<span class="err">' + (e && e.message ? e.message : 'erreur') + '</span>';
    document.getElementById('skip').textContent = 'Ouvrir Fabi quand même';
  });
  document.getElementById('skip').addEventListener('click', () => window.fabi.skip());
</script>
</body>
</html>`;
