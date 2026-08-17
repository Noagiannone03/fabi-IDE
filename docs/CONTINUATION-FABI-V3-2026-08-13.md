# Reprise opérationnelle Fabi V3 — 13 août 2026

> **Archive de passation.** L'état opérationnel courant est désormais
> `docs/CONTINUATION-FABI-V3-2026-08-17.md`. Conserver ce document pour
> l'historique P0–P11, mais ne pas utiliser ses versions rc67/0.1.16 comme état
> live.

Ce document permet de reprendre le chantier dans une nouvelle conversation
sans perdre les décisions, preuves et limites de la conversation longue de
juillet-août 2026. Il complète `docs/HANDOFF-SWARM-2026-07-17.md`, qui reste la
source de vérité historique.

## 1. Règles de reprise

1. Lire entièrement ce document, puis les dernières sections du handoff et les
   documents d'architecture indiqués ci-dessous avant de coder.
2. Avant toute mutation, refaire les contrôles en lecture seule : branche, SHA,
   worktree, état des machines, scheduler, registre et workflows. Les machines
   distantes étaient hors ligne au dernier contrôle.
3. Ne pas réintroduire la V2, de fallback silencieux, de span manuel de labo ou
   de variable cachée pour obtenir une démonstration. Le produit est V3-only et
   doit démarrer depuis les bundles officiels sans override.
4. Pour le réseau, le distribué, la mémoire, l'inférence, la sécurité, le
   failover, le streaming ou les mises à jour, étudier d'abord les sources
   primaires : Mesh/Skippy, Parallax/Gradient, Petals/Hivemind, Iroh,
   rust-libp2p, OpenCode, Electron et les backends concernés.
5. Ne jamais annoncer une qualification non effectuée. Une suite unitaire, un
   package CI, une installation et un E2E natif sont quatre preuves distinctes.
6. Après chaque gate important, mettre à jour le handoff, committer dans le bon
   dépôt et pousser la bonne branche.
7. Consulter périodiquement `docs/instruct.md`. Il est actuellement vide, non
   suivi par Git et appartient à l'utilisateur. Ne pas le supprimer ni le
   committer.

## 2. Conversation complète et documents à lire

Conversation intégrale locale :

`/Users/noagiannone/.codex/sessions/2026/07/20/rollout-2026-07-20T09-36-43-019f7e74-ac4e-7b52-b15b-9e0e3647a19e.jsonl`

Identifiant : `019f7e74-ac4e-7b52-b15b-9e0e3647a19e`.

Au dernier relevé, ce JSONL faisait environ 355 Mo. Il contient des secrets et
ne doit jamais être copié dans Git, attaché à une issue ou affiché en entier.
Utiliser seulement `rg` ou `tail` :

```bash
FABI_SESSION_JSONL=/Users/noagiannone/.codex/sessions/2026/07/20/rollout-2026-07-20T09-36-43-019f7e74-ac4e-7b52-b15b-9e0e3647a19e.jsonl
rg -n 'RunPod|replan_cold|rc67|0.1.16|hidden-probe' "$FABI_SESSION_JSONL"
tail -n 300 "$FABI_SESSION_JSONL"
```

Documents obligatoires :

- `docs/HANDOFF-SWARM-2026-07-17.md`, surtout ses dernières sections ;
- `docs/FABI-SWARM-PROTOCOL-V3.md` ;
- `docs/FABI-CONTEXT-AWARE-PLACEMENT-V3.md` ;
- `docs/SWARM-FAILOVER-DESIGN.md` ;
- `docs/SWARM-SCALE-PETALS-DESIGN.md` ;
- `docs/FABI-ADAPTIVE-SPECULATIVE-DECODING.md` ;
- `docs/SWARM-RUNPOD-VALIDATION.md` ;
- `docs/ARCHITECTURE-swarm-runtime.md`.

## 3. Dépôts, branches et révisions

État vérifié le 13 août 2026 vers 11 h CEST :

| Composant | Clone de référence | Branche | Révision poussée |
| --- | --- | --- | --- |
| IDE/Desktop | `/Users/noagiannone/Documents/fabi-ide` | `codex/rc49-product-e2e` | `ce3af0f04b426954b1c6f8fc703b42cec6926c8b` |
| Moteur V3 | `/Users/noagiannone/Documents/swarm-engine-v3` | `codex/swarm-protocol-v3` | `797f93fa716619730003d4264490f25c4f658d79` |
| CLI/OpenCode | `/Users/noagiannone/Documents/fabi-cli` | `dev` | `f72d1118c5fa7b59b695de8f1b1adb85f946d817` |
| Méta-runtime | `/Users/noagiannone/Documents/fabi` | `main` | `612f1bd11b8c1c1d2cff03e72fd579f59d6a55f2` |
| Runtime publié | dépôt `fabi` | tag `v2.7.0-rc67` | `612f1bd11b8c1c1d2cff03e72fd579f59d6a55f2` |
| Test failover isolé | branche moteur distante | `codex/failover-replan-cold` | `dbdefcc43a3a1e6afadef1a1473f6ac34b8eb6a8` |

Les clones moteur, CLI et runtime étaient propres et alignés. L'IDE contient la
mise à jour documentaire de cette passation et `docs/instruct.md` non suivi.

Clones/worktrees à ne pas confondre :

- `/Users/noagiannone/Documents/swarm-engine` est l'ancien clone `dp-mode`,
  révision `a79b561`, pas le moteur V3 courant.
- `/Users/noagiannone/Documents/swarm-engine-dynamic` est sur
  `codex/dynamic-dp-product`, révision `6092367`, avec des modifications
  utilisateur/legacy dans le serveur, le scheduling et `node.py`. Ne jamais les
  écraser.
- `/Users/noagiannone/Documents/swarm-engine-upstream-rebuild` est une branche
  d'étude `codex/upstream-rebuild`, révision `be90732`.
- `/Users/noagiannone/Documents/fabi-ide-desktop-stable` contient un ancien
  chantier updater non commit : manifests, workflow stable, scripts et docs.
  L'auditer avant réutilisation ; ne pas le fusionner en bloc.

Reprise :

```bash
cd /Users/noagiannone/Documents/fabi-ide
git status --short --branch
git pull --ff-only
tail -n 500 docs/HANDOFF-SWARM-2026-07-17.md

for repo in \
  /Users/noagiannone/Documents/swarm-engine-v3 \
  /Users/noagiannone/Documents/fabi-cli \
  /Users/noagiannone/Documents/fabi; do
  git -C "$repo" status --short --branch
  git -C "$repo" pull --ff-only
done
```

Si le pull refuse à cause de modifications locales, les inspecter et les
préserver. Aucun reset/checkout destructif.

## 4. Architecture produit à préserver

Fabi est un IDE/CLI OpenCode dont l'inférence est fournie par des swarms de
workers hétérogènes. La cible est un réseau communautaire où beaucoup de
machines arrivent, repartent et contribuent selon leurs capacités.

Invariants V3 :

- catalogue de modèles signé TUF/root3 ;
- DHT pour capacités, spans, disponibilité, contexte/KV et santé ;
- placement autonome inspiré de Petals : le worker observe le réseau et choisit
  une tranche utile, sans affectation globale rigide ;
- le VPS est point d'entrée OpenAI/OpenCode et coordinateur d'une requête :
  réservation atomique, permissions, journal SSE, epoch/fencing ; il ne doit
  pas redevenir le maître global du placement ;
- le contexte appartient à une route complète, pas au swarm entier ;
- chaque worker annonce la mémoire et le KV réellement disponibles ;
- admission seulement si une route complète couvre prompt + sortie réservée ;
- contribution réelle obligatoire pour consommer ; l'input reste verrouillé
  sans contribution reconnue et sans route admissible ;
- Mesh/Skippy 0.75.1, ABI 0.1.35 ; packages de couches sélectifs pour les grands
  modèles, jamais le modèle entier sur chaque petit worker ;
- Iroh pour le transport direct/relay, rust-libp2p pour la DHT ;
- heartbeats/leases indépendants du streaming et des générations longues ;
- journal durable commit-before-publish, abort explicite et replay froid du
  prompt + tokens commis ;
- epochs/fencing empêchent une ancienne route de republier ;
- FIFO globale : deux Spaces ne peuvent pas lancer deux générations en même
  temps avec la même contribution ;
- modes Ask, Agent, Goal ; permissions Ask edits et Auto edit.

Ne pas défaire ces choix : V3 seulement ; Qwen3-32B comme preuve actuelle du
découpage distribué ; Skippy n'est pas remplacé par un graphe ONNX manuel par
modèle ; le transfert KV et le speculative decoding viennent après la
fiabilité E2E, le failover et le NAT.

## 5. Ce qui est réellement terminé

### Runtime rc67

- Moteur `797f93fa...`, CLI `f72d1118...`, runtime `612f1bd...`.
- Workflow `31680445896` entièrement vert.
- macOS arm64 MLX, Linux x64 CPU/CUDA, Linux arm64 CPU et Windows x64
  DirectML/CUDA packagés.
- Release publique non draft, prerelease, 27 assets et sidecars.
- Correction : un timeout transitoire du bootstrap DHT initial ne ferme plus
  l'endpoint et ne redémarre plus le worker en boucle. Identité, signature,
  adresse et configuration restent fail-closed.

### Mémoire, IDE et protocole

- Cache KV Skippy dimensionné par tranche : 14 couches ne réservent plus 8 Gio
  comme si elles exécutaient les 64 ; environ 1,75 Gio dans ce cas.
- Mesures live RAM/VRAM/KV, admission Windows CUDA via NVML, lifecycle Maestro
  et shared frames nettoyés.
- Streaming SSE, outils, permissions, abort, Ask/Agent/Goal et FIFO globale.
- Fan-out de la vérité swarm à tous les renderers/Spaces.
- Course compositor macOS corrigée : bounds avant attach, attente du vrai
  chargement, comparaison viewport/bounds, une réinsertion officielle maximum.
- `hidden-probe`/`prefs-probe` provenaient d'un `electron --help` diagnostique
  orphelin, pas du bundle.
- Réservations, lease indépendant, SQLite WAL FULL, commit-before-publish,
  epoch/fencing et replay exact existent.
- La branche `codex/failover-replan-cold` prouve au niveau intégration un
  primaire mort, un premier remplacement en échec puis epoch 3 sans token SSE
  dupliqué. Elle ne remplace pas un kill natif.

## 6. Desktop 0.1.16 : état exact

Commit candidat : `ce3af0f04b426954b1c6f8fc703b42cec6926c8b`.
Workflow `31682951034` terminé en échec :

- macOS arm64 vert ;
- Windows x64 rouge avant construction NSIS ;
- 100 tests sur 102 passent ;
- les deux échecs viennent de `worker-log.test.js` : la simulation Darwin/Linux
  emploie le `path.join` natif Windows et produit des antislashs.

Le correctif propre est `path.posix.join` pour Darwin/Linux et
`path.win32.join` pour Windows. Ne pas changer les attentes pour cacher le bug.

Candidat macOS déjà téléchargé :
`/tmp/fabi-desktop-0.1.16.PtZD1m/Fabi-0.1.16-arm64.dmg`.

SHA-256 :
`582d30aa0fe190edf2c9c9b5ad3b0fa8214ff47295169cf7f4c9450cfb55b391`.

Tous ses fichiers correspondent à `SHA256SUMS`; bundle arm64 0.1.16,
`codesign --deep --strict` vert. Signature ad hoc, pas Developer ID/notarisée.

Le Mac local possède déjà ce bundle dans `/Applications/Fabi.app` et rc67.
Smoke : une fenêtre `1380x815`, aucun probe. L'ancien 0.1.15 a été déplacé vers
`~/.Trash/Fabi-0.1.15-before-0.1.16.app`.

## 7. Accès et machines

### VPS

- `vps-36b69797.vps.ovh.net`, IPv4 `37.59.98.16`, IPv6
  `2001:41d0:305:2100::ac43`, utilisateur `debian`.
- Alias local avec clé : `ssh vps`.
- Ne pas dépendre d'un ancien ControlMaster `/tmp/fabi-vps-control-*`.
- Les clés du VPS permettent l'accès aux machines du labo.
- Le mot de passe historique est dans le JSONL si une urgence l'exige ; ne pas
  le copier dans Git ni le réimprimer.

### Mac local

- rc67 et desktop candidat 0.1.16 installés ; smoke simple vert.
- Quitter normalement avant réinstallation :
  `osascript -e 'tell application id "fr.undefinedstudio.fabi" to quit'`.

### Mac mini projet IA

- Tailscale `mac-mini-projet-ia`, dernière IP `100.76.201.20`, user `gmbh`.
- Accès : `ssh vps 'ssh gmbh@100.76.201.20'`.
- Dernier état certain : desktop 0.1.15 et runtime rc66. Une fermeture normale a
  été lancée, puis l'installation rc67 a expiré lorsque la machine est devenue
  hors ligne. État actuel inconnu : inspecter l'app et
  `~/.local/share/fabi/MANIFEST` avant toute mutation.

### PC Windows RTX projet IA

- Tailscale `pc-windows-projet-ia`, alias VPS `pc-ia`, dernière IP
  `100.105.234.82`, user `gmbhl`.
- Accès : `ssh vps 'ssh pc-windows-projet-ia'`.
- Dernier état certain : desktop 0.1.15, runtime rc66 CUDA. Hors ligne avant
  rc67. Aucune UI Windows qualifiée : le test final exige une vraie session
  desktop `gmbhl` et le lancement normal de
  `%LOCALAPPDATA%\Programs\Fabi\Fabi.exe`.
- Ancien chemin de logs erroné : `C:\Users\gmbhl\Library\Logs\Fabi` ; chemin
  produit attendu : `%LOCALAPPDATA%\Fabi\logs`.

### Tailscale et RunPod

Au dernier contrôle, le Mac local était déconnecté de Tailscale et demandait
une authentification. Les deux machines distantes avaient été vues hors ligne.
Tailscale sert à l'administration ; le test produit final doit prouver un
trafic inference sans route 100.x.

Pod RunPod : `j44wb04s5bi6rq`, nom `fabi-rc67-e2e`, A40 Secure 48 Gio,
environ 0,44 USD/h, état confirmé `EXITED`. Il n'a lancé aucun worker, seulement
reçu rc67. Aucun volume persistant ; revérifier l'installation après restart.
Ne pas le terminer définitivement sans demande et ne jamais réutiliser les
anciennes IP/ports.

Le MCP RunPod historique utilise un ancien compte sans crédit. Le token courant
est dans le Trousseau macOS, service `codex-runpod-api-key-current`, compte
`noagiannone` :

```bash
FABI_RUNPOD_TOKEN="$(security find-generic-password \
  -a noagiannone -s codex-runpod-api-key-current -w)"
```

Ne pas l'imprimer, le passer dans des arguments ou le committer. L'entrée
`codex-runpod-api-key` correspond à l'ancien compte.

## 8. Services root3 et modèle de qualification

- Registre : `https://server.undefinedstudio.fr/fabi-registry/v1/swarms`.
- Swarm : `qwen3-32b-v3`.
- Scheduler :
  `https://server.undefinedstudio.fr/fabi-scheduler/qwen3-32b-v3`.
- Status :
  `https://server.undefinedstudio.fr/fabi-scheduler/qwen3-32b-v3/cluster/status_json`.
- Endpoint scheduler :
  `efbb30064456a064f83e8c84878b93868fc1864821b5f92cddbbecc3920b4f24`.
- Model swarm ID :
  `69e2d536942a630259538875c47784333618b8d7a0fd3e924ca524254c303338`.
- Relay : `https://server.undefinedstudio.fr:4443`.
- Root :
  `https://server.undefinedstudio.fr/fabi-swarm-registry-v3/root3/metadata/1.root.json`.
- Root SHA :
  `322767d6181161a6a6d1457849b1780870c59abe527b0e1775ddd914e6ed5d7a`.

Bootstraps DHT :

```text
/ip4/37.59.98.16/tcp/19192/p2p/12D3KooWMQrc1rWXwaeQcshtANiw9FyyGWmfqAnVsStGRqsJ54Yi
/ip4/37.59.98.16/tcp/19193/p2p/12D3KooWG8jJaC1upci3eDZ7XSobTPC5hT6bdqFGzzptH8q7b1eG
```

Dernier status : un seul worker Mac local, span `[0,11]`, contexte/KV 32768,
mais aucune route complète : `structural_pipeline_ready=false`,
`admission_ready=false`, `max_supported_context_tokens=0`,
`need_more_nodes=true`. L'IDE doit donc être verrouillé, jamais « Prêt » ou
« Generating ».

Les métadonnées root3 étaient targets/snapshot v2 et timestamp v4 lors de
l'audit, bundle 32B `69e2...`, 92 artefacts, environ 20,4 Go, 64 couches. Le
refresher online a pu incrémenter le timestamp. Toute publication doit
resynchroniser le timestamp live, prendre le même lock et publier timestamp en
dernier. Aucun rollback de version TUF.

L'image scheduler live doit être réinspectée avant mutation. Ne jamais faire
`docker compose down -v` : préserver volume, clés, DB de permits et identité.

## 9. Pièges de labo

`tools/lab-worker-control.sh` est un helper de labo avec certains defaults
historiques Qwen 0.6B. Il ne prouve pas un E2E produit. Le test final installe
les bundles officiels, lance Fabi.app/Fabi.exe en session utilisateur,
sélectionne `qwen3-32b-v3` et laisse l'IDE injecter root3, DHT et placement.

- Tuer l'enfant pendant que Fabi le supervise provoque un respawn. Quitter
  normalement l'app pour tester le lifecycle.
- « worker prêt » ne signifie pas « route complète » ; utiliser
  `admission_ready` et la capacité réelle.
- Relay n'est pas un échec, mais il faut enregistrer direct/relay.
- Une grosse RSS ne prouve pas un leak : mesurer KV, mémoire active, pression,
  compression et swap.
- Aucun renderer ne doit conserver `ready=true` après perte de la route.

## 10. TODO exhaustive

La section suivante est l'ordre de travail. Un item n'est terminé qu'avec son
gate mesuré et documenté.

### P0 — Réparer et qualifier le desktop 0.1.16

- [ ] Ouvrir le code et les tests `worker-log` de `ce3af0f`.
- [ ] Utiliser `path.posix` pour Darwin/Linux et `path.win32` pour Windows,
      puisque la fonction reçoit une plateforme explicite.
- [ ] Ne pas affaiblir les assertions ni normaliser seulement dans le test.
- [ ] Exécuter les 102 tests `fabi-swarm`, les tests package, typecheck et build
      Electron.
- [ ] Mettre à jour le handoff, commit et push sur
      `codex/rc49-product-e2e`.
- [ ] Relancer le workflow candidat ; exiger macOS et Windows verts.
- [ ] Télécharger les deux artefacts et vérifier chaque `SHA256SUMS`.
- [ ] Documenter workflow, SHA commit, SHA DMG et SHA installateur Windows.

Gate : aucun « desktop qualifié » tant que Windows n'a pas construit le NSIS.

### P1 — Aligner les trois machines

- [ ] Reconnecter Tailscale local si nécessaire.
- [ ] Retrouver Mac mini et RTX ; ne pas remplacer leur absence par une fausse
      preuve.
- [ ] Inspecter avant mutation : version app, manifeste runtime, Fabi, worker,
      Request Agent/Maestro, Ollama et OpenClaw.
- [ ] Arrêter Ollama/OpenClaw seulement si nécessaire, sans supprimer les
      données.
- [ ] Quitter Fabi normalement et prouver l'absence de descendants avant
      installation.
- [ ] Installer rc67 avec les installateurs officiels, sans override :

```bash
curl -fsSL --retry 5 --retry-max-time 180 \
  https://github.com/Noagiannone03/fabi/releases/download/v2.7.0-rc67/install.sh \
  | env FABI_VERSION=v2.7.0-rc67 bash
```

```powershell
$env:FABI_VERSION='v2.7.0-rc67'
Invoke-RestMethod 'https://github.com/Noagiannone03/fabi/releases/download/v2.7.0-rc67/install.ps1' |
  Invoke-Expression
```

- [ ] Vérifier : rc67, CLI `f72d1118...`, moteur `797f93fa...`, Mesh 0.75.1,
      ABI 0.1.35 et device Metal/CUDA approprié.
- [ ] Installer le bundle desktop complet qualifié, jamais une copie par-dessus.
- [ ] Vérifier version, signature, fenêtre unique, bounds, absence de probe et
      chemin natif des logs.
- [ ] Sur Windows, effectuer le test UI depuis une vraie session interactive.

### P2 — Former une vraie route distribuée Qwen3-32B

- [ ] Vérifier registre/root3/scheduler avant lancement.
- [ ] Lancer normalement Fabi sur Mac local, Mac mini et RTX.
- [ ] Laisser chaque worker choisir sa tranche sans override.
- [ ] Prouver que seuls les packages de couches requis sont téléchargés.
- [ ] Obtenir des spans complémentaires couvrant `[0,64)`, pas plusieurs spans
      préfixes qui se chevauchent.
- [ ] Relever RAM/VRAM, couches, bytes/tokens KV, contexte, backend, débit et
      chemin réseau direct/relay par worker.
- [ ] Si une machine reste indisponible, redémarrer temporairement RunPod ;
      revérifier rc67. Un A40 seul sur `[0,64)` ne prouve pas la distribution.
- [ ] Ajouter/retirer un worker sans réallocation globale inutile ni boucle de
      téléchargement.

Gate : `structural_pipeline_ready=true`, `admission_ready=true`, contexte non
nul, workers sains et contribution locale reconnue.

### P3 — Vérité UI multi-Space et lifecycle

- [ ] Ouvrir au moins deux Spaces.
- [ ] Sans route : tous verrouillés, aucun prompt possible.
- [ ] Avec route : tous passent à prêt depuis le même event, sans refresh.
- [ ] Couper un composant : tous repassent à verrouillé, aucun « Prêt » ou
      « Generating » fantôme.
- [ ] Restaurer la route et vérifier la transition inverse.
- [ ] Quitter l'app et prouver fermeture worker, Request Agent, leases et
      réservations, sans respawn ni processus orphelin.

### P4 — E2E Electron/OpenCode réel

- [ ] Sélection modèle, connexion swarm, contribution puis input déverrouillé.
- [ ] Prompts Ask, Agent et Goal.
- [ ] Ask edits affiche une invite fonctionnelle.
- [ ] Auto edit n'affiche aucune invite d'édition.
- [ ] Streaming tokens, raisonnement et tools avec états cohérents.
- [ ] Lecture et modification de vrais fichiers du workspace.
- [ ] Abort serveur confirmé et route libérée.
- [ ] Second message pendant génération : ticket visible en file, pas
      remplacement du tour actif.
- [ ] Même test depuis un autre Space : file globale unique.
- [ ] Prouver « abort propriétaire -> ticket suivant -> réponse complète ».
- [ ] Tester environ 12 220 tokens d'entrée + 4 096 de sortie réservée.
- [ ] Requête trop grande : erreur immédiate avec besoin/capacité, aucun loader
      fantôme.
- [ ] Changer de modèle puis revenir ; cache, statut et contribution cohérents.
- [ ] Refaire une passe UX sans remplacer l'identité visuelle d'origine : un
      seul sélecteur Ask/Agent/Goal dans l'input, un seul sélecteur Ask
      edits/Auto edit, menus rendus au-dessus de l'input sans clipping, icônes
      explicites dans les options et focus/clavier/accessibilité corrects.
- [ ] Afficher élégamment les messages en file entre chats/Spaces, avec ordre,
      état et possibilité d'annuler un ticket sans annuler le propriétaire.
- [ ] Rendre les états raisonnement/outils/édition lisibles : texte qui évolue,
      transition discrète, nom du fichier et effet de progression pendant une
      opération réelle. L'animation doit suivre les events, jamais un timer
      décoratif qui continuerait après la fin.

### P5 — Mesures et placement adaptatif gros contexte

- [ ] Publier/observer un résumé anonyme et signé de la demande de contexte,
      jamais les prompts.
- [ ] Vérifier le pin de l'autorité qui peut publier cette demande.
- [ ] Qualifier en actif, pas seulement shadow : moins de couches et plus de
      contexte lorsque les longues demandes dominent ; plus de couverture
      lorsque la chaîne est incomplète.
- [ ] Mesurer TTFT, tokens/s, RAM/VRAM, KV, réservations, téléchargements et
      réseau.
- [ ] Prouver hystérésis et stabilité basées sur le bénéfice, sans oscillation
      ni timers arbitraires.
- [ ] Inverser l'ordre d'arrivée RTX/Mac/Mac mini.
- [ ] Simuler beaucoup de workers hétérogènes, churn et contextes variés. Un
      petit worker ne doit pas abaisser tout le swarm.

### P6 — Failover natif

- [ ] Auditer/cherry-pick si utile le test `dbdefcc`; ce n'est pas une
      qualification live.
- [ ] Former une deuxième route complète, éventuellement avec RunPod.
- [ ] Kill pendant prefill, détection par signaux protocole/santé et non délai
      arbitraire.
- [ ] Replan, nouvel epoch, fencing, replay prompt + tokens commités, aucun
      doublon SSE.
- [ ] Répéter pendant decode puis tuer aussi le premier remplaçant.
- [ ] Rejeter un ancien worker revenu tard.
- [ ] Sans remplaçant : erreur propre, loaders terminés, réservations libérées.
- [ ] Mesurer le replay froid ; concevoir ensuite seulement un snapshot KV
      compatible, versionné et vérifié.

### P7 — Réseau réel sans Tailscale produit

- [ ] Deux NAT indépendants ; Tailscale uniquement pour SSH d'administration.
- [ ] Prouver qu'aucun trafic inference n'utilise une adresse 100.x.
- [ ] Enregistrer direct/relay, RTT, pertes, reconnexions, TTFT et débit.
- [ ] Tester hole punching direct et cas CGNAT/symétrique via relay.
- [ ] Couper/revenir réseau pendant prefill et decode.

### P8 — Mises à jour signées

- [ ] Auditer le worktree `fabi-ide-desktop-stable` avant réutilisation.
- [ ] Réparer la publication stable : `stable.yml` et `stable-mac.yml`
      renvoyaient 404 ; Caddy n'avait ni route ni mount `fabi-updates`.
- [ ] Publication atomique, checksums/signatures, rollback forward-only.
- [ ] Developer ID/notarisation macOS et certificat Windows. L'ad hoc n'est pas
      une signature de production.
- [ ] Tester ancienne version -> mise à jour obligatoire -> téléchargement ->
      installation -> relance automatique -> nouvelle version.
- [ ] Ne jamais exposer les SHA internes bruts comme message utilisateur.

### P9 — Multi-utilisateur, stockage, portabilité, modèles

- [ ] Device pairing/login multi-machine, révocation, rotation et audit.
- [ ] Cache multi-disques : espace disponible, choix volume, LRU pondéré par
      habitudes/modèle/couches, protection disque plein et UI de nettoyage.
- [ ] Le stockage disponible est une contrainte de faisabilité du téléchargement,
      pas un remplacement du score de placement. Si aucune tranche utile ne
      tient, afficher une erreur espace disque claire au lieu d'attendre.
- [ ] E2E matériel AMD/Intel intégré et dédié via backends maintenus ; aucune
      promesse universelle sans matériel réel.
- [ ] Ajouter plusieurs familles de modèles via import générique source +
      package Mesh, hashes/géométrie vérifiés ; aucun code spécial Qwen.
- [ ] Plusieurs swarms simultanés : isolation DHT, cache, contribution, routing
      et changement de modèle.
- [ ] Charge de centaines de workers simulés et utilisateurs concurrents ;
      mesurer VPS/registry/coordinator, SQLite et SSE.

### P10 — Optimisations après fiabilité

- [ ] Speculative decoding : étudier l'article Gradient et le code exact
      Mesh/Skippy de la révision embarquée avant design.
- [ ] Draft model, vérification distribuée et métriques d'acceptation par modèle
      sans coût stockage excessif.
- [ ] Équilibrage inspiré de Petals (débit minimal par couche) et Exo
      (topologie, réseau, backend, cache déjà présent).
- [ ] Transfert KV uniquement entre formats/backends compatibles, toujours avec
      fallback froid.

### P11 — Clôture

- [ ] Suites complètes, lint/typecheck/build et CI multi-OS.
- [ ] E2E et mesures documentés avec dates et commandes.
- [ ] Aucun secret, override de labo ou processus orphelin dans les bundles.
- [ ] Handoff mis à jour après chaque gate.
- [ ] Commits atomiques et pushes vérifiés par `git ls-remote`.
- [ ] Revue finale puis merge vers les branches produit, notamment IDE `main`,
      seulement après qualification.

## 11. Premier travail de la prochaine conversation

Réparer le contrat de chemins de logs Windows, rendre le workflow desktop
0.1.16 entièrement vert et vérifier ses deux artefacts. Ensuite seulement
aligner les trois machines et former la route distribuée 32B. Ne pas repartir
sur speculative decoding, updater ou nouveau backend avant les gates P0 à P4.

## 12. Définition de « produit prêt »

Une personne installe Fabi, choisit un modèle, contribue automatiquement selon
ses ressources, voit un statut honnête, envoie de longues requêtes OpenCode,
autorise ou automatise les edits, met des messages en file, interrompt, change
de modèle et ferme sans processus restant. Le réseau survit aux arrivées,
départs, NAT et pannes sans corruption ni duplication de tokens. Les mises à
jour sont signées, atomiques et obligatoires si le protocole l'exige.

Tout ce qui est inférieur doit être nommé candidat, test protocole, smoke ou
non qualifié, jamais production ready.

## 13. Chantier séparé à ne pas mélanger au dataplane

L'utilisateur a aussi demandé un dashboard d'administration privé sur le VPS
pour observer swarms, peers, pipelines, capacités, modèles et santé sans lire
les JSON. Ce dashboard doit rester un service d'observabilité indépendant du
moteur et du protocole, protégé par authentification administrateur, en lecture
seule par défaut. Il ne doit pas devenir une nouvelle source de vérité ni un
scheduler de placement. Sa réalisation peut être déléguée séparément une fois
les schémas d'observabilité stabilisés ; elle ne bloque pas P0 à P7.
