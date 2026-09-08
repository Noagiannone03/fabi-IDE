# Midnight — qualification encore nécessaire

Cette refonte n'est pas déclarée terminée. Les modifications de sources et les
tests isolés ne prouvent pas le fonctionnement de l'application entière.
La contrainte utilisateur interdit les compilations et vérifications lourdes sur
ce Mac. Aucun envoi de branche ni déclenchement CI n'a été autorisé pour cette passe.

## État par exigence

| Exigence | Évidence disponible | Ce qui manque |
| --- | --- | --- |
| Identité sombre, typographie propre | Midnight, Geist embarquée avec licence, thème Monaco et tokens ANSI/syntaxe | Capture du shell complet et vérification de la cascade avec les extensions |
| Repères IDE conservés | Arbre gauche, éditeur central, nouveaux agents à droite, terminaux en bas dans les sources | Ouvertures réelles, dimensions à différentes tailles, comportement clavier |
| Spaces repensés | Barre horizontale et gestion à la demande ; tests HTML/JS avec IPC simulé | Switch des WebContentsView, dialogue OS, restauration, création/fermeture natives |
| Dock simple et fiable | Réutilisation des vues ; géométrie et montage testés avec Lumino installé | Widget React réel, extensions nombreuses, raccourcis, focus et récupération d'erreurs |
| Fichiers récents et changements | MRU par workspace, ressources SCM, ouverture du diff via le fournisseur | Persistance après redémarrage, multi-root, renommage/suppression, staged/non-staged réels |
| Agents accessibles et états honnêtes | Sélecteur clavier, erreurs affichées, contrôles de permission conservés | Moteur disponible, connexion, génération, interruption, sessions simultanées |
| Terminal facile d'accès | Commandes réutilisant les terminaux, défaut en panneau bas | Identité PTY conservée après masquage/réaffichage et changements de Space |
| Cohérence des composants | Accueil, sélecteurs, menus, dialogues, réglages, notifications, Maestro modifiés | Vérification visuelle en situation, détails non couverts révélés par cette inspection |
| Conservation des sessions | Suppressions forcées de vues retirées, placements restaurés préservés par intention | Relance Electron avec fichiers non enregistrés, conversations et terminaux ouverts |
| Produit réellement utilisable | Contrôles syntaxiques et tests isolés disponibles | Compilation/typecheck, tests produit existants, essais navigateur et Electron |

## Contrôles légers déjà utilisés

- `node tools/check-dock-geometry.cjs` : 36 capacités et 9 positions de menu,
  corps de méthodes sources autonomes exécutés sans compilation du projet.
- `node tools/check-midnight-chrome.mjs` : pages natives statiques, pont IPC simulé,
  interactions DOM et styles calculés sur markup minimal. Pas une validation des
  clics physiques ni des IPC Electron.
- `node tools/check-midnight-layout.mjs` : distributions navigateur Lumino déjà
  installées, montage source du dock, trois viewports, arbre ouvert/fermé,
  non-chevauchement, garde Maestro. Vues métier remplacées par des doublures.
- Analyse syntaxique TS/TSX/CSS, `node --check` et `git diff --check`.

Ces contrôles ne remplacent pas un typecheck. Les bundles précédemment compilés
ne contiennent pas la refonte actuelle : leur affichage ne la valide pas.

## Route de qualification trouvée, non déclenchée

`.github/workflows/package-candidate.yml` propose un déclenchement manuel sur
macOS 15 : Node 22, Yarn 1.22.22, dépendances figées, tests fabi-swarm/fabi-spaces,
packaging Electron, vérification native et artefacts de qualification.
Ce workflow est une possibilité à soumettre à l'utilisateur, pas une autorisation
d'envoyer le code ou d'engager une exécution distante.

Après choix d'une machine/CI autorisée :

1. Compiler et exécuter les tests produit sur les modifications exactes ; corriger
   les erreurs avant toute conclusion visuelle.
2. Tester le parcours dossier → Space → fichier → édition → diff → agent → terminal.
3. Inspecter le shell complet à grande et petite taille, les menus ouverts, les
   erreurs et l'état sans projet. Corriger les défauts constatés.
4. Fermer et relancer avec une disposition modifiée et des sessions ouvertes.
5. Refaire l'audit ci-dessus avec les preuves de cette révision précise.

Ne pas publier une release ni considérer le goal terminé avant ces validations.
