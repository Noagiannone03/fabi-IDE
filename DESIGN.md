# 🦊 Fabi — Design System & ADN

Ce document décrit **l'identité visuelle de Fabi** et **comment styliser n'importe quel
élément** sans casser la mise en page de Theia. À lire avant de toucher au CSS.

Tout le style de marque vit dans **`fabi-branding/src/browser/style/`** :

| Fichier | Rôle |
|---|---|
| `index.css` | Variables de marque + surcharges de couleurs Theia + page d'accueil + dialog À-propos |
| `fabi-ui-polish.css` | Arrondis génériques (champs, boutons, menus, palette, scrollbars…) |
| `fabi-islands.css` | Le design **« îlots »** (panneaux flottants, onglets-chips, en-têtes, activity bar) |

Ces 3 feuilles sont importées dans `fabi-branding-frontend-module.ts`. Le thème de
couleurs **« Fabi Islands »** est, lui, un thème workbench enregistré via
`fabi-theme-contribution.ts` (`theme/fabi-islands-theme.ts`).

---

## 1. L'ADN

Fabi = un IDE **sombre, profond, en îlots flottants**, façon « dynamic islands ».
Inspiré de *bwya77/vscode-dark-islands*, mais **Material** (pas glassmorphism) et
décliné aux couleurs Fabi.

Trois mots : **profond · arrondi · posé**.

- **Profond** — un canvas très sombre (`#0b0b0e`) sur lequel *flottent* des surfaces.
- **Arrondi** — tout est adouci ; aucun angle vif, aucun trait dur.
- **Posé (Material)** — la profondeur vient de l'**élévation par l'ombre**, pas de
  reflets « verre ». Surfaces pleines, hiérarchie par la couleur et l'ombre.

---

## 2. Palette officielle

### Marque (orange renard 🦊)
| Token | Hex | Usage |
|---|---|---|
| `--fabi-orange` | `#EC5B2B` | Accent principal : boutons, liens, focus, logo |
| `--fabi-orange-hover` | `#FF7A4F` | Survol |
| `--fabi-orange-deep` | `#A03A18` | Ombres/contours du renard |
| `--fabi-yellow` | `#FFC58A` | Accent secondaire |
| `--fabi-blue` | `#94A3B8` | Wordmark « bi », liens froids |

### Surfaces (du plus profond au plus clair)
| Token | Hex | Usage |
|---|---|---|
| `--fabi-canvas` | `#0b0b0e` | Fond profond **derrière** les îlots (les gaps) |
| `--fabi-surface` | `#181a1d` | Surface des îlots (éditeur, panneaux) |
| en-tête de section | `#22252b` | Îlots détachés (headers de section) |
| onglet inactif | `#16181c` | Chip d'onglet au repos |
| onglet actif | `#2b2f37` / `#2f333b` | Chip d'onglet sélectionné (gris clair) |
| sélection neutre | `rgba(255,255,255,0.09)` | État « selected » (activity bar…) |

> ⚠️ Le thème de couleurs `fabi-islands` est dérivé de dark-islands **avec son bleu
> d'accent remplacé par l'orange Fabi** (`tools`/script de génération). Si on régénère
> le thème, re-appliquer ce remplacement.

---

## 3. Les RÈGLES (do / don't)

✅ **À FAIRE**
- Arrondir : rayons `7–9px` (composants), `15–17px` (panneaux/îlots).
- Différencier par la **couleur** (gris plus clair = actif/sélectionné).
- Profondeur par **ombre douce** + hairline uniforme `rgba(255,255,255,0.05)`.
- Garder l'orange comme **accent de marque** (boutons, liens, logo) — avec parcimonie.
- Icônes de fichiers : **Material Icon Theme** (défaut) ou Catppuccin Noctis.

🚫 **À NE PAS FAIRE**
- ❌ **Glassmorphism** : pas de dégradés blancs translucides, pas de reflets
  directionnels « verre ». (Material = surfaces pleines + ombre.)
- ❌ **Contours/liserés orange** sur sélection (focus ring dur, bordure d'onglet,
  liseré d'activity bar). → remplacer par un **fond** (gris ou tonal) + arrondi.
- ❌ **Marges** sur des éléments positionnés en **absolu** par Lumino (voir §4).
- ❌ Angles vifs, séparateurs 1px durs et contrastés.

---

## 4. ⚙️ Techniques (le cœur — à connaître absolument)

Theia/Lumino positionne beaucoup d'éléments en **`position: absolute`** (panneaux,
conteneurs de vues). Sur ceux-là, **`margin` ne fait RIEN**. D'où ces patterns :

### A. Île flottante sur élément absolu → « bordure = gap »
Les widgets Lumino sont déjà en `box-sizing: border-box`. Une **bordure de la couleur
du canvas** creuse l'élément vers l'intérieur (révélant le canvas autour) **sans**
déplacer la box que Lumino a positionnée :

```css
#theia-main-content-panel,
#theia-bottom-content-panel,
#theia-left-content-panel > .lm-BoxPanel-child:not(.theia-app-sidebar-container) {
    border: var(--fabi-gap) solid var(--fabi-canvas) !important; /* le « gap » */
    border-radius: var(--fabi-island-radius) !important;
    box-shadow: var(--fabi-island-shadow) !important;            /* élévation */
    overflow: hidden !important;
    background-color: var(--fabi-surface);
}
```

### B. Onglets-chips dans une barre → **hauteur fixe**, pas de marge qui déborde
Un onglet qui fait `hauteur_barre + marge_verticale` **dépasse** la barre et se fait
**rogner** par l'`overflow:hidden` du panneau. Règle : `hauteur_chip + 2×marge =
hauteur_barre`.

```css
/* barre de 35px → chip 27 + marge 4 = 35 : rentre pile, flotte, aucune coupe */
#theia-bottom-content-panel .lm-TabBar .lm-TabBar-tab {
    height: 27px !important;
    margin: 4px !important;
    border-radius: 9px !important;
}
```
(Les onglets éditeur, eux, sont des chips à marges **égales** actif/inactif → zéro
saut de layout au changement.)

### C. En-tête `position: static` qui ne « décroche » pas → **fond distinct**
Si la marge s'applique (élément `static`) mais que l'îlot reste invisible, c'est que
son **fond est identique au panneau**. Donner un fond plus clair :

```css
.theia-view-container-part-header {
    background-color: #22252b !important;  /* distinct du surface #181a1d */
    border-radius: 8px !important;
    margin: 7px 6px !important;
}
```

### D. Retinter Theia sans casser le thème → variables CSS `!important`
Theia injecte ses couleurs en variables `--theia-*` **sans** `!important`. Les nôtres,
posées sur `:root` avec `!important`, **gagnent toujours** — quel que soit l'ordre du
cascade, sans toucher au thème :

```css
:root {
    --theia-button-background: #EC5B2B !important;
    --theia-tab-activeBackground: #2f333b !important;
    --theia-activityBar-activeBorder: transparent !important; /* tue le liseré orange */
}
```

### E. Tuer un fond/contour parasite → inspecter le DOM, ne pas deviner
Beaucoup de « carrés moches » viennent du **fond d'un élément précis** (ex. l'icône
`i.codicon` du Settings avait un fond carré solide). Méthode : `elementsFromPoint` +
`getComputedStyle` pour trouver l'élément fautif, puis le neutraliser ciblé.

> 🔎 **Toujours mesurer le DOM réel** (positions, tailles, `overflow`, `background`)
> avant d'écrire du CSS sur le shell Theia. On ne devine pas — on mesure, on corrige,
> on vérifie par capture d'écran.

---

## 5. Sélecteurs utiles (shell Theia)

| Zone | Sélecteur |
|---|---|
| Shell racine / canvas | `#theia-app-shell`, `#theia-left-right-split-panel` |
| Zone éditeur | `#theia-main-content-panel` |
| Panneau du bas | `#theia-bottom-content-panel` |
| Panneaux latéraux (île) | `#theia-{left,right}-content-panel > .lm-BoxPanel-child:not(.theia-app-sidebar-container)` |
| Activity bar | `.theia-app-sidebar-container`, items `.lm-TabBar-tab`, actif `.lm-mod-current` |
| Onglets éditeur | `#theia-main-content-panel .lm-TabBar.theia-app-centers .lm-TabBar-tab` |
| Onglets bas | `#theia-bottom-content-panel .lm-TabBar .lm-TabBar-tab` |
| En-tête de section | `.theia-view-container-part-header` |
| Titre de panneau | `.theia-sidepanel-toolbar` |
| Menus | `.lm-Menu`, items `.lm-Menu-item` |
| Palette / quick input | `.quick-input-widget` |
| Scrollbars | `::-webkit-scrollbar-thumb`, `.monaco-scrollable-element .slider` |

---

## 6. Workflow pour styliser un nouvel élément

1. **Inspecter** : `position`, taille, `overflow`, `background` de l'élément et de ses
   parents (script Puppeteer headless → screenshot + `getComputedStyle`).
2. **Choisir la technique** (§4) selon que l'élément est `absolute` ou `static`.
3. **Écrire** dans `fabi-islands.css` (îlots) ou `fabi-ui-polish.css` (arrondis génériques).
4. **Builder** (`yarn build:browser`) et **vérifier par capture** — jamais à l'aveugle.
5. Respecter l'ADN (§1) et les règles (§3) : arrondi, gris pour la sélection, ombre
   pour la profondeur, orange = accent rare.

> *Pas de bidouille : on mesure, on applique la bonne technique, on vérifie.*
