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
    OPEN_SURFACE: 'fabi-maestro:open-surface',
    PREVIEW_SURFACE: 'fabi-maestro:preview-surface',
    CLEAR_PREVIEW: 'fabi-maestro:clear-preview',
    SEND_TO_SURFACE: 'fabi-maestro:send-to-surface',
    ACTIVATE_SURFACE: 'fabi-maestro:activate-surface',
    WRITE_TERMINAL: 'fabi-maestro:write-terminal'
};

const listen = (channel, callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return { dispose: () => ipcRenderer.off(channel, handler) };
};

contextBridge.exposeInMainWorld('fabiMaestroHost', {
    getContext: () => ipcRenderer.sendSync(C.CONTEXT),
    openSurface: target => ipcRenderer.invoke(C.OPEN_SURFACE, target),
    previewSurface: target => ipcRenderer.invoke(C.PREVIEW_SURFACE, target),
    clearPreview: () => ipcRenderer.invoke(C.CLEAR_PREVIEW),
    sendToSurface: (target, text) => ipcRenderer.invoke(C.SEND_TO_SURFACE, target, text),
    onActivateSurface: callback => listen(C.ACTIVATE_SURFACE, callback),
    onWriteTerminal: callback => listen(C.WRITE_TERMINAL, callback),
    // Mode focus (preview Maestro) : n'afficher que le widget ciblé / tout restaurer.
    onSoloSurface: callback => listen(C.SOLO_SURFACE, callback),
    onClearSolo: callback => listen(C.CLEAR_SOLO, callback)
});
