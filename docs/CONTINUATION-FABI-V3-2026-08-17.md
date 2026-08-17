# Reprise opérationnelle Fabi V3 — 17 août 2026

Ce document est le point de reprise courant. Il remplace opérationnellement
`CONTINUATION-FABI-V3-2026-08-13.md` sans effacer l'historique. Le handoff long
`HANDOFF-SWARM-2026-07-17.md` reste la source de vérité chronologique.

## 1. Invariant absolu et méthode de reprise

Le moteur produit de référence est exclusivement :

- clone : `/Users/noagiannone/Documents/swarm-engine-v3` ;
- branche : `codex/swarm-protocol-v3` ;
- HEAD courant : `72de6071338d5f313d921a587ab6cc3e38c1ff99`.

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
- l'ancienne continuation du 13 août pour l'historique P0–P11.

## 3. Dépôts autoritatifs au moment de la passation

État vérifié le 17 août 2026. Les quatre branches sont alignées avec leur
upstream.

| Composant | Clone | Branche | HEAD |
| --- | --- | --- | --- |
| IDE/Desktop | `/Users/noagiannone/Documents/fabi-ide` | `codex/rc49-product-e2e` | `570fa925e566bca2b5abb149ab65b787ff03ec87` |
| Moteur V3 de développement | `/Users/noagiannone/Documents/swarm-engine-v3` | `codex/swarm-protocol-v3` | `72de6071338d5f313d921a587ab6cc3e38c1ff99` |
| CLI/OpenCode | `/Users/noagiannone/Documents/fabi-cli` | `dev` | `694ed898af40169d25340eac912b97d6694e1316` |
| Méta-runtime | `/Users/noagiannone/Documents/fabi` | `main` | `4d5a763812e2c77b24b13e2df9fcccf53ac116a6` |

Le seul élément non suivi dans l'IDE avant cette passation était
`docs/instruct.md`. Les nouveaux documents de reprise sont volontairement les
seules modifications attendues.

Attention à deux SHA moteur distincts :

- `72de607...` est le moteur V3 de développement avec les fondations
  spéculatives dormantes ;
- `1c922f399d07bf1568bbaa4fcf75a4b8602a957d` est le moteur qualifié et épinglé
  dans le runtime public rc68 installé sur les machines.

Ne pas modifier les pins du runtime vers `72de607...` tant qu'une nouvelle RC
complète n'est pas construite et qualifiée.

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
- blocker : aucune route complète ne couvre encore `[0,64)` ;
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

- Laisser le RTX choisir la tranche complémentaire, attendue autour de
  `[28,64)`, sans override de span.
- Prouver couverture `[0,64)`, liens directionnels nécessaires, packages de
  couches seulement, mémoire/VRAM/KV et contexte 32 768.
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

### P5 à P11

Conserver la TODO exhaustive du document du 13 août : placement actif et
mesures, failover natif prefill/decode, NAT indépendants sans Tailscale pour le
trafic produit, updater réellement signé, pairing, stockage multi-disque,
portabilité, multi-modèle, charge, optimisations spéculatives, puis clôture et
merge produit. Aucun de ces blocs n'est déclaré terminé.

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
