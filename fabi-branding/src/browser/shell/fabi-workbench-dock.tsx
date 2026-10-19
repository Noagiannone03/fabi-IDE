import * as React from '@theia/core/shared/react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { Title, Widget } from '@theia/core/shared/@lumino/widgets';
import { ApplicationShell, FrontendApplicationContribution, ReactWidget } from '@theia/core/lib/browser';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { FabiSidePanelHandler } from './fabi-side-panel-handler';
import { FabiSymbol, viewSymbol } from './fabi-symbol';

/** La seule vue qui reste à gauche : l'explorateur (barre « Projets »). */
const EXPLORER_ID = 'explorer-view-container';
/** Vue mise en avant dans le dock ; les autres vivent dans le popover « … ». */
const GIT_SYMBOL = 'branch';
/** Recherche « Spotlight » = l'ouverture rapide de Theia (fichiers, `>` commandes, `@` symboles). */
const SPOTLIGHT_COMMAND = 'file-search.openFile';
/** Les terminaux d'agents IA ont leur place dans la barre Projets, pas derrière « Terminal ». */
const AGENT_TERMINAL_PREFIX = 'terminal-agent-';

/**
 * Dock du bas : un lanceur, jamais le propriétaire des vues. Fichiers et Terminal
 * agissent sur la zone de code ; Git et les outils secondaires (popover « … »)
 * s'ouvrent dans le panneau de DROITE, fermable par sa croix.
 */
class DockTools extends ReactWidget {
    protected busy = false;
    protected menuOpen = false;

    constructor(
        protected readonly shell: ApplicationShell,
        protected readonly commands: CommandService,
        protected readonly messages: MessageService
    ) {
        super();
        this.id = 'fabi-dock-tools';
        this.toDispose.push(shell.onDidChangeActiveWidget(() => this.update()));
        this.toDispose.push(shell.onDidChangeCurrentWidget(() => this.update()));
        const right = shell.rightPanelHandler;
        const refresh = () => this.update();
        right.tabBar.currentChanged.connect(refresh);
        right.tabBar.tabAdded.connect(refresh);
        this.toDispose.push({ dispose: () => { right.tabBar.currentChanged.disconnect(refresh); right.tabBar.tabAdded.disconnect(refresh); } });
        this.update();
    }

    /** Vues du panneau de droite, dans l'ordre de leur barre (cachée). */
    protected rightViews(): Title<Widget>[] {
        return Array.from(this.shell.rightPanelHandler.tabBar.titles);
    }

    protected isShownOnRight(title: Title<Widget>): boolean {
        return this.shell.rightPanelHandler.tabBar.currentTitle === title && this.shell.isExpanded('right');
    }

    protected async toggleRight(title: Title<Widget>): Promise<void> {
        this.menuOpen = false;
        if (this.isShownOnRight(title)) {
            await this.shell.collapsePanel('right');
        } else {
            await this.shell.activateWidget(title.owner.id);
        }
    }

    protected async toggleFiles(): Promise<void> {
        if (this.shell.isExpanded('left')) {
            await this.shell.collapsePanel('left');
        } else {
            await this.shell.activateWidget(EXPLORER_ID);
        }
    }

    private terminalQueue: Promise<void> = Promise.resolve();

    protected openTerminal(): Promise<void> {
        // Keep every click, including while the previous PTY is starting.
        const opening = this.terminalQueue.then(async () => {
            await this.commands.executeCommand('fabi.newTerminalTab');
        });
        this.terminalQueue = opening.catch(() => {});
        return opening;
    }

    protected async run(action: () => Promise<unknown>): Promise<void> {
        if (this.busy) { return; }
        this.busy = true;
        this.update();
        try {
            await action();
        } catch (error) {
            void this.messages.error(`Impossible d’ouvrir cet outil : ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.busy = false;
            if (!this.isDisposed) { this.update(); }
        }
    }

    protected renderTool(key: string, symbol: string, label: string, active: boolean, action: () => Promise<unknown>): React.ReactNode {
        return <button key={key}
            className={'fabi-dock-tool' + (active ? ' active' : '')}
            title={label} aria-label={label} aria-pressed={active} disabled={this.busy && key !== 'terminal'}
            onClick={() => key === 'terminal' ? void action().catch(error => this.messages.error(String(error))) : void this.run(action)}>
            <span className="fabi-dock-tile"><FabiSymbol name={symbol} /></span>
        </button>;
    }

    protected render(): React.ReactNode {
        const current = this.shell.currentWidget?.id ?? '';
        const views = this.rightViews();
        const git = views.find(title => viewSymbol(title.owner.id) === GIT_SYMBOL);
        const others = views.filter(title => title !== git);
        const otherShown = others.some(title => this.isShownOnRight(title));
        return <nav className="fabi-dock-tools" aria-label="Outils du Space" aria-busy={this.busy}>
            {this.renderTool('files', 'files', 'Espace', this.shell.isExpanded('left'), () => this.toggleFiles())}
            {this.renderTool('search', 'search', 'Rechercher (⌘P)', false, () => this.commands.executeCommand(SPOTLIGHT_COMMAND))}
            {git && this.renderTool('git', GIT_SYMBOL, 'Git', this.isShownOnRight(git), () => this.toggleRight(git))}
            {this.renderTool('terminal', 'terminal', 'Terminal',
                current.startsWith('terminal-') && !current.startsWith(AGENT_TERMINAL_PREFIX), () => this.openTerminal())}
            {others.length > 0 && <div className="fabi-dock-more">
                <button className={'fabi-dock-tool' + (this.menuOpen || otherShown ? ' active' : '')}
                    title="Plus d’outils" aria-label="Plus d’outils" aria-haspopup="menu" aria-expanded={this.menuOpen}
                    onClick={() => { this.menuOpen = !this.menuOpen; this.update(); }}>
                    <span className="fabi-dock-tile"><FabiSymbol name="more" /></span>
                </button>
                {this.menuOpen && <>
                    <div className="fabi-dock-backdrop" onClick={() => { this.menuOpen = false; this.update(); }} />
                    <div className="fabi-dock-menu" role="menu"
                        onKeyDown={event => { if (event.key === 'Escape') { this.menuOpen = false; this.update(); } }}>
                        {others.map((title, index) => <button key={title.owner.id} role="menuitem" autoFocus={index === 0}
                            className={'fabi-dock-menu-item' + (this.isShownOnRight(title) ? ' active' : '')}
                            onClick={() => void this.run(() => this.toggleRight(title))}>
                            {viewSymbol(title.owner.id)
                                ? <FabiSymbol name={viewSymbol(title.owner.id)!} />
                                : <span className={'fabi-dock-menu-icon ' + (title.iconClass || '')} />}
                            <span>{title.label || title.caption}</span>
                        </button>)}
                    </div>
                </>}
            </div>}
        </nav>;
    }
}

@injectable()
export class FabiWorkbenchDockContribution implements FrontendApplicationContribution {
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(MessageService) protected readonly messages: MessageService;

    onDidInitializeLayout(): void {
        for (const widget of this.shell.getWidgets('right')) {
            if (widget.id === 'chat-view-widget' || widget.id.startsWith('fabi-chat-instance:')) {
                this.shell.addWidget(widget, { area: 'main' });
            }
        }
        const handler = this.shell.leftPanelHandler;
        if (!(handler instanceof FabiSidePanelHandler)) { return; }
        this.moveSecondaryViewsRight();
        // Les extensions peuvent ajouter des vues à gauche après le démarrage.
        handler.tabBar.tabAdded.connect(() => setTimeout(() => this.moveSecondaryViewsRight()));

        const dock = new DockTools(this.shell, this.commands, this.messages);
        dock.id = 'fabi-workbench-dock';
        // Independent overlay: no extra row is allocated in the Lumino shell.
        Widget.attach(dock, this.shell.node);
        const reveal = document.createElement('button');
        reveal.className = 'fabi-sidebar-reveal';
        reveal.title = 'Afficher les projets';
        reveal.setAttribute('aria-label', 'Afficher les projets');
        const glyph = document.createElement('span');
        glyph.className = 'fabi-symbol ph-files';
        glyph.setAttribute('aria-hidden', 'true');
        reveal.append(glyph);
        reveal.onclick = () => this.shell.expandPanel('left');
        this.shell.node.append(reveal);
        const editor = this.shell.mainPanel.node;
        const position = () => {
            const r = editor.getBoundingClientRect();
            dock.node.style.left = Math.round(r.left + r.width / 2) + 'px';
            dock.node.style.bottom = Math.max(12, window.innerHeight - r.bottom + 14) + 'px';
        };
        const observer = new ResizeObserver(position);
        observer.observe(editor);
        observer.observe(this.shell.node);
        window.addEventListener('resize', position);
        position();
        const rest = (event: PointerEvent) => { if (!dock.node.contains(event.target as Node)) { dock.node.classList.add('fabi-dock-resting'); } };
        let collapseTimer: number | undefined;
        const show = () => { window.clearTimeout(collapseTimer); dock.node.classList.remove('fabi-dock-resting'); };
        const settle = () => {
            window.clearTimeout(collapseTimer);
            collapseTimer = window.setTimeout(() => {
                if (!dock.node.contains(document.activeElement) && !dock.node.matches(':hover')) {
                    dock.node.classList.add('fabi-dock-resting');
                }
            }, 320);
        };
        this.shell.node.addEventListener('pointerdown', rest);
        dock.node.addEventListener('pointerenter', show);
        dock.node.addEventListener('focusin', show);
        dock.node.addEventListener('pointerleave', settle);
        dock.node.addEventListener('focusout', settle);
        this.shell.disposed.connect(() => dock.dispose());
        dock.disposed.connect(() => { window.clearTimeout(collapseTimer); reveal.remove(); observer.disconnect(); window.removeEventListener('resize', position); this.shell.node.removeEventListener('pointerdown', rest); });
        document.body.classList.add('fabi-dock-enabled');
        document.body.classList.toggle('fabi-native-spaces', window.location.protocol === 'file:');
        handler.enableDockNavigation();
    }

    /**
     * Seul l'explorateur reste à gauche ; recherche, Git, debug, extensions… passent
     * dans le panneau de droite (sans l'ouvrir). Le layout persiste ce placement,
     * et les raccourcis de Theia (⇧⌘G…) les ouvrent donc à droite.
     */
    protected moveSecondaryViewsRight(): void {
        for (const title of Array.from(this.shell.leftPanelHandler.tabBar.titles)) {
            if (title.owner.id !== EXPLORER_ID) {
                void this.shell.addWidget(title.owner, { area: 'right' });
            }
        }
    }
}
