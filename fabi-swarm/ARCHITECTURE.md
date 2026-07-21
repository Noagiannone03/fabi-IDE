# Fabi Swarm — Intégration IDE (documentation)

> Doc de référence : tout ce qui a été construit pour brancher le swarm P2P
> (inférence distribuée Parallax) dans l'IDE Fabi (Eclipse Theia / Electron).
> Dernière mise à jour : 2026-06-11.

---

## 1. Vue d'ensemble — les 4 repos

| Repo | Rôle | Touché par cette intégration ? |
|------|------|--------------------------------|
| **fabi-ide** | L'IDE (Theia/Electron). Contient l'extension `fabi-swarm`. | ✅ **Le gros du travail** |
| **fabi** | Distribution (tarballs, installeurs) **+ le `fabi-registry`** (service VPS). | ✅ Registry enrichi (2 fichiers) |
| **swarm-engine** | Le moteur Python (fork Parallax) : worker `parallax join` + scheduler. | ❌ Intact (gate/governor/Windows déjà faits avant) |
| **fabi-cli** | L'agent de code terminal (fork opencode) avec logique swarm. | ❌ Intact (a servi de référence) |

**Principe produit** : *tu contribues = tu consommes*. Tu prêtes ton GPU au
swarm d'un modèle (worker `parallax join`) → tu peux utiliser ce modèle dans le
chat IA. Une porte (« gate ») côté scheduler n'autorise la consommation que si
ton compte a un worker actif.

---

## 2. L'extension `fabi-swarm` (dans fabi-ide)

Structure Theia classique : `common` (contrat partagé) / `node` (backend, peut
spawn des process) / `browser` (frontend React) / `electron-main` (launcher).

```
fabi-swarm/src/
├── common/
│   └── fabi-swarm-protocol.ts      Contrat RPC + types partagés (SwarmEntry, WorkerState,
│                                   ConnectionInfo, RuntimeStatus, FabiSwarmService/Client)
├── node/                           (backend — process Node de Theia)
│   ├── fabi-account-token.ts       Token de compte (~/.config/fabi/account-token), partagé CLI
│   ├── fabi-runtime-install.ts     Install canonique du moteur (réplique de install.sh/.ps1)
│   ├── fabi-runtime-manager.ts     Wrapper fin : statut / localisation / install
│   ├── fabi-worker-tuning.ts       Détection matériel + env PARALLAX_* + argv `parallax join`
│   ├── fabi-swarm-worker.ts        Spawn worker + parsing events [FABI] + auto-restart 30s
│   ├── fabi-registry.ts            Client registry + flux SSE (push, reconnexion backoff)
│   ├── fabi-connection.ts          Dérivation de l'état de connexion (worker + SSE)
│   ├── fabi-swarm-service.ts       Service principal : orchestre tout, push au frontend
│   └── fabi-swarm-backend-module.ts  DI + handler RPC client-aware
├── browser/                        (frontend — React/Theia)
│   ├── fabi-swarm-frontend.ts      Façade : proxy RPC client-aware + Events Theia
│   ├── fabi-swarm-model.ts         Enregistre le provider « fabi » dans Theia AI (dynamique)
│   ├── fabi-swarm-widget.tsx       Le panneau : liste modèles + écran de connexion
│   ├── fabi-swarm-view-contribution.ts  Enregistre le panneau (barre de droite)
│   └── fabi-swarm-frontend-module.ts    DI frontend
└── electron-main/                  (process principal Electron)
    ├── fabi-electron-main-application.ts  Sous-classe : fenêtre launcher au 1er lancement
    └── fabi-electron-main-module.ts       Rebind ElectronMainApplication
```

`package.json` → `theiaExtensions` déclare les 3 points d'entrée : `frontend`,
`backend`, `electronMain`.

---

## 3. Le parcours utilisateur (de bout en bout)

```
1. Télécharge + installe l'app Fabi (légère).
2. 1er lancement (app packagée) :
   └─ si moteur absent + GPU → FENÊTRE LAUNCHER télécharge le moteur (~2 Go, une fois)
   └─ puis l'IDE s'ouvre.
3. Panneau Fabi (barre de droite) → liste des modèles (live via SSE).
4. Clic sur un modèle :
   └─ stop worker courant → `parallax join` sur le scheduler du modèle (= contribuer)
   └─ ÉCRAN DE CONNEXION : handshake → allocation couches → chargement poids → prêt
   └─ le provider « fabi » est re-câblé sur ce scheduler/v1 + ce modèle
5. Dans le chat IA → sélectionne le modèle « fabi » → tu codes (consommation via le gate).
6. Changer de modèle = re-cliquer un autre → quitte l'ancien swarm, rejoint le nouveau.
```

---

## 4. Le système de token (« contribue = consomme »)

Une seule identité, deux usages, **même token des deux côtés** :

- **Fichier** : `~/.config/fabi/account-token` (32 octets hex). **Partagé avec le
  CLI** → un seul compte pour l'IDE et le terminal.
- **Contribuer** (`fabi-worker-tuning.ts` `buildWorkerEnv`) : le worker est lancé
  avec `FABI_ACCOUNT_TOKEN=<token>`. Parallax l'inclut dans son `node_info` ; le
  scheduler (gate `FABI_GATE`) rafraîchit un *bail* pour ce token tant que le
  nœud est actif.
- **Consommer** (`fabi-swarm-model.ts`) : le provider OpenAI utilise `apiKey =
  <token>`. Chaque requête chat porte `Authorization: Bearer <token>`. Le gate
  vérifie qu'un bail existe pour ce token → 200 si oui, 402 sinon.

> Conséquence : pas de worker actif → pas de bail → la consommation renvoie 402.
> C'est voulu : le swarm est une coopérative de GPU.

---

## 5. Installation du moteur (le « launcher »)

**Décision d'archi** : on **télécharge** un tarball pré-construit par la CI (PAS
de build sur la machine : le runtime Windows exige un repack de wheel vLLM
impossible à reproduire chez l'utilisateur ; PAS d'embarquement dans
l'installeur : limite NSIS 2 Go sur Windows + enfer de signature macOS).

- **Source** : `fabi-runtime-install.ts`, réplique fidèle de `install.sh` /
  `install.ps1` du repo `fabi`.
  - Tarball : `fabi-<os>-<arch>-<accel>.tar.zst` sur la dernière release GitHub `fabi`.
  - Téléchargement **resumable** (HTTP Range), **parts >2 Go** réassemblées,
    vérif **SHA-256**, **extraction atomique** (staging → rename) **cross-platform
    sans `bash`**, relocalisation du venv (`__FABI_INSTALL_ROOT__`).
  - **Install partagée avec le CLI** : `~/.local/share/fabi` (mac/linux) //
    `%LOCALAPPDATA%\fabi` (windows). Binaire : `runtime/parallax-venv/bin/parallax`.
- **Deux déclencheurs** :
  1. **Launcher** (`electron-main/`) au 1er lancement de l'app **packagée** :
     fenêtre brandée 🦊 qui télécharge avant d'ouvrir l'IDE. Surcharge
     `showInitialWindow()` (point de boot Theia vérifié). IPC sécurisé
     (contextBridge). Ne se déclenche **jamais en dev** (`app.isPackaged`).
  2. **Bouton « Installer le moteur »** dans le panneau (à tout moment).
- **Machine non éligible** (pas Apple Silicon ni NVIDIA) → `accel = cpu` →
  message honnête « cette machine ne peut pas rejoindre le swarm ».

---

## 6. Registry + SSE (temps réel, zéro poll client)

Pattern **Health Endpoint Aggregation + fan-out SSE** : *un seul scan serveur →
N clients*.

- Le **fabi-registry** (service sur le VPS, dans le repo `fabi`) scanne les
  conteneurs scheduler et expose :
  - `GET /v1/swarms` — liste des swarms.
  - `GET /v1/swarms/stream` — **SSE** : push à chaque changement.
- `SwarmEntry` porte l'état riche (lu au scan, fan-out via SSE) :
  `status`, `schedulerStatus` (`waiting`/`available`), `peers`, `totalVramGb`,
  `needMoreNodes`, `initNodesNum`, `lastBootstrapResult`, `nodesActive`,
  `nodesInitializing`.
- Côté IDE (`fabi-registry.ts`) : abonnement SSE unique, reconnexion backoff,
  poll de secours seulement si le SSE tombe. **Aucun poll du scheduler par le
  client** (c'était une erreur initiale, corrigée).

---

## 7. Machine à états de connexion

`fabi-connection.ts` `deriveConnection(activeSwarm, worker)` combine **deux flux
push** en un état présentable (titre + activité + détail + compteurs) :

- état **du swarm** (peers, capacité, prêt) ← entrée registry via **SSE**.
- état **du worker** (étape, couches, poids) ← events `[FABI]` stdout (`peer_id`,
  `joining_scheduler`, `allocated`, `alloc_timeout`, `weights_load_*`).

`reason` possibles : `pick-model`, `worker-missing-binary`, `worker-starting`,
`worker-crashed`, `alloc-timeout`, `scheduler-unreachable`, `connecting`,
`need-more-peers`, `insufficient-capacity`, `loading-model`, `ready`.

Le panneau affiche l'écran de connexion (spinner, activité, barre de poids,
peers x/y, couches assignées, chrono, hints à 3 min / 8 min). **Réallocation**
gérée nativement : si le scheduler rééquilibre, le worker re-émet
`weights_load_*` → on repasse en « chargement » automatiquement. **Auto-restart**
worker 30 s sur crash (comme le CLI).

---

## 8. Tuning du worker (port fidèle du CLI)

`fabi-worker-tuning.ts` : détecte le matériel (Apple Silicon / CUDA / generic),
calcule des limites anti-OOM (paliers RAM/VRAM → batch/seq/tokens/kv-block),
laisse le runtime calculer la réserve RAM hôte depuis `psutil.available`, pose
seulement la réserve VRAM dédiée CUDA (`PARALLAX_CUDA_SYSTEM_RESERVE_GB`),
construit l'argv exact :
`parallax join -s <peer> -r --max-batch-size … [--disable-prefix-cache]
[--gpu-backend vllm sur Windows]`. Tue les workers orphelins avant spawn.

---

## 9. État : fait / manque / à déployer

### ✅ Fait et compilé (tsc exit 0)
- Token « contribue = consomme » (worker env + apiKey provider).
- Install runtime robuste (resumable, parts, SHA, atomique, cross-platform).
- Launcher de 1er lancement (app packagée).
- Panneau multi-modèles + provider dynamique branché au chat.
- Registry SSE enrichi + **déployé sur le VPS** (vérifié : champs riches servis).
- Écran de connexion fidèle (push, zéro poll) + auto-restart + réallocation.
- Tuning matériel (port fidèle du CLI).

### ❌ Manque / à faire
- **Auto-reconnexion au dernier modèle** au démarrage + **persistance du choix**
  (le CLI le fait via `planSwarmStartup` + préférence ; l'IDE demande un clic).
- **Pas encore testé sur une app packagée** : ça compile/build, mais le launcher,
  l'install 2 Go et une vraie connexion n'ont jamais tourné en conditions réelles.
- **`theia build` complet** de `electron-app` à lancer (valider l'assemblage).
- Resynchroniser la copie de `SwarmEntry` côté `fabi-cli` (champs optionnels →
  non-bloquant).

### 🚀 À déployer / publier
- ✅ **Registry** : déployé sur le VPS (commit `51a4026`, binaire
  `/opt/fabi-registry`, systemd `fabi-registry`).
- ✅ **Release de tarballs** : `v2.7.0-rc11` promue en **release stable + latest**
  (`prerelease=false`). `/releases/latest` la renvoie → l'IDE résout la bonne
  version. Assets vérifiés téléchargeables (ex. `fabi-darwin-arm64-mlx.tar.zst`
  → HTTP 200). 5/6 plateformes (Mac Intel `darwin-x64-cpu` absent, sans impact :
  cette cible ne peut pas contribuer). Toutes les plateformes GPU sont couvertes.

---

## 10. Build & test

```bash
# Toolchain : node@22 via brew
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

# Typecheck / build de l'extension seule
cd fabi-ide/fabi-swarm && yarn build           # tsc

# Build complet de l'app (régénère electron-main.js avec le launcher)
cd fabi-ide && yarn                              # lerna bootstrap (lie les workspaces)
cd electron-app && yarn bundle                   # theia build

# Lancer en dev (PAS de launcher en dev — volontaire)
cd electron-app && yarn start

# PACKAGER l'app distribuable (nom « Fabi » + icônes, via electron-builder)
cd electron-app && yarn package        # .dmg/.zip (mac), .exe NSIS (win), AppImage/.deb (linux)
cd electron-app && yarn package:dir    # build NON empaqueté (rapide) → idéal pour tester le LAUNCHER
cd electron-app && yarn package:mac    # cible macOS uniquement
```

**Packaging (electron-builder)** : config dans `electron-app/electron-builder.yml`
(appId `fr.undefinedstudio.fabi`, productName **Fabi**, icônes mac `fabi.icns` /
win `icon.ico` / linux `resources/icons`). C'est ce qui produit l'app avec la
bonne icône + le bon nom, ET ce qui permet de tester le launcher (il ne tourne
qu'en `app.isPackaged`). 1er `yarn package` = la vraie validation (rebuild des
modules natifs, asar). Note : non signé/notarisé → macOS Gatekeeper avertira au
1er lancement (clic droit → Ouvrir) tant qu'on n'ajoute pas la signature.

### Variables d'environnement utiles
| Variable | Effet |
|----------|-------|
| `FABI_NO_LAUNCHER=1` | Désactive la fenêtre launcher |
| `FABI_FORCE_LAUNCHER=1` | Force le launcher même en dev |
| `FABI_RUNTIME_VERSION=vX` | Pinne la version du tarball (sinon `latest`) |
| `FABI_INSTALL=/chemin` | Dossier d'install du runtime (défaut partagé CLI) |
| `FABI_RUNTIME_DIR=/chemin` | Override direct du runtime (dev) |
| `FABI_PREFIX_CACHE=0` | Désactive le prefix-cache du worker |

---

## 11. VPS (prod)

- **Registry** : systemd `fabi-registry`, binaire `/opt/fabi-registry/fabi-registry`
  (compilé par `bun build --compile`), clone source `~/fabi-workspace/fabi`, port
  3002, exposé via Caddy sous `https://server.undefinedstudio.fr/fabi-registry`.
  - **Redéploiement** : `cd ~/fabi-workspace/fabi && git pull` →
    `cd packages/fabi-registry && bun build src/index.ts --compile
    --target=bun-linux-x64 --outfile=/tmp/x` → `sudo systemctl stop fabi-registry`
    → `cp /tmp/x /opt/fabi-registry/fabi-registry` → `sudo systemctl start
    fabi-registry`. (Le `stop` avant `cp` est obligatoire : « Text file busy ».)
- **Schedulers** : 5 conteneurs Docker (un par modèle), gate `FABI_GATE=on`.
- **URL publique** : `https://server.undefinedstudio.fr/fabi-{scheduler,registry}`.
