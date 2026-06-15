import * as React from '@theia/core/shared/react';

/**
 * Le VRAI renard Fabi (ta mascotte) posé au-dessus d'un clavier, avec deux pattes
 * qui dépassent et tapent — animation « en train de coder ».
 *
 * On réutilise la grille pixel officielle de la mascotte (cf.
 * fabi-branding/src/common/fox.ts — source de vérité, recopiée ici pour rester
 * self-contained). Sous le renard : un clavier pixel soigné (châssis avec relief +
 * deux rangées de touches) dont les touches s'illuminent en VAGUE gauche→droite,
 * et deux pattes (calque animé) qui tapent en alternance. Anim CSS (cf. §9).
 */

// --- mascotte Fabi (synchro depuis fabi-branding/src/common/fox.ts) ---
const FOX_PALETTE: Record<string, string | undefined> = {
    '.': undefined,
    '1': '#000000',
    '2': '#A03A18',
    '3': '#EC5B2B',
    '4': '#F5E6D3',
    '5': '#FFFFFF'
};
const FOX_GRID: readonly string[] = [
    '.2..........2.',
    '.22........22.',
    '.242......242.',
    '22433333333422',
    '.233333333332.',
    '.233351331532.',
    '.233311331132.',
    '.233344334432.',
    '.233344114432.',
    '.233344444432.',
    '..2334444332..',
    '...23344332...'
];
const FOX_W = 14;
const FOX_H = 12;

// --- clavier (relief) + pattes ---
const KB_BODY = '#363C45';   // châssis
const KB_TOP = '#525A66';    // arête haute (rim light)
const KB_FRONT = '#20242A';  // façade (ombre basse)
const KB_KEY = '#727A86';    // touche éteinte
const ARM = '#EC5B2B';       // orange brand (= tête)
const TOE = '#F5E6D3';       // crème (= museau)

// Touches : 2 rangées décalées (azerty-like). Délai = cascade gauche→droite.
const KEYS: ReadonlyArray<{ x: number; y: number }> = [
    { x: 2, y: 14 }, { x: 4, y: 14 }, { x: 6, y: 14 }, { x: 8, y: 14 }, { x: 10, y: 14 }, { x: 12, y: 14 },
    { x: 3, y: 16 }, { x: 5, y: 16 }, { x: 7, y: 16 }, { x: 9, y: 16 }, { x: 11, y: 16 }
];
const KEY_CYCLE = 1.3; // s

export const FabiTypingFox: React.FC<{ size?: number; className?: string }> = ({ size = 84, className }) => {
    const VB_H = 19; // renard (12) + pattes + clavier en relief (y13..18)
    const foxRects: React.ReactNode[] = [];
    for (let y = 0; y < FOX_H; y++) {
        const row = FOX_GRID[y];
        for (let x = 0; x < FOX_W; x++) {
            const color = FOX_PALETTE[row[x]];
            if (color) {
                foxRects.push(<rect key={`f${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={color} />);
            }
        }
    }
    return (
        <svg
            className={`fabi-fox ${className ?? ''}`}
            width={size}
            height={size * VB_H / FOX_W}
            viewBox={`0 0 ${FOX_W} ${VB_H}`}
            shapeRendering="crispEdges"
            aria-hidden="true"
            focusable="false"
        >
            {/* ---- Le renard (ton icône), léger bob ---- */}
            <g className="fabi-fox-bob">{foxRects}</g>

            {/* ---- Clavier pixel en relief ---- */}
            {/* châssis */}
            <rect x="1" y="13" width="12" height="5" fill={KB_BODY} />
            {/* arête haute (lumière) + coins « rabotés » pour adoucir */}
            <rect x="2" y="13" width="10" height="1" fill={KB_TOP} />
            {/* façade (ombre) */}
            <rect x="1" y="18" width="12" height="1" fill={KB_FRONT} />
            <rect x="2" y="17" width="10" height="1" fill={KB_FRONT} />
            {/* touches (s'illuminent en vague) */}
            {KEYS.map((k, i) => (
                <rect
                    key={`k${k.x}-${k.y}`}
                    className="fabi-fox-key"
                    x={k.x}
                    y={k.y}
                    width="1"
                    height="1"
                    fill={KB_KEY}
                    style={{ animationDelay: `${(k.x / (FOX_W - 1) * KEY_CYCLE).toFixed(2)}s` }}
                />
            ))}

            {/* ---- Deux pattes qui dépassent et tapent (alternance) ---- */}
            <g className="fabi-fox-paw fabi-fox-paw-l">
                <rect x="4" y="12" width="2" height="2" fill={ARM} />
                <rect x="4" y="14" width="2" height="1" fill={TOE} />
            </g>
            <g className="fabi-fox-paw fabi-fox-paw-r">
                <rect x="8" y="12" width="2" height="2" fill={ARM} />
                <rect x="8" y="14" width="2" height="1" fill={TOE} />
            </g>
        </svg>
    );
};
