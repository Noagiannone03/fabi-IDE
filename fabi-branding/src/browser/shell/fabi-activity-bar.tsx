// FabiActivityBar — barre d'activité HORIZONTALE, posée en bas du panneau latéral
// gauche. Icônes flottantes (ADN « îlots » : pas de container/boîte derrière),
// façon Cursor. Ne rend PAS le SideTabBar natif de Theia (qui bugge en horizontal) :
// on lit ses `titles` + son `currentTitle` et on rend nos propres boutons, tout en
// pilotant les mêmes vues via l'hôte (le SidePanelHandler).
//
// Débordement RESPONSIVE : on mesure la largeur RÉELLE de la barre (ResizeObserver)
// et on n'affiche QUE les icônes qui rentrent ; le reste bascule dans un menu « … ».
// Quand on rétrécit la section, les icônes en trop se replient dans le « … » ; quand
// on l'élargit, elles reviennent. (Avant : seuil fixe de 7 icônes → débordement coupé.)

import * as React from '@theia/core/shared/react';
import { FabiSymbol, viewSymbol } from './fabi-symbol';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { SideTabBar } from '@theia/core/lib/browser/shell/tab-bars';
import { Title, Widget } from '@theia/core/shared/@lumino/widgets';
import { Disposable } from '@theia/core/lib/common';

/** Ce dont la barre a besoin de l'hôte (le SidePanelHandler) pour piloter les vues. */
export interface FabiActivityBarHost {
    /** Le tab bar natif (caché) : source de vérité des vues + sélection. */
    readonly tabBar: SideTabBar;
    /** Sélectionne/affiche une vue (ou replie le panneau si c'est déjà l'active). */
    selectView(title: Title<Widget>): void;
}

// Géométrie (doit rester synchro avec fabi-activity-bar.css).
const ITEM = 34;   // largeur d'un bouton-icône
const GAP = 4;     // espace entre boutons (.fabi-activity-inner gap)
const PAD = 8;     // padding horizontal de .fabi-activity-inner (par côté)
const SLOT = ITEM + GAP;        // place occupée par un item (avec son gap)
const BASE = 2 * PAD - GAP;     // marge fixe : 2 paddings - 1 gap surcompté

export class FabiActivityBar extends ReactWidget {

    protected overflowOpen = false;
    /** Largeur dispo mesurée (px). 0 = pas encore mesurée → on montre tout. */
    protected availableWidth = 0;
    protected resizeObserver?: ResizeObserver;
    protected readonly titleListeners = new Map<Title<Widget>, Disposable>();

    constructor(protected readonly host: FabiActivityBarHost) {
        super();
        this.id = 'fabi-activity-bar';
        this.addClass('fabi-activity-bar');
        const tabBar = host.tabBar;
        // Re-render quand les vues ou la sélection changent.
        const refresh = () => this.refreshViews();
        tabBar.tabAdded.connect(refresh);
        tabBar.currentChanged.connect(refresh);
        tabBar.tabMoved.connect(refresh);
        const resize = () => { if (this.overflowOpen) { this.update(); } };
        window.addEventListener('resize', resize);
        this.toDispose.push(Disposable.create(() => {
            tabBar.tabAdded.disconnect(refresh);
            tabBar.currentChanged.disconnect(refresh);
            tabBar.tabMoved.disconnect(refresh);
            window.removeEventListener('resize', resize);
            for (const listener of this.titleListeners.values()) { listener.dispose(); }
            this.titleListeners.clear();
        }));
        this.refreshViews();
    }

    refreshViews(): void {
        const titles = new Set(this.host.tabBar.titles);
        for (const [title, listener] of this.titleListeners) {
            if (!titles.has(title)) { listener.dispose(); this.titleListeners.delete(title); }
        }
        for (const title of titles) {
            if (!this.titleListeners.has(title)) {
                const changed = () => this.update();
                title.changed.connect(changed);
                this.titleListeners.set(title, Disposable.create(() => title.changed.disconnect(changed)));
            }
        }
        this.update();
    }

    protected closeOverflow(restoreFocus = false): void {
        this.overflowOpen = false;
        this.update();
        if (restoreFocus) { this.node.querySelector<HTMLButtonElement>('.fabi-activity-item.more')?.focus(); }
    }

    protected onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); this.closeOverflow(true); return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { return; }
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.fabi-activity-menu-item'));
        if (!items.length) { return; }
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        event.preventDefault(); items[next].focus();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        // Observe la largeur RÉELLE de la barre : recalcul à chaque redimensionnement
        // de la section (drag du séparateur, etc.). On ne re-render que si le nombre
        // d'icônes visibles change → pas de flood de rendus pendant le drag.
        this.resizeObserver = new ResizeObserver(entries => {
            const width = entries[0]?.contentRect.width ?? this.node.clientWidth;
            this.applyWidth(width);
        });
        this.resizeObserver.observe(this.node);
        // Mesure initiale immédiate (sinon premier rendu sans largeur connue).
        this.applyWidth(this.node.clientWidth);
    }

    protected override onBeforeDetach(msg: Message): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        super.onBeforeDetach(msg);
    }

    /** Met à jour la largeur connue et re-render seulement si le découpage change. */
    protected applyWidth(width: number): void {
        if (!width || width === this.availableWidth) {
            return;
        }
        const before = this.visibleCount(this.titles().length, this.availableWidth);
        const after = this.visibleCount(this.titles().length, width);
        this.availableWidth = width;
        if (before !== after || this.overflowOpen) {
            this.update();
        }
    }

    /** Combien d'icônes rentrent dans `width` (en réservant la place du « … » si besoin). */
    protected visibleCount(total: number, width: number): number {
        if (!width || width <= 0) {
            return total; // largeur inconnue → on montre tout (corrigé dès la 1re mesure)
        }
        // Sans bouton « … » : k items tiennent si SLOT*k + BASE <= width.
        const fitAll = Math.floor((width - BASE) / SLOT);
        if (total <= fitAll) {
            return total;
        }
        // Sinon il faut un bouton « … » (lui aussi un SLOT) : on réserve sa place.
        const withMore = Math.floor((width - BASE - SLOT) / SLOT);
        return Math.max(0, Math.min(total, withMore));
    }

    protected titles(): Title<Widget>[] {
        return Array.from(this.host.tabBar.titles);
    }

    protected overflowPosition(): React.CSSProperties {
        const trigger = this.node.querySelector('.fabi-activity-item.more');
        const bounds = trigger?.getBoundingClientRect() ?? this.node.getBoundingClientRect();
        const width = Math.min(220, window.innerWidth - 16);
        return {
            position: 'fixed', width, minWidth: 0,
            left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
            bottom: window.innerHeight - bounds.top + 6,
            maxHeight: Math.max(40, bounds.top - 14), overflowY: 'auto'
        };
    }

    protected onItemClick(title: Title<Widget>): void {
        this.overflowOpen = false;
        this.host.selectView(title);
        this.update();
    }

    protected renderItem(title: Title<Widget>, current: Title<Widget> | null, key: React.Key): React.ReactNode {
        const active = title === current;
        return (
            <button
                key={key}
                className={'fabi-activity-item' + (active ? ' active' : '')}
                title={title.label || title.caption}
                aria-label={title.label || title.caption}
                aria-pressed={active}
                onClick={() => this.onItemClick(title)}
            >
                {viewSymbol(title.owner.id) ? <FabiSymbol name={viewSymbol(title.owner.id)!} /> : <span className={'fabi-activity-icon ' + (title.iconClass || '')} />}
            </button>
        );
    }

    protected render(): React.ReactNode {
        const titles = this.titles();
        const current = this.host.tabBar.currentTitle;

        const count = this.visibleCount(titles.length, this.availableWidth);
        const visible = titles.slice(0, count);
        const overflow = titles.slice(count);
        // Si la vue active est repliée dans le « … », on marque le bouton « … ».
        const currentHidden = !!current && overflow.indexOf(current) >= 0;

        return (
            <nav className="fabi-activity-inner" aria-label="Vues du projet"
                onBlur={event => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { this.closeOverflow(); }
                }}>
                {visible.map(t => this.renderItem(t, current, t.owner.id))}
                {overflow.length > 0 && (
                    <div className="fabi-activity-overflow">
                        <button
                            className={'fabi-activity-item more' + (this.overflowOpen || currentHidden ? ' active' : '')}
                            title="Plus de vues"
                            aria-label="Plus de vues"
                            aria-expanded={this.overflowOpen}
                            aria-haspopup="menu"
                            onKeyDown={event => {
                                if (event.key === 'Escape') { this.overflowOpen = false; this.update(); }
                            }}
                            onClick={() => { this.overflowOpen = !this.overflowOpen; this.update(); }}
                        >
                            <FabiSymbol name="more" />
                        </button>
                        {this.overflowOpen && (
                            <>
                                {/* Voile transparent : un clic en dehors ferme le menu. */}
                                <div
                                    className="fabi-activity-backdrop"
                                    onClick={() => this.closeOverflow()}
                                />
                                <div className="fabi-activity-menu" style={this.overflowPosition()} role="menu" aria-label="Autres vues du projet" onKeyDown={event => this.onMenuKeyDown(event)}>
                                    {overflow.map((t, i) => (
                                        <button
                                            key={t.owner.id}
                                            role="menuitemradio"
                                            aria-checked={t === current}
                                            autoFocus={currentHidden ? t === current : i === 0}
                                            className={'fabi-activity-menu-item' + (t === current ? ' active' : '')}
                                            onClick={() => this.onItemClick(t)}
                                        >
                                            <span className={'fabi-activity-icon ' + (t.iconClass || '')} />
                                            <span className="label">{t.label || t.caption}</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </nav>
        );
    }
}
