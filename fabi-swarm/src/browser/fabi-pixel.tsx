import * as React from '@theia/core/shared/react';

/**
 * Briques pixel-art partagées (renard Fabi, serveur, fichier de code) pour les
 * animations d'accueil et de connexion. Chaque générateur renvoie des <rect>
 * SVG en coordonnées locales (origine 0,0), à placer dans un <g transform>.
 * `shapeRendering="crispEdges"` côté <svg> garde le rendu net.
 */

// --- mascotte Fabi (synchro depuis fabi-branding/src/common/fox.ts) ---
export const FOX_PALETTE: Record<string, string | undefined> = {
    '.': undefined,
    '1': '#000000',
    '2': '#A03A18',
    '3': '#EC5B2B',
    '4': '#F5E6D3',
    '5': '#FFFFFF'
};
export const FOX_GRID: readonly string[] = [
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
export const FOX_W = 14;
export const FOX_H = 12;

export function foxRects(prefix = 'f'): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    for (let y = 0; y < FOX_H; y++) {
        const row = FOX_GRID[y];
        for (let x = 0; x < FOX_W; x++) {
            const color = FOX_PALETTE[row[x]];
            if (color) {
                out.push(<rect key={`${prefix}${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={color} />);
            }
        }
    }
    return out;
}

// --- serveur pixel (12 × 16) : baie 3U avec LEDs qui clignotent ---
export const SERVER_W = 12;
export const SERVER_H = 16;

export function serverRects(prefix = 's'): React.ReactNode[] {
    const BODY = '#313842';
    const EDGE = '#222831';
    const RIM = '#3E4651';
    const BAY = '#262C35';
    const out: React.ReactNode[] = [];
    // châssis
    out.push(<rect key={`${prefix}edge`} x="0" y="0" width={SERVER_W} height={SERVER_H} fill={EDGE} />);
    out.push(<rect key={`${prefix}body`} x="1" y="1" width={SERVER_W - 2} height={SERVER_H - 2} fill={BODY} />);
    out.push(<rect key={`${prefix}rim`} x="1" y="1" width={SERVER_W - 2} height="1" fill={RIM} />);
    // 3 baies + LED qui clignote (décalage par baie)
    [3, 7, 11].forEach((by, i) => {
        out.push(<rect key={`${prefix}bay${i}`} x="2" y={by} width="8" height="2" fill={BAY} />);
        out.push(
            <rect
                key={`${prefix}led${i}`}
                className="fabi-srv-led"
                x="8"
                y={by}
                width="1"
                height="1"
                fill="#7BD88F"
                style={{ animationDelay: `${(i * 0.4).toFixed(2)}s` }}
            />
        );
        // fentes de ventilation
        out.push(<rect key={`${prefix}slot${i}`} x="3" y={by + 1} width="3" height="1" fill="#1C2128" />);
    });
    return out;
}

// --- fichier de code pixel (8 × 11) : doc sombre + lignes de code colorées ---
export const FILE_W = 8;
export const FILE_H = 11;

export function fileRects(prefix = 'c'): React.ReactNode[] {
    const PAGE = '#2B313A';
    const EDGE = '#4A535F';
    return [
        <rect key={`${prefix}pg`} x="0" y="0" width={FILE_W} height={FILE_H} fill={PAGE} />,
        <rect key={`${prefix}b`} x="0" y="0" width={FILE_W} height="1" fill={EDGE} />,
        <rect key={`${prefix}corner`} x={FILE_W - 2} y="0" width="2" height="2" fill={EDGE} />,
        // lignes de code
        <rect key={`${prefix}l1`} x="1" y="3" width="4" height="1" fill="#EC5B2B" />,
        <rect key={`${prefix}l2`} x="1" y="5" width="5" height="1" fill="#D8DCE3" />,
        <rect key={`${prefix}l3`} x="1" y="7" width="3" height="1" fill="#6BA8FF" />,
        <rect key={`${prefix}l4`} x="1" y="9" width="5" height="1" fill="#7BD88F" />
    ];
}
