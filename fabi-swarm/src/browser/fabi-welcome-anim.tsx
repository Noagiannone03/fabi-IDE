import * as React from '@theia/core/shared/react';
import { foxRects, fileRects } from './fabi-pixel';

/**
 * Animation d'accueil pixel-art : DEUX renards Fabi (gros, bien espacés) reliés
 * par une connexion. Un fichier de code circule ENTRE eux (sur le lien, jamais
 * sur la tête) en va-et-vient ; celui qui le reçoit « code » un bon moment
 * (clavier + pattes qui tapent, touches qui s'illuminent), puis le renvoie. On
 * voit la connexion se faire. Lent et doux. Tout en CSS (cf. fabi-swarm.css §12).
 *
 * Géométrie en unités SVG (viewBox 72×32). Renards mis à l'échelle (×1.6).
 */
const SCALE = 1.6;

// renards : translate + scale (attribut) ; fade sur le groupe interne (CSS).
const FOXES = [
    { tx: 2, ty: 3, k: 'L', kbx: 6, kby: 23 },    // gauche
    { tx: 48, ty: 3, k: 'R', kbx: 52, kby: 23 }   // droite (bien espacé)
];

export const FabiWelcomeAnim: React.FC<{ size?: number }> = ({ size = 248 }) => (
    <svg
        className="fabi-wa"
        width={size}
        height={size * 32 / 72}
        viewBox="0 0 72 32"
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
    >
        {/* lien de connexion entre les deux renards */}
        <line className="fabi-wa-wire" x1="26" y1="14" x2="46" y2="14" />

        {/* claviers sous chaque renard (visibles quand il code) */}
        {FOXES.map(f => (
            <g key={`k${f.k}`} transform={`translate(${f.kbx} ${f.kby})`}>
                <g className={`fabi-wa-kbd fabi-wa-kbd-${f.k}`}>
                    <rect x="0" y="0" width="15" height="3.5" fill="#3a4049" />
                    <rect x="0" y="0" width="15" height="1" fill="#525a66" />
                    {[1, 3, 5, 7, 9, 11, 13].map((kx, i) => (
                        <rect
                            key={`wk${f.k}-${kx}`}
                            className="fabi-wa-key"
                            x={kx}
                            y="1.2"
                            width="1"
                            height="1"
                            fill="#727a86"
                            style={{ animationDelay: `${(i * 0.12).toFixed(2)}s` }}
                        />
                    ))}
                    {/* pattes qui tapent (comme l'anim « il code ») */}
                    <g className="fabi-wa-paw fabi-wa-paw-l">
                        <rect x="3" y="-3" width="2" height="3.5" fill="#ec5b2b" />
                        <rect x="3" y="0" width="2" height="1.2" fill="#f5e6d3" />
                    </g>
                    <g className="fabi-wa-paw fabi-wa-paw-r">
                        <rect x="10" y="-3" width="2" height="3.5" fill="#ec5b2b" />
                        <rect x="10" y="0" width="2" height="1.2" fill="#f5e6d3" />
                    </g>
                </g>
            </g>
        ))}

        {/* les deux renards (gros), fondu d'entrée décalé */}
        {FOXES.map(f => (
            <g key={`f${f.k}`} transform={`translate(${f.tx} ${f.ty}) scale(${SCALE})`}>
                <g className={`fabi-wa-fox fabi-wa-fox-${f.k}`}>{foxRects(`wf${f.k}`)}</g>
            </g>
        ))}

        {/* fichier de code qui circule ENTRE les deux (sur le lien) */}
        <g className="fabi-wa-file">
            <g transform="translate(-4 8.5)">{fileRects('wc')}</g>
        </g>
    </svg>
);
