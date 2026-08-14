const FABI_FRONTEND_PATH = /\/(?:app\.asar|electron-app)\/lib\/frontend\/index\.html$/;

/** Distinguishes the real Theia frontend from the Spaces rail and other pages. */
export function isFabiFrontendUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'file:'
            && FABI_FRONTEND_PATH.test(decodeURIComponent(url.pathname));
    } catch {
        return false;
    }
}
