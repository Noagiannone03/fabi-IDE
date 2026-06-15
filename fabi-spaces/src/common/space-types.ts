// Contrat partagé entre le main (SpaceManager) et le chrome (le rail).
// Un « Space » = un bureau de travail = un workspace Theia + son identité visuelle.
// Le rail n'est qu'une vue de cet état ; la vérité vit dans le main (SpaceStore).

/**
 * Palette d'accents d'un Space = les **couleurs système Apple** (valeurs dark-mode
 * officielles de la HIG). Vives mais raffinées — c'est la signature « Arc / macOS »,
 * à l'opposé des pastels désaturés génériques. Une couleur pleine par bureau.
 */
export const SPACE_COLORS = [
    '#0A84FF', // bleu (défaut) — systemBlue
    '#5E5CE6', // indigo      — systemIndigo
    '#BF5AF2', // violet      — systemPurple
    '#FF375F', // rose        — systemPink
    '#FF453A', // rouge       — systemRed
    '#FF9F0A', // ambre       — systemOrange
    '#FFD60A', // jaune       — systemYellow
    '#30D158', // vert        — systemGreen
    '#40C8E0', // cyan        — systemTeal
    '#8E8E93'  // graphite    — systemGray (neutre)
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

/** Données envoyées au modal de création à son ouverture. */
export interface NewSpaceModalInit {
    folder: string;
    defaultName: string;
    color: string;
}

/** Résultat renvoyé par le modal de création (« Créer »). */
export interface NewSpaceModalResult {
    name: string;
    icon: string;
    color: string;
}

/** État complet envoyé au chrome (rail + topbar) à chaque changement (idempotent). */
export interface SpacesState {
    spaces: SpaceDescriptor[];
    /** id du Space actuellement affiché. */
    activeId: string | undefined;
    /** ids des Spaces « vivants » (vue matérialisée) — les autres sont suspendus. */
    liveIds: string[];
    /** La sidebar est-elle dépliée (toggle) ? */
    expanded: boolean;
    /** Couleur d'accent du Space actif (pour teinter le chrome + l'IDE, façon « relié »). */
    activeColor: string | undefined;
    /** Nom affiché du Space actif (pour l'îlot-nom dans la barre de titre). */
    activeName: string | undefined;
    /** Icône du Space actif (codicon name ou emoji) — affichée dans le badge du haut. */
    activeIcon: string | undefined;
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
    export const TOGGLE_SIDEBAR = 'fabi-spaces:toggle-sidebar'; // () déplie/replie la sidebar
    export const WINDOW = 'fabi-spaces:window';          // ('minimize'|'maximize'|'close') contrôles fenêtre hôte

    // --- Modal de création d'un Space (popup centré) ---
    export const MODAL_OPEN = 'fabi-spaces:modal-open';        // main → modal : {folder, defaultName, color}
    export const MODAL_FOLDER = 'fabi-spaces:modal-folder';    // main → modal : (folderPath) après re-sélection
    export const MODAL_CREATE = 'fabi-spaces:modal-create';    // modal → main : {name, icon, color}
    export const MODAL_CANCEL = 'fabi-spaces:modal-cancel';    // modal → main : ()
    export const MODAL_PICK_FOLDER = 'fabi-spaces:modal-pick-folder'; // modal → main : () ré-ouvre le picker OS
}
