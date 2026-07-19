# Handoff Fabi Swarm — 17 juillet 2026

> **Mise a jour autoritative :** lire d'abord la section
> `Qualification du contrat heterogene et reprise produit du 18 juillet 2026` en fin de document. Elle
> contient les derniers commits, les validations effectives et l'etat exact du laboratoire.
> Les SHA et constats precedents sont conserves comme historique, mais cette derniere section
> fait foi en cas de contradiction.

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
- état au handoff : le document et les quatre scripts de laboratoire ont été ajoutés puis
  poussés sur `origin/main`. Les scripts conservent les paramètres réseau de l'ancien E2E
  Tailscale pour rendre le diagnostic reproductible, mais ne contiennent aucun secret.

Documents préexistants :

- `docs/ARCHITECTURE-swarm-runtime.md` décrit l'approche artefact/launcher ;
- `docs/SWARM-RUNPOD-VALIDATION.md` contient les anciens essais Runpod et leurs échecs.

Attention : `ARCHITECTURE-swarm-runtime.md` mentionne le runtime communautaire
SystemPanic/vLLM 0.22 utilisé dans l'ancien essai. La reconstruction choisit d'abord une
version native Windows proche du vLLM épinglé par le Parallax actuel. Le présent document
fait foi pour la reprise.

Scripts de laboratoire désormais versionnés :

- `tools/mac-worker-e2e.sh` : ancien worker MLX Mac mini ;
- `tools/windows-worker-e2e.ps1` : ancien worker RTX/vLLM ;
- `tools/parallel-range-download.ps1` : téléchargement Windows par plages ;
- `tools/windows-install-cuda-e2e.ps1` : bootstrap CUDA 12.6.3 vérifié par SHA256.

Les deux launchers worker lisent le token depuis `~/.config/fabi/account-token` au moment
de l'exécution. Ils ciblent l'ancien laboratoire Tailscale et ne sont pas le launcher final
à distribuer aux utilisateurs.

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

### Avancement de la reconstruction après le handoff

La branche `codex/upstream-rebuild` a ensuite reçu cinq commits Fabi isolés, tous poussés
sur `origin` :

- `3d66cfa` — `feat(windows): enable native vLLM workers` ;
- `e3f6e3e` — `fix(scheduler): route ready local-model workers` ;
- `811fb75` — `fix(frontend): expose local models by scheduler alias` ;
- `660b400` — `fix(vllm): stabilize network pipeline sampling` ;
- `e0aa134` — `fix(p2p): preserve manual assignment on rejoin`.

Le runtime communautaire vLLM 0.14.2 a été inspecté et installé dans le laboratoire Windows
isolé. La compatibilité du correctif a aussi été vérifiée contre le code source officiel
vLLM 0.14 : la sortie synchrone `ModelRunnerOutput.sampled_token_ids` est une liste CPU,
alors que la sortie asynchrone fournit également les tenseurs utilisés par l'ancien chemin
Parallax. L'adaptateur normalise désormais explicitement ces deux contrats.

La génération distribuée déterministe est maintenant prouvée sur la topologie suivante :

- Mac mini M4, backend MLX, couches `[0,2)` ;
- PC Windows RTX 4080 SUPER, backend vLLM natif 0.14.2, couches `[2,28)` ;
- modèle Qwen3-1.7B BF16 et tokenizer identiques ;
- scheduler de laboratoire local, transport P2P entre les deux machines.

Avec `async_scheduling=False`, une taille de bloc commune de 16 et le prefix cache actif sur
les deux workers, une requête d'amorçage puis neuf répétitions de `What is 2 + 3?` ont toutes
produit exactement `5`. Chacune des neuf répétitions a réutilisé le même bloc sur les deux
shards : `16/26` tokens côté MLX et `16/26` côté vLLM. Après un second redémarrage complet,
deux nouvelles requêtes ont encore produit `5` et le second appel a confirmé le même cache
hit. Ce résultat valide l'inférence distribuée courte avec prefix cache ; il ne valide pas
encore les longs contextes, la pression mémoire, la capacité, le lifecycle ou le chemin
Internet public.

Validation locale après les commits `dc7aab7` et `bed1d7d` :

```text
tests/scheduler_tests + tests/test_server_args.py + tests/test_vllm_rust_frontend.py
+ tests/test_vllm_model_runner_config.py + tests/test_p2p_node_info.py
+ tests/test_vllm_prefix_cache.py + tests/test_p2p_transfer_metrics.py : 80 passed, 1 skipped
Black et git diff --check : OK
Ruff avec F541 ignoré : OK ; deux F541 préexistants restent dans parallax/p2p/server.py
```

La suite `pytest` complète ne collecte pas dans le venv minimal du MacBook car six modules
de tests MLX requièrent `mlx_lm`. Cela reste une limite d'environnement de test à lever, pas
une suite déclarée verte.

Le défaut de prefix cache a été localisé dans l'adaptation vLLM Parallax, pas dans le principe
de cache par shard. L'upstream acceptait `enable_prefix_cache` mais ne le transmettait pas au
`CacheConfig`, gardait `enable_prefix_caching=False`, n'installait aucun block hasher et
planifiait encore le prompt complet après un hit. `dc7aab7` câble les primitives officielles
vLLM 0.14, ne planifie que le suffixe non caché, sélectionne les activations correspondantes
requête par requête avant concaténation et refuse toute divergence non satisfaisable au lieu
de compléter silencieusement avec des zéros.

Le laboratoire a aussi révélé que le calcul de débit P2P amont divisait par deux appels
successifs à `time.time()`. Sous Windows, ils pouvaient retourner la même valeur : chaque
token produisait alors un `ZeroDivisionError` puis une seconde d'attente. `bed1d7d` utilise
`perf_counter_ns()`, mesure une seule fois et couvre explicitement la durée nulle. Le dernier
E2E ne contient plus aucun traceback et les deux requêtes se terminent en 7,1 secondes au
total au lieu de subir cette attente à chaque token.

Deux limites restent établies :

1. Si des shards subissent plus tard des évictions différentes, le chemin sûr détecte qu'un
   downstream demande plus d'activations que l'upstream n'en a émises et arrête la requête
   avec une erreur explicite. Le produit doit encore négocier le minimum commun et rejouer le
   prefill pour rendre ce cas transparent sous pression mémoire et sur plus de deux stages.
2. Après redémarrage du scheduler pendant que des workers restent vivants, le heartbeat
   omettait `manual_layer_assignment` et le scheduler reconstruisait donc les workers comme
   automatiques. Le commit `e0aa134` conserve ce contrat et ajoute une régression unitaire.
   Une succession de peers manuels et automatiques avait aussi déclenché un `ValueError` en
   essayant d'activer un node déjà repassé `STANDBY` ; le scénario réseau complet de restart
   doit encore être rejoué pour confirmer que sa cause racine est bien supprimée.

Aucun déploiement n'a été effectué sur le VPS public. Les workers de laboratoire et le
scheduler local ont été arrêtés après la campagne, puis l'absence de processus worker
restant a été vérifiée sur Windows et macOS.

Validation exécutée après ce changement :

```text
PYTHONPATH=src <python-3.12> -m pytest tests/scheduler_tests -q
51 passed
```

Ne pas confondre « E2E court avec cache validé » et « produit validé » : les longs contextes,
les évictions divergentes, la capacité, les restarts et le chemin Internet public restent à
prouver.

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

Cette étape a été exécutée dans le runtime isolé, puis prolongée jusqu'à l'E2E distribué
décrit plus haut. Avant d'en faire un artefact produit, il reste obligatoire d'automatiser
la vérification de provenance/checksum et de rendre l'installation reproductible.

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
8. Conserver l'E2E distribué court désormais vert comme test de régression, puis tester un
   contexte de code réaliste avec un modèle assez grand. La pipeline hétérogène doit garder
   le prefix cache désactivé tant qu'un contrat commun n'est pas démontré.
9. Reproduire et corriger le rejoin après redémarrage scheduler, puis ajouter l'enveloppe de
   capacité worker-authoritative et ses tests de propriétés.
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

## Qualification finale de la session du 17 juillet 2026

Cette section est le point de reprise autoritatif. Elle enregistre des faits observables,
les decisions techniques et leurs justifications. Elle ne pretend pas retranscrire un
raisonnement interne mot a mot : les preuves, alternatives examinees et causes racines
sont detaillees afin qu'une autre IA puisse verifier chaque conclusion.

### Contraintes donnees par le proprietaire du projet

- rester sur les depots GitHub du compte `Noagiannone03` ;
- partir du Parallax upstream sain et reutiliser ses solutions ou des correctifs historiques
  isoles plutot que reecrire le moteur ;
- consulter upstream, les issues et la documentation avant toute modification structurelle ;
- tester le vrai pair-a-pair avec le Mac mini MLX et le PC Windows NVIDIA via Tailscale ;
- viser l'experience produit : Fabi choisit un mode et un modele, lance le worker, puis le
  scheduler alloue automatiquement les couches ;
- ne pas considerer la desactivation du prefix cache comme une solution finale ;
- documenter honnetement ce qui marche, ce qui reste a faire et ne jamais versionner les
  identifiants communiques pendant la session.

### Etat Git exact a reprendre

Moteur `Noagiannone03/swarm-engine`, branche `codex/upstream-rebuild` :

- base distante precedente : `bed1d7d` ;
- `cfa8b6b` — liberation de capacite, reconnexion scheduler et resistance a la pression
  du prefix cache ;
- `863712f` — arret `SIGTERM` gracieux, cherry-pick exact du correctif historique isole
  `db7cdae` ;
- `4ce2241` — identite pair worker persistante, portage minimal de la logique utile de
  `b9703bc` sans reprendre la branche historique entiere ;
- `32b9baf` — `node_leave` tente meme apres l'arret du manager d'etat partage ;
- `be90732` — la CLI attend la disparition du groupe de processus worker complet.

IDE `Noagiannone03/fabi-IDE`, branche `main` :

- `ad791d1` — contrat CLI actuel du prefix cache et arret supervise du worker ;
- la presente section de handoff est le commit de documentation immediatement posterieur.

CLI `Noagiannone03/fabi-cli`, branche `dev` :

- `f8b839a71` — le cache actif utilise le defaut Parallax et l'opt-out emet
  `--disable-prefix-cache`.

Le remote `upstream` du moteur a ete rafraichi le 17 juillet. `upstream/main` etait toujours
a `162354a` : aucun nouveau commit officiel n'etait disponible a cherry-pick. Le depot sale
historique `/Users/noagiannone/Documents/swarm-engine` n'a volontairement pas ete modifie.

### Ce qui a ete corrige dans le moteur

1. **Premier worker et allocation automatique.** Le scheduler renouvelle maintenant le bail
   du heartbeat de bootstrap pendant qu'il attend assez de workers. Un worker qui rejoint
   sans plage manuelle recoit automatiquement `[0, 28)` pour Qwen3-1.7B sur le Mac mini.

2. **Rejoin apres redemarrage scheduler.** La reconnexion automatique efface l'ancien etat
   de service avant le nouveau join. Le worker retrouve le scheduler redemarre, rejoint
   directement et recoit de nouveau sa plage sans arguments de couches.

3. **Capacite concurrente.** Les reservations appartiennent au scheduler, sont indexees par
   un identifiant de requete normalise et sont liberees sur fin HTTP, fin de stream,
   annulation et erreur. Une condition reveille immediatement la requete suivante au lieu
   d'attendre un heartbeat arbitraire.

4. **Latence de routage.** Le heartbeat transporte la vraie valeur
   `avg_layer_latency_ms`. La reconstruction RPC precedente recalculait parfois `inf`, ce
   qui rendait le worker temporairement inadmissible et provoquait un `429` juste apres une
   grosse requete pourtant terminee.

5. **Chunked prefill.** Les references obsoletes de la file de prefill ont ete eliminees ;
   elles ne peuvent plus conserver une requete deja terminee dans le scheduler de batch.

6. **Cause racine du cache sous pression.** Le radix cache upstream indexait les enfants
   seulement par le premier token d'un bloc. Deux blocs differents commencant par le meme
   token s'ecrasaient dans le dictionnaire. Les KV blocks de la branche ecrasee restaient
   comptes/alloues mais devenaient inaccessibles a l'eviction, d'ou `Evicted 0` puis OOM.
   La cle est maintenant le tuple complet du bloc. Le test unitaire reproduisait avant le
   correctif trois blocs caches mais une seule feuille accessible et une eviction limitee a
   deux blocs ; il valide desormais la conservation et l'eviction de toutes les branches.

7. **Identite stable.** Le worker utilise `PARALLAX_KEY_PATH` s'il est defini, sinon
   `~/.parallax`, cree le dossier en mode `0700`, et fournit la cle a Lattica. Le Mac mini a
   conserve le meme peer id sur au moins trois lancements avec
   `/Users/gmbh/.local/share/fabi/identity`.

8. **Depart gracieux.** L'arret n'abandonne plus `node_leave` quand le manager partage est
   deja ferme ou renvoie `EOFError`/`BrokenPipeError`. Les threads ont un join borne, Lattica
   est fermee independamment et la CLI attend aussi les descendants du groupe de processus.

### Alignement IDE et CLI

La reconstruction Parallax active le prefix cache par defaut. L'ancien flag
`--enable-prefix-cache` n'existe plus dans le contrat courant :

- cache actif : aucun argument, donc utilisation du defaut du moteur ;
- cache explicitement desactive : `--disable-prefix-cache` ;
- l'IDE, le CLI et les launchers E2E macOS/Windows utilisent maintenant ce meme contrat.

Le superviseur IDE envoie sur Unix `SIGINT`, attend 12 secondes, envoie `SIGTERM`, attend
5 secondes, puis seulement `SIGKILL`. Les timers restent references afin que Node ne quitte
pas avant le nettoyage. Sur Windows, `taskkill.exe /PID <pid> /T` traite tout l'arbre et
`/F` n'est ajoute qu'a la derniere escalation. Le handler synchrone de sortie applique le
meme principe.

### Resultats de validation reels

Environnement valide : scheduler sur le MacBook via Tailscale, worker MLX sur le Mac mini,
modele `Qwen3-1.7B-bf16`, 28 couches, prefix cache actif, blocs de 16 tokens et batch maximal
de 1.

- allocation sans `--start-layer`/`--end-layer` : `[0, 28)` ;
- prompt de 2 422 tokens execute deux fois : 2 416 tokens caches/reutilises, puis latence
  observee de 0,625 s et 0,397 s ;
- deux prompts concurrents d'environ 4 800 tokens : HTTP 200 en 6,662 s et 7,295 s ; la
  seconde requete a demarre immediatement apres la liberation de la reservation ;
- redemarrage du scheduler : reconnexion directe et reallocation automatique validees ;
- pression cache apres redemarrage propre : cinq prompts distincts de 17 519, 17 519,
  17 519, 14 019 et 14 019 tokens, tous HTTP 200 ;
- capacite KV observee : 64 672 tokens, soit 4 042 blocs ;
- les evictions ont rendu des blocs (8 puis des series de 64) au lieu de `Evicted 0`, sans
  OOM ;
- repetition du dernier prompt : HTTP 200 en 0,772 s, avec 14 016 tokens reutilises sur
  14 019 ;
- arret worker : le scheduler a recu `node_leave`, passe le pair hors ligne, supprime la
  pipeline et affiche zero pipeline enregistree immediatement ;
- dernier essai d'arret apres `be90732` : plus aucun port worker n'ecoute ;
- test d'integration du superviseur IDE avec un faux groupe worker : reception de `SIGINT`,
  puis `SIGTERM` car le faux enfant ignorait volontairement l'interruption, et aucun PID
  survivant apres 12,007 s.

Suite moteur executee :

```text
PYTHONPATH=src .venv/bin/python -m pytest -q \
  tests/test_block_radix_cache.py tests/test_rpc_connection_handler.py \
  tests/test_backend_request_handler.py tests/test_batch_scheduler.py \
  tests/test_cli.py tests/test_server_args.py tests/scheduler_tests \
  tests/test_p2p_node_info.py tests/test_prefix_cache.py \
  tests/test_vllm_prefix_cache.py tests/test_mlx_linear_prefix_cache.py

113 passed, 1 warning in 1.12s
```

`compileall` et `git diff --check` ont reussi. La suite MLX complete ne peut pas etre
collectee dans le venv local du MacBook car `mlx_lm` n'y est pas installe ; le runtime du
Mac mini possede bien MLX et a servi les E2E ci-dessus. `yarn -s build:fabi-ext` a reussi
dans l'IDE.

Les tests CLI n'ont pas demarre pour deux dependances absentes de l'installation locale :

- `bun test src/swarm/worker.test.ts` : preload `@opentui/solid/preload` introuvable ;
- `bun typecheck` : executable `tsgo` introuvable.

Ne pas installer aveuglement un gros arbre de dependances sur cette machine : il restait
environ 1,2 Gio d'espace disque pendant la session. Les fonctions changees sont pures et
leurs tests sont ajoutes, mais ils doivent etre executes dans l'environnement CLI complet.

### Interpretation du resultat prefix cache

La desactivation globale du cache n'est plus le correctif retenu. Le cas MLX mono-worker
est actif, repete, soumis a pression et vert apres correction de la structure radix. Les
documents officiels Parallax trouves pendant la session decrivent encore parfois
`--enable-prefix-cache` et sont en retard par rapport au parser actuel ; le code et les
tests du checkout courant font foi.

Ce resultat ne prouve pas encore qu'une pipeline heterogene MLX + vLLM peut evincer des
prefixes differents de chaque cote sans diverger. Il faut conserver l'activation par defaut
pour les configurations qualifiees, mais ne declarer la pipeline heterogene prete qu'apres
un protocole commun de replay/eviction et un E2E de pression sur les deux backends.

### Etat du laboratoire a la cloture

- scheduler local arrete proprement ;
- worker Mac mini arrete, port P2P ferme et aucune pipeline enregistree ;
- aucun processus Parallax/Fabi de laboratoire actif sur le MacBook ;
- aucun deploiement effectue sur le VPS pendant cette phase ;
- PC Windows non reteste pendant cette phase ; son ancien etat ne doit pas etre presente
  comme qualifie ;
- fichiers locaux temporaires contenant la cle de session et le launcher Windows supprimes
  avant cloture ;
- aucun secret ajoute aux trois depots.

### Ce qui reste a faire, dans cet ordre

1. **Executer les tests CLI dans un checkout complet** puis verifier que l'IDE et la CLI
   installent/lancent exactement le commit moteur qualifie, pas un ancien runtime. Le test
   manuel Mac a necessite un `PYTHONPATH` vers la source : le produit doit publier et pinner
   un artefact reproductible avec checksum.
2. **Qualifier Windows vLLM natif.** Le PC possede vLLM-Windows 0.14.2 et une RTX 4080 SUPER,
   mais le frontend Rust vLLM requis n'a pas ete valide dans cette session. Reutiliser un
   artefact maintenu ou la procedure officielle compatible plutot que recoder le frontend.
3. **Tester la vraie pipeline heterogene** Mac `[0, 2)` + Windows `[2, 28)` : tokenizer,
   revision du modele, dtype, transfert d'activations, cache hit, pression et eviction
   doivent etre identiques/coordonnees. Ajouter un test qui force des branches partageant
   le meme premier token.
4. **Tester les pannes non gracieuses** : deconnexion reseau en cours de requete, kill dur,
   expiration heartbeat, redemarrage d'un shard, annulation client et reprise sans ghost ni
   reservation bloquee.
5. **Valider l'admission** : verifier notamment si `Node.max_requests` doit agreger la limite
   minimale plutot que maximale sur une pipeline heterogene. Ecrire le test avant de changer
   ce contrat.
6. **Valider le parcours produit complet** depuis Fabi : choix swarm/modele, lancement
   automatique des workers, allocation DP, routage RR/DP, fermeture de l'application et
   mise a jour/rollback du runtime.
7. **Publier les artefacts moteur** macOS/Windows/Linux, mettre a jour le pin et le checksum
   du registry Fabi, puis seulement deployer un scheduler de staging sur le VPS et tester le
   chemin Lattica public sans dependance Tailscale.
8. **Securite** : les identifiants d'acces ont ete exposes dans la conversation. Revoquer et
   regenerer la cle SSH de session ainsi que les mots de passe concernes avant tout passage
   en production, meme si aucun secret n'est present dans Git.

### Commande de reprise courte

Depuis `fabi-IDE`, la prochaine session doit lire cette section, verifier que les trois
branches distantes pointent sur les commits listes, executer le test CLI dans son
environnement complet, puis reprendre au point 2 ci-dessus. Ne pas deployer sur le VPS et
ne pas merger l'ancien fork tant que la matrice macOS + Windows heterogene n'est pas verte.

## Reprise et qualification heterogene du 18 juillet 2026

Cette section remplace les anciens points de reprise lorsqu'ils se contredisent. Le coeur
heterogene Mac MLX + Windows vLLM est maintenant fonctionnel en allocation automatique DP,
mais le produit complet, le cache distribue sous pression et le chemin Internet public ne
sont pas encore qualifies.

### Etat Git autoritatif

- IDE `Noagiannone03/fabi-IDE`, branche `main` : `ad58d80` ;
- CLI `Noagiannone03/fabi-cli`, branche `dev` : `8c1c001` ; ce commit conserve le bus type
  et epingle exactement le moteur reconstruit ;
- moteur `Noagiannone03/swarm-engine`, nouvelle branche produit
  `codex/dynamic-dp-product` : `14a8793` ;
- base de reconstruction precedente : `codex/upstream-rebuild` a `be90732` ;
- Parallax officiel `GradientHQ/parallax` verifie a `162354a` : aucun changement upstream
  plus recent n'etait disponible.

Commits de la branche produit moteur, tous pousses sur `origin` :

- `3183d64` — expose allocation `dp` et routage `dp` dans le backend et la CLI ;
- `d59f9f7` — annonce la capacite d'heberger le frontend et interdit la couche zero aux
  runtimes incompatibles ;
- `14a8793` — rend le bootstrap DP independant de l'ordre d'arrivee des workers.

### Decisions produit validees

Le mode produit retenu est le mode elastique Parallax existant : allocation `dp` et routage
`dp`. Il doit construire des pipelines complets puis attribuer les workers admissibles
supplementaires comme redondance, sans laisser arbitrairement des pairs en `joining`.
Le mode `rr` reste utile comme comparaison, mais n'est pas la cible principale de Fabi.

Le frontend Rust officiel de Parallax repose sur l'heritage de descripteurs POSIX et ne
possede pas de chemin Windows natif. Il n'a pas ete recode. Chaque worker annonce desormais
`supports_frontend`; macOS retourne vrai lorsque le binaire officiel est disponible et
Windows retourne faux. L'allocateur peut donc utiliser Windows pour les couches suivantes
sans jamais lui attribuer la couche zero.

Le DP upstream parcourait les workers dans leur ordre d'arrivee. Si Windows, incapable de
demarrer une pipeline, arrivait avant le seul Mac compatible frontend, le DP ignorait
Windows, demarrait trop tard sur le Mac et ne pouvait plus revenir en arriere. La solution
est une entree canonique du DP : workers capables d'heberger la tete en premier, puis
capacite decroissante et identite stable. Une regression reproduit explicitement l'ordre
Windows puis Mac.

### Validation reelle du coeur heterogene

Topologie du laboratoire :

- scheduler sur le MacBook, API locale `3001`, allocation `dp`, routage `dp` ;
- Mac mini M4, MLX/SGLang, modele local Qwen3-1.7B BF16, capacite parametres volontairement
  limitee a `0.05`, frontend officiel disponible ;
- PC Windows RTX 4080 SUPER, vLLM Windows 0.14.2 natif, backend d'attention
  `torch_native`, frontend indisponible ;
- taille de bloc commune : 16, sequence maximale annoncee : 4 096, batch maximal : 1 ;
- prefix cache desactive uniquement pour ce baseline de correction numerique et chunked
  prefill desactive avec la valeur officielle `--chunked-prefill-size 0`.

Aucun worker n'a recu `--start-layer` ni `--end-layer`. Le PC a volontairement rejoint en
premier, puis le Mac. Le scheduler a construit automatiquement :

```text
Mac mini  supports_frontend=true   [0, 2)
Windows   supports_frontend=false  [2, 28)
standby                              0
```

Les deux workers sont passes `READY` et actifs. L'API `/cluster/status_json` indiquait
`available`, `need_more_nodes=false`, `allocation_strategy=dp` et `routing_strategy=dp`.
La table de routage observee pour chaque requete etait bien Mac puis Windows.

Resultats OpenAI compatibles :

- `GET /v1/models` expose `Qwen/Qwen3-1.7B` ;
- requete non streamee `What is 2 + 3?` : HTTP 200, reponse exacte `5`, 26 tokens de
  prompt et 2 tokens de completion ;
- cinq repetitions supplementaires : cinq reponses exactes `5` ;
- requete streamee `What is 3 + 4?` : chunks SSE valides, contenu `7`, terminaison
  `data: [DONE]` ;
- les reservations scheduler ont ete liberees apres chaque fin et les workers sont revenus
  a une charge nulle ;
- aucune exception d'inference n'est apparue. Les messages Triton Windows sont les warnings
  attendus du bundle lorsque le backend explicitement choisi est `torch_native`.

Validation automatisee du correctif d'ordre :

```text
tests/scheduler_tests/test_layer_allocation.py
tests/scheduler_tests/test_scheduler.py
tests/test_rpc_connection_handler.py
tests/test_backend_scheduler_config.py
tests/test_p2p_node_info.py

50 passed
compileall et git diff --check : OK
```

Ruff ne signale que cinq `E741` preexistants dans `layer_allocation.py`, hors des lignes
modifiees.

### Etat exact du laboratoire pendant cette reprise

Au moment de cette mise a jour, le scheduler et les deux workers sont volontairement encore
actifs pour poursuivre la campagne cache/pression. Le scheduler charge le checkout local
`14a8793`; les deux workers distants ont charge le code `d59f9f7`, suffisant pour leur
contrat runtime/capacite. Avant une nouvelle campagne ou publication, arreter proprement les
processus puis positionner les checkouts distants sur `14a8793` afin que les sources soient
strictement identiques. Ne pas presenter cette topologie comme un test Internet : elle
utilise encore les adresses Tailscale du laboratoire et les deux workers disposent aussi
d'un chemin LAN direct.

### Suite obligatoire, dans cet ordre

1. **Cache distribue et pression.** Relancer la meme pipeline avec le prefix cache actif,
   verifier les hits communs MLX/vLLM, les longs prompts, les evictions divergentes et le
   replay sur les deux shards. La desactivation du cache ci-dessus n'est qu'un baseline.
2. **Elasticite DP.** Ajouter un worker compatible, verifier qu'il est alloue en redondance
   plutot que laisse en attente, puis mesurer repartition, fairness et capacite sous requetes
   concurrentes.
3. **Admission et routage adaptes au contexte OpenCode.** Ne pas router seulement sur le
   texte utilisateur. Compter le prompt final rendu par le tokenizer, y compris systeme,
   historique, outils et resultats, ajouter la sortie maximale demandee et une marge de
   securite. Un chemin n'est admissible que si chaque shard respecte sa longueur maximale
   et sa capacite KV encore disponible. Pour les petits prompts, preferer le pipeline
   admissible le plus leger ; pour les gros contextes, choisir un chemin qui tient la
   reservation entiere ou retourner une erreur explicite. Avant implementation, comparer
   les mecanismes officiels Parallax, vLLM, SGLang et MLX et reutiliser leurs metriques de
   tokenizer/KV plutot que creer une estimation parallele.
4. **Pannes et lifecycle.** Tester annulation stream, coupure reseau, kill dur d'un shard,
   heartbeat expire, rejoin et redemarrage scheduler sans ghost ni reservation bloquee.
5. **Parcours Fabi complet.** Choix du modele dans l'IDE/OpenCode, installation du runtime,
   lancement automatique sans couches manuelles, generation code streamee et arret propre.
6. **Internet sans Tailscale.** Deployer seulement ensuite un scheduler de staging, tester
   deux reseaux/NAT distincts avec hole punching/relay Lattica et observer le chemin reel.
7. **Release reproductible.** Construire les artefacts macOS/Windows/Linux, checksums,
   provenance, pins registry/CLI, rollback et matrice de qualification avant production.

Aucun secret ne doit entrer dans Git. Les identifiants communiques en conversation doivent
etre regeneres avant toute mise en production.

## Qualification du contrat heterogene et reprise produit du 18 juillet 2026

Cette section est la nouvelle source de verite. Le coeur Mac MLX + Windows vLLM est
maintenant qualifie avec prefix cache actif, contexte long et parametres worker par defaut.
Le chemin Internet sans Tailscale et la reprise en cours de generation restent
volontairement non declares comme termines. L'admission statique selon le budget de contexte
est maintenant implementee et testee. La reservation dynamique des blocs KV mesuree par les
executors est implementee dans `2ce70ee` et doit maintenant etre qualifiee sur le laboratoire
Mac + Windows avant d'etre epinglee dans le CLI.

### Etat Git autoritatif

- IDE `Noagiannone03/fabi-IDE`, branche `main` avant la presente mise a jour : `03435be` ;
- CLI `Noagiannone03/fabi-cli`, branche `dev` : `f22003e` ;
- moteur `Noagiannone03/swarm-engine`, branche `codex/dynamic-dp-product` : `2ce70ee` ;
- registre/release `Noagiannone03/fabi`, branche `main` : `4450982`, tag
  `v2.7.0-rc20` ;
- base de reconstruction : `be90732` ;
- Parallax officiel compare au commit `162354a`.

Nouveaux commits moteur, pousses sur `origin` :

- `d77834b` — `fix(runtime): negotiate heterogeneous prefill contract`.
- `331118b` — `feat(scheduler): admit requests by context capacity`.
- `76c7dd6` — `fix(scheduler): cap routes by model context`.
- `2ce70ee` — `feat(scheduler): reserve measured KV capacity`.

Validation locale du commit :

```text
tests scheduler + P2P/RPC + protocole moteur + prefix cache : 105 passed
Ruff cible, Ruff format, compileall et git diff --check : OK
apres admission statique, plafond modele et reservation KV mesuree : 298 passed, 6 skipped
(tests materiels indisponibles dans l'environnement local), aucune regression logicielle
```

Une execution Ruff volontairement trop large a retrouve 96 erreurs historiques dans des
fichiers non modifies. Elles ne sont pas introduites par `d77834b` et ne doivent pas etre
melangees a ce correctif.

Attention : `v2.7.0-rc19` et `v2.7.0-rc20` restent volontairement epingles sur `d77834b` et ne
contiennent donc pas encore `331118b`, `76c7dd6` ni `2ce70ee`. Qualifier l'admission sur le laboratoire
distribue avant de deplacer le pin CLI/runtime et de produire une nouvelle release candidate.

### Verrouillage CLI et artefact `rc20`

La premiere etape de reprise est terminee cote source et build local :

- `f22003e` — `fix: pin heterogeneous swarm runtime`, pousse sur `fabi-cli/dev` ;
- `84ad75d` — `build: ship heterogeneous swarm contract`, pousse sur `fabi/main` ;
- tag annote `v2.7.0-rc19` pousse sur `84ad75d` ;
- `4450982` — `ci: migrate Intel macOS release runner`, pousse sur `fabi/main` ;
- tag annote `v2.7.0-rc20` pousse sur `4450982` ;
- `runtime-lock.env` pointe sur les SHA complets `f22003efed050db076e6d06775ca34194a429498`
  et `d77834bb27c276ee117b5c0753b4ad30ead01d43`.

Le contrat Git pur (`runtime-source.ts`) est separe de l'installateur interactif. Le CLI
initialise un depot vide, fetch le SHA qualifie, checkout `FETCH_HEAD` en detached et refuse
de lancer un runtime gere dont `HEAD` differe. Trois tests unitaires valident le pin, le
checkout par SHA et la conservation d'un override de branche explicite. Le fetch reel depuis
GitHub a aussi ete execute et a produit exactement `d77834bb...`.

L'installateur PowerShell/WSL ne force plus par defaut la branche mutable `fabi-patches` :
en l'absence d'override utilisateur, il laisse maintenant le CLI appliquer son SHA qualifie.
Cela ferme une divergence ou une installation WSL pouvait contourner silencieusement le pin
produit.

Qualification locale hors iCloud du chemin release, avec Bun `1.3.13` :

```text
tests runtime-source : 3 passed
typecheck packages/opencode : OK
Prettier cible + git diff --check + bash -n : OK
build fabi-darwin-arm64 --single : smoke test --version OK
tarball FABI_SKIP_PARALLAX=1 : 21 MiB, SHA-256 verifie
MANIFEST : opencode=f22003ef..., parallax=d77834bb...
```

Le build local a utilise `FABI_SKIP_PARALLAX=1` et qualifie donc le binaire, le pin de
fallback et le manifeste, pas encore le venv MLX embarque complet. Le run `rc19`
`29652454187` a produit cinq jobs verts, mais son job Intel est reste indefiniment en attente :
le label `macos-13` a ete retire par GitHub fin 2025. Le workflow utilise maintenant le label
officiel `macos-15-intel`. Le tag `v2.7.0-rc20` a declenche le run `29654158979` et les six
jobs, y compris Intel, ont demarre. Verifier leurs conclusions et les assets/checksums avant
de declarer `rc20` installable sur toutes les plateformes.

### Cause racine du bug long prompt

Avec la valeur Parallax par defaut `chunked_prefill_size=1024`, le shard MLX envoyait les
activations des 1 024 premiers tokens. L'adaptateur vLLM Parallax formait cependant toujours
un batch du prompt complet, par exemple 2 429 tokens, car son scheduler interne est construit
avec `enable_chunked_prefill=False`. Le downstream reclamait donc plus d'activations que le
head n'en avait envoyees. L'ancienne propagation d'erreur ne remontait pas proprement cette
exception au frontend, ce qui pouvait produire ensuite une reponse HTTP 200 corrompue.

Ce n'est pas un bug a masquer dans le cache. La recherche upstream confirme le contrat :

- Parallax PR `#469` ajoute le chunked prefill MLX et le valide MLX vers MLX ;
- Parallax PR `#470` ajoute le chemin SGLang ;
- l'aide CLI officielle decrit l'option pour MLX/SGLang ;
- l'adaptateur vLLM Parallax courant n'implemente pas la progression de chunks ;
- vLLM gere officiellement le chunking dans son propre scheduler, avec le nombre de tokens
  deja calcules et `max_num_batched_tokens`. Injecter des chunks d'activations externes sans
  ce contrat n'est pas equivalent.

La solution retenue est donc une negociation de capacite de bout en bout, pas un nouveau
cas special dans le calcul :

1. chaque worker annonce le backend reel, le support du chunked prefill, sa preference et
   la valeur effectivement chargee ;
2. le scheduler calcule un contrat commun pour tous les workers alloues ;
3. un vLLM Parallax abaisse automatiquement ce contrat a zero ;
4. toute pipeline reste non routable tant que chaque shard n'a pas recharge exactement ce
   contrat ;
5. un join/leave dynamique peut renegocier le contrat et declencher un rechargement propre ;
6. un worker ancien qui n'annonce pas ces champs echoue en mode ferme au lieu d'etre suppose
   compatible ;
7. `/cluster/status_json` expose `chunked_prefill_size` et `prefill_contract_ready`.

Le protocole P2P transporte aussi maintenant une terminaison `ERROR` distincte d'un abort
client. Une exception downstream libere les ressources, parcourt la pipeline et devient une
erreur frontend au lieu d'une completion reussie mais invalide.

### Qualification reelle sans parametres manuels

Les deux machines distantes ont charge exactement `d77834b`. Aucun worker n'a recu :

- `--start-layer` ;
- `--end-layer` ;
- `--chunked-prefill-size 0` ;
- `--disable-prefix-cache`.

Le PC Windows a volontairement rejoint avant le Mac. Les annonces initiales ont ete :

```text
Windows RTX 4080 SUPER  backend vLLM  support chunk=false  preference=1024  actif=0
Mac mini M4             backend MLX   support chunk=true   preference=1024  actif=1024
```

Le scheduler a automatiquement negocie zero, puis construit :

```text
Mac mini  [0, 2)    frontend=true
Windows   [2, 28)   frontend=false
standby   0
```

Apres chargement, `/cluster/status_json` a retourne `available`, allocation `dp`, routage
`dp`, `chunked_prefill_size=0`, `prefill_contract_ready=true`, avec les deux workers
`available`. La route des requetes etait Mac puis Windows.

Les appels ont tous utilise le vrai point d'entree produit du scheduler,
`POST :3001/v1/chat/completions`. Appeler directement le frontend d'un worker en mode
scheduler est invalide, car cette voie contourne l'injection de la table DP ; le worker
refuse correctement une requete sans route.

Resultats observes :

- court non streame, sentinelle `FABISHORT-31415` : exact, HTTP 200, 1,207 s ;
- repetition courte : exacte, HTTP 200, 1,038 s, hit commun de 16 tokens ;
- long contexte de code inerte : 14 991 tokens de prompt, sentinelle exacte
  `FABIAUTH-92731`, HTTP 200, 9,569 s ;
- deux repetitions longues : sentinelle exacte, HTTP 200, 0,992 s puis 0,992 s ;
- les deux shards ont reutilise exactement 14 976 tokens sur 14 991, soit 936 blocs de 16 ;
- streaming : chunks SSE recomposes en `FABISTREAM-27182`, terminaison `[DONE]`, HTTP 200,
  0,774 s ;
- aucun `Distributed prefix cache mismatch`, aucune exception d'inference et aucune fausse
  completion reussie dans les logs de cette campagne.

Un prompt artificiel compose de 15 000 repetitions du meme token a produit une sortie de
mauvaise qualite mais un transport correct. Le meme budget sous forme de contexte de code
varie a produit la sentinelle exacte trois fois. Cela distingue une faiblesse semantique du
petit Qwen sur une entree pathologique d'un defaut de pipeline.

### Reprise apres perte d'un worker : decision de conception, pas encore implementation

Parallax ne fournit pas actuellement la reprise en cours de generation demandee. Son issue
officielle `#411`, « Save streaming response and continue generation if worker node fails »,
est encore une feature ouverte. Le heartbeat et le rebootstrap actuels reconstruisent la
capacite du cluster, mais ne restaurent pas l'etat KV d'une requete en vol.

Petals fournit la reference de conception la plus directement applicable. Son algorithme
fault-tolerant conserve deux caches : KV sur les serveurs et entrees de chaque etage chez le
client. Si un serveur disparait, le client choisit une ou plusieurs repliques couvrant les
memes couches et rejoue les entrees d'etage conservees pour reconstruire leur KV. Les
activations peuvent circuler directement entre serveurs tout en etant copiees au client,
avec verification asynchrone par checksum.

Pour Fabi, cette idee implique une evolution architecturale explicite :

1. garantir au moins une couverture de secours pour chaque intervalle avant de declarer une
   pipeline « recoverable » ;
2. journaliser, sous une limite memoire stricte, les activations aux frontieres d'etages ou
   une representation permettant de les recalculer ;
3. associer chaque requete a une version de modele, une route, une generation/epoch et des
   checksums afin d'interdire les sorties tardives de l'ancien shard ;
4. lors d'une panne, geler l'emission SSE, choisir une couverture compatible
   modele/revision/dtype/blocs/contrat prefill, reconstruire son KV, puis reprendre sans
   dupliquer les tokens deja livres ;
5. si aucune couverture n'existe, retourner une erreur explicite et liberer toutes les
   reservations ; ne jamais inventer une continuation a partir d'un KV incomplet ;
6. mesurer le cout reel : conserver toutes les activations de frontiere d'un contexte 64k
   peut etre trop cher. Comparer replay depuis tokens, checkpoints periodiques compresses et
   double envoi vers une replique chaude avant de choisir.

Le chiffrage et la machine d'etats retenue sont maintenant detailles dans
`docs/SWARM-FAILOVER-DESIGN.md`. La premiere implementation doit etre un journal de tokens
avec epochs et replay froid exact ; le journal BF16 distribue puis la replique chaude sont
des accelerations ulterieures. Pour Qwen3-1.7B, une frontiere coute 128 MiB a 32k, 160 MiB a
40 960 et 256 MiB a 64k. Une replique chaude de `[2,28)` double respectivement environ
3,25 GiB, 4,06 GiB ou 6,50 GiB de KV. Deux workers sans couverture dupliquee ne peuvent pas
etre declares recuperables.

Les projets Exo et GPUStack sont utiles pour la decouverte, le placement topologique et la
gestion d'instances, mais ils ne constituent pas une preuve de reprise KV equivalente dans
la topologie heterogene actuelle. Ne pas copier leur orchestration en la presentant comme
une continuation exacte de requete.

### Admission et routage selon le contexte

Le commit `331118b` implemente la premiere etape de ce contrat. Le scheduler applique le chat
template du tokenizer Transformers canonique du modele, avec systeme, historique, schemas
d'outils, resultats d'outils et contexte de code, puis ajoute `max_completion_tokens` ou
`max_tokens` (128 par defaut, identique au runtime). Le tokenizer est charge paresseusement,
mis en cache par modele et respecte le mode Hugging Face local uniquement.

Chaque requete transporte maintenant son budget jusqu'au routeur. DP, RR et le routeur
randomise excluent tout shard dont `max_sequence_length` est inferieur au budget. La longueur
statique d'une pipeline est le minimum de ses shards ; le scheduler expose le maximum des
pipelines completes dans `/cluster/status_json`. Le calcul ignore volontairement la charge
instantanee pour distinguer une requete impossible d'une pipeline compatible mais occupee.

Le commit `76c7dd6` ferme un second depassement : la capacite annoncee par les workers est
maintenant plafonnee par la limite commune des configurations du modele canonique et de sa
variante MLX. `Qwen/Qwen3-1.7B` annonce 40 960 dans `max_position_embeddings` et sa fiche
officielle 32 768 tokens natifs. Le laboratoire a prouve 15k, pas 64k. Une cible 64k exige
un modele qui la declare ou une configuration YaRN/RoPE identique et qualifiee sur MLX et
vLLM ; passer seulement `--max-sequence-length 65536` ne constitue plus une promesse acceptee.

Le test avec le vrai tokenizer local `Qwen/Qwen3-1.7B` et une conversation de type OpenCode
(systeme, historique, appel et resultat d'outil, gros bloc de code) a compte 12 220 tokens de
prompt et reserve 4 096 tokens de sortie, soit une route exigee de 16 316 tokens. Un premier
essai a aussi revele que le chargeur MLX existant attend un chemin local de modele sur Mac ;
le scheduler utilise donc directement `transformers.AutoTokenizer`, contrat commun Mac et
Windows, plutot que d'introduire un cas special MLX.

Contrat cible :

```text
budget_statique = prompt_rendu + max_output
admission_dynamique = reservation de budget_statique sur chaque shard
```

Le commit `2ce70ee` implemente la seconde partie sans formule VRAM theorique. Apres chargement
du modele, chaque executor publie la geometrie de son allocateur reel : `num_gpu_blocks *
block_size` pour MLX, la taille en tokens du pool SGLang, et le nombre de pages du block pool
vLLM multiplie par leur taille. Le nombre maximal de requetes publie est celui du scheduler
runtime initialise. Un worker qui ne publie pas cette telemetrie a une capacite de contexte
nulle et ne recoit aucun prompt ; il reste visible pendant son initialisation, mais une
estimation materielle ne devient jamais une decision d'admission.

Le scheduler arrondit `prompt + max_output` a la granularite physique de chaque shard et
reserve ce nombre de tokens sur chaque noeud de la route. Selection et reservation sont une
transaction protegee : deux dispatchs concurrents ne peuvent pas consommer les memes
derniers blocs. En cas de heartbeat ou depart entre le snapshot et la mutation, le scheduler
annule les reservations partielles et recalcule une fois la route sans tuer sa boucle. La
fin normale, l'erreur et la deconnexion liberent le meme budget exactement une fois. Une
reallocation de couches invalide immediatement l'ancienne geometrie KV jusqu'a la mesure du
nouvel executor.

La capacite d'une pipeline reste le minimum de ses shards, pas la valeur du worker le plus
large. Le statut cluster expose maintenant, par worker, la presence de telemetrie, la
capacite et la taille de bloc mesurees, les tokens reserves et les tokens restants.

- budget superieur a toute longueur statique disponible : HTTP 400 `invalid_request_error`
  avec tokens requis et maximum disponible ;
- longueur compatible mais pipelines momentanement occupees : attente bornee puis HTTP 429 ;
- longueur compatible mais KV momentanement insuffisant : attente bornee puis HTTP 429 ;
- executor encore en chargement ou sans telemetrie KV : HTTP 503 `context_route_not_ready` ;
- aucune troncature silencieuse, aucun lancement en esperant eviter l'OOM ;
- petit prompt : pipeline admissible la plus legere/rapide ;
- gros prompt : pipeline qui reserve le budget complet, avec affinite de prefixe si plusieurs
  chemins sont possibles.

Ce comportement suit les contrats utiles de vLLM : `max_model_len` couvre prompt plus sortie,
les entrees trop longues sont rejetees explicitement et les tokens batches/KV sont des
ressources distinctes. L'issue Parallax `#342` sur la preallocation KV est encore ouverte ;
il faut donc construire l'admission Fabi au-dessus de metriques reelles et testees, pas
supposer cette garantie deja presente.

References primaires relues pour cette decision :

- [Parallax PR 469 — MLX chunked prefill](https://github.com/GradientHQ/parallax/pull/469) ;
- [Parallax PR 470 — SGLang chunked prefill](https://github.com/GradientHQ/parallax/pull/470) ;
- [Parallax issue 411 — continuation apres panne worker](https://github.com/GradientHQ/parallax/issues/411) ;
- [Parallax issue 342 — preallocation KV](https://github.com/GradientHQ/parallax/issues/342) ;
- [Petals — inference fault-tolerant sur Internet](https://arxiv.org/abs/2312.08361) ;
- [vLLM — contrat `max_model_len`](https://docs.vllm.ai/en/stable/api/vllm/config/model/) ;
- [vLLM — scheduler et budgets de tokens](https://docs.vllm.ai/en/v0.11.0/api/vllm/config/scheduler.html) ;
- [vLLM — gestionnaire du block pool KV](https://docs.vllm.ai/en/stable/api/vllm/v1/core/kv_cache_manager/) ;
- [Exo](https://github.com/exo-explore/exo) et
  [GPUStack](https://github.com/gpustack/gpustack) pour comparaison d'orchestration.

### Matrice de tests de contexte et de reprise

1. **fait** — limites exactes 4k/32k/64k acceptees et `limite + 1` refusee ;
2. **fait** — prompt OpenCode reel avec systeme, outils et historique tokenise par Qwen ;
3. **fait** — DP choisit le chemin rapide 4k pour un petit prompt, le chemin 32k compatible
   pour un gros prompt et retourne HTTP 400 avant reservation si aucun chemin ne suffit ;
4. **fait** — un worker 64k associe a un modele 32k est plafonne par le contrat modele ;
5. **fait en tests locaux, E2E distribue a faire** — KV temporairement sature, reservation
   arrondie aux blocs, liberation, dispatch concurrent atomique et worker sans telemetrie ;
6. depart du head, d'un shard median et du dernier shard pendant prefill puis decode ;
7. replique froide, replique chaude et absence de replique ;
8. checksum divergent ou modele/revision differents : reprise refusee ;
9. streaming : aucun token duplique ou perdu autour du failover ;
10. kill dur, perte reseau, heartbeat expire et retour tardif de l'ancien worker ;
11. pression prefix cache heterogene avec evictions differentes apres reprise.

### Ordre de reprise obligatoire

1. **source et build local termines ; CI `rc20` en cours sur les six cibles** — pin
   CLI/runtime, manifeste et artefact reproductible de `d77834b` ;
2. **termine dans `331118b`, `76c7dd6` et `2ce70ee`** — admission statique du contexte,
   erreurs OpenAI explicites, telemetrie KV mesuree et reservation atomique par blocs ;
3. **termine dans `docs/SWARM-FAILOVER-DESIGN.md`** — journal de reprise inspire de Petals,
   epochs/fencing et couts memoire/reseau chiffres sur 32k/40k/64k ;
4. reconstruire le CLI avec `2ce70ee`, puis qualifier sur Mac + Windows la telemetrie et la
   saturation KV avec plusieurs petits/gros prompts ;
5. chronometrer le scenario OpenCode 12 220 tokens d'entree + 4 096 tokens reserves ;
6. ajouter une troisieme machine/replique et qualifier le DP elastique ;
7. implementer la reprise par etapes avec tests de panne reproductibles ;
8. valider le parcours IDE/OpenCode complet, y compris gros prompts outils et streaming ;
9. tester seulement ensuite deux NAT distincts sans Tailscale via hole punching/relay ;
10. publier les artefacts signes/checksum, pins, rollback et matrice de release.

### Etat du laboratoire a la cloture

- scheduler local arrete proprement ;
- worker Mac arrete avec `SIGINT` et `node_leave` observe ;
- worker Windows et son arbre runtime arretes ;
- aucun processus de laboratoire ne doit rester actif ;
- aucun deploiement produit effectue sur le VPS ;
- les adresses Tailscale ont servi uniquement au laboratoire ; le chemin Internet public
  n'est pas qualifie ;
- aucun secret ajoute a Git. Les identifiants exposes en conversation doivent etre revoques
  avant production.

## Qualification des routes directes et annulation HTTP du 19 juillet 2026

Cette section devient la source de verite la plus recente. Le laboratoire Mac mini M4 +
Windows RTX 4080 SUPER tourne desormais sur le meme commit moteur, avec une route DP
cyclique explicitement qualifiee comme directe dans les deux sens. Le chemin reste un test
Tailscale : il ne qualifie pas encore Internet entre deux NAT sans tailnet.

### Etat Git et validation locale

Moteur `Noagiannone03/swarm-engine`, branche `codex/dynamic-dp-product` :

- `49adefb` — `fix(backend): cancel disconnected blocking requests` ;
- `d84eff7` — `fix(routing): require direct cyclic worker paths` ;
- SHA complet deploye : `d84eff70142eff1281508a4a96eb42161ef79ab0`.

Le premier commit observe la socket HTTP Starlette pendant une requete non streamee,
annule le RPC Lattica aval quand le client part et libere la reservation dans le meme chemin
`finally`. Le second commit ne remplace pas Lattica : il utilise une methode RPC de sante
enregistree sur le handler Parallax existant. Le client Lattica officiel refuse deja une
connexion uniquement relayee ; le worker publie donc seulement les pairs atteignables par
un RPC direct.

Le scheduler renvoie a chaque worker tous les candidats pouvant suivre sa plage allouee.
Le routeur DP conserve l'identite du head, verifie chaque transition puis le retour du tail
vers le head, et choisit un autre cycle complet si la redondance le permet. Une liste
`direct_peer_ids=[]` publiee par un worker courant ferme la route ; `None` conserve seulement
la compatibilite de protocole avec un worker ancien. Une reallocation invalide la telemetrie
directe precedente jusqu'au prochain probe. Le meme controle cyclique est applique aux
pipelines RR/randomises via l'estimation de latence commune.

Validation locale :

```text
tests scheduler + backend/RPC/P2P concernes : 115 passed, 1 warning
suite non materielle disponible : 220 passed, 15 skipped, 1 warning
Ruff cible (E741 historiques ignores), Ruff format et git diff --check : OK
```

La collecte vraiment complete reste impossible dans le venv du MacBook : quatorze fichiers
materiels importent `mlx` ou `mlx_lm`, absents de cet environnement. Les executors MLX reels
ont ete valides sur le Mac mini ; ne pas transformer cette limite de collecte en faux succes.

### Cause du defaut relay-only et solution de laboratoire

La version Lattica officielle disponible reste `1.0.21`. Son garde-fou RPC exige une
connexion directe. Lorsqu'un pair est deja present seulement par `p2p-circuit`, la logique
de reconnexion ne compose pas automatiquement les `listen_addresses` identifies et le
forward echoue avec `Only relayed connection available for peer`.

Le correctif retenu ne supprime pas ce garde-fou et ne transporte pas les activations via
un relay public. Les launchers de laboratoire donnent aux primitives officielles
`--initial-peers` les multiadresses TCP/QUIC Tailscale du scheduler et de l'autre worker.
Windows a alors etabli vers le Mac :

```text
via /ip4/100.82.190.118/udp/19080/quic-v1/... is_direct: true
```

Le Mac compose reciproquement le PC. Ces adresses sont propres au laboratoire ; le produit
final devra obtenir les adresses candidates par discovery/identify et qualifier le hole
punching public, sans pinner des IP Tailscale.

### Deploiement et preuves E2E

Les trois composants chargent exactement `d84eff70142eff1281508a4a96eb42161ef79ab0` :

- scheduler Qwen3-1.7B dans le conteneur VPS `parallax-scheduler` ; son label image et le
  `git rev-parse` interne ont ete verifies ; les autres schedulers du VPS n'ont pas ete
  modifies ;
- Mac mini, checkout detached sous le runtime Fabi ;
- PC Windows, checkout detached sous le runtime vLLM natif et tache planifiee
  `FabiWorkerE2E`.

Windows a volontairement rejoint avant le seul worker capable d'heberger le frontend. Le
DP a automatiquement reconstruit Mac `[0,2)` puis Windows `[2,28)`, sans arguments de
couches. `/cluster/status_json` a ensuite expose pour chacun :

```text
direct_link_telemetry_ready=true
Mac direct_peer_ids=[Windows]
Windows direct_peer_ids=[Mac]
status=available, reserved_context_tokens=0
```

Resultats :

- baseline reseau sur l'ancien SHA apres composition directe : sentinelle
  `FABIDIRECT-7319`, HTTP 200 en 0,750 s ;
- apres deploiement `d84eff7` : sentinelle `FABID84-8467`, HTTP 200 en 5,725 s a froid ;
- qualification OpenCode : 12 220 tokens calibres en entree, 4 096 tokens de sortie
  reserves, sentinelle `FABIOPENCODE-62219` correcte apres normalisation ; 8,285 s a froid
  puis 0,890 s avec prefix cache ; l'usage runtime a compte 12 225 tokens de prompt ;
- annulation non streamee : requete OpenCode a prefixe inedit, client coupe apres 1,001 s
  (`curl` 28), log scheduler `Client disconnected before request ... completed`, puis trois
  secondes plus tard zero token reserve sur les deux shards et cluster encore disponible.

Un premier essai de sentinelle limite a 32 tokens avait termine proprement avec
`finish_reason=length` pendant le raisonnement Qwen. Ce n'etait pas une panne de pipeline ;
le test deterministe utilise desormais `/no_think` ou `chat_template_kwargs.enable_thinking=false`
et compare le contenu apres normalisation des espaces.

### Etat live et prochaine reprise

Au moment de cette mise a jour, le scheduler de laboratoire et les deux workers sont actifs
sur `d84eff7`. Les launchers distants ont des sauvegardes `pre-direct-20260719`; aucun secret
n'a ete ajoute aux scripts ou a Git.

Point lifecycle observe : `SIGINT` n'a pas arrete le groupe Mac dans la fenetre de 30 s,
alors que `SIGTERM` a arrete le groupe entier sans processus restant. Reproduire avec logs
avant de modifier le code ; ne pas ajouter un autre kill ad hoc.

Ordre de reprise :

1. tuer un shard pendant un prefill puis un decode, verifier erreur explicite, fencing,
   liberation et reconstruction de la capacite ; aucune continuation exacte ne doit etre
   pretendue sans replique et replay KV ;
2. ajouter une troisieme machine/replique couvrant les memes couches et qualifier le DP
   elastique, fairness puis le replay froid decrit dans `SWARM-FAILOVER-DESIGN.md` ;
3. valider le parcours IDE/OpenCode complet sur ce SHA et mettre a jour les pins runtime ;
4. seulement ensuite tester deux NAT distincts sans Tailscale, avec direct/hole-punch/relay
   observables, puis construire les artefacts signes et checksums de release.
