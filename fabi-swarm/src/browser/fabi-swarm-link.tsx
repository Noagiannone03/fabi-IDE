import * as React from '@theia/core/shared/react';
import { foxRects, serverRects, FOX_H, SERVER_H } from './fabi-pixel';

/**
 * Connexion au swarm en pixel art : ta machine (le renard Fabi) ↔ un serveur,
 * avec des paquets de données qui circulent au milieu selon l'état. Remplace
 * l'ancien glyph (icônes Lucide). Mêmes props → drop-in.
 *   • flow       → paquets qui filent renard → serveur (tu contribues/consommes)
 *   • connecting → paquets qui pulsent (établissement)
 *   • waiting    → points qui clignotent lentement (en attente de pairs)
 *   • error      → lien rompu, atténué
 */
export type FabiLinkState = 'flow' | 'connecting' | 'waiting' | 'error';

const VB_W = 42;
const VB_H = 16;
const FOX_Y = (VB_H - FOX_H) / 2;        // centré vertical
const SRV_X = VB_W - 12;                  // serveur à droite
const SRV_Y = (VB_H - SERVER_H) / 2;      // débord léger, centré

export const FabiSwarmLink: React.FC<{ state?: FabiLinkState; size?: 'sm' | 'md' }> = ({ state = 'flow', size = 'sm' }) => {
    const width = size === 'md' ? 150 : 104;
    return (
        <svg
            className={`fabi-link2 state-${state}`}
            width={width}
            height={width * VB_H / VB_W}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            shapeRendering="crispEdges"
            aria-hidden="true"
            focusable="false"
        >
            {/* renard (machine) */}
            <g transform={`translate(0 ${FOX_Y})`} className="fabi-link2-fox">{foxRects('lf')}</g>
            {/* serveur (swarm) */}
            <g transform={`translate(${SRV_X} ${SRV_Y})`} className="fabi-link2-srv">{serverRects('ls')}</g>
            {/* lien + paquets au milieu (y = centre) */}
            <line className="fabi-link2-wire" x1="15" y1="8" x2="28" y2="8" />
            <g className="fabi-link2-packets">
                <rect className="fabi-link2-pkt" x="0" y="7" width="2" height="2" />
                <rect className="fabi-link2-pkt" x="0" y="7" width="2" height="2" />
                <rect className="fabi-link2-pkt" x="0" y="7" width="2" height="2" />
            </g>
            {/* « ! » au milieu : affiché en attente (pas assez de pairs) */}
            <g className="fabi-link2-alert">
                <rect x="20" y="3" width="2" height="5" fill="#f2b23a" />
                <rect x="20" y="9" width="2" height="2" fill="#f2b23a" />
            </g>
        </svg>
    );
};
