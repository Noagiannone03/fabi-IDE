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
    TOGGLE_SIDEBAR: 'fabi-spaces:toggle-sidebar',
    WINDOW: 'fabi-spaces:window',
    MODAL_OPEN: 'fabi-spaces:modal-open',
    MODAL_FOLDER: 'fabi-spaces:modal-folder',
    MODAL_CREATE: 'fabi-spaces:modal-create',
    MODAL_CANCEL: 'fabi-spaces:modal-cancel',
    MODAL_PICK_FOLDER: 'fabi-spaces:modal-pick-folder'
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
    toggleSidebar: () => ipcRenderer.send(C.TOGGLE_SIDEBAR),
    windowControl: action => ipcRenderer.send(C.WINDOW, action),
    // Modal de création
    onModalOpen: cb => ipcRenderer.on(C.MODAL_OPEN, (_e, init) => cb(init)),
    onModalFolder: cb => ipcRenderer.on(C.MODAL_FOLDER, (_e, folder) => cb(folder)),
    modalCreate: result => ipcRenderer.send(C.MODAL_CREATE, result),
    modalCancel: () => ipcRenderer.send(C.MODAL_CANCEL),
    modalPickFolder: () => ipcRenderer.send(C.MODAL_PICK_FOLDER),
    platform: process.platform
});
