# Publication stable du desktop Fabi

Cette chaîne est distincte du workflow `package-candidate.yml`. Un candidat
ad hoc sert à qualifier le code sur les runners; il ne doit jamais alimenter
le canal utilisateur.

Le workflow `package-stable.yml` construit depuis un SHA unique :

- macOS ARM64 avec un certificat **Developer ID Application**, Hardened
  Runtime, notarisation Apple et ticket staplé ;
- Windows x64 avec une signature Authenticode dont le sujet est épinglé dans
  la configuration embarquée d'`electron-updater` ;
- un répertoire statique final après revérification des versions, tailles et
  SHA-512 générés par `electron-builder`.

Le job d'assemblage refuse les chemins relatifs, liens symboliques, collisions,
blockmaps absentes, versions divergentes et octets qui ne correspondent pas au
fichier `stable.yml`/`stable-mac.yml`. Il produit `SHA256SUMS` et
`release-manifest.json`. Aucune clé n'entre dans ce bundle.

Sources primaires utilisées :

- [Auto Update electron-builder](https://www.electron.build/docs/features/auto-update/) : le provider générique exige une publication manuelle des artefacts et métadonnées, et le ZIP macOS est requis ;
- [signature de code electron-builder](https://www.electron.build/docs/features/code-signing/) ;
- [notarisation macOS](https://www.electron.build/docs/notarization/) ;
- [signature Windows](https://www.electron.build/docs/features/code-signing/code-signing-win/).

## Préparation GitHub

Créer un environnement protégé `desktop-stable`, idéalement soumis à revue,
avec les secrets suivants :

- `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` ;
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` ;
- `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`.

Créer la variable d'environnement non secrète
`FABI_WINDOWS_PUBLISHER_NAME`. Elle doit être exactement le `SimpleName` du
certificat Authenticode. Sa rotation doit être planifiée comme une migration :
les anciennes applications l'utilisent pour refuser un installateur signé par
une autre identité.

Déclencher ensuite le workflow sur le SHA qualifié et fournir exactement la
version de `electron-app/package.json`, par exemple `0.1.19`. Le workflow
échoue avant le build si un secret, le publisher ou la version manque.

## Déploiement Caddy proposé

Cette section est un plan opérateur; le workflow ne possède aucun accès au VPS.

Conserver les versions sous un même bind mount, par exemple :

```text
/home/debian/fabi-updates/stable/
  releases/0.1.19/...
  current -> releases/0.1.19
```

1. Télécharger le seul artefact `fabi-desktop-0.1.19-stable` du workflow.
2. Copier son contenu dans `releases/.0.1.19.tmp`.
3. Exécuter `sha256sum --check SHA256SUMS` dans ce répertoire.
4. Vérifier que `release-manifest.json` annonce la version attendue et que le
   répertoire ne contient aucun autre fichier.
5. Renommer le répertoire temporaire en `releases/0.1.19`.
6. Créer un lien `.current-next`, puis remplacer `current` par renommage
   atomique. Tous les payloads et les deux métadonnées basculent ainsi dans la
   même opération.

Monter `/home/debian/fabi-updates` en lecture seule dans Caddy sous
`/srv/fabi-updates`, puis servir :

```caddyfile
handle_path /fabi-updates/stable/* {
    root * /srv/fabi-updates/stable/current
    file_server
}
```

Caddy sert nativement les requêtes Range nécessaires aux téléchargements. Les
deux métadonnées `stable.yml` et `stable-mac.yml` doivent recevoir
`Cache-Control: no-store`; les artefacts nommés par version peuvent être mis en
cache comme immuables. Valider le Caddyfile avec le binaire exact du conteneur
avant de recréer uniquement le proxy si son bind mount conserve un ancien
inode.

Contrôles après bascule :

```sh
curl -fsS https://server.undefinedstudio.fr/fabi-updates/stable/stable.yml
curl -fsS https://server.undefinedstudio.fr/fabi-updates/stable/stable-mac.yml
curl -fsSI -H 'Range: bytes=0-1023' \
  https://server.undefinedstudio.fr/fabi-updates/stable/Fabi-0.1.19-arm64-mac.zip
```

Enfin, qualifier un vrai saut depuis une version signée précédente : détection,
téléchargement, vérification native, fermeture, installation, relance et
conservation du workspace. Le succès du build seul ne prouve pas cette
transaction. Une bascule du lien `current` permet un rollback serveur, mais
`allowDowngrade=false` interdit volontairement de rétrograder une machine déjà
mise à jour; un correctif utilisateur doit donc porter une version supérieure.

## Préparation locale des extensions

Les scripts `bundle` et `watch` passent par `prepare:plugins`. Le préparateur vérifie les manifestes installés, les versions Open VSX épinglées dans `package.json`, les points d’entrée main/browser et les dépendances/packs transitifs. Un cache complet n’effectue aucune requête réseau. Sinon, le téléchargeur Theia reste responsable de l’installation ; son échec est bloquant, et les fichiers sont revérifiés après son succès. Les scripts de packaging appellent seulement `bundle`, sans téléchargements redondants. `download:plugins` reste disponible explicitement.

Motif : le téléchargeur Theia résolvait à nouveau sur Open VSX deux dépendances déjà présentes parmi les 60 extensions locales. Une expiration réseau empêchait donc un packaging complet de démarrer. Le correctif ne repose pas sur `--ignore-errors` et ne modifie pas `node_modules`. Tests : `node --test tools/prepare-plugins.test.mjs` (cache complet sans réseau, dépendance manquante, version incorrecte, point d’entrée absent, panne réseau).

### Icône produit et édition sans Swarm

L'icône installée et l'icône utilisée dans le Dock doivent montrer uniquement le
renard sur fond sombre arrondi pour l’application installée. Pendant son
exécution, le Dock utilise le renard transparent (`fox-512.png`). Ce choix
remplace la tentative de silhouette transparente dans Finder sur Tahoe. `node tools/gen-logo.mjs` génère les PNG/ICO, le logo embarqué
et, sur macOS via `iconutil`, les deux fichiers ICNS de branding et de packaging.
Le générateur préserve les autres fichiers du dossier branding. Recompiler les
extensions puis repackager après modification du logo.

La distribution actuelle désactive Swarm via `SWARM_ENGINE_ENABLED` (voir
`FABI-ASSIST.md`), mais conserve `Resources/assist-runtime` pour Assist/RunPod.
Ne pas supprimer ce runtime en cherchant à enlever le moteur local Swarm.

`electron-app/product.json` est inclus à la racine de `app.asar`, correspondant
à `vscode.env.appRoot`. L’extension intégrée Extension Authoring le lit à son
activation pour connaître la politique de badges SVG et de propositions d’API.
Les listes Fabi sont explicitement vides : aucune autorisation spéciale implicite.
Le smoke test packagé active cette extension et contrôle ses erreurs dans les logs.

### Limite confirmée sur macOS Tahoe (rendu Finder)

Attention : la transparence de `icon.icns` ne garantit pas un renard détouré
dans Finder. `NSWorkspace.shared.icon(forFile:)` reproduit sur cette machine
un carré clair ajouté par macOS autour de notre ICNS transparent, alors que
`app.dock.setIcon` affiche bien le renard seul pendant l’exécution.
`swift tools/inspect-macos-icon.swift /chemin/Fabi.app /tmp/fabi-icon.png`
permet de contrôler le rendu réel, pas seulement le fichier source.

Un essai de `NSWorkspace.setIcon` sur une copie temporaire a supprimé le carré,
mais a fait échouer `codesign --verify --deep --strict` (Finder information /
resource fork). Cette modification n’est donc pas livrée dans le DMG signé.
Ne pas annoncer ce problème résolu sur Tahoe sur la seule base d’un contrôle
d’alpha PNG/ICNS. Cette piste est abandonnée ; le Dock est désormais traité par un plug-in
AppKit signé, décrit ci-dessous. Finder garde son icône sombre.

Décision utilisateur : retour au fond sombre arrondi d’origine pour Finder et
le DMG ; conservation de la silhouette transparente pendant l’exécution.

### Renard détouré dans le Dock, application fermée

La solution est `NSDockTilePlugIn`, API AppKit prévue pour personnaliser la tuile
d’une application inactive. `resources/dock-tile/FabiDockTile.m` installe un
`NSImageView` avec le même `branding/png/fox-512.png` que le Dock pendant
l’exécution. Aucun timer, réseau, observateur ou processus Fabi permanent.
Le système héberge le petit module ; le callback nil détache sa vue.

`tools/package-dock-tile.cjs` (afterPack macOS) compile le bundle pour l’architecture
cible et le place dans `Contents/PlugIns` avant la signature electron-builder. electron-builder exclut systématiquement `Contents/PlugIns` de sa signature.
Le hook scelle donc le bundle natif avec l’identité et le trousseau sélectionnés
par electron-builder, avant la signature du paquet principal. La signature
stricte du bundle est vérifiée immédiatement.
La clé `NSDockTilePlugIn` désigne ce bundle. Les versions DMG hors Mac App Store
sont concernées ; cette API ne personnalise pas Finder/Spotlight. Le fond sombre
est conservé à ces endroits. Aucune modification FinderInfo après signature.

Validation : compiler `tools/check-dock-tile.m` avec clang/AppKit, puis lui passer
le chemin absolu du bundle et un PNG de sortie. Le test charge la classe principale,
vérifie le contenu opaque du renard et la transparence des marges, puis détache
et rattache la tuile. Vérifier aussi `codesign --verify --deep --strict Fabi.app`.
Sur une application déjà épinglée, le Dock doit recharger le nouveau bundle
(réépinglage ou redémarrage du Dock après installation).

Références :
- https://developer.apple.com/documentation/appkit/nsdocktileplugin
- https://developer.apple.com/documentation/bundleresources/information-property-list/nsdocktileplugin
- https://github.com/marioaguzman/NSDockTilePlugIn-Example (référence d’intégration ; code Fabi original)

Validation sur le Mac Tahoe : le paquet signé a été installé, Fabi fermé, et
`lsof` a confirmé le chargement de `FabiDockTile` par
`com.apple.dock.external.extra.arm64`. L’ancienne entrée épinglée conservait
`tile-data.dock-extra = false` ; le rechargement du Dock seul ne suffisait pas.
Cette entrée Fabi a été actualisée (équivalent du retrait/réépinglage) sans
changer les autres tuiles. Pour une mise à jour manuelle, retirer puis réépingler
Fabi si l’ancienne icône persiste. Vérification stricte de signature réussie
après installation ; Fabi n’est pas lancé pour maintenir l’icône.
