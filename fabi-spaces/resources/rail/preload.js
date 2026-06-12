// Preload du rail (chrome). contextIsolation activé : on n'expose qu'une petite
// surface typée `window.fabiSpaces`, jamais ipcRenderer brut. Les canaux doivent
// rester synchronisés avec src/common/space-types.ts (SpacesIpc).
const { contextBridge, ipcRenderer } = require('electron');

const C = {
    STATE: 'fabi-spaces:state',
    READY: 'fabi-spaces:ready',
    OPEN: 'fabi-spaces:open',
    CREATE: 'fabi-spaces:create',
    CLOSE: 'fabi-spaces:close',
    RENAME: 'fabi-spaces:rename',
    SET_COLOR: 'fabi-spaces:set-color',
    SET_EMOJI: 'fabi-spaces:set-emoji',
    REORDER: 'fabi-spaces:reorder',
    SHOW_OVERVIEW: 'fabi-spaces:show-overview',
    HIDE_OVERVIEW: 'fabi-spaces:hide-overview',
    WINDOW: 'fabi-spaces:window'
};

contextBridge.exposeInMainWorld('fabiSpaces', {
    onState: cb => ipcRenderer.on(C.STATE, (_e, state) => cb(state)),
    ready: () => ipcRenderer.send(C.READY),
    open: id => ipcRenderer.send(C.OPEN, id),
    create: () => ipcRenderer.send(C.CREATE),
    close: id => ipcRenderer.send(C.CLOSE, id),
    rename: (id, name) => ipcRenderer.send(C.RENAME, id, name),
    setColor: (id, color) => ipcRenderer.send(C.SET_COLOR, id, color),
    setEmoji: (id, emoji) => ipcRenderer.send(C.SET_EMOJI, id, emoji),
    reorder: ids => ipcRenderer.send(C.REORDER, ids),
    showOverview: () => ipcRenderer.send(C.SHOW_OVERVIEW),
    hideOverview: () => ipcRenderer.send(C.HIDE_OVERVIEW),
    windowControl: action => ipcRenderer.send(C.WINDOW, action),
    platform: process.platform
});
