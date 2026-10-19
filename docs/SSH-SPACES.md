# Espaces SSH

Fabi utilise **`@theia/remote` 1.72.2**, déjà présent dans l’application, pour les
connexions SSH. Les fichiers du projet restent sur le serveur. Aucun dossier
miroir du projet n’est créé sur le Mac.

## Parcours

1. Cliquer sur `+`, choisir SSH, puis « Se connecter en SSH… ».
2. Saisir `utilisateur@hôte` ou un alias de `~/.ssh/config` dans le sélecteur Theia.
3. Répondre à l’authentification Theia si nécessaire. Les clés/configurations et
   les commandes SSH de la palette utilisent également les services Theia.
4. Une fois la connexion établie, sélectionner un dossier dans l’explorateur du
   serveur. Le nouvel espace reste dans la fenêtre Fabi.
5. Les fichiers, recherches et terminaux de cet espace utilisent le backend
   distant. Les espaces locaux conservent leur backend local.

Le premier accès installe le backend Fabi et son runtime Node sur le serveur.
Les accès suivants réutilisent l’installation. Les descripteurs Spaces conservent
uniquement l’hôte, l’utilisateur et le chemin distant, jamais le mot de passe ni
le port temporaire du tunnel. Après redémarrage, Theia rétablit la connexion et
redemande l’authentification si nécessaire.

## Réutilisation et adaptations

Source : [Eclipse Theia Remote](https://github.com/eclipse-theia/theia/tree/v1.72.2/packages/remote).
La sélection SSH, l’authentification, la lecture de la configuration, le transport
SSH2, l’installation de Node et des dépendances natives, les RPC et les dialogues
de fichiers distants viennent des classes upstream importées, sans copie de leur
pile réseau dans Fabi.

- `SpaceSSHContribution` redirige l’ouverture de fenêtre vers un Space.
- `SpaceWindowService` garde les ouvertures de dossiers dans cette vue Electron.
- `RemoteSpaceContribution` restaure la connexion et synchronise le dossier
  sélectionné avec le descripteur persistant.
- `SpaceRemoteFiles` omet le frontend desktop du transfert serveur ; les webviews
  restent incluses. `SpaceSSHProvider` utilise `ssh2.sftp.fastPut` avec repli sur
  le transfert upstream pour les serveurs incompatibles.
- `SpaceRemoteSetup` adapte la méthode upstream de lancement pour écouter sur
  `127.0.0.1`, comme le proxy local. Son attribution/licence upstream est conservée.

[Open Remote SSH](https://github.com/jeanp413/open-remote-ssh) a aussi été étudié.
Cette extension utilise `registerRemoteAuthorityResolver` et un serveur VS Code/
VSCodium ; cette API n’est pas implémentée par le plugin host Theia de Fabi.
Brancher sa pile telle quelle nécessiterait de remplacer cette partie de l’IDE.

## Validation du 13 octobre 2026

Sur un VPS Debian, avec un profil Electron isolé :

- connexion via le sélecteur et l’authentification upstream ; environ **5,1 s après
  validation du mot de passe**, avec le serveur déjà installé (pas une mesure de
  première installation) ;
- sélection d’un dossier du VPS dans le dialogue distant, chemin conservé dans
  `spaces.json` ;
- ouverture, modification et sauvegarde d’un fichier via l’éditeur ; contenu
  relu indépendamment par SSH sur le VPS ;
- terminal intégré : `uname -s` renvoie Linux, fichier créé sur le VPS ;
- alternance local/SSH : deux vues intégrées, sans nouvelle fenêtre frontend ;
- redémarrage de l’application : reconnexion SSH et restauration du dossier
  sélectionné (émulation de visibilité CDP pendant que macOS était verrouillé) ;
- transfert initial : archive backend d’environ 15 Mio, contre 54 Mio lorsque
  le frontend desktop était inclus.

Vérifications locales (Node 22) :

```sh
yarn build:electron
yarn --cwd fabi-spaces test
yarn test:desktop-release
node tools/check-space-lifecycle.mjs
node tools/check-space-readiness.mjs
node tools/check-midnight-chrome.mjs
yarn test:spaces:electron
```

Sur macOS, le test Electron peut exercer le déplacement natif avec
`FABI_NATIVE_DRAG_HELPER` pointant vers le binaire compilé depuis
`tools/mac-window-drag.swift`. Le test utilise un profil temporaire.

La validation distante porte sur Debian ; les autres plateformes distantes
n’ont pas été validées. Les tests ne représentent pas une qualification complète
de toutes les extensions tierces en mode distant.

Le déplacement natif de la fenêtre a été validé avec le helper macOS avant le
verrouillage de la session. La dernière passe Electron a validé le cycle de vie
sans rejouer les gestes natifs, impossibles sur l’écran verrouillé. Le test de
chrome statique déclenche les boutons par le DOM ; il ne remplace pas ce test
de pointeur natif.

## Reconnexion et mises à jour (14 octobre 2026)

Le bootstrap macOS/Linux conserve le transport, l’authentification, les archives
et les dépendances natives de Theia. Deux sondes SSH regroupent la découverte
OS/architecture/home puis la vérification backend/runtime. Une installation déjà
présente ne déclenche aucun téléchargement ni transfert ; le backend est ensuite
lancé sur loopback par Theia.

Node est réutilisé indépendamment de la version Fabi, dans
`~/.fabi-runtimes/node-v<version>-<plateforme>-<architecture>`. Les installations
historiques peuvent fournir ce runtime par copie locale sur le serveur ; leur
contenu reste intact pour les sessions déjà ouvertes. Le backend Fabi conserve
son propre dossier versionné, pour ne pas réutiliser du code incompatible.
Un marqueur d’installation inachevée force la reprise du backend après échec.
Windows garde le bootstrap upstream.

Les requêtes simultanées identiques sur un même fournisseur partagent leur
connexion en cours. Les logs `[fabi-ssh]` séparent l’authentification (y compris
l’attente de saisie), la préparation, le transfert éventuel et le démarrage.
Les tests exécutent les sondes dans un vrai shell, avec des chemins contenant
espaces et apostrophes ; ils vérifient la réutilisation sans réseau et la reprise
après échec. Ces tests ne constituent pas une mesure de latence sur le serveur.

Références comparées : [VS Code Remote SSH](https://code.visualstudio.com/docs/remote/ssh)
et [Open Remote SSH, installation du serveur](https://github.com/jeanp413/open-remote-ssh/blob/master/src/serverSetup.ts).

Le diagnostic réel a aussi reproduit un échec SSH à 20 006 ms alors que le
sélecteur attendait encore la phrase secrète de la clé. Le `readyTimeout` global
SSH2 incluait l’attente humaine. L’adaptation de `establishSSHConnection` reprend
la méthode Theia sous sa licence, conserve son gestionnaire d’authentification,
et suspend uniquement le délai réseau pendant les demandes de saisie. Les
attentes réseau restent limitées à 20 s ; des keepalives détectent une connexion
perdue. Un test avec un vrai serveur SSH local impose 21 s de saisie avant de
vérifier que l’authentification et une commande distante réussissent.

Validation réelle après correctif sur `gmbh` (macOS, 14 octobre) :
identification 610 ms, contrôle de l’installation 672 ms, démarrage backend
1 838 ms, soit environ **3,1 s après authentification**, sans téléchargement ni
copie. L’authentification a pris 20 248 ms, sans expiration pendant la saisie.
Le frontend distant s’est ouvert et le service distant a confirmé OpenCode
installé. Ce chiffre mesure la disponibilité du backend, pas le temps total
jusqu’à la fin du chargement de toutes les extensions.

## Choix du dossier après connexion (15 octobre 2026)

Le premier choix de dossier utilise un IPC acquitté avant l’ouverture par
WorkspaceService. Le rechargement transmet explicitement l’URL du renderer,
avec son nouveau fragment et les deux ports ; il ne dépend plus de la lecture
potentiellement retardée du fragment dans Electron main. Un workspace déjà
chargé empêche aussi de rouvrir le sélecteur à partir d’un descripteur périmé.
Le test Electron de cycle de vie vérifie la sélection acquittée, la persistance
après rechargement et la conservation du tunnel, avec un chemin contenant un
espace et un dièse.
