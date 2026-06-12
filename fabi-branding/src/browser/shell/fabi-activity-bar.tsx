// FabiActivityBar — barre d'activité HORIZONTALE, posée en bas du panneau latéral
// gauche. Icônes flottantes (ADN « îlots » : pas de container/boîte derrière),
// façon Cursor. Ne rend PAS le SideTabBar natif de Theia (qui bugge en horizontal) :
// on lit ses `titles` + son `currentTitle` et on rend nos propres boutons, tout en
// pilotant les mêmes vues via l'hôte (le SidePanelHandler).
//
// Débordement : si trop d'icônes, on en montre N et on ouvre un menu « … » pour le reste.

import * as React from '@theia/core/shared/react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { SideTabBar } from '@theia/core/lib/browser/shell/tab-bars';
import { Title, Widget } from '@theia/core/shared/@lumino/widgets';

/** Ce dont la barre a besoin de l'hôte (le SidePanelHandler) pour piloter les vues. */
export interface FabiActivityBarHost {
    /** Le tab bar natif (caché) : source de vérité des vues + sélection. */
    readonly tabBar: SideTabBar;
    /** Sélectionne/affiche une vue (ou replie le panneau si c'est déjà l'active). */
    selectView(title: Title<Widget>): void;
}

/** Nombre max d'icônes visibles avant de basculer le surplus dans le menu « … ». */
const MAX_VISIBLE = 7;

export class FabiActivityBar extends ReactWidget {

    protected overflowOpen = false;

    constructor(protected readonly host: FabiActivityBarHost) {
        super();
        this.id = 'fabi-activity-bar';
        this.addClass('fabi-activity-bar');
        const tabBar = host.tabBar;
        // Re-render quand les vues ou la sélection changent.
        tabBar.tabAdded.connect(() => this.update());
        tabBar.currentChanged.connect(() => this.update());
        tabBar.tabMoved.connect(() => this.update());
    }

    protected titles(): Title<Widget>[] {
        return Array.from(this.host.tabBar.titles);
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
                onClick={() => this.onItemClick(title)}
            >
                <span className={'fabi-activity-icon ' + (title.iconClass || '')} />
            </button>
        );
    }

    protected render(): React.ReactNode {
        const titles = this.titles();
        const current = this.host.tabBar.currentTitle;

        const visible = titles.length > MAX_VISIBLE ? titles.slice(0, MAX_VISIBLE) : titles;
        const overflow = titles.length > MAX_VISIBLE ? titles.slice(MAX_VISIBLE) : [];

        return (
            <div className="fabi-activity-inner">
                {visible.map((t, i) => this.renderItem(t, current, i))}
                {overflow.length > 0 && (
                    <div className="fabi-activity-overflow">
                        <button
                            className={'fabi-activity-item more' + (this.overflowOpen ? ' active' : '')}
                            title="Plus de vues"
                            onClick={() => { this.overflowOpen = !this.overflowOpen; this.update(); }}
                        >
                            <span className="fabi-activity-icon codicon codicon-more" />
                        </button>
                        {this.overflowOpen && (
                            <div className="fabi-activity-menu">
                                {overflow.map((t, i) => (
                                    <button
                                        key={i}
                                        className={'fabi-activity-menu-item' + (t === current ? ' active' : '')}
                                        onClick={() => this.onItemClick(t)}
                                    >
                                        <span className={'fabi-activity-icon ' + (t.iconClass || '')} />
                                        <span className="label">{t.label || t.caption}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }
}
