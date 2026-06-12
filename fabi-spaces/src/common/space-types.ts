// Contrat partagé entre le main (SpaceManager) et le chrome (le rail).
// Un « Space » = un bureau de travail = un workspace Theia + son identité visuelle.
// Le rail n'est qu'une vue de cet état ; la vérité vit dans le main (SpaceStore).

/** Palette d'accents proposés pour un Space (signature « couleur par bureau » façon Arc). */
export const SPACE_COLORS = [
    '#EC5B2B', // orange Fabi (défaut)
    '#E0A82E', // ambre
    '#4Fae6e', // vert
    '#3B9CCB', // bleu
    '#7C6BD6', // violet
    '#D45A8A', // rose
    '#94A3B8'  // ardoise
] as const;

export type SpaceColor = typeof SPACE_COLORS[number] | string;

/**
 * Descripteur persistant d'un Space. C'est ce qui est sérialisé dans `spaces.json`
 * et envoyé au rail. Ne contient AUCUN handle natif (vue, fenêtre) — uniquement de
 * l'état sérialisable.
 */
export interface SpaceDescriptor {
    /** Identifiant stable (ne change jamais, sert de clé partout). */
    id: string;
    /** Nom affiché. Vide → dérivé du dossier du workspace. */
    name: string;
    /** Emoji ou glyphe court affiché sur la tuile. Vide → initiale du nom. */
    emoji: string;
    /** Couleur d'accent du Space. */
    color: SpaceColor;
    /**
     * Chemin du workspace (dossier racine) ouvert dans ce Space.
     * Vide → Space « vierge » (Theia restaure le dernier / page d'accueil).
     */
    workspacePath: string;
    /** Horodatage de dernière activation (ms epoch), pour l'ordre « récents » / la suspension. */
    lastActive: number;
}

/** État complet envoyé au rail à chaque changement (un seul message, idempotent). */
export interface SpacesState {
    spaces: SpaceDescriptor[];
    /** id du Space actuellement affiché. */
    activeId: string | undefined;
    /** ids des Spaces « vivants » (vue matérialisée) — les autres sont suspendus. */
    liveIds: string[];
}

/**
 * Canaux IPC rail ⇄ main. Préfixe `fabi-spaces:` pour ne pas collisionner avec
 * les canaux Theia (`CHANNEL_*`).
 */
export namespace SpacesIpc {
    // main → rail : pousse l'état complet (le rail re-render à partir de ça).
    export const STATE = 'fabi-spaces:state';

    // rail → main : actions utilisateur.
    export const READY = 'fabi-spaces:ready';            // le rail est chargé, demande l'état initial
    export const OPEN = 'fabi-spaces:open';              // (id) afficher ce Space
    export const CREATE = 'fabi-spaces:create';          // () créer un Space (ouvre un folder picker)
    export const CLOSE = 'fabi-spaces:close';            // (id) fermer/supprimer ce Space
    export const RENAME = 'fabi-spaces:rename';          // (id, name)
    export const SET_COLOR = 'fabi-spaces:set-color';    // (id, color)
    export const SET_EMOJI = 'fabi-spaces:set-emoji';    // (id, emoji)
    export const REORDER = 'fabi-spaces:reorder';        // (orderedIds[])
    export const SHOW_OVERVIEW = 'fabi-spaces:show-overview'; // () le rail passe en overlay plein écran
    export const HIDE_OVERVIEW = 'fabi-spaces:hide-overview'; // () retour au rail fin
    export const WINDOW = 'fabi-spaces:window';          // ('minimize'|'maximize'|'close') contrôles fenêtre hôte
}
