# Changelog

Toutes les évolutions notables de Fabi sont consignées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## [0.1.0] — 2026-06-22

Première version *versionnée* de Fabi, accompagnée d'un **gros rafraîchissement
de la direction artistique** (« Fabi 2026 »).

### Design — refonte « Fabi 2026 »
- **Socle de tokens unique** (`fabi-branding/.../style/fabi-tokens.css`) : surfaces,
  texte, accent, rayons, espacements, échelle typographique et **motion** centralisés.
  Tout le CSS de marque consomme désormais ces variables (fini les valeurs en dur).
- **Profondeur calme** : hiérarchie portée par des *hairlines* + des paliers de
  surface near-black plutôt que par des ombres épaisses. Canvas plus profond,
  ombres allégées (look 2026, plus le halo lourd d'avant).
- **Accent de marque réintroduit avec discipline** : l'orange renard `#EC5B2B`
  redevient l'accent unique (CTA primaire, focus, onglet actif, sélection palette),
  le reste du chrome restant neutre.
- **Composants refondus** : boutons (tailles 28/32, press tactile), champs (focus
  ring 2 couches), onglets *borderless* à fond plein, menus, palette de commandes
  translucide, scrollbars.
- **Typographie** : échelle formalisée (11→28px), système 3 graisses (400/500/600),
  tracking négatif sur les titres.
- **Motion** : courbe ease-out premium + retours tactiles `scale()` sur les boutons.
- **Page d'accueil** redessinée.

### Divers
- Passage de la version `0.0.0` → `0.1.0` (lerna + tous les workspaces).
