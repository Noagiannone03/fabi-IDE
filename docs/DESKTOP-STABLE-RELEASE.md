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
