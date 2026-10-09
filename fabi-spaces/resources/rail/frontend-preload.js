// Preload des frontends Theia embarqués dans les Spaces.
// En app packagée, node_modules n'est pas présent comme en dev: le preload
// officiel Theia est bundlé dans app.asar/lib/frontend/preload.js.
const path = require('path');

function loadTheiaPreload() {
    const resourcesPath = process.resourcesPath;
    if (resourcesPath) {
        try {
            require(path.join(resourcesPath, 'app.asar', 'lib', 'frontend', 'preload.js'));
            return;
        } catch {
            // Dev / packaging partiel: fallback ci-dessous.
        }
    }
    require('@theia/core/lib/electron-browser/preload').preload();
    require('@theia/filesystem/lib/electron-browser/preload').preload();
}

loadTheiaPreload();

const { contextBridge, ipcRenderer } = require('electron');

const C = {
    CONTEXT: 'fabi-maestro:host-context',
    ATTENTION: 'fabi-spaces:attention',
    ACTIVATE_SELF: 'fabi-spaces:activate-self'
};

contextBridge.exposeInMainWorld('fabiSpaceHost', {
    getContext: () => ipcRenderer.sendSync(C.CONTEXT),
    // Barre Projets : pastille du Space dans la colonne des espaces + retour au Space.
    reportAttention: count => ipcRenderer.send(C.ATTENTION, count),
    activateSelf: () => ipcRenderer.invoke(C.ACTIVATE_SELF)
});
