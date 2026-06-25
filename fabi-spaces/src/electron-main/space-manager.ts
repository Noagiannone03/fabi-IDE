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
import { basename } from 'path';
import { CHANNEL_REQUEST_RELOAD } from '@theia/core/lib/electron-common/electron-api';
import {
    SpaceDescriptor, SpacesState, SpacesIpc, SPACE_COLORS,
    NewSpaceModalInit, NewSpaceModalResult
} from '../common/space-types';
import { MaestroHostIpc } from 'fabi-swarm/lib/common/fabi-maestro-protocol';
import { SpaceStore } from './space-store';
import { FrontendUrlContext, buildFrontendUrl, spaceWebPreferences } from './frontend-url';

/** Largeur du rail au repos (colonne d'icônes d'espaces), en px CSS. */
const RAIL_COLLAPSED = 52;   // = largeur réelle de la colonne de tuiles (8+5+34+5) → l'explorateur est COLLÉ au rail, plus de vide à droite
/** Largeur du rail déplié au survol (affiche les noms + la gestion, façon Arc). */
const RAIL_EXPANDED = 250;
/** Hauteur de la barre de titre du haut (déplaçable + traffic-lights). */
const TOPBAR_HEIGHT = 36;
/**
 * Les WebContentsView sont compositées séparément par Chromium. Sur les écrans
 * Retina, deux rectangles strictement adjacents peuvent laisser apparaître une
 * ligne subpixel pendant un resize ou un changement d'échelle.
 *
 * Le chrome est toujours remis au-dessus de l'IDE dans `layout()`. On le fait donc
 * recouvrir l'IDE d'un pixel CSS au lieu de juxtaposer trois surfaces indépendantes.
 */
const CHROME_OVERLAP = 1;
/** Largeur de la colonne Maestro laissée visible à côté de la surface native. */
const MAESTRO_PANEL_WIDTH = 390;
const MAESTRO_PREVIEW_SURFACE = 'fabi-maestro:preview-surface';
const MAESTRO_CLEAR_PREVIEW = 'fabi-maestro:clear-preview';
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
    /** Chemin FS du topbar.html (la barre de titre déplaçable). */
    topbarHtmlPath: string;
    /** Chemin FS du modal.html (popup de création de Space). */
    modalHtmlPath: string;
    /** Chemin FS du preload partagé (rail + topbar + modal). */
    railPreloadPath: string;
}

export class SpaceManager {

    protected readonly store = new SpaceStore();
    protected host!: BaseWindow;
    protected railView!: WebContentsView;
    protected topbarView!: WebContentsView;
    /** Modal de création (popup centré), présent uniquement pendant la création. */
    protected modalView: WebContentsView | undefined;
    /** Vues matérialisées (frontends vivants), par id de Space. */
    protected readonly views = new Map<string, WebContentsView>();
    protected activeId: string | undefined;
    /** Space affiché à droite de Maestro comme un iframe natif. */
    protected maestroPreviewId: string | undefined;
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
        // Le tableau de bord Maestro est toujours présent (épinglé en tête du rail).
        this.store.ensureMaestro();
        this.createHost();
        console.log('[fabi-spaces] boot: host créé');
        this.createChrome();
        console.log('[fabi-spaces] boot: chrome créé →', this.opts.railHtmlPath);
        this.registerIpc();

        // Space à afficher en premier : le dernier actif s'il existe, sinon le premier
        // espace de TRAVAIL (on n'ouvre pas Maestro d'office au lancement — on garde
        // l'utilisateur dans son code).
        const lastActive = this.store.getActiveId();
        const first = (lastActive && this.store.get(lastActive))
            ? lastActive
            : (this.firstWorkspaceId() ?? this.store.getSpaces()[0]?.id);
        if (first) {
            console.log('[fabi-spaces] boot: ouverture du Space', first);
            await this.open(first);
        }
        this.host.show();
        console.log('[fabi-spaces] boot: fenêtre-hôte affichée ✅');
    }

    /** Premier id d'espace de travail (≠ Maestro), dans l'ordre du rail. */
    protected firstWorkspaceId(): string | undefined {
        return this.store.getSpaces().find(s => s.kind !== 'maestro')?.id;
    }

    /** Premier lancement : un Space par défaut qui restaure le workspace précédent de l'utilisateur. */
    protected seedIfEmpty(): void {
        // « Vide » au sens des espaces de TRAVAIL : Maestro seul ne compte pas comme
        // un workspace utilisable → on garantit toujours au moins un espace de travail.
        const hasWorkspace = this.store.getSpaces().some(s => s.kind !== 'maestro');
        if (!hasWorkspace) {
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
            backgroundColor: '#22262d',
            show: false,
            ...(mac
                ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 13, y: 11 } }
                : { frame: false })
        });
        this.host.center();
        this.host.on('resize', () => this.layout());
        this.host.on('closed', () => this.dispose());
    }

    /** Crée une WebContentsView de chrome (topbar/rail) avec le preload partagé. */
    protected chromeView(htmlPath: string): WebContentsView {
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
        this.host.contentView.addChildView(view);
        view.webContents.loadFile(htmlPath);
        return view;
    }

    protected createChrome(): void {
        // Sidebar d'espaces (gauche) + barre de titre (haut) : deux vues de chrome.
        this.railView = this.chromeView(this.opts.railHtmlPath);
        this.railView.setBackgroundColor('#22262d');
        this.topbarView = this.chromeView(this.opts.topbarHtmlPath);
        this.topbarView.setBackgroundColor('#22262d');
        this.layout();
    }

    // ----------------------------------------------------------------------
    // Layout / compositing
    // ----------------------------------------------------------------------

    protected contentBounds(): Rectangle {
        const [w, h] = this.host.getContentSize();
        return { x: 0, y: 0, width: w, height: h };
    }

    /**
     * Modèle Arc :
     *  - barre de titre (topbar) pleine largeur en haut (déplaçable + traffic-lights) ;
     *  - sidebar d'espaces (rail) à gauche, sous la topbar : étroite au repos, élargie au
     *    survol — elle OVERLAY l'IDE (ne le pousse pas, pas de reflow) ;
     *  - l'IDE actif occupe le reste (toujours à x = RAIL_COLLAPSED).
     * z-order (bas → haut) : vues d'IDE, rail, topbar.
     */
    protected layout(): void {
        if (this.disposed) {
            return;
        }
        const { width: W, height: H } = this.contentBounds();
        const railW = this.railExpanded ? RAIL_EXPANDED : RAIL_COLLAPSED;

        // L'IDE passe d'un pixel sous le chrome. Ce recouvrement est volontaire :
        // il évite les coutures de compositing entre WebContentsView sans introduire
        // de marge visuelle ni modifier la largeur utile du contenu.
        const spaceRect: Rectangle = {
            x: Math.max(0, railW - CHROME_OVERLAP),
            y: Math.max(0, TOPBAR_HEIGHT - CHROME_OVERLAP),
            width: Math.max(0, W - railW + CHROME_OVERLAP),
            height: Math.max(0, H - TOPBAR_HEIGHT + CHROME_OVERLAP)
        };
        for (const view of this.views.values()) {
            view.setBounds(spaceRect);
        }

        if (this.activeId === 'maestro' && this.maestroPreviewId) {
            const maestro = this.views.get('maestro');
            const preview = this.views.get(this.maestroPreviewId);
            if (maestro && preview) {
                maestro.setBounds(spaceRect);
                preview.setBounds({
                    x: Math.min(W, spaceRect.x + MAESTRO_PANEL_WIDTH),
                    y: spaceRect.y,
                    width: Math.max(0, spaceRect.width - MAESTRO_PANEL_WIDTH),
                    height: spaceRect.height
                });
                // Ordre explicite : Maestro en fond, surface native à droite.
                this.host.contentView.addChildView(maestro);
                this.host.contentView.addChildView(preview);
            }
        }

        // Rail (sidebar) : au-dessus de l'IDE pour pouvoir l'overlay quand déplié.
        this.railView.setBounds({
            x: 0,
            y: Math.max(0, TOPBAR_HEIGHT - CHROME_OVERLAP),
            width: railW,
            height: Math.max(0, H - TOPBAR_HEIGHT + CHROME_OVERLAP)
        });
        this.host.contentView.addChildView(this.railView);

        // Topbar : pleine largeur, tout en haut, au sommet.
        this.topbarView.setBounds({ x: 0, y: 0, width: W, height: TOPBAR_HEIGHT });
        this.host.contentView.addChildView(this.topbarView);

        // Modal de création : plein écran, AU-DESSUS de tout.
        if (this.modalView && !this.modalView.webContents.isDestroyed()) {
            this.modalView.setBounds({ x: 0, y: 0, width: W, height: H });
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
        view.setBackgroundColor('#22262d');
        this.views.set(id, view);
        this.host.contentView.addChildView(view);
        this.wireSpaceWebContents(id, view);
        // Maestro charge le MÊME frontend Theia mais en « mode maestro » (?maestro=1) :
        // aucun workspace, aucun éditeur — uniquement le tableau de bord (cf. fabi-swarm).
        const maestro = space.kind === 'maestro';
        view.webContents.loadURL(buildFrontendUrl(this.opts, space.workspacePath, { maestro }));
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
                wc.loadURL(newUrl);
            } else {
                wc.reload();
            }
        };
        ipcMain.on(CHANNEL_REQUEST_RELOAD, onReload);
        wc.once('destroyed', () => ipcMain.removeListener(CHANNEL_REQUEST_RELOAD, onReload));

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

    /** Affiche un Space (le matérialise au besoin). Switch instantané via setVisible. */
    async open(id: string): Promise<void> {
        if (!this.store.get(id)) {
            return;
        }
        this.ensureView(id);
        if (id !== 'maestro') {
            this.maestroPreviewId = undefined;
        }
        this.activeId = id;
        this.store.setActive(id);

        // Visibilité : seule la vue active est visible.
        for (const [vid, v] of this.views) {
            v.setVisible(vid === id);
        }
        this.layout();
        this.applyAccent(id);
        this.fadeInView(id);
        this.enforceSuspension();
        this.pushState();
    }

    /** Petit fondu d'entrée sur la vue qui devient active (« on voit que ça change »). */
    protected fadeInView(id: string): void {
        const view = this.views.get(id);
        if (!view || view.webContents.isDestroyed() || view.webContents.isLoading()) {
            return;
        }
        view.webContents.executeJavaScript(
            `(()=>{try{document.body.animate([{opacity:0.55},{opacity:1}],{duration:200,easing:'ease-out'});}catch(e){}})();`,
            true
        ).catch(() => { /* frontend pas prêt */ });
    }

    /** Crée un nouveau Space : choix du dossier (OS) → popup de config → création. */
    async create(): Promise<void> {
        const dir = await this.pickFolder();
        if (dir === undefined) {
            return; // sélection de dossier annulée
        }
        const config = await this.promptNewSpace(dir);
        if (!config) {
            return; // popup annulé
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
                try { this.host.contentView.removeChildView(view); } catch { /* déjà détaché */ }
                if (!wc.isDestroyed()) {
                    wc.close();
                }
                this.layout();
                resolve(result);
            };

            const onCreate = (e: IpcMainEvent, data: NewSpaceModalResult): void => {
                if (e.sender.id === wc.id) { finish({ ...data, dir: currentDir }); }
            };
            const onCancel = (e: IpcMainEvent): void => {
                if (e.sender.id === wc.id) { finish(undefined); }
            };
            const onPick = (e: IpcMainEvent): void => {
                if (e.sender.id !== wc.id) {
                    return;
                }
                void this.pickFolder().then(d => {
                    if (d) {
                        currentDir = d;
                        if (!wc.isDestroyed()) {
                            wc.send(SpacesIpc.MODAL_FOLDER, d);
                        }
                    }
                });
            };

            ipcMain.on(SpacesIpc.MODAL_CREATE, onCreate);
            ipcMain.on(SpacesIpc.MODAL_CANCEL, onCancel);
            ipcMain.on(SpacesIpc.MODAL_PICK_FOLDER, onPick);

            wc.once('did-finish-load', () => {
                const init: NewSpaceModalInit = { folder: currentDir, defaultName: basename(currentDir), color: this.nextColor() };
                wc.send(SpacesIpc.MODAL_OPEN, init);
            });

            this.host.contentView.addChildView(view);
            this.layout();
            wc.loadFile(this.opts.modalHtmlPath);
        });
    }

    /** Détache et détruit la vue d'un Space (sans toucher au descripteur persistant). */
    protected destroyView(id: string): void {
        const view = this.views.get(id);
        if (!view) {
            return;
        }
        this.views.delete(id);
        try {
            this.host.contentView.removeChildView(view);
        } catch { /* déjà détaché */ }
        if (!view.webContents.isDestroyed()) {
            view.webContents.close();
        }
    }

    /** Ferme/supprime un Space. Bascule sur un autre (ou en recrée un) si c'était l'actif. */
    async close(id: string): Promise<void> {
        // Maestro est permanent : on ignore toute demande de fermeture.
        if (this.store.get(id)?.kind === 'maestro') {
            return;
        }
        this.destroyView(id);
        const wasActive = this.activeId === id;
        this.store.remove(id);

        // On garantit toujours au moins un espace de TRAVAIL (Maestro seul ne suffit pas).
        this.seedIfEmpty();
        if (wasActive) {
            this.activeId = undefined;
            // On bascule de préférence sur un espace de travail (pas Maestro).
            const next = this.firstWorkspaceId() ?? this.store.getSpaces()[0]?.id;
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
        // Candidats = vivants sauf l'actif ET sauf Maestro (gardé chaud pour la
        // supervision : on veut son tableau de bord instantané au retour).
        const candidates = [...this.views.keys()]
            .filter(id => id !== this.activeId && this.store.get(id)?.kind !== 'maestro')
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
        const fromRail = (event: IpcMainEvent) => event.sender.id === this.railView.webContents.id;
        const fromChrome = (event: IpcMainEvent) =>
            event.sender.id === this.railView.webContents.id || event.sender.id === this.topbarView.webContents.id;

        ipcMain.on(SpacesIpc.READY, e => { if (fromRail(e)) { this.pushState(); } });
        ipcMain.on(SpacesIpc.OPEN, (e, id: string) => { if (fromRail(e)) { void this.open(id); } });
        ipcMain.on(SpacesIpc.CREATE, e => { if (fromRail(e)) { void this.create(); } });
        ipcMain.on(SpacesIpc.CLOSE, (e, id: string) => { if (fromRail(e)) { void this.close(id); } });
        ipcMain.on(SpacesIpc.RENAME, (e, id: string, name: string) => { if (fromRail(e)) { this.rename(id, name); } });
        ipcMain.on(SpacesIpc.SET_COLOR, (e, id: string, color: string) => { if (fromRail(e)) { this.setColor(id, color); } });
        ipcMain.on(SpacesIpc.SET_EMOJI, (e, id: string, emoji: string) => { if (fromRail(e)) { this.setEmoji(id, emoji); } });
        ipcMain.on(SpacesIpc.REORDER, (e, ids: string[]) => { if (fromRail(e)) { this.reorder(ids); } });
        // Le toggle peut venir du rail OU de la topbar.
        ipcMain.on(SpacesIpc.TOGGLE_SIDEBAR, e => { if (fromChrome(e)) { this.setExpanded(!this.railExpanded); } });
        // La topbar ET le rail peuvent piloter la fenêtre (boutons Win/Linux, double-clic).
        ipcMain.on(SpacesIpc.WINDOW, (e, action) => { if (fromChrome(e)) { this.windowControl(action); } });

        // Contexte du frontend appelant (utilisé par le reporter de surfaces).
        ipcMain.on(MaestroHostIpc.CONTEXT, e => {
            const entry = [...this.views].find(([, view]) => view.webContents.id === e.sender.id);
            e.returnValue = entry ? { spaceId: entry[0] } : {};
        });
        ipcMain.handle(MaestroHostIpc.OPEN_SURFACE, async (e, target: { spaceId?: string; widgetId?: string }) => {
            if (!this.fromMaestro(e.sender.id) || !target?.spaceId || !target.widgetId) {
                return false;
            }
            return this.routeToSurface(target.spaceId, MaestroHostIpc.ACTIVATE_SURFACE, target.widgetId);
        });
        ipcMain.handle(MAESTRO_PREVIEW_SURFACE, async (e, target: { spaceId?: string; widgetId?: string }) => {
            if (!this.fromMaestro(e.sender.id) || !target?.spaceId || !target.widgetId || target.spaceId === 'maestro') {
                return false;
            }
            return this.previewSurface(target.spaceId, target.widgetId);
        });
        ipcMain.handle(MAESTRO_CLEAR_PREVIEW, async e => {
            if (!this.fromMaestro(e.sender.id)) {
                return false;
            }
            this.maestroPreviewId = undefined;
            for (const [id, view] of this.views) {
                view.setVisible(id === this.activeId);
            }
            this.layout();
            return true;
        });
        ipcMain.handle(MaestroHostIpc.SEND_TO_SURFACE, async (
            e,
            target: { spaceId?: string; widgetId?: string },
            text: string
        ) => {
            if (!this.fromMaestro(e.sender.id) || !target?.spaceId || !target.widgetId || typeof text !== 'string') {
                return false;
            }
            return this.routeToSurface(target.spaceId, MaestroHostIpc.WRITE_TERMINAL, target.widgetId, text);
        });
    }

    protected fromMaestro(webContentsId: number): boolean {
        const view = this.views.get('maestro');
        return !!view && view.webContents.id === webContentsId;
    }

    /** Active le Space, attend son chargement éventuel, puis cible le widget natif. */
    protected async routeToSurface(spaceId: string, channel: string, ...args: unknown[]): Promise<boolean> {
        if (!this.store.get(spaceId)) {
            return false;
        }
        await this.open(spaceId);
        const view = this.views.get(spaceId);
        if (!view || view.webContents.isDestroyed()) {
            return false;
        }
        if (view.webContents.isLoading()) {
            await new Promise<void>(resolve => view.webContents.once('did-finish-load', () => resolve()));
        }
        view.webContents.send(channel, ...args);
        return true;
    }

    /** Affiche le vrai frontend du Space à droite tout en gardant Maestro à gauche. */
    protected async previewSurface(spaceId: string, widgetId: string): Promise<boolean> {
        if (this.activeId !== 'maestro' || !this.store.get(spaceId)) {
            return false;
        }
        const preview = this.ensureView(spaceId);
        this.maestroPreviewId = spaceId;
        for (const [id, view] of this.views) {
            view.setVisible(id === 'maestro' || id === spaceId);
        }
        this.layout();
        if (preview.webContents.isLoading()) {
            await new Promise<void>(resolve => preview.webContents.once('did-finish-load', () => resolve()));
        }
        preview.webContents.send(MaestroHostIpc.ACTIVATE_SURFACE, widgetId);
        return true;
    }

    protected pushState(): void {
        if (this.disposed) {
            return;
        }
        const state = this.state();
        // Le rail ET la topbar reçoivent l'état (couleur active pour le « relié », expanded…).
        for (const chrome of [this.railView, this.topbarView]) {
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
            activeIcon: active?.emoji || undefined
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

    protected dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.store.flush();
        for (const view of this.views.values()) {
            if (!view.webContents.isDestroyed()) {
                view.webContents.close();
            }
        }
        this.views.clear();
        for (const chrome of [this.railView, this.topbarView, this.modalView]) {
            if (chrome && !chrome.webContents.isDestroyed()) {
                chrome.webContents.close();
            }
        }
        app.quit();
    }
}
