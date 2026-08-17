# Reprise opérationnelle Fabi V3 — 17 août 2026

Ce document est le point de reprise courant. Il consolide l'ancienne passation
du 13 août, supprimée à la demande de l'utilisateur. Le handoff long
`HANDOFF-SWARM-2026-07-17.md` conserve l'historique chronologique.

## 1. Invariant absolu et méthode de reprise

Le moteur produit de référence est exclusivement :

- clone : `/Users/noagiannone/Documents/swarm-engine-v3` ;
- branche : `codex/swarm-protocol-v3` ;
- HEAD courant : `043697057cce3154090220e392d036ecd88941b8`.

Ne jamais reprendre `/Users/noagiannone/Documents/swarm-engine` ni
`/Users/noagiannone/Documents/swarm-engine-dynamic` comme base produit. Fabi
est V3-only : aucun fallback, launcher ou protocole V2 ne doit être
réintroduit.

À chaque reprise :

1. inspecter les quatre worktrees avant toute mutation ;
2. préserver toute modification utilisateur ; aucun reset ou checkout
   destructif ;
3. lire ce document entièrement, les dernières sections du handoff, puis les
   documents d'architecture cités plus bas ;
4. vérifier le live avant d'affirmer : CI, versions installées, processus,
   registre, scheduler et DHT ;
5. distinguer tests unitaires, package CI, installation native, lancement
   headless et E2E UI interactif ;
6. mettre à jour le handoff, committer et pousser après chaque gate réel ;
7. consulter `docs/instruct.md` au démarrage puis périodiquement. Ce fichier
   utilisateur est vide et non suivi : ne pas le supprimer ni le committer.

## 2. Conversations et objectif source

Conversation historique de juillet-août, très volumineuse :

`/Users/noagiannone/.codex/sessions/2026/07/20/rollout-2026-07-20T09-36-43-019f7e74-ac4e-7b52-b15b-9e0e3647a19e.jsonl`

ID : `019f7e74-ac4e-7b52-b15b-9e0e3647a19e`.

Conversation ayant repris ce chantier du 13 au 17 août :

`/Users/noagiannone/.codex/sessions/2026/08/13/rollout-2026-08-13T11-33-08-019ffa77-e1a2-74e2-8e2b-3be5b920aec9.jsonl`

ID : `019ffa77-e1a2-74e2-8e2b-3be5b920aec9`.

Le Goal initial de cette seconde conversation est aussi conservé ici :

`/Users/noagiannone/.codex/attachments/c754992f-e211-419a-b8e9-d0593f580e0c/pasted-text-1.txt`

Ces JSONL peuvent contenir des secrets. Ne jamais les afficher entièrement,
les copier dans Git ou les joindre à une issue. Utiliser `rg` et `tail` :

```bash
CURRENT_FABI_SESSION=/Users/noagiannone/.codex/sessions/2026/08/13/rollout-2026-08-13T11-33-08-019ffa77-e1a2-74e2-8e2b-3be5b920aec9.jsonl
rg -n '32003410782|rc68|OpenClaw|Ollama|speculative|P4' "$CURRENT_FABI_SESSION"
tail -n 500 "$CURRENT_FABI_SESSION"
```

Documents obligatoires :

- `docs/HANDOFF-SWARM-2026-07-17.md` ;
- `docs/FABI-SWARM-PROTOCOL-V3.md` ;
- `docs/FABI-CONTEXT-AWARE-PLACEMENT-V3.md` ;
- `docs/SWARM-FAILOVER-DESIGN.md` ;
- `docs/SWARM-SCALE-PETALS-DESIGN.md` ;
- `docs/FABI-ADAPTIVE-SPECULATIVE-DECODING.md` ;
- `docs/SWARM-RUNPOD-VALIDATION.md` ;
- `docs/ARCHITECTURE-swarm-runtime.md` ;

## 3. Dépôts autoritatifs au moment de la passation

État vérifié le 17 août 2026. Les quatre branches sont alignées avec leur
upstream.

| Composant | Clone | Branche | HEAD |
| --- | --- | --- | --- |
| IDE/Desktop | `/Users/noagiannone/Documents/fabi-ide` | `codex/rc49-product-e2e` | `c6d667ce0049981597758aa41e6fc44b529a69c4` |
| Moteur V3 de développement | `/Users/noagiannone/Documents/swarm-engine-v3` | `codex/swarm-protocol-v3` | `043697057cce3154090220e392d036ecd88941b8` |
| CLI/OpenCode | `/Users/noagiannone/Documents/fabi-cli` | `dev` | `ed7967b8e592471b05e729b1772d4ffb54b74787` |
| Méta-runtime | `/Users/noagiannone/Documents/fabi` | `main` | `7380ee1fbbf4f8a4a5e9c0afd1caba2a2fcbee12` |

Le seul élément non suivi dans l'IDE avant cette passation était
`docs/instruct.md`. Les nouveaux documents de reprise sont volontairement les
seules modifications attendues.

Attention aux états runtime distincts :

- `043697057...` est le moteur V3 courant, avec les événements lifecycle et
  les fondations spéculatives toujours dormantes ;
- `1c922f399d07bf1568bbaa4fcf75a4b8602a957d` est le moteur qualifié et épinglé
  dans le runtime public rc68 installé sur les machines.

Le runtime rc70 épinglant `043697057...` est publié et qualifié, mais n'est pas
encore installé sur les machines live afin de ne pas interrompre le
téléchargement rc68 du RTX.

## 4. Architecture à préserver

- Catalogue modèle signé TUF/root3 et artefacts de couches sélectifs.
- DHT pour offres, spans, leases, capacités mémoire/KV, liens et santé.
- Placement autonome : chaque worker observe le réseau et choisit une tranche
  utile. Aucun VPS autoritaire n'assigne globalement les couches.
- Le VPS coordonne une requête : admission, réservation, journal SSE,
  epoch/fencing et libération. Il ne devient pas le scheduler de placement.
- Une route complète porte son propre contexte ; le plus petit worker ne doit
  pas réduire arbitrairement tout le swarm.
- Admission sur le budget réel prompt + sortie réservée et le KV disponible.
- Contribution locale réelle obligatoire avant consommation.
- Mesh/Skippy 0.75.1, ABI 0.1.35, backend Metal/CUDA selon la machine.
- Iroh pour direct/relay ; rust-libp2p pour la DHT.
- Heartbeats et leases indépendants des générations longues.
- Commit-before-publish, abort explicite, replay froid exact, epochs et fencing.
- FIFO machine-wide multi-Space ; pas une FIFO locale concurrente par chat.
- Ask, Agent, Goal ; Ask edits et Auto edit/YOLO.
- Aucun timer décoratif pour conclure qu'un worker, un outil ou une requête a
  réussi ou échoué.

## 5. Ce qui a été achevé depuis la passation du 13 août

### 5.1 Runtime public rc68

Le runtime public installé porte :

- `fabi v2.7.0-rc68` ;
- CLI `694ed898af40169d25340eac912b97d6694e1316` ;
- moteur qualifié `1c922f399d07bf1568bbaa4fcf75a4b8602a957d` ;
- Mesh `0.75.1`, ABI `0.1.35` ;
- Metal sur les Macs, CUDA sur la RTX.

Les installateurs officiels macOS et Windows sont transactionnels. La RTX a
finalement téléchargé l'archive officielle complète de 806 907 229 octets,
SHA-256 attendu
`391c22a4d9e5e251dab1347435dc4cb23eb9f774e13b661bf3fdb0c74c99144f`,
puis son manifeste a basculé de rc66 vers rc68.

### 5.2 Desktop courant 0.1.19

La fausse boîte Theia « Restart » au démarrage est comprise et corrigée. Elle
venait de la migration `window.titleBarStyle: native -> custom` effectuée après
le branchement du listener frontend. Le commit `b20cf0...` migre maintenant le
JSONC avant le frontend, préserve commentaires et préférences et laisse un
fichier invalide intact. Les profils local et Mac mini portent `custom` et les
lancements observés n'ont plus montré la boîte.

Les travaux P4 suivants font aussi partie de la branche et du candidat :

- `7907124` : harnesses E2E mono-Space et multi-Space durcis ;
- `930c900` : FIFO backend autoritative avec abort propriétaire ;
- `656b76b` : permissions Ask edits/YOLO à travers le broker réel ;
- `cbbd5e1` : raisonnement incrémental, outil `edit`, `file.edited` et états ;
- `a995720` : fin exacte d'une requête trop grande et libération FIFO ;
- `980fb21` : suppression de la seconde FIFO locale et gate par `turnId` ;
- `c756843` : envoi visible pendant une génération déjà admise et action
  séparée pour arrêter le propriétaire ;
- `edd4e16` : reconnaissance CDP des frontends packagés et de développement ;
- `570fa92` : audit Electron verrouillé consigné dans le handoff.

Ces commits rendent les scénarios testables et ferment beaucoup de contrats
locaux. Ils ne remplacent pas le replay live Electron sur une route complète.

### 5.3 Candidat desktop qualifié par CI

Workflow GitHub Actions : `32003410782`, HEAD
`570fa925e566bca2b5abb149ab65b787ff03ec87`, conclusion `success`.

- job macOS arm64 vert : contrat produit, build ad hoc, contrat natif et
  checksums ;
- job Windows x64 vert : contrat produit, NSIS, installation smoke sans bureau
  et checksums.

Artefacts de ce workflow, qui remplacent les anciens binaires portant aussi la
version 0.1.19 :

| Artefact | Taille | SHA-256 |
| --- | ---: | --- |
| `Fabi-0.1.19-arm64.dmg` | 221 861 678 | `bc466b43ac39202689fb705e6f8c0ffce2d4b932877aff9d053a1682b40f9da7` |
| `Fabi-Setup-0.1.19-x64.exe` | 189 255 044 | `e80b80e82222e9505390a5976d8cf6018ac68b30530332ec8599309f14f8c3d0` |

Une copie vérifiée reste sur le VPS dans
`/tmp/fabi-candidate-32003410782`. Le cache local temporaire a été supprimé
après vérification pour récupérer environ 597 Mio ; les artefacts restent
téléchargeables depuis le workflow. La signature macOS est ad hoc, pas
Developer ID/notarisée : P8 reste ouvert.

### 5.4 Suites exécutées pendant la qualification courante

IDE :

- 112/112 tests `fabi-swarm` ;
- 7/7 tests `fabi-spaces` ;
- 11/11 tests desktop/outils ;
- syntaxe des deux harnesses E2E ;
- typechecks et bundles déjà verts sur les commits concernés ;
- workflow macOS/Windows `32003410782` vert.

Moteur V3 :

- suite complète : 1084 réussis, 8 ignorés, 0 échec avec le seuil de disque de
  test neutralisé par `FABI_MODEL_CACHE_MIN_FREE_BYTES=0` ;
- le premier passage avait seulement quatre échecs dus au disque local sous le
  seuil produit de 6 Gio, pas à un défaut fonctionnel ;
- format Rust vert ; Clippy `-D warnings` vert ;
- 31 tests réseau/DHT, 1 test DXGI et 5 tests bridge Skippy verts.

CLI/runtime :

- trois tests installateur CLI et `bun typecheck` verts ;
- lock runtime exact, quatre tests de bundling/neutralisation, et transaction
  d'upgrade POSIX verts.

Tous les artefacts de test temporaires suivis ont été nettoyés sans toucher aux
caches modèles. Le disque local reste critique : environ 2,7 Gio disponibles.

## 6. État live des trois machines à la passation

### 6.1 Mac local

- `/Applications/Fabi.app`, version 0.1.19 du workflow `32003410782` ;
- `codesign --deep --strict` vert ;
- runtime rc68 exact, Metal ;
- Fabi lancé normalement ; worker et Request Agent actifs ;
- node ID `993a92a366b8f05db751f53ad5b7ef9e1256e96e3141d42e22d42a486c41efab` ;
- span autonome `[15,28)`, état V3 `ready`, KV 32 768 tokens ;
- réglage Theia `window.titleBarStyle=custom`, aucun dialogue Restart observé ;
- seulement environ 2,7 Gio libres : ne pas effacer les caches modèles, mais
  éviter toute nouvelle archive ou build volumineux sur ce disque.

### 6.2 Mac mini projet IA

- Tailscale `100.76.201.20`, LAN `192.168.10.82`, user `gmbh` ;
- accès : `ssh vps "ssh gmbh@mac-mini-projet-ia ..."` ;
- app installée dans `/Users/gmbh/Applications/Fabi.app`, version 0.1.19 ;
- runtime rc68 exact, Metal ;
- node ID `eac4e80848d2d7f454af674b51a90cf0397273e8fc98d57339f1b76db12864ec` ;
- span autonome `[0,15)`, état V3 `ready`, KV 32 768 tokens ;
- Fabi et Request Agent sont actifs ;
- l'ancien 0.1.15 reste récupérable dans la Corbeille ;
- un restart sûr du seul scheduler 32B a réparé son ancien snapshot DHT sans
  recréer le volume ni l'identité.

À la demande explicite de l'utilisateur, OpenClaw a été arrêté sans rien
supprimer : le LaunchAgent `ai.openclaw.gateway` a été déchargé de la session,
les processus agent/Chrome dédiés ont reçu TERM et la vérification ne trouvait
plus aucun processus ou label chargé. Les jobs de transfert temporaires créés
pour cette qualification ont aussi été arrêtés ; Fabi est resté actif.

### 6.3 PC Windows RTX

- Tailscale `100.105.234.82`, LAN `192.168.10.29`, user `gmbhl` ;
- accès : `ssh vps "ssh pc-windows-projet-ia ..."` ;
- Windows 11 Pro, RTX 4080 SUPER 16 Gio ;
- aucune session utilisateur interactive n'était ouverte au contrôle ;
- desktop 0.1.19 installé dans
  `C:\Users\gmbhl\AppData\Local\Programs\Fabi\Fabi.exe` ;
- ancien dossier préservé dans
  `C:\Users\gmbhl\AppData\Local\Programs\Fabi.pre-0.1.19-20260817T0924` ;
- runtime rc68 exact, CUDA, CLI `694ed898...`, moteur `1c922f399...` ;
- l'installateur rc68 et son `curl` avaient terminé avant la passation ;
- Fabi a été lancé de façon détachée par `Win32_Process.Create` parce qu'un
  simple `Start-Process` sous SSH était tué avec la session ;
- ce lancement persiste avec ses enfants Python, mais reste un lancement
  headless de worker et non une preuve UI Windows.

À la demande de l'utilisateur, les deux `llama-server.exe` sous `C:\llama`
ont été arrêtés avec leurs arbres exacts. La tâche planifiée `OllamaServe` est
préservée, état Ready, et aucun modèle/fichier n'a été supprimé. La VRAM est
passée d'environ 13 003 Mio utilisés à 63 Mio, puis environ 321 Mio lors de
l'initialisation de Fabi. Ne pas relancer Ollama pendant le gate distribué.

Les anciens logs rc66 contiennent une boucle `readiness Request Agent obsolète
ou étrangère` provenant d'un ancien lancement headless. Le lancement rc68 du
17 août doit être évalué séparément ; ne pas attribuer les anciennes lignes au
nouveau runtime. Le log courant a enregistré le worker rc68 et le Request Agent
à partir de 07:50 UTC.

## 7. État réseau Qwen3-32B

Endpoints :

- registre : `https://server.undefinedstudio.fr/fabi-registry/v1/swarms` ;
- scheduler :
  `https://server.undefinedstudio.fr/fabi-scheduler/qwen3-32b-v3` ;
- statut :
  `https://server.undefinedstudio.fr/fabi-scheduler/qwen3-32b-v3/cluster/status_json` ;
- scheduler peer :
  `efbb30064456a064f83e8c84878b93868fc1864821b5f92cddbbecc3920b4f24` ;
- model swarm ID :
  `69e2d536942a630259538875c47784333618b8d7a0fd3e924ca524254c303338` ;
- relay : `https://server.undefinedstudio.fr:4443`.

Le root3 public, timestamp, snapshot, targets et manifeste modèle ont été
vérifiés cohérents. Le scheduler `parallax-scheduler-qwen3-32b-v3` conserve son
volume, sa DB de permits et son identité ; ne jamais faire `docker compose
down -v`.

Dernier état certain avant finalisation du document :

- catalogue `snapshot_ready` ;
- deux workers acceptés, sains et prêts ;
- spans `[0,15)` et `[15,28)` ;
- un lien dirigé direct Mac mini -> Mac local, sans relay ;
- contexte/KV annoncé 32 768 sur chaque Mac ;
- aucune route active ;
- `structural_pipeline_ready=false`, `admission_ready=false`, contexte
  routable zéro ;
- blocker : aucune route complète du modèle n'est encore admissible ;
- le RTX est désormais le troisième worker accepté : node
  `c4a8c5206a56248429fe1a6b32898bfdca98723ab3bd1583c26d4e67ffb53714`,
  capacité publiée 14,86 Gio, choix autonome des couches `[28,63]` à 32 768
  tokens et lien direct Mac local -> RTX ;
- il téléchargeait 37 fichiers sélectifs et restait
  `building`/`waiting_contract`, KV non publié et rejet transitoire
  `scheduler_transition` ; la route n'était donc pas encore admissible.

Ne jamais afficher l'UI « Prêt » avant la convergence réelle du troisième
worker et des liens nécessaires.

## 8. Speculative decoding : état exact

Le speculative decoding n'est ni activé, ni publié, ni épinglé dans rc68. La
fonction utilisateur reste strictement `target-only`.

Le moteur V3 de développement contient néanmoins des fondations dormantes :

- vérification multi-token transactionnelle, checkpoint/rollback/trim KV ;
- nettoyage atomique d'une route différée ;
- contrats bornés et fenced request/route/epoch/digest/window ;
- settlement exact : acceptation complète + bonus, rejet + token correctif,
  stop et limite de sortie ;
- digest du plan signé dans `CommittedRoute` et bridge durable greedy-only ;
- RPC Iroh borné/authentifié mais non enregistré ;
- certification registre opt-in d'un proposer suffix Mesh ;
- retrait des fenêtres sur replan/expiry/release ;
- raccord au journal SQLite commit-before-publish ;
- télémétrie sans prompt/token brut et contrôleur dormant comparé à une
  baseline target-only.

Commits détaillés dans le handoff : `f2d4a6b`, `70ae89d`, `0252247`,
`66a3e6d`, `42ea774`, `9ca0813`, `e744d9e`, `736a761`, `00e69bd` et
`72de607`.

Il manque encore : exposition maintenue du proposer Mesh, exécuteur derrière
le RPC, orchestration multi-span, proposer request-local, chemin durable
commit -> SSE, drainage borné, alimentation réelle des métriques, parité
greedy puis statistique, et benchmarks Mac mini + RTX + seconde route.

Ordre impératif : ne reprendre ce chantier qu'après P1–P4 réellement verts,
puis failover/NAT suffisamment fiables. Ne jamais activer les fondations
dormantes pour accélérer artificiellement le gate produit courant.

## 9. Travail restant, dans l'ordre

### P1 — terminer l'alignement et le lifecycle

- Attendre la fin des 37 fichiers et l'initialisation du worker RTX rc68 sans
  tuer Fabi.
- Son offre DHT, sa capacité CUDA 14,86 Gio et son choix autonome `[28,63]`
  sont déjà observés ; vérifier maintenant son état final, son KV et sa VRAM.
- Vérifier que l'ancien problème de readiness ne se reproduit pas sous rc68.
- Obtenir ensuite une vraie session desktop `gmbhl` pour le gate UI Windows :
  le lancement Win32 headless ne le remplace pas.
- Tester plus tard fermeture normale et absence de descendants sur les trois
  machines, sans confondre cela avec `taskkill /F`.

### P2 — route physique complète

- Le RTX a choisi `[28,63]` dans le catalogue et le log de rechargement indique
  `[28,63)` ; vérifier la convention de borne et la couverture de la dernière
  couche dans l'état final, sans override de span.
- Prouver la couverture complète du modèle, les liens directionnels requis,
  les packages de couches seulement, mémoire/VRAM/KV et contexte 32 768.
- Exiger `structural_pipeline_ready=true` et `admission_ready=true`.
- Faire une première requête OpenAI réelle et vérifier tokens, TTFT, débit,
  réservations et libération.
- Ajouter/retirer un worker et vérifier la convergence sans réallocation
  globale ni boucle de téléchargement.

### P3 — vérité multi-Space et lifecycle

- Deux Spaces distincts ; sans route tous verrouillés.
- Avec route, transition commune vers prêt sans refresh.
- Perte de route : tous reverrouillés, aucun `Ready`/`Generating` fantôme.
- Retour de route, puis fermeture normale de l'app et de tous ses descendants.

### P4 — E2E Electron/OpenCode

- Ask, Agent, Goal ; Ask edits et Auto edit/YOLO.
- Streaming texte et raisonnement ; outils et modification réelle de fichier.
- Cartes outil `running -> completed`, nom du fichier et état final exact.
- Abort du propriétaire, route libérée, ticket suivant complet.
- FIFO globale avec deux Spaces et ordre observable.
- Ticket annulable sans annuler le propriétaire.
- Gros contexte environ 12 220 tokens + sortie 4 096.
- Requête trop grande : erreur immédiate besoin/capacité, aucun loader fantôme.
- Changement de modèle et retour, statut/cache/contribution cohérents.
- Exécuter les harnesses de `tools/` préparés par `7907124`/`edd4e16` et
  conserver diagnostics/captures en cas d'échec.

### P5 — mesures et placement adaptatif gros contexte

- Publier/observer un résumé anonyme et signé de la demande de contexte, sans
  prompt, token brut ni sortie, et vérifier l'autorité de publication.
- Qualifier le placement actif : moins de couches et plus de contexte lorsque
  les longues demandes dominent, davantage de couverture si la chaîne est
  incomplète.
- Mesurer TTFT, tokens/s, RAM/VRAM, KV, réservations, téléchargements et réseau.
- Prouver hystérésis et stabilité fondées sur le bénéfice, sans oscillation ni
  timer arbitraire.
- Inverser l'ordre d'arrivée RTX/Mac/Mac mini et simuler workers hétérogènes,
  churn et contextes variés. Un petit worker ne doit pas abaisser tout le swarm.

### P6 — failover natif

- Former une deuxième route complète, éventuellement avec RunPod, sans faire
  passer un test d'intégration isolé pour une preuve live.
- Tuer un worker pendant prefill puis pendant decode ; détecter via protocole et
  santé, pas via un délai arbitraire.
- Replanifier avec nouvel epoch, fencing et replay prompt + tokens commités,
  sans doublon SSE ; tuer aussi le premier remplaçant.
- Rejeter un ancien worker revenu tard.
- Sans remplaçant : erreur propre, loaders terminés et réservations libérées.
- Mesurer le replay froid avant de concevoir un snapshot KV compatible,
  versionné et vérifié.

### P7 — réseau réel sans Tailscale produit

- Deux NAT indépendants ; Tailscale uniquement pour l'administration SSH.
- Prouver qu'aucun trafic d'inférence n'utilise une adresse 100.x.
- Mesurer direct/relay, RTT, pertes, reconnexions, TTFT et débit.
- Tester hole punching direct, CGNAT/symétrique via relay, puis coupure/retour
  réseau pendant prefill et decode.

### P8 — mises à jour signées

- Auditer l'ancien worktree `fabi-ide-desktop-stable` avant toute réutilisation.
- Corriger le feed stable encore dormant/404 avec publication atomique,
  checksums, signatures et rollback forward-only.
- Obtenir Developer ID/notarisation macOS et certificat Windows ; l'ad hoc
  actuel n'est pas une signature de production.
- Tester ancienne version -> mise à jour obligatoire -> téléchargement ->
  installation -> relance automatique -> nouvelle version.
- Ne jamais montrer les SHA internes bruts comme message utilisateur.

### P9 — utilisateurs, stockage, portabilité, modèles et charge

- Device pairing/login multi-machine, révocation, rotation et audit.
- Cache multi-disques : espace, choix de volume, LRU pondéré, protection disque
  plein et UI de nettoyage. L'espace est une contrainte de téléchargement, pas
  un remplacement du score de placement.
- E2E AMD/Intel intégré et dédié via backends maintenus, sans promesse
  universelle non testée.
- Ajouter plusieurs familles de modèles par import générique source + package
  Mesh, avec hashes/géométrie vérifiés et sans code spécial Qwen.
- Plusieurs swarms simultanés : isolation DHT, cache, contribution, routing et
  changement de modèle.
- Charge de centaines de workers simulés et utilisateurs concurrents ; mesurer
  VPS, registre, coordinateur, SQLite et SSE.

### P10 — optimisations après fiabilité

- Étudier l'article Gradient et la révision Mesh/Skippy épinglée avant toute
  activation du speculative decoding.
- Draft model/proposer maintenu, vérification distribuée, métriques
  d'acceptation et coût stockage borné.
- Équilibrage inspiré de Petals et Exo : débit minimal par couche, topologie,
  réseau, backend et cache déjà présent.
- Transfert KV seulement entre formats/backends compatibles, avec fallback
  froid systématique.

### P11 — clôture

- Suites complètes, lint/typecheck/build et CI multi-OS.
- E2E et mesures documentés avec dates et commandes.
- Aucun secret, override de labo ou processus orphelin dans les bundles.
- Handoff à jour, commits atomiques et pushes vérifiés par SHA distant.
- Revue finale puis merge vers les branches produit, notamment IDE `main`,
  uniquement après qualification.

Aucun des blocs P5–P11 n'est déclaré terminé.

## 10. Accès, services et précautions

- VPS : `ssh vps`, utilisateur `debian`, hôte public `37.59.98.16`.
- Mac mini : toujours spécifier `gmbh@mac-mini-projet-ia` depuis le VPS.
- RTX : `pc-windows-projet-ia`, user `gmbhl`.
- Tailscale sert à l'administration ; P7 exige que l'inférence n'utilise pas
  d'adresse 100.x.
- Token RunPod courant : Trousseau macOS, service
  `codex-runpod-api-key-current`, compte `noagiannone`. Ne pas l'imprimer.
- Le pod historique `j44wb04s5bi6rq` est `EXITED`, non supprimé ; aucun pod
  payant n'est actif.
- Ne pas réactiver OpenClaw/Ollama pendant les mesures sauf besoin explicite.
- Ne pas supprimer les archives partielles Windows/Mac avant d'avoir vérifié
  l'état final et choisi explicitement ce qui est devenu inutile.
- Préserver les backups d'app/runtime indiqués dans ce document et le handoff.

## 11. Définition finale

Fabi n'est fini que lorsqu'une personne peut installer et ouvrir normalement
l'app, choisir un modèle, contribuer automatiquement, voir une vérité exacte,
faire de longues générations OpenCode avec outils et éditions, gérer
permissions/modes/FIFO/abort/changement de modèle, puis fermer proprement ; et
que le réseau résiste au churn, aux pannes et aux NAT avec mise à jour signée,
sans configuration de laboratoire ni fallback V2.

Le prochain geste utile n'est donc pas du nouveau code spéculatif : observer et
qualifier le worker RTX rc68, fermer P2, puis exécuter P3/P4 sur la route
physique.

## 12. Gate courant : lifecycle rc70 et desktop 0.1.21

État vérifié le 17 août 2026 à 12:27 CEST :

- moteur V3 `043697057cce3154090220e392d036ecd88941b8`, CI
  `32015167077` verte sur macOS, Ubuntu et Windows ; suite locale complète
  `1088 passed, 8 skipped` ;
- CLI `ed7967b8e592471b05e729b1772d4ffb54b74787`, tests installateur et
  typecheck verts ;
- méta-runtime `7380ee1fbbf4f8a4a5e9c0afd1caba2a2fcbee12`, tag annoté
  `v2.7.0-rc70`, workflow Release `32015802311` vert ; 27 assets et 12/12
  sidecars SHA-256 vérifiés ;
- manifeste macOS rc70 extrait en flux : CLI `ed7967b8...`, moteur
  `043697057...`, Mesh 0.75.1, ABI 0.1.35, Python 3.12.7 et Metal ;
- IDE `c6d667ce0049981597758aa41e6fc44b529a69c4`, desktop 0.1.21,
  115 tests swarm, 7 Spaces, 11 desktop et bundle Electron verts ;
- workflow desktop `32018598421` vert sur macOS ARM64 et Windows x64, y
  compris contrat natif/codesign ad hoc, NSIS et installation smoke ;
- DMG : 221 834 885 octets, SHA-256
  `42b647c7332365e89fbe5c8ed317b2ab7ae569af001a5033cf19a810ed589c00` ;
- EXE : 189 253 422 octets, SHA-256
  `8f47a9943a6748c06f6638537a27df2ef13780d3fa297f4ec2eb6bfe5828d09a` ;
- copie vérifiée des artefacts sous
  `/var/tmp/fabi-desktop-32018598421` sur le VPS.

Le correctif rc70 répond au faux bootstrap indéfini : le moteur émet maintenant
les événements `[FABI]` sur stdout aux transitions réelles et le desktop ne
mélange plus stderr avec le tampon de framing. Cela est couvert par tests et
CI, mais la preuve UI live exige encore l'installation contrôlée de 0.1.21/rc70.

État des machines :

- Mac local : Fabi volontairement fermé par l'utilisateur ; aucun processus
  Fabi/Parallax ; environ 8,4 Gio libres après suppression de cinq caches de
  développement reconstruisibles. Ne pas le relancer avant le gate ;
- Mac mini : desktop/worker rc68 toujours actif, node `eac4e808...`, état V3
  `ready`, KV 32 768 ;
- RTX : même worker rc68 PID `10268`, 25 blobs et 5 981 789 997 octets
  apparents, cinq incomplets pour 325 058 560 octets, VRAM 73/15 975 Mio et
  GPU 0 %. Le téléchargement continue. Le contrat signé sélectionne exactement
  37 fichiers et 10 513 630 797 octets : `model-package.json`,
  `shared/metadata.gguf` et les couches 028 à 062. Cela confirme que le log
  runtime `[28,63)` est semi-ouvert ; la couverture de la borne finale reste à
  prouver dans l'état de route, pas à déduire du catalogue brut `[28,63]` ;
- scheduler : seulement Mac mini + RTX visibles, `waiting`, route structurelle
  fausse, admission fausse, contexte zéro et `need_more_nodes=true`, ce qui est
  attendu tant que le Mac local reste fermé et le RTX non initialisé.

Ne pas installer rc70 ni 0.1.21 sur le RTX pendant son téléchargement rc68.
Après sa fin : vérifier borne `[28,63)` et fichiers exacts, KV/VRAM/liens,
basculer proprement les trois machines, remettre le Mac local dans la route,
exiger admission réelle et génération mesurée. P3/P4 suivent immédiatement.
Le speculative decoding n'est ni activé ni utilisé comme raccourci.

## 13. Compteur de téléchargement rc71 en qualification

État vérifié le 17 août 2026 vers 13:03 CEST :

- moteur V3 `dcb5c5f255a711df1f702904e27f0e5f21caa33a`, poussé sur
  `codex/swarm-protocol-v3` ; le chemin Skippy fournit maintenant à
  `snapshot_download` une classe tqdm qui ne suit que la barre externe
  `Fetching N files`, publie `weights_load_progress` et rend toute exception
  de télémétrie inoffensive pour le téléchargement authentifié ;
- tests ciblés moteur : 25 réussis ; suite complète : `1090 passed, 8 skipped`.
  Le premier passage avait cinq échecs environnementaux dus au seuil disque
  produit et à un budget MLX nul dans le processus long ; les quatre tests
  stockage passent avec le seuil de test neutralisé et le test MLX passe seul,
  puis la suite complète passe avec ce même seuil de test neutralisé ;
- workflow moteur `32021830865` entièrement vert sur Ubuntu, macOS et Windows
  au SHA exact, y compris format/lint, DHT, wheel ABI3, bridge Skippy et
  contrats V3 ;
- CLI `271eb46cfaf731dca12343087323e4d7f0d1ad76`, tests installateur ciblés et
  typecheck complet verts, poussé sur `dev` ;
- méta-runtime `28c3f9119c1c54dc05a96660102a1c95f541813a` : ses transactions
  Linux/Windows et la cohérence du lock sont vertes dans `32022430867`. Le tag
  annoté `v2.7.0-rc71` dereference exactement ce commit ; le workflow release
  `32022504921` construit encore les six tarballs. Aucun asset rc71 n'est encore
  revendiqué ni installé ;
- IDE `b3c7db7eeec809f19e518ef3b72eddaa2d0c0b94` préserve le dernier total de
  fichiers jusqu'à `weights_load_done`, puis
  `c6b7c1bcaa8a2bb04eb0e1261d1d596f7ed4f0a7` épingle rc71/CLI/moteur et porte
  le desktop à 0.1.22. Les 116 tests swarm, 7 Spaces, 11 desktop et le bundle
  Electron sont verts localement. Le workflow candidat `32022614426` est
  encore en cours ; aucun DMG/EXE 0.1.22 n'est encore revendiqué.

Le contrôle Windows du même worker rc68 PID `10268` confirme une progression
réelle : 27 blobs pour 6 544 983 277 octets apparents, cinq incomplets pour
325 058 560 octets, 4 927 832 021 octets écrits et VRAM 73/15 975 Mio. Le
comptage exact des chemins signés est passé de 16/37 à 18/37 ; les fichiers
complets vont jusqu'à `layers/layer-043.gguf` et il manque 044 à 062. Le
scheduler reste justement non admissible et le Mac mini reste `ready`, KV
32 768. Fabi demeure volontairement fermé sur ce Mac.

Deux modèles 0,6B uniquement téléchargés par la suite de tests ont été retirés
du cache Hugging Face comme données reconstruisibles ; le cache Fabi 32B de
14 Gio est intégralement préservé. L'espace libre observé est remonté à environ
6,6 Gio. Sur le Mac mini, un `curl` oublié de l'ancienne tentative de transfert
a été arrêté exactement ; le vieux `dd` sur le fichier temporaire déjà absent
reste en état noyau `U` malgré TERM, comme les anciens `shasum`. Le worker Fabi
n'a pas été touché.

Ordre immédiat actualisé : terminer et vérifier les workflows rc71/0.1.22,
laisser le RTX rc68 achever ses 37 fichiers sans restart, exiger son chargement,
son KV, sa VRAM et ses liens, puis seulement effectuer la transition contrôlée
des trois machines. Le speculative decoding reste dormant.
