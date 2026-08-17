# Prompt de reprise à coller dans la prochaine conversation

Copie tout le bloc ci-dessous dans une nouvelle conversation Codex.

```text
IMPORTANT : le moteur de référence est exclusivement
`/Users/noagiannone/Documents/swarm-engine-v3`, branche
`codex/swarm-protocol-v3`. Travaille sur cette V3 et ne reprends jamais
`/Users/noagiannone/Documents/swarm-engine` ni
`/Users/noagiannone/Documents/swarm-engine-dynamic` comme base produit. Fabi
est V3-only : aucun fallback, launcher ou protocole V2 ne doit être
réintroduit.

Tu reprends intégralement le développement de Fabi V3 depuis l'état exact du
17 août 2026 dans le workspace :

`/Users/noagiannone/Documents/fabi-ide`

Fabi est un IDE/CLI OpenCode connecté à un réseau d'inférence pair-à-pair fondé
sur Parallax/Gradient, Mesh/Skippy, Iroh et rust-libp2p. Le but est un produit
robuste et fini de bout en bout, pas une démo de laboratoire.

Avant toute modification :

1. Inspecte `git status --short --branch` dans les quatre dépôts et préserve
   toute modification locale. Aucun reset/checkout destructif.
2. Fais `git pull --ff-only` seulement si cela n'écrase rien.
3. Lis entièrement :
   - `docs/CONTINUATION-FABI-V3-2026-08-17.md` ;
   - `docs/NEXT-CONVERSATION-PROMPT-2026-08-17.md`.
4. Lis au minimum les 800 dernières lignes de
   `docs/HANDOFF-SWARM-2026-07-17.md`, puis remonte quand une décision manque.
5. Lis les documents V3, placement, failover, scale Petals, RunPod,
   speculative decoding et architecture listés dans la continuation.
6. Consulte `docs/instruct.md` au démarrage puis périodiquement. Il est vide,
   non suivi et appartient à l'utilisateur : ne le supprime ni ne le committe.
7. Vérifie réellement les branches, SHA, CI, versions installées, processus,
   registre, scheduler et DHT avant toute affirmation.

Si le contexte documentaire ne suffit pas, recherche avec `rg` ou `tail` dans
les deux conversations sources :

- historique principal :
  `/Users/noagiannone/.codex/sessions/2026/07/20/rollout-2026-07-20T09-36-43-019f7e74-ac4e-7b52-b15b-9e0e3647a19e.jsonl` ;
- reprise du 13 au 17 août :
  `/Users/noagiannone/.codex/sessions/2026/08/13/rollout-2026-08-13T11-33-08-019ffa77-e1a2-74e2-8e2b-3be5b920aec9.jsonl`.

Ces JSONL sont volumineux et peuvent contenir des secrets : ne les affiche
jamais entièrement, ne les copie pas dans Git et ne publie aucun secret dans
tes réponses.

Révisions autoritatives connues au début de la reprise :

- IDE : `/Users/noagiannone/Documents/fabi-ide`, branche
  `codex/rc49-product-e2e`, SHA
  `c6d667ce0049981597758aa41e6fc44b529a69c4` ;
- moteur V3 de développement :
  `/Users/noagiannone/Documents/swarm-engine-v3`, branche
  `codex/swarm-protocol-v3`, SHA
  `043697057cce3154090220e392d036ecd88941b8` ;
- CLI : `/Users/noagiannone/Documents/fabi-cli`, branche `dev`, SHA
  `ed7967b8e592471b05e729b1772d4ffb54b74787` ;
- méta-runtime : `/Users/noagiannone/Documents/fabi`, branche `main`, SHA
  `7380ee1fbbf4f8a4a5e9c0afd1caba2a2fcbee12` ;
- runtime public qualifié : rc70, CLI `ed7967b8...`, moteur qualifié
  `043697057...`, Mesh 0.75.1, ABI 0.1.35 ; les machines live restent encore
  sur rc68 jusqu'à la fin du téléchargement RTX.

Le desktop candidat courant est Fabi 0.1.21 au SHA IDE `c6d667c...`. Son
workflow officiel `32018598421` est vert sur macOS arm64 et Windows x64,
incluant le smoke NSIS. Les artefacts vérifiés sont :

- DMG 221 834 885 octets, SHA-256
  `42b647c7332365e89fbe5c8ed317b2ab7ae569af001a5033cf19a810ed589c00` ;
- EXE 189 253 422 octets, SHA-256
  `8f47a9943a6748c06f6638537a27df2ef13780d3fa297f4ec2eb6bfe5828d09a`.

Une copie vérifiée est sur le VPS sous
`/var/tmp/fabi-desktop-32018598421`. La release rc70 `32015802311` est elle
aussi entièrement verte, avec 27 assets, 12/12 sidecars conformes aux digests
GitHub et un manifeste macOS contrôlé en flux. La signature macOS reste ad hoc :
ne pas déclarer l'updater/signature de production terminé.

État live à revérifier immédiatement :

- Mac local : l'utilisateur a volontairement fermé Fabi parce que ce Mac ne
  servait pas pour l'instant. Aucun processus Fabi/Parallax au dernier relevé,
  environ 7,3 Gio libres. Ne pas le relancer avant le gate live.
- Mac mini : Fabi 0.1.19 dans `/Users/gmbh/Applications/Fabi.app`, rc68 actif,
  span `[0,15)`, node `eac4e808...64ec`, KV 32768. OpenClaw est volontairement
  arrêté et son LaunchAgent déchargé sans suppression ; ne le relance pas
  pendant les mesures.
- RTX Windows : Fabi 0.1.19 et rc68 CUDA sont installés. L'archive officielle
  a atteint 806 907 229 octets et le manifeste rc68 porte les bons SHA. Fabi a
  été lancé de façon détachée avec `Win32_Process.Create`; c'est un worker
  headless, pas une preuve UI. Aucune session interactive `gmbhl` n'était
  ouverte. Les deux `llama-server.exe` ont été arrêtés, la tâche planifiée
  `OllamaServe` et les modèles sont préservés, et la VRAM a été libérée.
- Scheduler 32B : le Mac mini est `ready`. Le RTX est accepté sous le node
  `c4a8c520...3714`, a publié 14,86 Gio CUDA et choisi autonomement `[28,63]` à
  32 768 tokens. À 12:27 CEST, le même PID `10268` avait 25 blobs pour
  5 981 789 997 octets apparents, cinq incomplets pour 325 058 560 octets,
  VRAM 73/15 975 Mio et GPU 0 %. Le contrat signé porte exactement 37 fichiers
  et 10 513 630 797 octets : package, metadata et couches 028 à 062, donc le
  log `[28,63)` est semi-ouvert. Il restait `waiting_contract`. Comme le Mac
  local est fermé, le scheduler ne voit que Mac mini + RTX et publie
  honnêtement route/admission fausses, contexte zéro et `need_more_nodes=true`.

Accès :

- VPS : `ssh vps` ;
- Mac mini : `ssh vps "ssh gmbh@mac-mini-projet-ia ..."` ;
- RTX : `ssh vps "ssh pc-windows-projet-ia ..."` ;
- registre : `https://server.undefinedstudio.fr/fabi-registry/v1/swarms` ;
- status 32B :
  `https://server.undefinedstudio.fr/fabi-scheduler/qwen3-32b-v3/cluster/status_json`.

Tailscale sert à l'administration. Le futur gate NAT doit prouver que le
trafic d'inférence n'utilise pas les adresses 100.x.

Premier objectif concret : ne recommence pas P0 et ne relance pas le Mac local
pour rien. Laisse le PID rc68 du RTX finir ses 37 fichiers. Son offre et son
choix autonome `[28,63]` sont déjà présents ; vérifie l'état `ready`, la
convention `[28,63)`, la VRAM, le KV et les liens sans override manuel. Ensuite
seulement, installe de façon contrôlée rc70/desktop 0.1.21 sur les machines,
remets le Mac local dans la route, exige
`structural_pipeline_ready=true` et `admission_ready=true`, puis fais une
génération OpenAI réelle et mesure TTFT, débit, mémoire, réseau, réservations
et libération.

Si le worker RTX échoue, diagnostique la cause contractuelle dans le runtime et
les logs. Ne contourne pas par un span manuel, une ancienne RC, un launcher V2
ou un timer. Un lancement headless peut prouver le dataplane, mais le gate UI
Windows nécessite ensuite une vraie session desktop `gmbhl` et un lancement
normal de `%LOCALAPPDATA%\Programs\Fabi\Fabi.exe`.

Une fois la route complète obtenue, continue sans t'arrêter :

1. P3, vérité readiness sur deux Spaces et lifecycle/fermeture normale ;
2. P4, E2E Electron/OpenCode avec Ask/Agent/Goal, Ask edits/Auto edit,
   streaming, raisonnement, outils, édition réelle, abort, FIFO globale,
   ticket suivant, gros contexte, erreur de capacité et changement de modèle ;
3. P5, mesures et placement adaptatif actif ;
4. P6, failover natif prefill/decode, replay froid, epochs/fencing et aucun
   doublon ;
5. P7, deux NAT réels sans Tailscale pour le trafic produit ;
6. P8–P9, updater signé, pairing, stockage multi-disque, portabilité,
   multi-modèle et charge ;
7. P10 seulement après fiabilité : speculative decoding et transfert KV ;
8. P11, qualification finale, docs, commits/pushes puis merge produit.

Le speculative decoding est volontairement dormant. L'historique moteur
contient les contrats de vérification, settlement, fencing, journal durable,
RPC Iroh non enregistré, certification opt-in et contrôleur target-only, mais
il manque encore proposer Mesh exposé, exécuteur RPC, orchestration multi-span,
commit->SSE, métriques réelles et benchmarks. Aucun de ces commits n'est
activé dans rc70. Ne l'active pas avant les gates P1–P4 et la fiabilité.

Règles de travail :

- aucune surqualification : unit test, CI, installation, headless et UI sont
  des preuves différentes ;
- aucune suppression de données, caches modèles, backups, OpenClaw ou Ollama ;
- aucun processus de labo caché comme preuve produit ;
- pas de nouvelle source de vérité centrale pour le placement ;
- avant tout problème complexe distribué/réseau/runtime/mémoire/streaming/
  failover/sécurité, consulte les sources primaires et le code officiel ;
- corrige le contrat et ajoute les tests, n'empile pas de patchs fragiles ;
- donne régulièrement une mise à jour courte à l'utilisateur ;
- après chaque gate, mets à jour le handoff, fais des commits atomiques dans le
  bon dépôt, pousse et vérifie les SHA distants ;
- continue de façon autonome tant qu'une action sûre et utile reste possible.

Le Goal n'est terminé que lorsqu'une personne peut installer et ouvrir Fabi,
choisir un modèle, contribuer automatiquement, voir un statut fidèle, lancer
de longues générations OpenCode, utiliser outils/edits/permissions/modes,
mettre en file, interrompre, changer de modèle et fermer proprement, avec
résistance au churn, aux pannes et aux NAT et avec mises à jour signées, sans
configuration de laboratoire.
```

Intitulé court si l'interface demande un Goal :

```text
Finaliser et qualifier Fabi V3 de bout en bout
```

Objectif condensé si l'interface ne demande qu'une phrase :

```text
Reprendre Fabi V3 depuis `docs/CONTINUATION-FABI-V3-2026-08-17.md`, finir la
route physique Qwen3-32B avec le RTX rc68, qualifier P3/P4 Electron/OpenCode,
puis poursuivre placement, failover, NAT, updater signé, pairing, stockage,
portabilité, multi-modèle et enfin speculative decoding, sans fallback V2 ni
preuve de laboratoire et en documentant/poussant chaque gate réel.
```
