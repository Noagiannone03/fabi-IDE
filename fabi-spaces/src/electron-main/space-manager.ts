// SpaceManager — le compositor « Arc des IDE ».
//
// Possède UNE fenêtre-hôte (BaseWindow, sans contenu propre) qui composite des
// WebContentsView natives :
//   - railView  : notre chrome (le rail de Spaces), bande verticale à gauche, toujours au-dessus.
//   - une WebContentsView par Space « vivant » : un frontend Theia complet pointé sur son
//     workspace. Une seule est visible à la fois (setVisible) → switch instantané, zéro reload.
//
// Theia se croit dans une fenêtre normale (même index.html, même preload, même backend).
// Les features « fenêtre » de Theia no-op sur une vue embarquée (optional chaining sur
// BrowserWindow.fromWebContents) → le boot ne casse pas ; on route ce qui compte (reload,
// contrôles fenêtre) explicitement ci-dessous.

import { app, BaseWindow, WebContentsView, dialog, ipcMain, screen, Rectangle, IpcMainEvent } from 'electron';
import { basename, join, dirname } from 'path';
import { CHANNEL_REQUEST_RELOAD, CHANNEL_FOCUS_WINDOW } from '@theia/core/lib/electron-common/electron-api';
import {
    SpaceDescriptor, SpacesState, SpacesIpc, SPACE_COLORS,
    NewSpaceModalInit, NewSpaceModalResult
} from '../common/space-types';
import { MaestroHostIpc } from 'fabi-swarm/lib/common/fabi-maestro-protocol';
import { SpaceStore } from './space-store';
import { parseRemoteSpace } from '../common/remote-space';
import { playSpaceTransition } from '../common/space-transition';
import { FrontendUrlContext, buildFrontendUrl, buildRemoteFrontendUrl, spaceWebPreferences } from './frontend-url';
import { attachNativeView, reattachNativeView } from './native-view-layout';

/** Largeur du rail au repos (colonne d'icônes d'espaces), en px CSS. */
const RAIL_COLLAPSED = 52;  // Narrow, connected Space tabs; no desktop thumbnails.
/** Hauteur de la barre de titre du haut (déplaçable + traffic-lights). */
const TITLEBAR_HEIGHT = process.platform === 'darwin' ? 32 : 0;
/**
 * Les WebContentsView sont compositées séparément par Chromium. Sur les écrans
 * Retina, deux rectangles strictement adjacents peuvent laisser apparaître une
 * ligne subpixel pendant un resize ou un changement d'échelle.
 *
 * Le chrome est toujours remis au-dessus de l'IDE dans `layout()`. On le fait donc
 * recouvrir l'IDE d'un pixel CSS au lieu de juxtaposer trois surfaces indépendantes.
 */
const CHROME_OVERLAP = 1;
/**
 * Nombre max de frontends Theia gardés VIVANTS en même temps. Au-delà, le Space le
 * moins récemment utilisé est suspendu (détruit → rechargé au retour, façon onglet
 * endormi). Réglé haut par défaut → en usage normal (quelques espaces) AUCUN reload
 * au switch, tout reste chargé. Baisser via `FABI_SPACES_MAX_LIVE` si RAM limitée.
 */
const MAX_LIVE = Math.max(1, Number(process.env.FABI_SPACES_MAX_LIVE) || 8);

export interface SpaceManagerOptions extends FrontendUrlContext {
    appName: string;
    /** Chemin FS du rail.html (la sidebar d'espaces). */
    railHtmlPath: string;
    /** Chemin FS des onglets verticaux de Spaces. */
    tabStripHtmlPath: string;
    /** Chemin FS du modal.html (popup de création de Space). */
    modalHtmlPath: string;
    /** Chemin FS du preload partagé (rail + onglets + modal). */
    railPreloadPath: string;
}

export class SpaceManager {

    protected readonly store = new SpaceStore();
    protected host!: BaseWindow;
    protected railView!: WebContentsView;
    protected tabStripView!: WebContentsView;
    protected titlebarView?: WebContentsView;
    protected readonly ipcCleanup: (() => void)[] = [];
    protected cancelModal?: () => void;
    /** Modal de création (popup centré), présent uniquement pendant la création. */
    protected modalView: WebContentsView | undefined;
    /** Vues matérialisées (frontends vivants), par id de Space. */
    protected readonly views = new Map<string, WebContentsView>();
    /** Chargement + validation du viewport natif de chaque vue. */
    protected readonly viewReady = new WeakMap<WebContentsView, Promise<void>>();
    protected readonly remotePorts = new Map<string, number>();
    protected activeId: string | undefined;
    /** Le rail est-il déplié (survol) ? Sa largeur en dépend ; il overlay l'IDE sans le pousser. */
    protected railExpanded = false;
    protected disposed = false;

    constructor(protected readonly opts: SpaceManagerOptions) { }

    // ----------------------------------------------------------------------
    // Boot
    // ----------------------------------------------------------------------

    async boot(): Promise<void> {
        console.log('[fabi-spaces] boot: début (port', this.opts.backendPort, ')');
        this.seedIfEmpty();
        this.createHost();
        console.log('[fabi-spaces] boot: host créé');
        const chromeReady = this.createChrome();
        // Observe both branches immediately, including an early frontend failure.
        const initialLoads: Promise<void>[] = [chromeReady];
        console.log('[fabi-spaces] boot: chrome créé →', this.opts.railHtmlPath);
        this.registerIpc();

        // Space à afficher en premier : le dernier actif s'il existe, sinon le premier.
        const lastActive = this.store.getActiveId();
        const first = (lastActive && this.store.get(lastActive))
            ? lastActive
            : this.store.getSpaces()[0]?.id;
        if (first) {
            console.log('[fabi-spaces] boot: ouverture du Space', first);
            initialLoads.push(this.open(first));
        }
        await Promise.all(initialLoads);
        if (this.disposed) { return; }
        // Chromium can defer renderer work until a native window is visible.
        // Set native bounds before showing, then verify without gating startup.
        this.layout();
        this.host.show();
        for (const view of [this.railView, this.tabStripView, this.titlebarView, ...this.views.values()]) {
            if (view) { void this.ensureViewport(view, view.getBounds(), 'boot')
                .catch(error => console.warn('[fabi-spaces] viewport :', error)); }
        }
        // Focusing a WebContentsView while its host is hidden does not reliably
        // give Chromium an active surface on macOS. Restore focus after show so
        // the first workspace can finish its animation-frame-based startup.
        if (this.activeId) {
            this.views.get(this.activeId)?.webContents.focus();
        }
        console.log('[fabi-spaces] boot: fenêtre-hôte affichée ✅');
    }

    /** Premier lancement : un Space par défaut qui restaure le workspace précédent de l'utilisateur. */
    protected seedIfEmpty(): void {
        if (this.store.getSpaces().length === 0) {
            this.store.add({
                id: this.newId(),
                name: '',                 // dérivé du dossier (ou « Espace » si vierge)
                emoji: '',
                color: SPACE_COLORS[0],
                workspacePath: '',        // vide → Theia restaure le dernier workspace
                lastActive: Date.now()
            });
        }
    }

    protected createHost(): void {
        const mac = process.platform === 'darwin';
        const { width, height } = this.defaultSize();
        this.host = new BaseWindow({
            width,
            height,
            minWidth: 640,
            minHeight: 400,
            title: this.opts.appName,
            backgroundColor: '#191a1e',
            show: false,
            ...(mac
                ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 13, y: 11 } }
                : { frame: true })
        });
        this.host.center();
        this.host.on('resize', () => this.layout());
        this.host.on('closed', () => {
            if (this.disposed) { return; }
            this.dispose();
            app.quit();
        });
    }

    /** Crée une WebContentsView de chrome (topbar/rail) avec le preload partagé. */
    protected chromeView(): WebContentsView {
        const view = new WebContentsView({
            webPreferences: {
                preload: this.opts.railPreloadPath,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                backgroundThrottling: false
            }
        });
        view.setBackgroundColor('#00000000');
        return view;
    }

    protected createChrome(): Promise<void> {
        // Sidebar d'espaces (gauche) + barre de titre (haut) : deux vues de chrome.
        this.railView = this.chromeView();
        this.railView.setBackgroundColor('#00000000');
        this.tabStripView = this.chromeView();
        this.tabStripView.setBackgroundColor('#191a1e');

        const { width: W, height: H } = this.contentBounds();
        const railReady = this.loadView(
            this.railView,
            this.railBounds(W, H),
            'rail',
            () => this.railView.webContents.loadFile(this.opts.railHtmlPath)
        );
        const tabsReady = this.loadView(
            this.tabStripView,
            this.tabStripBounds(W, H),
            'tab-strip',
            () => this.tabStripView.webContents.loadFile(this.opts.tabStripHtmlPath)
        );
        const loads = [railReady, tabsReady];
        // The vertical tabs are not a title bar. Give the macOS title area its
        // own sandboxed surface: no preload, IPC, buttons or manual mouse loop.
        if (TITLEBAR_HEIGHT) {
            const titlebar = new WebContentsView({ webPreferences: {
                sandbox: true, contextIsolation: true, nodeIntegration: false
            } });
            this.titlebarView = titlebar;
            titlebar.setBackgroundColor('#191a1e');
            loads.push(this.loadView(titlebar, { x: 0, y: 0, width: W, height: TITLEBAR_HEIGHT },
                'titlebar', () => titlebar.webContents.loadFile(join(dirname(this.opts.tabStripHtmlPath), 'titlebar.html'))));
        }
        return Promise.all(loads).then(() => {
            this.railView.setVisible(this.railExpanded);
        });
    }

    /**
     * Attache et charge une WebContentsView, puis vérifie le contrat entre les
     * bounds Views et le viewport Chromium avant que la fenêtre soit montrée.
     *
     * Electron expose officiellement removeChildView/addChildView pour déplacer ou
     * réordonner une vue existante. Sur macOS, une création pendant le démarrage du
     * backend peut exceptionnellement conserver la surface initiale 800x600 alors
     * que getBounds() est déjà correct. Le détachement/rattachement n'est effectué
     * que si cette divergence est effectivement mesurée, à la fin du chargement —
     * aucun timer ni resize artificiel.
     */
    protected loadView(
        view: WebContentsView,
        bounds: Rectangle,
        name: string,
        load: () => Promise<void>
    ): Promise<void> {
        attachNativeView(this.host.contentView, view, bounds);
        const ready = load().then(() => this.ensureViewport(view, view.getBounds(), name));
        // Callers still await the original promise. Attach a rejection observer
        // now because another view may be loading before they reach their await.
        void ready.catch(() => undefined);
        this.viewReady.set(view, ready);
        return ready;
    }

    protected async ensureViewport(view: WebContentsView, bounds: Rectangle, name: string): Promise<void> {
        if (this.disposed || !this.host.isVisible() || view.webContents.isDestroyed() || !view.getVisible()) {
            return;
        }
        const viewport = await view.webContents.executeJavaScript(
            '({ width: window.innerWidth, height: window.innerHeight, hidden: document.hidden })',
            true
        ) as { width: number; height: number; hidden: boolean };
        // The renderer may have answered after another Space became active.
        if (viewport.hidden || this.disposed || view.webContents.isDestroyed() || !view.getVisible()) { return; }
        bounds = view.getBounds();
        if (viewport.width === bounds.width && viewport.height === bounds.height) {
            return;
        }
        console.warn(
            `[fabi-spaces] viewport ${name} désynchronisé ` +
            `${viewport.width}x${viewport.height} (attendu ${bounds.width}x${bounds.height}) — rattachement natif`
        );
        reattachNativeView(this.host.contentView, view, bounds);
        view.webContents.invalidate();

        const repaired = await view.webContents.executeJavaScript(
            '({ width: window.innerWidth, height: window.innerHeight })',
            true
        ) as { width: number; height: number };
        if (repaired.width !== bounds.width || repaired.height !== bounds.height) {
            throw new Error(
                `viewport ${name} invalide après rattachement: ` +
                `${repaired.width}x${repaired.height}, attendu ${bounds.width}x${bounds.height}`
            );
        }
    }

    // ----------------------------------------------------------------------
    // Layout / compositing
    // ----------------------------------------------------------------------

    protected contentBounds(): Rectangle {
        const [w, h] = this.host.getContentSize();
        return { x: 0, y: 0, width: w, height: h };
    }

    protected spaceBounds(W: number, H: number): Rectangle {
        const railW = RAIL_COLLAPSED;
        const x = Math.min(W, Math.max(0, railW - CHROME_OVERLAP));
        const y = Math.min(H, Math.max(0, TITLEBAR_HEIGHT - CHROME_OVERLAP));
        return {
            x, y,
            width: Math.max(0, W - x),
            height: Math.max(0, H - y)
        };
    }

    protected railBounds(W: number, H: number): Rectangle {
        return { x: 0, y: TITLEBAR_HEIGHT, width: W, height: Math.max(1, H - TITLEBAR_HEIGHT) };
    }

    protected tabStripBounds(W: number, H: number): Rectangle {
        return { x: 0, y: TITLEBAR_HEIGHT, width: Math.min(RAIL_COLLAPSED, W), height: Math.max(1, H - TITLEBAR_HEIGHT) };
    }

    /**
     * Organisation des Spaces :
     *  - barre de titre macOS dédiée en haut (déplaçable + traffic-lights) ;
     *  - gestion des espaces à gauche, uniquement sur demande ;
     *  - l'IDE actif occupe toute la largeur disponible lorsque la gestion est fermée.
     * z-order (bas → haut) : IDE, onglets, gestion des espaces, titre, modal.
     */
    protected layout(): void {
        if (this.disposed) {
            return;
        }
        const { width: W, height: H } = this.contentBounds();

        // L'IDE passe d'un pixel sous le chrome. Ce recouvrement est volontaire :
        // il évite les coutures de compositing entre WebContentsView sans introduire
        // de marge visuelle ni modifier la largeur utile du contenu.
        const spaceRect = this.spaceBounds(W, H);
        for (const view of this.views.values()) {
            view.setBounds(spaceRect);
        }

        // Gestion des Spaces : vue native masquée quand le panneau est fermé.
        this.railView.setBounds(this.railBounds(W, H));
        this.host.contentView.addChildView(this.railView);
        this.railView.setVisible(this.railExpanded);

        // Onglets verticaux : colonne de gauche, sous la barre de titre.
        this.host.contentView.addChildView(this.tabStripView);
        this.tabStripView.setBounds(this.tabStripBounds(W, H));

        if (this.railExpanded) { this.host.contentView.addChildView(this.railView); }

        if (this.titlebarView) {
            attachNativeView(this.host.contentView, this.titlebarView,
                { x: 0, y: 0, width: W, height: TITLEBAR_HEIGHT });
        }

        // Modal de création : plein écran, AU-DESSUS de tout.
        if (this.modalView && !this.modalView.webContents.isDestroyed()) {
            this.modalView.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width: W, height: Math.max(1, H - TITLEBAR_HEIGHT) });
            this.host.contentView.addChildView(this.modalView);
        }
    }

    // ----------------------------------------------------------------------
    // Matérialisation des Spaces (vues)
    // ----------------------------------------------------------------------

    /** Crée (ou retrouve) la WebContentsView d'un Space et charge son frontend Theia. */
    protected ensureView(id: string): WebContentsView {
        const existing = this.views.get(id);
        if (existing) {
            return existing;
        }
        const space = this.store.get(id)!;
        const view = new WebContentsView({ webPreferences: spaceWebPreferences(this.opts) });
        view.setBackgroundColor('#191a1e');
        view.setVisible(false);
        const { width, height } = this.contentBounds();
        // Même invariant que le chrome : dimensionner avant l'attachement afin que
        // le renderer soit créé avec le viewport réellement visible.
        view.setBounds(this.spaceBounds(width, height));
        this.views.set(id, view);
        this.wireSpaceWebContents(id, view);
        this.loadView(
            view,
            this.spaceBounds(width, height),
            `space:${id}`,
            () => view.webContents.loadURL(space.remote && this.remotePorts.has(id)
                ? buildRemoteFrontendUrl(this.opts, space.workspacePath, this.remotePorts.get(id)!)
                : buildFrontendUrl(this.opts, space.remote ? '!empty' : space.workspacePath))
        );
        return view;
    }

    /** Shims par-vue : reload routé sur CETTE vue + teinte d'accent injectée dans l'IDE. */
    protected wireSpaceWebContents(id: string, view: WebContentsView): void {
        const wc = view.webContents;
        const onReload = (event: IpcMainEvent, newUrl?: unknown) => {
            if (event.sender.id !== wc.id) {
                return;
            }
            if (typeof newUrl === 'string' && newUrl) {
                const target = new URL(newUrl);
                const bundled = new URL(buildFrontendUrl(this.opts, ''));
                if (target.protocol !== bundled.protocol || target.pathname !== bundled.pathname) { return; }
                const space = this.store.get(id);
                if (space?.remote && !target.searchParams.has('localPort')) {
                    // Disconnect returns to this Space's connection screen, never a local folder with the same path.
                    const disconnected = new URL(buildFrontendUrl(this.opts, '!empty'));
                    disconnected.searchParams.set('disconnected', '1');
                    void wc.loadURL(disconnected.toString());
                    return;
                }
                if (target.hash && target.hash !== '#!empty') {
                    this.store.update(id, { workspacePath: decodeURI(target.hash.slice(1)) });
                }
                void wc.loadURL(newUrl).catch(error => console.error('[fabi-spaces] reload:', error));
            } else {
                wc.reload();
            }
        };
        ipcMain.on(CHANNEL_REQUEST_RELOAD, onReload);
        wc.once('destroyed', () => ipcMain.removeListener(CHANNEL_REQUEST_RELOAD, onReload));
        const onFocus = (event: IpcMainEvent, windowName?: string) => {
            if (event.sender.id !== wc.id || windowName || this.activeId !== id || this.disposed) { return; }
            if (this.host.isMinimized()) { this.host.restore(); }
            this.host.focus();
            wc.focus();
        };
        ipcMain.on(CHANNEL_FOCUS_WINDOW, onFocus);
        wc.once('destroyed', () => ipcMain.removeListener(CHANNEL_FOCUS_WINDOW, onFocus));

        // À chaque (re)chargement du frontend Theia, on (re)pose la couleur de l'espace
        // sur :root → le CSS « îlots » s'en sert pour teinter l'IDE (effet « relié »).
        wc.on('dom-ready', () => this.applyAccent(id));
    }

    /** Pose `--fabi-space-accent` (la couleur du Space) sur le :root du frontend Theia. */
    protected applyAccent(id: string): void {
        const view = this.views.get(id);
        const color = this.store.get(id)?.color;
        if (!view || !color || view.webContents.isDestroyed() || view.webContents.isLoading()) {
            return;
        }
        const css = JSON.stringify(color);
        view.webContents
            .executeJavaScript(`document.documentElement.style.setProperty('--fabi-space-accent', ${css});`, true)
            .catch(() => { /* le frontend n'est pas prêt : dom-ready réessaiera */ });
    }

    // ----------------------------------------------------------------------
    // Actions
    // ----------------------------------------------------------------------

    protected openSequence = 0;

    /** Affiche un Space sans attendre sa capture ni bloquer les clics suivants. */
    async open(id: string): Promise<void> {
        if (this.disposed || !this.store.get(id)) {
            return;
        }
        const sequence = ++this.openSequence;
        const previousId = this.activeId;
        const activeView = this.ensureView(id);
        try { await this.viewReady.get(activeView); }
        catch (error) {
            if (this.views.get(id) === activeView) { this.destroyView(id); }
            throw error;
        }
        // A Space may have been removed or suspended while its renderer loaded.
        // Never activate a stale view, even if no newer open request was made.
        if (sequence !== this.openSequence || this.disposed || !this.store.get(id)
            || this.views.get(id) !== activeView || activeView.webContents.isDestroyed()) { return; }
        this.activeId = id;
        this.railExpanded = false;
        this.store.setActive(id);

        // Visibilité : seule la vue active est visible.
        for (const [vid, v] of this.views) {
            v.setVisible(vid === id);
        }
        this.layout();
        this.applyAccent(id);
        activeView.webContents.focus();
        this.enforceSuspension();
        this.pushState();

        // Selection is committed above in one main-process turn. Renderer work
        // is cosmetic/diagnostic and must never delay navigation or its IPC state.
        void this.ensureViewport(activeView, activeView.getBounds(), `space:${id}`)
            .catch(error => console.warn('[fabi-spaces] viewport :', error));
        if (previousId && previousId !== id) {
            const ids = this.store.getSpaces().map(space => space.id);
            const direction = ids.indexOf(id) >= ids.indexOf(previousId) ? 1 : -1;
            void activeView.webContents.executeJavaScript(`(${playSpaceTransition.toString()})(${direction})`)
                .catch(error => console.warn('[fabi-spaces] animation :', error));
        }
    }

    protected creatingSpace = false;

    /** One creation flow at a time, including the native folder picker. */
    async create(): Promise<void> {
        if (this.creatingSpace || this.disposed) { return; }
        this.creatingSpace = true;
        try { await this.createSpace(); }
        finally { this.creatingSpace = false; }
    }

    /** Crée un nouveau Space : choix du dossier (OS) → popup de config → création. */
    protected async createSpace(): Promise<void> {
        const config = await this.promptNewSpace('');
        if (!config || this.disposed) {
            return; // popup annulé
        }
        if (config.connection === 'ssh') {
            const active = this.activeId && this.views.get(this.activeId);
            if (active && !active.webContents.isDestroyed()) {
                active.webContents.send('fabi-spaces:connect-request');
            }
            return;
        }
        const space: SpaceDescriptor = {
            id: this.newId(),
            name: config.name,
            emoji: config.icon,
            color: config.color,
            workspacePath: config.dir,
            lastActive: Date.now()
        };
        this.store.add(space);
        await this.open(space.id);
    }

    /**
     * Affiche le popup de création (vue modale plein écran centrée) et résout avec la
     * config choisie (nom/icône/couleur/dossier) ou `undefined` si annulé.
     */
    protected promptNewSpace(dir: string): Promise<(NewSpaceModalResult & { dir: string }) | undefined> {
        return new Promise(resolve => {
            let currentDir = dir;
            let settled = false;
            const view = new WebContentsView({
                webPreferences: {
                    preload: this.opts.railPreloadPath,
                    contextIsolation: true,
                    nodeIntegration: false,
                    sandbox: false,
                    backgroundThrottling: false
                }
            });
            view.setBackgroundColor('#00000000');
            const { width, height } = this.contentBounds();
            view.setBounds({ x: 0, y: 0, width, height });
            this.modalView = view;
            const wc = view.webContents;

            const finish = (result: (NewSpaceModalResult & { dir: string }) | undefined): void => {
                if (settled) {
                    return;
                }
                settled = true;
                ipcMain.removeListener(SpacesIpc.MODAL_CREATE, onCreate);
                ipcMain.removeListener(SpacesIpc.MODAL_CANCEL, onCancel);
                ipcMain.removeListener(SpacesIpc.MODAL_PICK_FOLDER, onPick);
                this.modalView = undefined;
                this.cancelModal = undefined;
                try { this.host.contentView.removeChildView(view); } catch { /* déjà détaché */ }
                if (!wc.isDestroyed()) {
                    wc.close();
                }
                this.layout();
                if (!this.disposed && this.activeId) { this.views.get(this.activeId)?.webContents.focus(); }
                resolve(result);
            };

            const onCreate = (e: IpcMainEvent, data: NewSpaceModalResult): void => {
                if (e.sender.id !== wc.id || !data) { return; }
                if (data.connection === 'ssh') {
                    finish({ connection: 'ssh', name: '', icon: 'remote', color: this.nextColor(), dir: '' });
                    return;
                }
                if (typeof data.name !== 'string' || !data.name.trim() || !currentDir) { return; }
                finish({ name: data.name.trim().slice(0, 100), icon: typeof data.icon === 'string' ? data.icon : '',
                    color: this.nextColor(), dir: currentDir });
            };
            const onCancel = (e: IpcMainEvent): void => {
                if (e.sender.id === wc.id) { finish(undefined); }
            };
            const onPick = (e: IpcMainEvent): void => {
                if (e.sender.id !== wc.id) {
                    return;
                }
                void this.pickFolder().then(d => {
                    if (d && !settled && !this.disposed) {
                        currentDir = d;
                        if (!wc.isDestroyed()) {
                            wc.send(SpacesIpc.MODAL_FOLDER, d);
                        }
                    }
                });
            };

            this.cancelModal = () => finish(undefined);
            wc.once('destroyed', this.cancelModal);
            ipcMain.on(SpacesIpc.MODAL_CREATE, onCreate);
            ipcMain.on(SpacesIpc.MODAL_CANCEL, onCancel);
            ipcMain.on(SpacesIpc.MODAL_PICK_FOLDER, onPick);

            wc.once('did-finish-load', () => {
                if (settled || this.disposed) { return; }
                const init: NewSpaceModalInit = { folder: currentDir, defaultName: basename(currentDir), color: this.nextColor() };
                wc.send(SpacesIpc.MODAL_OPEN, init);
                wc.focus();
            });

            this.host.contentView.addChildView(view);
            this.layout();
            void wc.loadFile(this.opts.modalHtmlPath).catch(error => {
                console.error('[fabi-spaces] chargement du dialogue échoué :', error);
                finish(undefined);
            });
        });
    }

    /** Détache et détruit la vue d'un Space (sans toucher au descripteur persistant). */
    protected destroyView(id: string): void {
        const view = this.views.get(id);
        if (!view) {
            return;
        }
        this.views.delete(id);
        this.remotePorts.delete(id);
        try {
            this.host.contentView.removeChildView(view);
        } catch { /* déjà détaché */ }
        if (!view.webContents.isDestroyed()) {
            // Release the SSH transport before tearing down its local RPC client.
            const close = () => { if (!view.webContents.isDestroyed()) { view.webContents.close(); } };
            if (new URL(view.webContents.getURL() || 'about:blank').searchParams.has('localPort')) {
                view.setVisible(false);
                const deadline = setTimeout(close, 1500);
                void view.webContents.executeJavaScript('window.fabiDisconnectRemote?.()')
                    .catch(() => undefined).finally(() => { clearTimeout(deadline); close(); });
            } else { close(); }
        }
    }

    /** Ferme/supprime un Space. Bascule sur un autre (ou en recrée un) si c'était l'actif. */
    async close(id: string): Promise<void> {
        this.destroyView(id);
        const wasActive = this.activeId === id;
        this.store.remove(id);
        this.setAttention(id, 0);

        // On garantit toujours au moins un espace de travail.
        this.seedIfEmpty();
        if (wasActive) {
            this.activeId = undefined;
            const next = this.store.getSpaces()[0]?.id;
            if (next) {
                await this.open(next);
                return;
            }
        }
        this.pushState();
    }

    /** Suspend un Space (détruit la vue, garde le descripteur). Jamais l'actif. */
    suspend(id: string): void {
        if (id === this.activeId) {
            return;
        }
        this.destroyView(id);
        this.pushState();
    }

    rename(id: string, name: string): void {
        this.store.update(id, { name });
        this.pushState();
    }

    setColor(id: string, color: string): void {
        this.store.update(id, { color });
        this.applyAccent(id);
        this.pushState();
    }

    setEmoji(id: string, emoji: string): void {
        this.store.update(id, { emoji });
        this.pushState();
    }

    reorder(orderedIds: string[]): void {
        this.store.reorder(orderedIds);
        this.pushState();
    }

    /** Déplie/replie le rail (toggle ; overlay sur l'IDE, sans le pousser). */
    setExpanded(expanded: boolean): void {
        if (this.railExpanded === expanded) {
            return;
        }
        this.railExpanded = expanded;
        this.layout();
        this.pushState();
        const target = expanded ? this.railView : this.tabStripView;
        target.webContents.focus();
        void target.webContents.executeJavaScript(`document.querySelector('button')?.focus()`).catch(() => {});
    }

    windowControl(action: 'minimize' | 'maximize' | 'close'): void {
        switch (action) {
            case 'minimize': this.host.minimize(); break;
            case 'maximize': this.host.isMaximized() ? this.host.unmaximize() : this.host.maximize(); break;
            case 'close': this.host.close(); break;
        }
    }

    // ----------------------------------------------------------------------
    // Suspension (RAM) — garde au plus MAX_LIVE frontends vivants.
    // ----------------------------------------------------------------------

    protected enforceSuspension(): void {
        if (this.views.size <= MAX_LIVE) {
            return;
        }
        // Candidats = vivants sauf l'actif.
        const candidates = [...this.views.keys()]
            .filter(id => id !== this.activeId)
            .map(id => ({ id, lastActive: this.store.get(id)?.lastActive ?? 0 }))
            .sort((a, b) => a.lastActive - b.lastActive);
        while (this.views.size > MAX_LIVE && candidates.length) {
            this.suspend(candidates.shift()!.id);
        }
    }

    // ----------------------------------------------------------------------
    // IPC rail ⇄ main
    // ----------------------------------------------------------------------

    protected registerIpc(): void {
        const on = (channel: string, listener: Parameters<typeof ipcMain.on>[1]): void => {
            const guarded: typeof listener = (event, ...args) => {
                if (this.disposed) { return; }
                try {
                    Promise.resolve(listener(event, ...args)).catch(error =>
                        console.error(`[fabi-spaces] ${channel}:`, error));
                } catch (error) { console.error(`[fabi-spaces] ${channel}:`, error); }
            };
            ipcMain.on(channel, guarded);
            this.ipcCleanup.push(() => ipcMain.removeListener(channel, guarded));
        };
        const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void => {
            ipcMain.handle(channel, async (event, ...args) => {
                if (this.disposed) { return false; }
                try { return await listener(event, ...args); }
                catch (error) { console.error(`[fabi-spaces] ${channel}:`, error); return false; }
            });
            this.ipcCleanup.push(() => ipcMain.removeHandler(channel));
        };
        const fromRail = (event: IpcMainEvent) => event.sender.id === this.railView.webContents.id;
        const fromChrome = (event: IpcMainEvent) =>
            event.sender.id === this.railView.webContents.id || event.sender.id === this.tabStripView.webContents.id;

        on(SpacesIpc.READY, e => { if (fromChrome(e)) { this.pushState(); } });
        on(SpacesIpc.OPEN, (e, id: string) => { if (fromChrome(e)) { return this.open(id); } });
        on(SpacesIpc.CREATE, e => { if (fromChrome(e)) { return this.create(); } });
        on(SpacesIpc.CLOSE, (e, id: string) => { if (fromRail(e)) { return this.close(id); } });
        on(SpacesIpc.RENAME, (e, id: string, name: string) => { if (fromRail(e)) { this.rename(id, name); } });
        on(SpacesIpc.SET_COLOR, (e, id: string, color: string) => { if (fromRail(e)) { this.setColor(id, color); } });
        on(SpacesIpc.SET_EMOJI, (e, id: string, emoji: string) => { if (fromRail(e)) { this.setEmoji(id, emoji); } });
        on(SpacesIpc.REORDER, (e, ids: string[]) => {
            if (fromChrome(e) && Array.isArray(ids) && ids.every(id => typeof id === 'string')) { this.reorder(ids); }
        });
        on('fabi-spaces:context-menu', (e, id: unknown, y: unknown) => {
            if (!fromChrome(e) || typeof id !== 'string') { return; }
            const space = this.store.get(id);
            if (!space) { return; }
            this.setExpanded(true);
            this.railView.webContents.send('fabi-spaces:edit', {
                ...space, menu: true, y: typeof y === 'number' && Number.isFinite(y) ? y : 12
            });
        });
        on('fabi-spaces:dismiss-menu', e => {
            if (fromRail(e)) {
                this.setExpanded(false);
                if (this.activeId) { this.views.get(this.activeId)?.webContents.focus(); }
            }
        });
        // Le toggle peut venir du rail OU de la topbar.
        on(SpacesIpc.TOGGLE_SIDEBAR, e => { if (fromChrome(e)) { this.setExpanded(!this.railExpanded); } });
        // La topbar ET le rail peuvent piloter la fenêtre (boutons Win/Linux, double-clic).
        on(SpacesIpc.WINDOW, (e, action) => { if (fromChrome(e)) { this.windowControl(action); } });

        // Barre Projets d'un Space : nombre d'agents à regarder (pastille du rail).
        // Un Space suspendu garde sa dernière valeur jusqu'à ce qu'on y revienne.
        on(SpacesIpc.ATTENTION, (e, count: unknown) => {
            const id = this.spaceIdOf(e.sender.id);
            if (id && typeof count === 'number' && Number.isFinite(count)) {
                this.setAttention(id, count);
            }
        });
        handle(SpacesIpc.ACTIVATE_SELF, async e => {
            const id = this.spaceIdOf(e.sender.id);
            if (!id) {
                return false;
            }
            if (this.host.isMinimized()) {
                this.host.restore();
            }
            this.host.focus();
            await this.open(id);
            return true;
        });

        handle('fabi-spaces:remote-create', async (e, identity: unknown, port: unknown) => {
            if (!this.spaceIdOf(e.sender.id)) { return false; }
            const remote = parseRemoteSpace(identity);
            if (!remote || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535
                || port === this.opts.backendPort) { return false; }
            const id = this.newId();
            this.store.add({ id, remote, name: remote.host, emoji: 'remote', color: this.nextColor(),
                workspacePath: '', lastActive: Date.now() });
            this.remotePorts.set(id, port);
            await this.open(id);
            return true;
        });
        on('fabi-spaces:workspace-changed', (e, path: unknown) => {
            const id = this.spaceIdOf(e.sender.id);
            const space = id && this.store.get(id);
            if (!id || !space || typeof path !== 'string' || !path.startsWith('/') || /[\0\r\n]/.test(path)) { return; }
            const connected = new URL(e.sender.getURL()).searchParams.has('localPort');
            if (!!space.remote !== connected) { return; }
            this.store.update(id, { workspacePath: path });
            this.pushState();
        });
        handle('fabi-spaces:remote-workspace', (e, path: unknown) => {
            const id = this.spaceIdOf(e.sender.id);
            const space = id ? this.store.get(id) : undefined;
            if (!id || !space?.remote || typeof path !== 'string' || !path.startsWith('/')
                || /[\0\r\n]/.test(path) || !new URL(e.sender.getURL()).searchParams.has('localPort')) { return false; }
            this.store.update(id, { workspacePath: path });
            this.pushState();
            return true;
        });
        handle('fabi-spaces:remote-context', e => {
            const id = this.spaceIdOf(e.sender.id);
            const space = id ? this.store.get(id) : undefined;
            return space?.remote ? { ...space.remote, workspacePath: space.workspacePath } : undefined;
        });
        handle('fabi-spaces:remote-connected', (e, port: unknown) => {
            const id = this.spaceIdOf(e.sender.id);
            const space = id ? this.store.get(id) : undefined;
            if (!space?.remote || typeof port !== 'number' || !Number.isInteger(port)
                || port < 1 || port > 65535 || port === this.opts.backendPort) { return false; }
            // The renderer receives an acknowledgement before its document is replaced.
            setImmediate(() => {
                if (this.disposed || !id || this.views.get(id)?.webContents !== e.sender || e.sender.isDestroyed()) { return; }
                this.remotePorts.set(id, port);
                void e.sender.loadURL(buildRemoteFrontendUrl(this.opts, space.workspacePath, port))
                    .catch(error => console.error('[fabi-spaces] remote navigation:', error));
            });
            return true;
        });

        // Contexte du frontend appelant (utilisé par le reporter de surfaces).
        on(MaestroHostIpc.CONTEXT, e => {
            const spaceId = this.spaceIdOf(e.sender.id);
            e.returnValue = spaceId ? { spaceId } : {};
        });
    }

    protected spaceIdOf(webContentsId: number): string | undefined {
        return [...this.views].find(([, view]) => view.webContents.id === webContentsId)?.[0];
    }

    /** Agents à regarder par Space ; le total s'affiche aussi sur l'icône de l'app. */
    protected readonly attention = new Map<string, number>();

    protected setAttention(id: string, count: number): void {
        const next = Math.max(0, Math.floor(count));
        if ((this.attention.get(id) ?? 0) === next) {
            return;
        }
        if (next) {
            this.attention.set(id, next);
        } else {
            this.attention.delete(id);
        }
        app.setBadgeCount([...this.attention.values()].reduce((sum, value) => sum + value, 0));
        this.pushState();
    }

    protected pushState(): void {
        if (this.disposed) {
            return;
        }
        const state = this.state();
        // Les deux vues de navigation reçoivent le même état.
        for (const chrome of [this.railView, this.tabStripView]) {
            if (chrome && !chrome.webContents.isDestroyed()) {
                chrome.webContents.send(SpacesIpc.STATE, state);
            }
        }
    }

    protected state(): SpacesState {
        const active = this.activeId ? this.store.get(this.activeId) : undefined;
        return {
            spaces: this.store.getSpaces().map(s => ({ ...s, name: this.displayName(s) })),
            activeId: this.activeId,
            liveIds: [...this.views.keys()],
            expanded: this.railExpanded,
            activeColor: active?.color,
            activeName: active ? this.displayName(active) : undefined,
            activeIcon: active?.emoji || undefined,
            attention: Object.fromEntries(this.attention)
        };
    }

    // ----------------------------------------------------------------------
    // Utilitaires
    // ----------------------------------------------------------------------

    protected displayName(s: SpaceDescriptor): string {
        if (s.name) {
            return s.name;
        }
        if (s.workspacePath) {
            return basename(s.workspacePath);
        }
        return 'Espace';
    }

    protected async pickFolder(): Promise<string | undefined> {
        const res = await dialog.showOpenDialog(this.host as unknown as Electron.BrowserWindow, {
            title: 'Choisir un dossier pour ce Space',
            properties: ['openDirectory', 'createDirectory']
        });
        return res.canceled ? undefined : res.filePaths[0];
    }

    protected nextColor(): string {
        // Couleur la moins utilisée parmi la palette, pour varier visuellement.
        const used = new Map<string, number>();
        for (const s of this.store.getSpaces()) {
            used.set(s.color, (used.get(s.color) ?? 0) + 1);
        }
        let best = SPACE_COLORS[0] as string;
        let bestCount = Infinity;
        for (const c of SPACE_COLORS) {
            const count = used.get(c) ?? 0;
            if (count < bestCount) {
                bestCount = count;
                best = c;
            }
        }
        return best;
    }

    protected defaultSize(): { width: number; height: number } {
        const area = screen.getPrimaryDisplay().workAreaSize;
        return {
            width: Math.min(1380, Math.round(area.width * 0.82)),
            height: Math.min(880, Math.round(area.height * 0.85))
        };
    }

    protected idCounter = 0;
    protected newId(): string {
        // Pas de Math.random (interdit ici) ni de Date.now collision : compteur + timestamp boot.
        this.idCounter += 1;
        return `sp_${this.bootStamp}_${this.idCounter}`;
    }
    protected readonly bootStamp = Date.now().toString(36);

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        ++this.openSequence;
        this.cancelModal?.();
        for (const cleanup of this.ipcCleanup.splice(0).reverse()) { cleanup(); }
        this.store.flush();
        for (const view of this.views.values()) {
            if (!view.webContents.isDestroyed()) {
                view.webContents.close();
            }
        }
        this.views.clear();
        for (const chrome of [this.railView, this.tabStripView, this.titlebarView, this.modalView]) {
            if (chrome && !chrome.webContents.isDestroyed()) {
                chrome.webContents.close();
            }
        }
        if (this.host && !this.host.isDestroyed()) { this.host.destroy(); }
    }
}
