# Handoff Fabi Swarm — 17 juillet 2026

Ce document permet de reprendre le chantier dans une nouvelle session Codex et sur une
autre machine sans rejouer les expérimentations déjà faites. Il distingue volontairement
le produit actuellement publié, l'ancienne branche de diagnostic très modifiée, et la
nouvelle reconstruction basée sur le Parallax upstream sain.

## Instruction de reprise pour la prochaine session

Donner ce message à Codex depuis un clone de `fabi-IDE` :

> Lis entièrement `docs/HANDOFF-SWARM-2026-07-17.md`, puis inspecte les commits et
> branches qui y sont référencés. Continue le plan « upstream rebuild » étape par étape.
> Ne cherry-pick pas en bloc `production-swarm`, ne considère pas le HTTP 200 de l'ancien
> E2E comme une validation de l'inférence, et ne déploie rien sur le scheduler public avant
> que la génération déterministe mono-machine puis distribuée soit correcte. Donne des
> mises à jour courtes en français pendant le travail.

## Objectif produit

Fabi doit devenir un IDE/CLI capable de consommer et de contribuer à un réseau d'inférence
LLM pair-à-pair :

- `fabi install` installe un launcher et le runtime adapté à la machine ;
- démarrer Fabi peut lancer le worker local sans installation manuelle annexe ;
- macOS Apple Silicon utilise MLX ;
- Linux NVIDIA utilise le backend CUDA officiellement supporté par Parallax ;
- Windows NVIDIA fonctionne nativement, sans imposer WSL à l'utilisateur ;
- le worker mesure et annonce lui-même ce qu'il accepte de fournir ;
- le scheduler répartit les couches et les requêtes à partir de cette enveloppe annoncée ;
- le mode par défaut reste stable et prévisible ; un mode élastique peut faire contribuer
  l'ensemble des nodes compatibles ;
- les gros contextes de code (cible initiale 64k) doivent être dimensionnés avec le vrai
  coût du KV cache et ne jamais tuer la machine de l'utilisateur ;
- le chemin produit final doit fonctionner sur Internet via Lattica/libp2p et ne doit pas
  dépendre de Tailscale. Tailscale reste uniquement un moyen d'administration et de test.

## Décision d'architecture actuelle

Ne plus empiler de correctifs sur l'ancien fork. Le moteur doit rester synchronisable avec
Parallax :

1. cœur Parallax upstream conservé ;
2. adaptateurs de plateforme minces et testés ;
3. extensions Fabi séparées : identité/authentification, enveloppe de ressources du worker,
   contrat registry/scheduler, événements UX et lifecycle ;
4. artefacts runtime versionnés et vérifiés par checksum ;
5. l'IDE/CLI ne contient pas une copie du moteur : il détecte, installe et lance l'artefact.

L'ancien fork divergeait de `upstream/main` de 79 commits et modifiait 73 fichiers du cœur
(environ 9 967 insertions et 560 suppressions). Cela explique la cascade de compatibilités
et justifie la reconstruction propre. Cette branche reste utile comme journal de bugs et
comme source de tests, pas comme base à merger en bloc.

## Dépôts et références exactes

### 1. IDE — `Noagiannone03/fabi-IDE`

- branche : `main`
- commit constaté : `f94dfb7` — `feat: launch stable 64k swarm workers`
- remote : `https://github.com/Noagiannone03/fabi-IDE.git`
- état au handoff : `main` était aligné sur `origin/main` avant l'ajout de ce document ;
  quatre scripts E2E locaux non suivis existent dans `tools/` et contiennent pour certains
  des paramètres de l'ancien environnement. Ne pas les committer tels quels.

Documents préexistants :

- `docs/ARCHITECTURE-swarm-runtime.md` décrit l'approche artefact/launcher ;
- `docs/SWARM-RUNPOD-VALIDATION.md` contient les anciens essais Runpod et leurs échecs.

Attention : `ARCHITECTURE-swarm-runtime.md` mentionne le runtime communautaire
SystemPanic/vLLM 0.22 utilisé dans l'ancien essai. La reconstruction choisit d'abord une
version native Windows proche du vLLM épinglé par le Parallax actuel. Le présent document
fait foi pour la reprise.

### 2. CLI — `Noagiannone03/fabi-cli`

- branche : `dev` (branche par défaut de ce dépôt) ;
- commit : `881f7dfe5` — `fix: select native Windows GPU runtime` ;
- remote : `https://github.com/Noagiannone03/fabi-cli.git` ;
- ce commit était déjà sur `origin/dev` au handoff.

Commits utiles récents :

- `fb04f15c7` : worker stable et contexte swarm 64k ;
- `c1b2574ee` : envoi du token de compte Fabi au worker ;
- `004802447` : sélection du swarm et du modèle dans l'interface ;
- `cd06c08b4` : changement de worker quand le modèle change ;
- `c698dbf0f` : choix du swarm au démarrage ;
- `b304d19ad` : activation du prefix cache.

Code principal : `packages/opencode/src/swarm/`. Lire `AGENTS.md` avant toute modification
et exécuter tests/typecheck depuis `packages/opencode`, jamais depuis la racine du dépôt.

Le code CLI actuel sait sélectionner l'artefact Windows natif, mais le runtime publié est
encore lié à l'ancien moteur. Ne publier une nouvelle release qu'après validation du moteur
reconstruit.

### 3. Registry/runtime — `Noagiannone03/fabi`

- branche : `main` ;
- commit/tag : `60f85bc`, `v2.7.0-rc18` ;
- remote : `https://github.com/Noagiannone03/fabi.git` ;
- ce commit était déjà sur `origin/main` au handoff.

Commits utiles récents :

- `5a726ac` : pins immuables des sources runtime ;
- `4af06e0` : contexte production et Python 3.12 ;
- `55797f0` : flux SSE live des swarms ;
- `5fa13d4` : découpage/réassemblage des artefacts de plus de 2 Go.

Comme pour le CLI, `rc18` aligne encore les workers sur l'ancienne branche. Conserver le
pipeline de release/checksum, mais mettre à jour le pin seulement après l'E2E propre.

### 4. Ancien moteur expérimental — `production-swarm`

- dépôt : `Noagiannone03/swarm-engine` ;
- branche locale : `codex/production-swarm` ;
- branche distante historique : `origin/production` ;
- commit : `4a0dbc5` — `fix: keep Windows long-context workers in eager mode`.

Cette branche contient les expérimentations Runpod, lifecycle, auth, capacité, Lattica,
MLX et Windows. Elle ne doit plus recevoir de petits patchs successifs.

Les dernières modifications locales ont été préservées séparément afin de ne pas salir la
branche de reconstruction :

- branche d'archive : `codex/production-swarm-handoff` ;
- commit : `04d5051` — `chore: archive final production swarm diagnostics` ;
- branche poussée sur `origin`.

Cette archive contient :

- `src/parallax/cli.py` ;
- `src/parallax/p2p/server.py` ;
- `src/parallax/vllm/batch_info.py` ;
- `tests/test_cli.py`.

Elles correspondent notamment au nettoyage des processus enfants, au forwarding de
notifications et à la compatibilité de signature vLLM 0.16. Les relire comme preuves de
bugs ; ne pas les cherry-pick automatiquement dans le rebuild.

### 5. Nouveau moteur sain — branche à continuer

- dépôt : `Noagiannone03/swarm-engine` ;
- branche : `codex/upstream-rebuild` ;
- base exacte : `GradientHQ/parallax` `upstream/main` au commit
  `162354a03234a28cf6e2946e2e0b2203da7c3721` ;
- premier commit Fabi : `56882d9` — `refactor: isolate MLX-only server metadata imports` ;
- branche poussée : `origin/codex/upstream-rebuild`.

Le premier changement déplace les imports MLX/MLX-LM utilisés par
`ShardedModelInfo.from_sharded_model` dans cette méthode. Un scheduler ou worker CUDA peut
donc importer le cœur sans installer une fausse pile MLX. Le comportement du backend MLX
reste inchangé.

Validation exécutée après ce changement :

```text
PYTHONPATH=src <python-3.12> -m pytest tests/scheduler_tests -q
51 passed
```

Ne pas confondre « scheduler unit tests verts » et « produit validé » : l'inférence réelle
Windows et distribuée reste à prouver.

## Résultat du dernier E2E distribué sur l'ancienne branche

Topologie testée :

- Mac Apple Silicon : premières couches MLX ;
- PC Windows RTX 4080 SUPER : couches suivantes via vLLM natif ;
- scheduler VPS ;
- contexte annoncé : 65 536 tokens ;
- transport worker à worker via Lattica sur les adresses Tailscale de test.

Ce qui a réellement fonctionné :

- workers joints et allocation `[0,2)` sur Mac, `[2,28)` sur Windows ;
- forwarding Mac vers Windows ;
- requête arrivée au GPU Windows ;
- retour HTTP 200 jusqu'au client.

Ce qui invalide le test : la sortie était corrompue et ne répondait pas au prompt
déterministe demandé. Le réseau et la pipeline ont tourné, mais la correction numérique du
modèle n'est pas démontrée. Causes probables à départager :

- combinaison de poids MLX 4-bit et poids vLLM non quantifiés ;
- contrat de modèle/tokenizer non strictement identique entre les workers ;
- incompatibilités internes entre Parallax épinglé pour vLLM 0.14 et le runtime Windows
  vLLM 0.16 alors utilisé.

Règle : un HTTP 200 n'est jamais une réussite E2E si le texte déterministe attendu est faux.

## Bugs établis pendant les essais précédents

1. Plusieurs processus Parallax Windows orphelins pouvaient tourner avec la même identité.
   Le launcher final doit posséder tout le groupe de processus et l'arrêter entièrement.
2. Un handler P2P construit avant l'allocation conservait une plage de couches `None` ; une
   notification optionnelle levait alors une exception et empêchait le vrai forward ZMQ.
3. Une requête interrompue pouvait conserver un slot occupé. Utiliser l'abort officiel du
   backend et des timeouts de progression, pas un reset global ad hoc.
4. Le peer ID doit être stable par installation et distinct du `worker_session_id`, qui doit
   changer à chaque lancement pour rejeter les heartbeats ghosts.
5. Les liens seulement relayés ne suffisaient pas toujours au bouclage d'une pipeline. Le
   produit doit diagnostiquer direct/relay et tester NAT traversal/relay en conditions Internet.
6. Le calcul upstream de `Node.max_requests` mérite un test : le code observé utilise
   `max(requested, derived)` alors qu'une limite de sécurité devrait normalement retenir la
   valeur la plus basse. Ne pas modifier sans test reproduisant le dépassement KV.

## Recherche upstream et choix Windows natif

Constats :

- Parallax épingle `vllm==0.14.0` dans son extra `vllm` ;
- l'installeur Windows officiel de Parallax utilise WSL2 ; ce n'est pas le produit voulu ;
- vLLM officiel ne supporte pas encore Windows natif directement et renvoie vers WSL ou
  des forks communautaires ;
- `aivrar/vllm-windows-build` publie un bundle natif `v0.14.2-win`, très proche du contrat
  attendu par Parallax : Python 3.10, PyTorch 2.9.1 + CUDA 12.6, kernels précompilés.

Liens à relire :

- https://github.com/GradientHQ/parallax
- https://github.com/GradientHQ/parallax_win_cli
- https://docs.vllm.ai/en/v0.14.0/getting_started/installation/gpu/
- https://github.com/vllm-project/vllm/issues/14981
- https://github.com/aivrar/vllm-windows-build
- https://github.com/aivrar/vllm-windows-build/releases/tag/v0.14.2-win

État sur le PC Windows :

- le ZIP `vllm-0.14.2-win.zip` (~370,8 Mo) a fini d'être téléchargé dans un nouveau runtime
  isolé sous `%LOCALAPPDATA%\fabi\runtime-v014` ;
- ne pas écraser `%LOCALAPPDATA%\fabi\runtime`, qui contient l'ancien essai ;
- le ZIP n'a pas encore été validé par checksum, inspecté ni installé au moment du handoff.

Étape suivante obligatoire : calculer le SHA256 local, le comparer à une valeur publiée ou
à une provenance vérifiable, extraire, puis lire `install.bat` et les scripts avant de les
exécuter. Ensuite lancer une génération vLLM mono-machine déterministe avant Parallax.

## Modèle de capacité à construire

Principe non négociable : le scheduler ne devine pas les ressources de la machine. Le
worker annonce une enveloppe d'admission mesurée localement et déjà amputée des réserves.

Le cœur upstream possède déjà :

- `HardwareInfo` / `detect_node_hardware` ;
- `Node.get_decoder_layer_capacity` ;
- le calcul de coût par couche et KV dans `ModelInfo` ;
- `DynamicProgrammingLayerAllocator` ;
- la télémétrie de latence moyenne par couche.

Il faut conserver ces briques et améliorer le contrat d'entrée :

- mémoire totale physique ;
- mémoire libre/available mesurée au démarrage ;
- réserve système/graphique explicite ;
- mémoire réellement offerte au swarm ;
- nombre maximal de requêtes et longueur de contexte acceptés ;
- précision/quantification exacte du modèle ;
- backend et versions runtime ;
- statut de pression mémoire et possibilité de refuser une nouvelle admission.

L'enveloppe d'admission doit être figée pour une session de worker afin que le chargement
des poids ne fasse pas croire au scheduler que la capacité vient de disparaître. Une
nouvelle session ou un changement explicite de profil peut la recalibrer.

Profils produit envisagés : `background`, `balanced`, `dedicated`, avec override manuel.
Les valeurs par défaut doivent être justifiées par les API système (VRAM CUDA libre,
mémoire disponible, pression mémoire), couvertes par tests, et toujours laisser une réserve.

## Allocation DP et routage RR/DP

Parallax upstream sépare déjà deux décisions :

- `strategy`: allocation des couches, `dp` ou `greedy`, défaut `dp` ;
- `routing_strategy`: routage des requêtes, `rr` ou `dp`, défaut `rr`.

Ne pas créer un nouvel algorithme portant presque le même nom. Exposer deux modes Fabi
compréhensibles par-dessus ces options :

- mode stable par défaut : allocation `dp`, routage `rr` sur des pipelines complets et
  enregistrés ;
- mode élastique/tous-les-nodes : allocation `dp`, routage `dp`, plus une politique de
  fairness mesurable afin que les workers compatibles aient une opportunité de servir.

« Tous les nodes » ne signifie pas forcer un node trop petit, incompatible ou dégradé dans
une requête. Il signifie utiliser tous les workers admissibles lorsque des pipelines/routes
correctes peuvent être construites. Écrire d'abord des tests : join progressif, nodes
hétérogènes, plusieurs pipelines, faible node, départ en cours de requête, starvation et
répartition sur une série de requêtes.

## Machines de test et accès

Les secrets ne sont volontairement pas versionnés dans Git, même privé. Les mots de passe
ont été communiqués dans la conversation source ; les redonner à la nouvelle session via
un canal éphémère si le trousseau/les clés ne sont pas disponibles. Ne jamais copier le
token Fabi ou un mot de passe dans un commit, un log ou une commande affichée.

### VPS scheduler / bastion

- hostname : `vps-36b69797.vps.ovh.net` ;
- IPv4 : `37.59.98.16` ;
- IPv6 : `2001:41d0:305:2100::ac43` ;
- utilisateur : `debian` ;
- Tailscale observé pendant l'ancien E2E : `100.79.54.80` ;
- le VPS possède/possédait les clés permettant de rebondir vers les machines du tailnet.

Le scheduler du VPS tourne encore sur la pile expérimentale patchée. Ne pas le remplacer
par `upstream-rebuild` avant les baselines locales.

### PC Windows NVIDIA

- Tailscale : `100.105.234.82` ;
- utilisateur SSH : `gmbhl` ;
- GPU : RTX 4080 SUPER 16 Go ;
- driver observé : 591.86 ;
- runtime ancien : `%LOCALAPPDATA%\fabi\runtime` ;
- nouveau laboratoire vLLM 0.14 : `%LOCALAPPDATA%\fabi\runtime-v014` ;
- logs anciens : `%LOCALAPPDATA%\fabi\worker-windows-task.out.log` et `.err.log`.

Un ancien worker peut encore tourner. Avant un nouveau test, inventorier les processus par
ligne de commande/session id et arrêter seulement ceux du laboratoire Fabi.

### Mac mini Apple Silicon

- Tailscale observé : `100.82.190.118` ;
- ancien runtime : `~/.local/share/fabi/runtime` ;
- token local : `~/.config/fabi/account-token` ;
- identité Lattica : `~/.config/fabi/identity` ;
- ancien launcher E2E : `~/.local/share/fabi/mac-worker-e2e.sh`.

Un ancien worker peut également tourner. Même règle de nettoyage ciblé avant test.

### MacBook courant

Le dépôt de travail local était sous `/Users/noagiannone/Documents/fabi-IDE`. Les dossiers
`audit/` sont ignorés par l'IDE et contiennent les clones/worktrees de laboratoire. Sur une
nouvelle machine, recloner explicitement les quatre dépôts plutôt que copier ces worktrees.

## Procédure de reprise recommandée

1. Cloner les dépôts et checkout les références exactes listées plus haut.
2. Lire entièrement ce document, `AGENTS.md` du CLI et les tests scheduler upstream.
3. Sur Windows, vérifier le ZIP 0.14.2, inspecter le bundle, installer dans `runtime-v014`.
4. Lancer une génération vLLM locale déterministe sur le RTX, sans Parallax.
5. Confirmer tokenizer, chat template, modèle, dtype/quantification et sortie attendue.
6. Tester l'import puis le lancement d'un worker `codex/upstream-rebuild` sur Windows ; ne
   corriger que les frontières de plateforme réellement bloquantes.
7. Tester le même modèle et la même représentation de poids localement sur MLX. Ne pas
   mélanger un modèle MLX 4-bit avec un shard CUDA BF16 sans preuve de compatibilité bit-à-bit.
8. Faire un E2E distribué local déterministe, petit modèle d'abord, puis contexte de code
   réaliste avec un modèle assez grand.
9. Ajouter l'enveloppe de capacité worker-authoritative et ses tests de propriétés.
10. Ajouter les tests des deux modes allocation/routage, puis l'exposition CLI/registry.
11. Construire les trois artefacts runtime reproductibles, checksums et manifests.
12. Brancher `fabi install`, tester installation propre sur macOS, Windows et Linux.
13. Tester Internet sans Tailscale pour le plan de données ; garder le tailnet uniquement
    pour l'administration.
14. Déployer sur un scheduler de staging, puis seulement sur le scheduler public.

## Matrice de validation minimale

Chaque étape doit échouer clairement si elle n'est pas satisfaite :

- imports scheduler sans MLX sur CUDA ;
- génération mono-machine exacte sur MLX et vLLM ;
- même tokenizer/chat template/model revision sur tous les shards ;
- génération distribuée déterministe correcte ;
- prompt long proche de la limite et dépassement proprement refusé ;
- mémoire offerte respectée pendant prefill et decode ;
- worker qui rejoint/quitte/redémarre sans ghost ;
- annulation client libérant les slots sur tous les shards ;
- route directe, hole punching et relay de secours observables ;
- RR stable ; DP élastique sans starvation ;
- install/upgrade/rollback idempotents ;
- fermeture de Fabi arrêtant tout le groupe de processus worker ;
- aucun secret dans logs, manifests, artefacts ou Git.

## Définition de « terminé »

Le chantier n'est pas terminé quand les workers sont seulement `READY`, quand une pipeline
est allouée, ou quand l'API répond 200. Il est terminé lorsque :

- l'installation depuis une machine propre est automatique ;
- le texte généré est correct et reproductible ;
- un vrai prompt de code long fonctionne ;
- les ressources restent dans l'enveloppe annoncée ;
- les départs, erreurs et annulations récupèrent sans intervention ;
- les trois plateformes passent leur matrice ;
- le chemin public fonctionne sans dépendance Tailscale ;
- les commits Fabi restent petits, isolés, testés et rebasables sur Parallax upstream.
