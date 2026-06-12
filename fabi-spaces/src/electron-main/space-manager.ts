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
import { SpaceDescriptor, SpacesState, SpacesIpc, SPACE_COLORS } from '../common/space-types';
import { SpaceStore } from './space-store';
import { FrontendUrlContext, buildFrontendUrl, spaceWebPreferences } from './frontend-url';

/** Largeur de la colonne gauche du rail (les tuiles d'espaces), en px CSS. */
const RAIL_WIDTH = 62;
/** Hauteur de la barre de titre du haut (déplaçable + traffic-lights). */
const TOPBAR_HEIGHT = 36;
/** Nombre max de frontends Theia gardés vivants en même temps (le reste est suspendu → RAM). */
const MAX_LIVE = Math.max(1, Number(process.env.FABI_SPACES_MAX_LIVE) || 3);

export interface SpaceManagerOptions extends FrontendUrlContext {
    appName: string;
    /** Chemin FS du rail.html (chrome). */
    railHtmlPath: string;
    /** Chemin FS du preload du rail. */
    railPreloadPath: string;
}

export class SpaceManager {

    protected readonly store = new SpaceStore();
    protected host!: BaseWindow;
    protected railView!: WebContentsView;
    /** Vues matérialisées (frontends vivants), par id de Space. */
    protected readonly views = new Map<string, WebContentsView>();
    protected activeId: string | undefined;
    protected overviewOpen = false;
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
        this.createRail();
        console.log('[fabi-spaces] boot: rail créé →', this.opts.railHtmlPath);
        this.registerIpc();

        // Space à afficher en premier : le dernier actif, sinon le premier de la liste.
        const first = this.store.getActiveId() && this.store.get(this.store.getActiveId()!)
            ? this.store.getActiveId()!
            : this.store.getSpaces()[0]?.id;
        if (first) {
            console.log('[fabi-spaces] boot: ouverture du Space', first);
            await this.open(first);
        }
        this.host.show();
        console.log('[fabi-spaces] boot: fenêtre-hôte affichée ✅');
    }

    /** Premier lancement : un Space par défaut qui restaure le workspace précédent de l'utilisateur. */
    protected seedIfEmpty(): void {
        if (this.store.isEmpty()) {
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
            backgroundColor: '#0b0b0e',
            show: false,
            ...(mac
                ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 13, y: 11 } }
                : { frame: false })
        });
        this.host.center();
        this.host.on('resize', () => this.layout());
        this.host.on('closed', () => this.dispose());
    }

    protected createRail(): void {
        this.railView = new WebContentsView({
            webPreferences: {
                preload: this.opts.railPreloadPath,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                backgroundThrottling: false
            }
        });
        this.railView.setBackgroundColor('#0b0b0e');
        this.host.contentView.addChildView(this.railView);
        this.railView.webContents.loadFile(this.opts.railHtmlPath);
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
     * Le rail est le FOND plein-cadre (barre de titre en haut + colonne d'espaces à
     * gauche, façon Arc) ; l'IDE actif est encastré dessus, en bas-à-droite. Seul le
     * « L » du chrome reste visible autour de l'IDE.
     */
    protected layout(): void {
        if (this.disposed) {
            return;
        }
        const { width: W, height: H } = this.contentBounds();

        // Rail = fond plein-cadre.
        this.railView.setBounds({ x: 0, y: 0, width: W, height: H });

        // IDE encastré : sous la barre de titre, à droite de la colonne d'espaces.
        const spaceRect: Rectangle = {
            x: RAIL_WIDTH,
            y: TOPBAR_HEIGHT,
            width: Math.max(0, W - RAIL_WIDTH),
            height: Math.max(0, H - TOPBAR_HEIGHT)
        };
        for (const view of this.views.values()) {
            view.setBounds(spaceRect);
        }

        // z-order : en normal le rail est DESSOUS (l'IDE le recouvre, seul le chrome en L
        // reste visible) ; en overview il passe AU-DESSUS (il occupe tout l'écran).
        if (this.overviewOpen) {
            this.host.contentView.addChildView(this.railView);     // au sommet
        } else {
            this.host.contentView.addChildView(this.railView, 0);  // au fond
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
        view.setBackgroundColor('#0b0b0e');
        this.views.set(id, view);
        this.host.contentView.addChildView(view);
        this.wireSpaceWebContents(id, view);
        view.webContents.loadURL(buildFrontendUrl(this.opts, space.workspacePath));
        return view;
    }

    /** Shims par-vue : reload routé sur CETTE vue (Theia n'attache ce listener que sur ses BrowserWindow). */
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
        this.activeId = id;
        this.store.setActive(id);

        // Visibilité : seule la vue active est visible.
        for (const [vid, v] of this.views) {
            v.setVisible(vid === id && !this.overviewOpen);
        }
        this.layout();
        this.enforceSuspension();
        this.pushState();
    }

    /** Crée un nouveau Space : choisit un dossier puis l'ouvre. */
    async create(): Promise<void> {
        const dir = await this.pickFolder();
        const space: SpaceDescriptor = {
            id: this.newId(),
            name: dir ? basename(dir) : '',
            emoji: '',
            color: this.nextColor(),
            workspacePath: dir ?? '',
            lastActive: Date.now()
        };
        this.store.add(space);
        await this.open(space.id);
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
        this.destroyView(id);
        const wasActive = this.activeId === id;
        this.store.remove(id);

        if (this.store.isEmpty()) {
            this.seedIfEmpty();
        }
        if (wasActive) {
            this.activeId = undefined;
            const next = this.store.getActiveId() ?? this.store.getSpaces()[0]?.id;
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

    setOverview(open: boolean): void {
        this.overviewOpen = open;
        // En overview, on masque la vue active (le rail occupe tout l'écran).
        if (this.activeId) {
            this.views.get(this.activeId)?.setVisible(!open);
        }
        this.layout();
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
        // Candidats = vivants sauf l'actif, triés du moins récemment actif au plus récent.
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
        const fromRail = (event: IpcMainEvent) => event.sender.id === this.railView.webContents.id;

        ipcMain.on(SpacesIpc.READY, e => { if (fromRail(e)) { this.pushState(); } });
        ipcMain.on(SpacesIpc.OPEN, (e, id: string) => { if (fromRail(e)) { void this.open(id); } });
        ipcMain.on(SpacesIpc.CREATE, e => { if (fromRail(e)) { void this.create(); } });
        ipcMain.on(SpacesIpc.CLOSE, (e, id: string) => { if (fromRail(e)) { void this.close(id); } });
        ipcMain.on(SpacesIpc.RENAME, (e, id: string, name: string) => { if (fromRail(e)) { this.rename(id, name); } });
        ipcMain.on(SpacesIpc.SET_COLOR, (e, id: string, color: string) => { if (fromRail(e)) { this.setColor(id, color); } });
        ipcMain.on(SpacesIpc.SET_EMOJI, (e, id: string, emoji: string) => { if (fromRail(e)) { this.setEmoji(id, emoji); } });
        ipcMain.on(SpacesIpc.REORDER, (e, ids: string[]) => { if (fromRail(e)) { this.reorder(ids); } });
        ipcMain.on(SpacesIpc.SHOW_OVERVIEW, e => { if (fromRail(e)) { this.setOverview(true); } });
        ipcMain.on(SpacesIpc.HIDE_OVERVIEW, e => { if (fromRail(e)) { this.setOverview(false); } });
        ipcMain.on(SpacesIpc.WINDOW, (e, action) => { if (fromRail(e)) { this.windowControl(action); } });
    }

    protected pushState(): void {
        if (this.disposed || this.railView.webContents.isDestroyed()) {
            return;
        }
        this.railView.webContents.send(SpacesIpc.STATE, this.state());
    }

    protected state(): SpacesState {
        return {
            spaces: this.store.getSpaces().map(s => ({ ...s, name: this.displayName(s) })),
            activeId: this.activeId,
            liveIds: [...this.views.keys()]
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
        app.quit();
    }
}
