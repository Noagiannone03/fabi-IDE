// Construit l'URL du frontend Theia + les webPreferences pour une vue de Space.
//
// Une vue de Space charge EXACTEMENT le même `index.html` qu'une fenêtre Theia
// normale, avec :
//   - `?port=<backendPort>`  → le frontend se connecte au backend partagé
//   - `#<workspacePath>`     → le WorkspaceService ouvre ce dossier (cf.
//                              workspace-service.ts → doGetDefaultWorkspaceUri)
// et les MÊMES webPreferences (preload Theia + contextIsolation…) qu'une fenêtre
// standard — sinon `window.electronTheiaCore` est absent et le frontend ne boote pas.

import type { WebPreferences } from 'electron';
import { FileUri } from '@theia/core/lib/common/file-uri';

export interface FrontendUrlContext {
    /** Chemin FS de l'index.html du frontend (globals.THEIA_FRONTEND_HTML_PATH). */
    frontendHtmlPath: string;
    /** Chemin FS du preload Theia (lib/frontend/preload.js dans le projet app). */
    preloadPath: string;
    /** Port du backend Node partagé. */
    backendPort: number;
}

/**
 * URL à charger dans la WebContentsView d'un Space.
 * @param workspacePath dossier à ouvrir ; vide → Theia restaure le dernier workspace.
 */
export function buildFrontendUrl(ctx: FrontendUrlContext, workspacePath: string): string {
    const uri = FileUri.create(ctx.frontendHtmlPath).withQuery(`port=${ctx.backendPort}`);
    const withWs = workspacePath ? uri.withFragment(encodeURI(workspacePath)) : uri;
    return withWs.toString(true);
}

/** webPreferences d'une vue de Space (copie fidèle de ElectronMainApplication.getDefaultOptions). */
export function spaceWebPreferences(ctx: FrontendUrlContext): WebPreferences {
    return {
        preload: ctx.preloadPath,
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        backgroundThrottling: false,
        enableDeprecatedPaste: true
    } as WebPreferences;
}
