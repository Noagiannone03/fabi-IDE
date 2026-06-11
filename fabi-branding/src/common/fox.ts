/**
 * Logo renard Fabi — source de vérité partagée (pixel-art chibi).
 * Reprend à l'identique la mascotte de fabi-cli (mascot.ts), grille 14×12.
 * Aucune dépendance : utilisable côté browser (widgets) comme pour générer
 * du markup SVG (page About, splash, etc.).
 */
export const FOX_PALETTE: Record<string, string | undefined> = {
    '.': undefined,      // transparent
    '1': '#000000',      // yeux, truffe, bouche
    '2': '#A03A18',      // orange foncé : oreilles ext., contour
    '3': '#EC5B2B',      // orange brand Fabi : tête
    '4': '#F5E6D3',      // crème : joues, intérieur oreilles, museau
    '5': '#FFFFFF'       // blanc : highlight des yeux
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

export const FOX_GRID_W = 14;
export const FOX_GRID_H = 12;

/** Couleurs officielles de la charte Fabi (réutilisées dans le thème + l'UI). */
export const FABI_COLORS = {
    orange: '#EC5B2B',
    orangeHover: '#FF7A4F',
    orangeDeep: '#A03A18',
    cream: '#FFF7F1',
    muzzle: '#F5E6D3',
    yellow: '#FFC58A',
    blue: '#94A3B8',
    inkOnOrange: '#1b1206',
    dark1: '#0b0807',
    dark2: '#15100d',
    dark3: '#1f1814'
} as const;

/**
 * Génère le markup SVG du renard (fond transparent).
 * @param pixel taille d'un pixel-art en unités SVG (défaut 1, viewBox 14×12)
 */
export function foxSvgMarkup(): string {
    let rects = '';
    for (let y = 0; y < FOX_GRID_H; y++) {
        for (let x = 0; x < FOX_GRID_W; x++) {
            const color = FOX_PALETTE[FOX_GRID[y][x]];
            if (!color) {
                continue;
            }
            rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${color}"/>`;
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FOX_GRID_W} ${FOX_GRID_H}" shape-rendering="crispEdges">${rects}</svg>`;
}
