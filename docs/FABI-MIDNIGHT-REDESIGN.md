# Fabi Midnight — refonte sombre

Dernière direction utilisateur : conserver les repères des IDE actuels, repenser chaque
composant avec une identité propre, sombre, lisible et simple. Le projet clair a été
rejeté et remisé dans un stash ; la base de cette nouvelle passe est `1f27f98`.

## Références consultées

- Warp : https://styles.refero.design/style/720c9806-2d70-4dd1-9a19-12efd71fc742
- Linear : https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1
- Raycast : https://styles.refero.design/style/3b6a17f0-3bdf-418c-a95e-0b89e5a8b2f8

Retenir la précision des niveaux de surface, des contrôles et de la typographie.
Ne pas transposer leurs pages marketing dans l'IDE. Pas de gros slogans ni de
tableaux de bord décoratifs. Le code et les outils réels sont la matière de l'écran.

## Système

Geist variable pour les contrôles, JetBrains Mono pour le code. Police embarquée,
avec sa licence SIL OFL. Graphite #191a1e, code #121316, surfaces #24252b,
texte #d7d7df, accent discret #b9b4d6. Le renard conserve la marque Fabi.
Rayons 4/6/8/10/12 selon la fonction, bordures faibles, focus clavier perceptible.

## Contrainte de travail

L'utilisateur demande de ne plus compiler sur ce Mac, qui chauffe trop. Ne pas lancer
de build, de watcher de compilation ni de vérification lourde locale. Continuer les
éditions et les contrôles légers ; signaler clairement ce qui reste non compilé.

## Travail restant

- Redessiner la navigation des Spaces et leur personnalisation en cohérence avec le shell.
- Intégrer un dock discret avec les outils utiles, en supprimant les accès redondants.
- Revoir les vues d'accueil, le compositeur agent, modèles, permissions, outils, historique,
  changements Git, terminal, paramètres, dialogues et notifications.
- Vérifier les fichiers réels, raccourcis, panneaux, changements et restauration des bureaux.
- Vérifier dans le navigateur avec les extensions de langage et dans Electron.
- Inspecter les captures du shell en situation réelle, grand et petit écran.

La première passe de tokens et de contrôles est en cours ; cette liste n'est pas une validation.

## Avancement des sources — 8 septembre 2026

- Navigation des Spaces en barre horizontale : noms visibles, espace actif, création,
  accès à la gestion et navigation clavier. Mise à jour ciblée du DOM pour préserver le focus.
- Gestion latérale masquée lorsqu'elle est fermée, sans colonne d'icônes réservée ;
  viewport natif conservé à une largeur valide pour son chargement.
- Barre native de 44 px, contrôles de fenêtre conservés, permissions IPC limitées
  aux deux vues de chrome pour ouvrir/créer des Spaces et demander l'état.
- Geist embarquée dans le chrome natif ; palette graphite harmonisée.
- Maestro harmonisé : titre typographique, palette Midnight, états sémantiques
  sobres au lieu des mascottes animées dans les lignes, contrôles/composer lisibles.
  Largeur native 340 px conservée pour ne pas désaligner les WebContentsView.
- Dock standard non monté en mode Maestro (ce mode rejetait les widgets qu'il
  ouvrait). Garde vérifiée dans le test isolé Lumino, autres scénarios toujours verts.
- Maestro conserve le brouillon jusqu'à confirmation d'envoi ; échecs d'envoi et
  d'arrêt affichés. Échec de chargement distingué d'une conversation vide, avec
  action Réessayer. Syntaxe TSX/CSS vérifiée ; services live non sollicités.
- Question envoyée à l'utilisateur pour choisir une autre machine/CI de validation
  complète. Aucune autorisation de compilation locale ou d'envoi vers une CI déduite.
- `tools/check-midnight-layout.mjs` teste le montage source du dock avec les
  distributions navigateur Lumino déjà installées, sans compiler Fabi. Les vues
  métier/React sont des doublures, la mécanique BoxPanel/BoxLayout est réelle.
- Ce test a révélé une largeur minimale mise en cache après rétrécissement :
  ajout d'un recalcul `fit` dock/shell au resize, abonnement retiré avec le dock.
  Après correction : 1440×900, 900×600 et 640×400, panneau ouvert/fermé, dock de
  54 px, absence de chevauchement et largeur contenue passent. Le scénario ouvert
  exige une vraie largeur d'arbre d'au moins 224 px pour éviter un faux positif.
- Disposition par défaut cohérente avec le code visible : nouvelles conversations
  à droite, nouveaux terminaux en bas ; les options explicites et les placements
  restaurés ne sont pas déplacés. Premier panneau agents calibré entre 280 et 420 px.
  Bouton natif « Nouvelle conversation » ajouté à la barre du panneau droit.
- Faux onglet terminal retiré avec sa contribution de routage ; fermeture/suppression
  forcée des vues Outline supprimée. Ces vues restent accessibles et restaurables.
  Les changements sont réversibles via Git ; aucune session utilisateur n'a été
  fermée pendant cette passe de sources.
- Six fichiers de routage/modules analysés syntaxiquement, sans compilation.
  Coexistence réelle éditeur/agents/terminal et sauvegarde des dispositions restent
  à vérifier sur une application compilée hors de ce Mac.
- Gestion des Spaces : bouton d'options visible par projet, ouverture clavier via
  boutons natifs, déplacement haut/bas sans drag obligatoire, Maestro non modifiable.
  Icône/couleur regroupées dans un détail repliable ; sélection accessible annoncée.
  Renommage vide annulé, nom limité à 100 caractères, Échap restaure le focus.
- Contrôle statique du rail ajouté au script chrome : menu/focus, réordonnancement
  avec Maestro préservé, nom vide et annulation passent. La tentative de capture du
  rail a dépassé 10 secondes et a été abandonnée ; nouvel essai sans capture réussi.
  Aucune capture récente du rail ne constitue donc une validation visuelle à ce stade.
- Dock : retrait des vues inactives et changements de titres suivis, abonnements
  explicitement nettoyés, clés React stables. Menu des vues supplémentaires avec
  focus initial, flèches/Haut/Bas/Début/Fin, Échap et retour au déclencheur.
  Placement du menu borné au viewport et hauteur défilable, recalcul au resize.
- `node tools/check-dock-geometry.cjs` passe : 36 combinaisons nombre de vues / largeur
  et 9 placements de menu. Le script analyse puis exécute les corps JavaScript
  autonomes des méthodes sources, sans compiler le projet. Il ne teste pas encore
  les événements React/Lumino ni les extensions en fonctionnement.
- Une erreur de lancement d'outil ne bloque plus les boutons du dock en attendant
  la fermeture de la notification d'erreur.
- Réglages et notifications couverts par `fabi-native-midnight.css` : catégories,
  descriptions, recherche, valeurs modifiées, erreurs, surfaces et actions des messages.
  Notifications placées au-dessus du dock, largeur limitée au viewport ; états fermés
  et icônes de gravité natifs conservés. Tokens de thème correspondants explicités.
- Contrôle statique étendu avec feuilles natives Theia : couleur des descriptions,
  position des notifications, conservation de `display:none` et largeur à 360 px
  passent. Ceci n'est pas un test de modification effective des préférences.
- Ouverture automatique de l'explorateur limitée à un layout neuf. Un panneau
  gauche fermé dans une session restaurée n'est plus rouvert systématiquement.
- Ancienne suppression globale du focus retirée des imports. Focus des arbres,
  listes et onglets rétabli ; tokens de focus Monaco explicites. Les sélecteurs
  d'onglets Midnight égalent maintenant la priorité des anciennes règles Islands.
- Dialogues natifs ciblés via leurs classes réelles `dialogOverlay / dialogBlock`
  (les premières règles `.theia-dialog` étaient sans effet sur ces dialogues).
- Contrôle statique de cascade ajouté au script chrome : chargement des feuilles
  réelles, calcul des marges/rayons/fond de l'onglet, du fond du dialogue et du focus
  d'arbre sur markup minimal. Assertions réussies. Ce test ne lance pas le shell
  et ne valide pas sa géométrie native.
- Un essai du test a attendu dans la simulation Puppeteer d'un clic. Instance
  arrêtée ; limite de protocole ajoutée, actions statiques exécutées via DOM click.
  Le nouvel essai passe. La précision des clics physiques reste à tester dans l'IDE.
- Accueil enrichi d'un filtre Récents / Changements, alimenté par `ScmService` :
  événements d'ajout/retrait de dépôt et de modification des ressources, sans polling.
  Les entrées indexées et non indexées sont conservées séparément ; clic via
  `resource.open()` pour ouvrir la comparaison native correspondante. Douze entrées
  visibles avec accès au contrôle de version complet. États vides sans inventer
  un dépôt ou annoncer prématurément qu'il est propre ; erreurs d'ouverture visibles.
- Dépendance directe `@theia/scm` 1.72.2 déclarée dans fabi-branding ; version déjà
  présente dans node_modules et yarn.lock. Aucun install/build lancé. Analyse de
  syntaxe TSX et CSS réussie ; comportement réel SCM non validé dans cette passe.
- Panneau agents : accueil compact sans illustration animée permanente ni promesse
  « sans limite », modèle/connexion/modes harmonisés avec Midnight. Les couleurs
  d'alerte des permissions automatiques sont conservées, pas assimilées à un accent décoratif.
- Modèles rendus comme boutons natifs avec état sélectionné et texte hors ligne ;
  focus à l'ouverture, Échap ferme et rend le focus au déclencheur. Les erreurs
  d'installation, connexion et déconnexion sont affichées. Une garde synchrone
  empêche deux demandes simultanées. Aucune installation ou connexion lancée pour tester.
- Syntaxe TSX du sélecteur et de l'accueil agents contrôlée ; rendu, transitions
  de disponibilité et utilisation effective du moteur restent non validés.
- Création de Space redessinée : nom et dossier au premier niveau, personnalisation
  repliée par défaut, bouton de validation neutre, labels et erreurs accessibles,
  focus clavier contenu dans le dialogue, garde contre le double envoi. Le manager
  empêche deux parcours de création simultanés dès le sélecteur de dossier natif.
- `tools/check-midnight-chrome.mjs` exécuté sur les HTML/CSS/JS sources avec un pont
  IPC simulé : validation, focus, petit écran 640×400, envoi unique et navigation
  clavier des Spaces passent. Aucun backend, build ou Electron lancé. Capture de
  la fenêtre de création inspectée : `/tmp/fabi-midnight-modal.png` (temporaire).
  Ce test ne valide pas les dialogues OS, les IPC natifs ou le shell de l'IDE.
- Accueil remplacé : titre du projet, deux actions principales, huit fichiers récents
  visibles, accès à l'arborescence et aux changements Git. Les fonctions avancées
  restent dans les vues et la palette plutôt que dans onze cartes de démarrage.
- Historique MRU limité à douze URI, enregistré par workspace, sans scan ni polling.
  Les URI temporaires et hors workspace sont exclues ; les lectures restaurées sont
  filtrées et dédupliquées. Retirer un récent ne touche pas au fichier. Les échecs
  d'ouverture sont affichés dans la ligne et ne retirent pas arbitrairement l'entrée.
- Plus d'ouverture forcée du chat au démarrage : le focus et le layout restaurés
  sont préservés. Syntaxe des trois fichiers de l'accueil contrôlée sans compilation.
  Persistance réelle, rendu compact et ouverture des fichiers restent à tester.
- Thème Monaco Midnight raccordé sous l'identifiant historique `fabi-islands` :
  couverture syntaxique existante conservée, nouvelle palette pour les scopes et
  tokens sémantiques, suggestions, sélection, différences Git et 16 couleurs ANSI.
  Les styles `bold`/`italic` et les transparences des tokens sont conservés.
- Contraste calculé sans navigateur : code 12,98:1 et commentaires 6,04:1 sur
  #121316 ; texte secondaire #92929e à 4,97:1 sur #24252b. Les anciens textes
  secondaires trop faibles ont été éclaircis. Ce contrôle ne prouve pas encore
  le contraste de tous les états rendus par la cascade CSS.
- Dock global ajouté au layout du shell, au-dessus du statut : il réutilise la barre
  de vues existante (extensions et ordre conservés), puis expose Terminal, Agents,
  Commandes et Réglages. Les raccourcis doublons sont masqués seulement si le dock est installé.
- Explorateur repliable après montage réussi du dock ; fallback de navigation conservé.
- Le dock réactive les terminaux/conversations existants avant d'en créer. Le démarrage
  ne ferme plus toutes les vues restaurées à droite. Les boutons affichent les erreurs réelles.
- Syntaxe TS/TSX des fichiers de navigation analysée sans émission ni vérification de
  types ; géométrie Lumino, ouverture/masquage, accessibilité et restauration restent
  à vérifier dans une application compilée sur une machine adaptée.
- Contrôles légers : syntaxe JavaScript et `git diff --check`. Aucun build lancé
  pour cette passe. Rendu final et comportement Electron non validés à ce stade.
