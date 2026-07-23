# Handoff Fabi Swarm — 17 juillet 2026

> **Mise a jour autoritative :** lire d'abord la section
> `Integration IDE, contribution ephemere et heartbeats du 19 juillet 2026` en fin de document. Elle
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

## Integration IDE, contribution ephemere et heartbeats du 19 juillet 2026

Cette section est la source de verite la plus recente. Elle remplace les SHA, l'etat live et
l'ordre de reprise des sections precedentes en cas de contradiction. Aucun secret, token de
compte, mot de passe, IP d'administration ni identifiant de pair live n'est consigne ici.

### Revisions poussees et runtime qualifie

- `Noagiannone03/swarm-engine`, branche `codex/dynamic-dp-product` :
  - `aa856fe5415aaa833ffdf1d1c86d2f73e90139d9` —
    `feat(fabi): admit only live contributing accounts` ;
  - `59dc2bb82c956848a320a54079d30747da3bcdc3` —
    `fix(p2p): isolate heartbeats from network probes` ;
- `Noagiannone03/fabi-cli`, branche `dev` :
  - `211457406c242bfedc92896e77c79f6a2fcc5033` —
    `feat(swarm): bind consumption to live workers` ;
  - `0dd48bc1a6cb4a6145d7fe444ffd316a30b0f1f6` —
    `chore(swarm): qualify heartbeat-safe runtime` ;
- `Noagiannone03/fabi`, branche `main` :
  - `0b8a164b9c7f29000a6d0a84f83ba2f088570e2b` —
    `chore(release): pin heartbeat-safe swarm runtime` ;
  - tag publie : `v2.7.0-rc24` ;
- `Noagiannone03/fabi-IDE`, branche `main` :
  - `e7034ba6ad239e745fa15b3f594cb0f01a82536c` —
    `feat(swarm): gate IDE inference on live contribution`.

Les trois pins du runtime IDE sont maintenant exacts : release `v2.7.0-rc24`, OpenCode/Fabi
CLI `0dd48bc1...`, moteur `59dc2bb...`. Un manifeste qui annonce une autre combinaison est
refuse. Un binaire OpenCode arbitraire trouve sur la machine n'est plus accepte comme runtime
produit ; l'override explicite reste reserve au developpement.

Au moment de cette ecriture, la CI `rc23` est entierement verte. Pour `rc24`, Linux x64 CPU,
Linux x64 CUDA, Linux ARM64, macOS Apple Silicon MLX et macOS Intel sont verts ; le job
Windows x64 CUDA est encore en cours. Run :
https://github.com/Noagiannone03/fabi/actions/runs/29693764501.

### Contrat « contribuer pour consommer » retenu

Il n'existe volontairement ni monnaie, ni solde persistant, ni points a depenser. Le droit
de consommer est ephemere et decide par le scheduler au moment de l'admission :

1. la credential bearer du client doit correspondre a celle d'au moins un worker du compte ;
2. ce worker doit avoir un heartbeat frais, etre `READY`, posseder une allocation de couches
   active et publier sa telemetrie KV mesuree ;
3. la pipeline complete qui contient ce worker doit etre servable ;
4. par defaut, chaque worker eligible ouvre une seule requete concurrente au compte ;
5. le droit est reserve atomiquement au debut puis libere exactement une fois en fin, erreur
   ou deconnexion ; une requete deja admise n'est jamais coupee par une revalidation UI.

Les credentials brutes ne sont ni loguees ni stockees par le scheduler : l'identite interne
est un hash. Les endpoints `/v1/contribution/status` et les routes OpenAI utilisent le meme
Bearer. Reponses produit : HTTP 403 sans contribution reconnue, HTTP 503 si le swarm complet
n'est pas servable, HTTP 429 si la capacite de contribution du compte est deja occupee.

Cette decision reprend les proprietes utiles des reseaux existants sans importer leur
economie : reciprocite et slots bornes de BitTorrent, contribution live de Petals, et
separation identite/capacite observee dans AI Horde et HyperSpace. References primaires :

- [BitTorrent BEP 3](https://www.bittorrent.org/beps/bep_0003.html) ;
- [Petals](https://github.com/bigscience-workshop/petals) ;
- [AI Horde](https://github.com/Haidra-Org/AI-Horde) ;
- [HyperSpace node](https://github.com/hyperspaceai/hyperspace-node).

Limite assumee : la credential est actuellement partagee localement entre CLI et IDE par
le fichier de compte ou `FABI_ACCOUNT_TOKEN`. La connexion d'un meme compte sur plusieurs
machines necessite encore un vrai login/device pairing. Ne jamais bricoler cette etape par
copie visible du token dans l'UI.

### Heartbeat pendant l'inference

Le worker Parallax execute le calcul GPU dans des processus executor distincts du serveur
P2P. Le thread announcer continue donc d'envoyer `node_update` toutes les dix secondes pendant
le prefill et le decode. Une generation reelle de 1 024 tokens a dure 29,587 s, soit plus que
le timeout scheduler de 25 s, sans eviction : les deux workers sont restes `available` et la
generation s'est terminee normalement.

Une faiblesse restait toutefois possible : `get_node_info()` effectuait des probes directs
et RTT synchrones avant le heartbeat. Un pair redondant lent pouvait donc retarder la preuve
de vie sans rapport avec le calcul. `59dc2bb` deplace toute sonde reseau dans le daemon
`DirectPeerProber` ; le heartbeat ne lit plus qu'un snapshot cache et fail-closed. Le premier
join conserve ses retries de discovery, mais les updates de vie ne bloquent plus. L'arret
utilise `stop_event.wait`, rejoint aussi ce daemon et ne laisse pas une boucle en sommeil.

Le meme commit corrige l'ordre du gate : pendant une generation active, le statut du compte
reste `capacity_reached`, meme si la route est momentanement occupee. L'IDE peut ainsi afficher
« Contribution deja utilisee » au lieu du faux diagnostic « swarm indisponible ».

Validation moteur ciblee : 146 tests passes, 1 warning de deprecation Starlette ; Ruff format,
Ruff check et `git diff --check` passent.

### Reprise propre de Fabi IDE et OpenCode

Le chemin chat n'est plus un assemblage de polling et de statuts optimistes :

- `waitUntilReady()` est reveille par les memes evenements worker/registry qui pilotent l'UI ;
- le prompt reste masque/verrouille tant que transport, pipeline et contribution ne sont pas
  tous autorises par le scheduler ;
- l'admission est revalidee toutes les cinq secondes, avec epoch/fencing pour ignorer une
  reponse tardive apres changement de modele ou de worker ;
- les etats `contribution-pending`, `contribution-required` et `capacity_reached` sont distincts
  dans le protocole et dans l'interface ;
- la credential locale doit etre exactement 32 octets hexadecimaux, est creee exclusivement
  avec permissions 0600/0700 quand la plateforme le permet, et n'est jamais regeneree en
  silence si un fichier existant est invalide ;
- le provider OpenCode annonce la vraie fenetre scheduler qualifiee, 32 768 tokens de contexte
  et 4 096 tokens de sortie par defaut, jamais l'ancienne valeur fictive 262 144 ;
- la cle de redemarrage du sidecar contient seulement le hash de la credential, jamais sa
  valeur ;
- le flux SSE OpenCode 1.15 est parse par `eventsource-parser`, avec limite d'evenement a
  16 Mio, reconnexion bornee et accumulation correcte de `message.part.delta` en snapshots
  cumulatifs attendus par Theia ;
- `session.status=retry` ne termine plus un tour ; seul `idle`, `session.idle` ou une erreur le
  clot. Le timeout de tour est borne et configurable, 10 minutes par defaut ;
- crash, changement de modele, abort et fermeture du sidecar terminent les waiters, nettoient
  les parties SSE et remontent une erreur explicite au chat ;
- l'UI expose des activites exactes : preparation, generation, chargement, allocation,
  contribution en validation ou deja utilisee.

Validation IDE : 15 tests Node passent, notamment manifeste runtime, limites 32k/4k,
non-divulgation de credential, deltas OpenCode 1.15 et verrou de contribution. Toutes les
sources TypeScript/TSX modifiees passent `transpileModule` sans diagnostic syntaxique et
`git diff --check` passe. Le `tsc` cible lance par `yarn test` reste bloque sur ce clone macOS
iCloud contenant des fichiers dataless ; il a ete interrompu apres 50 s. Refaire le vrai build
Theia depuis un clone local complet avant de qualifier l'artefact IDE : ne pas enregistrer ce
blocage d'environnement comme un succes de typecheck.

### Etat du laboratoire apres deploiement

Le scheduler Qwen3-1.7B du laboratoire sur le VPS charge maintenant exactement
`59dc2bb82c956848a320a54079d30747da3bcdc3` ; le SHA Git interne et le label OCI ont ete
verifies. `FABI_GATE=on`, sans allowlist statique. Apres recreation du seul conteneur cible,
le Mac mini M4 et le PC RTX 4080 SUPER ont rejoint automatiquement, le cluster DP est revenu
`available` avec contexte maximum 32 768 et telemetrie KV intacte. Les autres schedulers du
VPS n'ont pas ete modifies. `Dockerfile.pre-59dc2bb` permet le rollback du laboratoire.

Le scheduler est donc au dernier SHA ; les workers distants restent compatibles mais ne sont
pas tous declares au dernier checkout dans ce handoff. Le PC etait au SHA `aa856fe` avant la
recreation. L'acces SSH direct au Mac mini depuis ce MacBook reste refuse ; ne pas pretendre
l'avoir mis a niveau. La release `rc24` est la voie produit pour aligner les deux workers.

### Ce qui reste, dans l'ordre

1. attendre la fin du job Windows `rc24`, verifier assets, checksums et attestations, puis
   installer cette release sur le Mac mini et le PC ; confirmer les SHA runtime sur les deux ;
2. construire Fabi IDE depuis un clone non-dataless et executer un E2E UI reel : selection du
   modele, worker local, allocation automatique, champ prompt debloque, outils OpenCode,
   streaming, abort et revalidation contribution ;
3. rejouer petit prompt puis entree OpenCode 12 220 + sortie reservee 4 096 avec `rc24`, mesurer
   TTFT/debit et verifier les reservations KV pendant toute la requete ;
4. ajouter une troisieme machine qui replique les memes couches. Sans replique compatible, un
   worker perdu doit produire une erreur explicite et liberer les ressources ; il est impossible
   de continuer exactement les tokens deja calcules. Avec replique, implementer journal de
   checkpoints, epoch/fencing, replay KV froid puis chaud, et tests kill prefill/decode ;
5. tester deux NAT distincts sans Tailscale et rendre visibles direct/hole-punch/relay. Ne pas
   accepter une pipeline d'activations relay-only si sa latence/debit ne respecte pas le contrat ;
6. concevoir le login et le device pairing multi-machine, la revocation et la rotation des
   credentials avant toute ouverture publique ;
7. qualifier charge concurrente, fairness, abus, observabilite, rollback et reprise scheduler
   avant de promouvoir une RC en release stable.

## Runtime portable, E2E IDE et pression memoire du 20 juillet 2026

Cette section est la source de verite la plus recente. Elle complete et remplace les SHA,
l'etat release et l'ordre de reprise de la section du 19 juillet en cas de contradiction.
La release candidate `rc28` n'est pas encore taguee : ne pas installer ni annoncer comme
qualifie un artefact local tant que les validations Mac/Windows de cette section ne sont pas
terminees.

### Revisions poussees et etat release

- `swarm-engine`, `codex/dynamic-dp-product` :
  - `7ef8311f70cf28a0ed5f9749af631dd1c503130c` — frontend Rust macOS portable,
    PCRE2 statique et audit de relocalisation ;
  - `918f9f65f01e6b91103835de5a051177a989a5b9` — budget MLX derive de la RAM
    disponible, capacite scheduler bornee et garde de pression a hysteresis ;
- `fabi-cli`, `dev` :
  - `cb81775c63fb1eb5194b90624d2a889b5b37f293` — pin du frontend portable ;
  - `af924cb5d1cf0a772dc87aef62a2e7653ac231eb` — reserve Apple Silicon produit
    et pin du moteur `918f9f6` ;
- `fabi` runtime/registry, `main` :
  - `5138266` — lock `rc28` sur les deux revisions ci-dessus ;
- `fabi-IDE`, `main` : travail local encore non commite. Il contient le manifeste strict et
  relocalisable `rc27`, ainsi que la correction qui lance le sidecar OpenCode avec
  `serve --no-parallax`. Les pins IDE doivent passer a `rc28` seulement apres publication du
  vrai tag et validation des assets.

`rc27` n'est pas qualifiable sur Mac malgre sa CI : le binaire Rust embarque reference un
chemin Homebrew absolu vers PCRE2. Le correctif `7ef8311` lie PCRE2 statiquement et un build
macOS local complet ne depend plus que des frameworks systeme et de `/usr/lib`. Un premier
archive local `rc28` construit avant le correctif memoire ne doit pas etre reutilise ; il faut
reconstruire depuis `5138266`.

### E2E IDE deja prouve avant la correction memoire

Depuis une application Theia packagee et un runtime local complet, les parcours suivants ont
ete observes reellement contre le scheduler de laboratoire :

- gate de contribution verrouille puis champ prompt debloque apres reconnaissance du worker ;
- reponse OpenCode reelle en streaming : premier delta DOM a 1,332 s, fin a 3,167 s et douze
  mises a jour visibles ;
- abort utilisateur autour de 1,5 s ;
- outil `pwd`, demande de permission, autorisation puis resultat ;
- worker reste vivant apres ces operations.

Cause d'un conflit lifecycle corrigee dans l'IDE : le sidecar `fabi serve` demarrait son propre
worker Parallax, puis son nettoyage d'orphelins terminait le worker possede par Theia. Le
sidecar est maintenant HTTP/OpenCode uniquement avec `--no-parallax`. Les 18 tests IDE cibles,
le build de l'extension et le packaging ont passe sur le clone local complet.

### Cause racine des gels du Mac et contrat memoire retenu

Le gel signale n'etait pas subjectif. Le Mac local possede 16 Gio de memoire unifiee. Le log
worker a charge environ 3,017 Gio de poids, puis l'ancien calcul a prealloue environ 7,06 Gio de
KV pour 26 couches et 71 136 tokens. Les unified logs macOS montrent ensuite purge des caches,
pression memoire `critical` et notifications critiques a Zoom, Fusion et WebKit. L'ancienne
variable `PARALLAX_SYSTEM_RESERVE_GB=4` du CLI etait morte : aucun code moteur ne la lisait.

Le nouveau contrat ne pretend pas predire la RAM d'une application future : cette quantite
n'existe pas. Il combine des mesures et limites maintenues :

1. avant `node_join`, `psutil.virtual_memory().available` mesure la RAM que l'OS peut fournir
   sans swap ; le worker retranche une marge utilisateur, borne par le working set recommande
   par MLX, et publie le resultat distinctement dans `usable_memory_bytes` ;
2. le scheduler conserve `memory_gb` pour le diagnostic mais calcule poids et KV depuis ce
   plafond utilisable ; il ne repartit donc plus les 16 Gio physiques ;
3. l'executor applique les API MLX officielles `set_memory_limit`, `set_wired_limit` et
   `set_cache_limit` ; le KV fixe est calcule depuis le solde encore allouable, pas depuis le
   working set complet ; le plafond d'une generation ne peut jamais grandir en cours de route ;
4. la pression est echantillonnee chaque seconde mais les actions sont lentes : trois mesures
   basses mettent uniquement l'admission en pause, quinze mesures saines reprennent le meme
   contrat sans reallocation ; deux mesures critiques rendent la generation a sens unique,
   drainent les requetes pendant au plus 30 s puis quittent proprement. Le superviseur CLI
   redemarre apres 30 s et le prochain join recalcule une enveloppe plus petite ;
5. aucun agrandissement automatique ni changement de couches n'a lieu sur un heartbeat. Une
   croissance future exigera une longue fenetre stable ou un changement explicite de modele.

Sur le Mac local au moment du preflight, la mesure etait : 16,0 Gio physiques, 7,954 Gio
disponibles sans swap, working set MLX 11,840 Gio, reserve produit 6,0 Gio, donc seulement
1,954 Gio annonces au scheduler. Cette valeur est un snapshot et doit etre remesuree a chaque
join ; elle prouve que le worker n'annonce plus arbitrairement 16 Gio.

Le choix reprend les implementations primaires existantes :

- [psutil `virtual_memory`](https://psutil.readthedocs.io/latest/api.html#psutil.virtual_memory)
  definit `available` comme la memoire attribuable sans swap et recommande ce champ ;
- [Exo profile la RAM disponible avec psutil](https://github.com/exo-explore/exo/blob/main/src/exo/shared/types/profiling.py)
  puis [valide le placement contre cette RAM](https://github.com/exo-explore/exo/blob/main/src/exo/master/placement_utils.py) ;
- [Apple `os_proc_available_memory`](https://developer.apple.com/documentation/os/os_proc_available_memory)
  est seulement consultatif, propre au processus, peut retourner zero hors app et Apple dit de
  ne pas l'utiliser pour maximiser la consommation ; ce n'est donc pas un remplacement de la
  mesure systeme du pool unifie ;
- [Apple expose les evenements natifs de pression](https://developer.apple.com/documentation/dispatch/dispatch_source_type_memorypressure),
  mais aucun binding Python maintenu et deja present dans le runtime n'a ete trouve ; ajouter
  PyObjC ou un daemon macOS fragile uniquement pour cette source n'est pas retenu ;
- [MLX-LM borne ses caches en octets](https://github.com/ml-explore/mlx-lm/pull/906) apres
  [un cas de kernel panic par croissance non bornee](https://github.com/ml-explore/mlx-lm/issues/883),
  et propose aussi un KV tournant `max_kv_size` ; Parallax garde son cache page pour le routing
  contexte mais le borne maintenant par la meme enveloppe physique.

Validation moteur : Ruff format/check, `git diff --check` et suite complete : 352 passes,
6 skips, un warning deprecation Starlette. Validation CLI : 31 tests worker/installer, typecheck
du package puis typecheck Turbo des quatre packages, tous verts.

### Ordre de reprise actualise

1. reconstruire le runtime macOS `rc28` depuis le lock `5138266`, verifier manifeste,
   dependances natives et preflight memoire, puis faire un join controle sans pression critique ;
2. finir/verifier le job Windows CUDA, publier `rc28` seulement si tous les assets, checksums et
   attestations sont coherents, puis installer sur le Mac mini et le PC RTX ;
3. confirmer les SHA runtime des deux workers et refaire le DP automatique, l'E2E IDE complet
   et le gros contexte 12 220 + 4 096 avec TTFT, debit, RAM/swap, KV et refus trop grand ;
4. reprendre ensuite la tolerance aux pannes, les NAT reels et le device pairing selon l'ordre
   de la section precedente.

### Generalisation Windows/Linux et reconstruction rc28

Le contrat memoire n'est plus limite a MLX/macOS. Les revisions poussees les plus recentes
remplacent les pins ci-dessus :

- `swarm-engine` `15c3444538c8bf09ac465a57f3281282e4fa9dc0` —
  `feat(runtime): enforce cross-platform memory envelopes` ;
- `fabi-cli` `ea98e6ff8049c8a3191b5f009d808397fa1255eb` —
  `feat(swarm): apply memory safety on every platform` ;
- `fabi` `cbd1571` — lock release sur ces deux revisions.

Le design commun surveille maintenant deux ressources distinctes :

- RAM hote sur macOS, Windows et Linux avec `psutil.virtual_memory().available` ;
- memoire unifiee MLX sur Apple Silicon, avec plafonds MLX appliques au processus ;
- VRAM globale libre de chaque GPU CUDA visible avec `torch.cuda.mem_get_info`, sur Windows
  natif comme Linux. La capacite CUDA annoncee au scheduler est la somme des enveloppes
  `free - reserve` des GPU visibles, jamais la VRAM totale nominale ; vLLM retranche la meme
  reserve avant ses caches et workspace ; chaque GPU a aussi son propre garde runtime.

L'etat le plus severe entre RAM hote et tous les GPU decide l'admission. Une erreur ponctuelle
de capteur conserve le dernier etat stable au lieu de tuer le superviseur. Le mecanisme
d'hysteresis reste identique sur toutes les plateformes et ne provoque aucune reallocation de
couches. Le CLI injecte desormais la reserve RAM hote sur tous les OS et la reserve VRAM sur
tous les profils CUDA, en preservant les overrides operateur. Le scope produit qualifie reste
Apple Silicon MLX et NVIDIA CUDA Windows/Linux ; un nœud CPU peut consommer mais n'est pas
presente comme worker d'inference qualifie.

Ce choix suit les compteurs globaux du runtime plutot que l'allocateur PyTorch seul :

- [PyTorch documente `mem_get_info` comme le compteur global libre/total du device](https://docs.pytorch.org/docs/stable/generated/torch.cuda.mem_get_info.html) ;
- [les snapshots PyTorch ne voient pas les allocations CUDA externes comme NCCL](https://docs.pytorch.org/docs/stable/torch_cuda_memory.html) ;
- [SGLang calcule son allocation statique depuis la memoire encore disponible](https://github.com/sgl-project/sglang/issues/3265)
  et recommande de garder de la place pour activations et graphes CUDA ; Parallax conserve
  donc son `mem_fraction_static` au lieu d'empiler un second allocateur maison.

Validation moteur apres generalisation : 358 tests passes, 6 skips, un warning Starlette ;
63 tests memoire/lancement/scheduler/vLLM cibles passent ; Ruff sur tous les fichiers touches,
compileall et `git diff --check` passent. Validation CLI : 66 tests du module swarm, typecheck
du package et typecheck Turbo des quatre packages passent.

Une archive macOS `v2.7.0-rc28` a ete reconstruite localement depuis exactement ces revisions :

- binaire Fabi/OpenCode `1.15.0` ;
- manifeste `opencode_revision=ea98e6ff...`, `parallax_revision=15c3444...` ;
- checksum zstd valide, archive 134 Mio environ ;
- frontend `vllm-rs` sans dependance Homebrew : seulement frameworks macOS et `/usr/lib` dans
  `otool -L` ;
- apres application du manifeste de relocalisation comme le fait `install.sh`, le Python
  embarque importe Parallax et MLX depuis un dossier temporaire deplace, et `parallax --help`
  fonctionne ; preflight observe durant ce test : environ 7,066 Gio disponibles, 6 Gio de
  reserve, donc seulement 1,066 Gio de limite processus avant chargement.

L'appel direct au Python d'une archive brute avant relocalisation echoue volontairement car
les chemins contiennent encore `__FABI_INSTALL_ROOT__`; ce n'est pas un runtime installe.
La validation correcte doit toujours appliquer `relocation-manifest.txt`, comme les installateurs
POSIX et PowerShell. `rc28` n'est toujours pas qualifie a cet instant : il reste a pousser le
tag, attendre les six builds CI — surtout Windows CUDA — puis installer les assets publies sur
le Mac mini et le PC RTX. Ne pas reutiliser l'archive locale comme preuve Windows.

### Publication rc28 et validation Mac mini

Cette sous-section est plus recente que le statut provisoire ci-dessus. Le tag
`v2.7.0-rc28` pointe exactement sur `cbd15719f75f0e3d1a4d2f977992d4542e82f592` et a ete
pousse. Le workflow GitHub Actions `29734627565` est termine avec succes sur les six cibles :
Windows x64 CUDA, Linux x64 CUDA, Linux x64 CPU, Linux arm64 CPU, macOS arm64 MLX et macOS
x64 CPU. Les assets, fichiers SHA256 et attestations ont ete publies. L'archive Windows CUDA
est scindee en deux parties, d'environ 1,76 Gio et 190 Mio. L'archive CI macOS arm64 a passe
localement son SHA256 et `gh attestation verify` contre le depot de release.

Le Mac mini a installe l'asset public rc28 par `install.sh`, pas l'archive locale. Le backup
automatique est `~/.local/share/fabi.backup-1784543769`. Le manifeste installe est exact :

- `fabi v2.7.0-rc28`, cible `bun-darwin-arm64`, acceleration `mlx` ;
- OpenCode `ea98e6ff8049c8a3191b5f009d808397fa1255eb` ;
- Parallax `15c3444538c8bf09ac465a57f3281282e4fa9dc0` ;
- les 51 fichiers declares par `runtime/relocation-manifest.txt` existent et aucun ne contient
  encore `__FABI_INSTALL_ROOT__` ; le Python embarque importe Parallax, MLX et psutil depuis
  l'installation deplacee, et `parallax --help` fonctionne.

Au join controle, le Mac a mesure environ 10,28 Gio disponibles, reserve 6 Gio au systeme et
a annonce `usable_memory_bytes=4599873536` au scheduler. Le scheduler a bien recu aussi
`system_available_memory_bytes` et `system_reserve_bytes`. `memory_pressure -Q` indiquait 87 %
de memoire libre : aucune pression ni gel n'a ete observe. Ce join n'est pas une preuve E2E :
le scheduler est reste bloque au bootstrap DP avec le worker Windows encore sur l'ancien
runtime, puis le Mac a quitte au timeout d'allocation de cinq minutes. Il faut refaire le join
apres migration Windows et recreation du scheduler pour effacer ce melange de versions et le
noeud Mac stale.

Fabi IDE pointe maintenant localement sur rc28 et les deux SHA exacts. Les 18 tests de
l'extension passent, son build TypeScript passe, le bundle Electron complet passe avec zero
erreur et `electron-builder --dir` produit l'application macOS arm64. Cette application de labo
n'est pas signee, faute de certificat Developer ID ; ne pas la presenter comme un paquet de
distribution notarise.

La migration Windows rc28 est en cours depuis l'asset public. Avant installation, la tache
`FabiWorkerE2E` a ete arretee et seuls ses quatre processus Python identifies ont ete termines ;
la VRAM est passee de 2 890 Mio libres / 13 158 Mio utilises a 15 989 Mio libres / 59 Mio
utilises. Ne pas declarer le PC qualifie avant la fin de l'installation, la verification du
manifeste, le preflight CUDA et un nouveau join homogene.

## Qualification inference Windows et gros contexte du 20 juillet 2026

Cette section est la source de verite la plus recente. `rc29` est publiee comme tag mais reste
une candidate en cours de build tant que la matrice CI et l'installation des assets publics sur
les deux workers ne sont pas terminees. Le laboratoire decrit ci-dessous prouve le correctif
source applique au runtime Windows `rc28`; il ne doit pas etre presente comme une installation
publique homogene de `rc29`.

### Causes racines trouvees apres l'installation rc28

Le blocage DP initial n'etait pas un calcul lent. Avec `param_mem_ratio=0.05`, le Mac pouvait
annoncer deux couches brutes mais une capacite negative pour la tete apres poids d'embedding.
L'allocateur entrait dans le water-fill puis levait une exception que le join synchrone rendait
semblable a un gel. Le moteur valide maintenant la capacite endpoint avant bootstrap, rollback
les mutations d'une allocation refusee et laisse les workers reessayables. Avec le ratio produit
`0.65` et la meme enveloppe memoire live, le DP construit Mac `[0,4)` puis RTX `[4,28)` sans
redonner acces aux 16 Gio physiques ni contourner la reserve OS.

Un redemarrage scheduler a revele un second defaut : le premier heartbeat recreait un worker
avec des capacites partielles, puis le vrai `node_join` etait traite comme idempotent et ignorait
notamment `supports_frontend`. La re-inscription rafraichit desormais uniquement les champs
possedes par le worker tout en preservant couches, reservations, telemetrie KV et etat runtime
possedes par le scheduler.

Le premier prompt `rc28` atteignait bien le Mac, transferait les activations au RTX puis
retournait HTTP 500. Le log par processus Windows a donne la trace exacte :

```text
TypeError: Request.__init__() got an unexpected keyword argument 'eos_token_id'
```

Le couple historiquement valide dans le labo etait Parallax avec le bundle natif Windows
`aivrar/vllm-windows-build` 0.14.2, installe dans `runtime-v014`. La release publique native
utilise le wheel SystemPanic 0.16 pour CPython 3.12. Ce fork a deja adopte le contrat vLLM
suivant : `Request` ne prend plus `eos_token_id` et le stocke dans `SamplingParams`. vLLM
officiel 0.16 exige encore l'argument sur `Request`. Les tests Linux officiels ne pouvaient donc
pas detecter cette divergence Windows.

L'adaptateur inspecte maintenant explicitement la signature : ancien contrat, EOS transmis au
constructeur `Request`; nouveau contrat, EOS applique a `SamplingParams` par son API de
generation. Aucun `TypeError` large n'est intercepte, afin de ne pas masquer une exception levee
dans vLLM. Les deux contrats et le cas inconnu sont testes. Le build Windows construit desormais
une vraie `Request` en smoke hardware-free, importe toute la chaine executor, installe
explicitement `llguidance>=1.3,<1.4` et `xgrammar==0.1.29` que les marqueurs `x86_64` de vLLM
omettent sous `AMD64`, puis execute `pip check`.

Sources primaires relues :

- [vLLM officiel 0.16, contrat Request](https://github.com/vllm-project/vllm/blob/v0.16.0/vllm/v1/request.py) ;
- [fork SystemPanic 0.16, contrat Request](https://github.com/SystemPanic/vllm-windows/blob/v0.16.0/vllm/v1/request.py) ;
- [fork SystemPanic 0.16, SamplingParams](https://github.com/SystemPanic/vllm-windows/blob/v0.16.0/vllm/sampling_params.py) ;
- [logging vLLM configurable](https://docs.vllm.ai/en/v0.13.0/examples/others/logging_configuration/) ;
- [Python, logs multi-process](https://docs.python.org/3/howto/logging-cookbook.html#logging-to-a-single-file-from-multiple-processes).

### Revisions et validations source

Moteur `codex/dynamic-dp-product`, tous pousses :

- `451a05d1449f1b13b669f2ae0d15bc8e404b9ec7` — validation de la memoire endpoint DP ;
- `057e15e2e76b30729ce2d963492d3ee86b43064d` — contrat protobuf compatible vLLM 0.16 ;
- `84cda9c4c8e2ea50e368ba1158f42b6628f044dd` — rejoin complet apres restart scheduler,
  logs rotatifs opt-in par session/PID et conservation du logging Parallax dans les enfants ;
- `c14c99759cc5b3b6e6cd6e11d74213309e7b7456` — compatibilite des deux API `Request` vLLM.

Suite moteur finale : 370 tests passes, 6 skips, un warning Starlette preexistant ; Ruff check,
Ruff format et `git diff --check` passent. Le scheduler de labo charge l'image construite depuis
`84cda9c` avec label OCI et checkout interne verifies. Le PC `rc28` charge temporairement les
deux fichiers adaptateur de `c14c997` pour la preuve materielle ; le Mac reste sur l'asset public
`rc28`. Cette heterogeneite source est volontairement documentee et sera supprimee par
l'installation publique `rc29`.

Runtime/registry `main` :

- `27a66b3fb0ebd3539a0225adda0f4566b537c06d` — pin moteur `c14c997`, dependances Windows et
  smoke de construction `Request` ;
- tag annote `v2.7.0-rc29` pousse sur ce commit ;
- workflow `29746962176` : termine `success` en 41 min 49 s, six jobs verts plus la mise a jour
  `install.sh`. Le job critique `Build windows-x64-cuda` (`88367243626`) a conclu `success` a
  14:17:53 UTC. Les assets sont publies ; noter que le tarball Windows est livre en deux parties
  `fabi-windows-x64-cuda.tar.zst.partaa` / `.partab`, ce que l'installeur doit recoller.

Ne pas annoncer `rc29` qualifiee pour autant. La CI verte ne couvre que le premier critere. Il
reste : installation publique sur Windows, verification des manifestes relocalises cote Windows,
et rejeu prompt + SSE sur un couple 100 % public. Cote macOS ces preuves sont faites — asset
public installe, SHA256 verifie, 51 fichiers relocalises, non-stream 200 en 1,666 s, SSE TTFT
0,845 s / fin 2,458 s / 18 chunks / sentinelle exacte. Le PC reste sur le hotpatch `rc28` tant que
l'installation publique Windows n'est pas faite, donc l'heterogeneite source documentee plus haut
n'est pas encore levee.

### Preuves E2E du laboratoire

Apres arret des deux workers, redemarrage du seul scheduler cible, puis demarrage Mac et Windows,
le DP a reconstruit automatiquement Mac `[0,4)` vers RTX `[4,28)`. Les liens directs Tailscale
sont reciproques, les deux workers sont `available`, contexte 32 768 et reservations nulles.

- a froid apres correction Windows : HTTP 200 en 6,570 s ; la limite 32 tokens a termine dans
  le raisonnement Qwen, comportement attendu et non une panne ;
- non-stream `/no_think` : sentinelle `FABI-C14C997-WARM-OK` exacte en 1,246 s ;
- SSE : TTFT 0,643 s, fin 2,359 s, 17 chunks, sentinelle exacte et `[DONE]` ;
- redemarrage isole du worker RTX, rejoin et probes directs : sentinelle exacte en 1,552 s sans
  redemarrer le Mac ni le scheduler ;
- contexte OpenCode reel calibre par le tokenizer local : 12 220 tokens avant frontend,
  12 223 observes par le runtime, sortie maximale reservee 4 096, sentinelle exacte en 10,044 s ;
- mesure longue : 12 207 tokens de prompt, 532 tokens de sortie en 30,721 s ; reservations
  simultanees de 16 304 tokens sur chaque shard pendant 13,985 s, puis retour exact a zero ;
- budget impossible : 32 784 demandes contre 32 768 supportes, HTTP 400
  `context_length_exceeded` en 0,190 s et aucune reservation.

Apres charge, le Mac gardait 78 % de memoire systeme libre et l'executor environ 1,06 Gio RSS.
Le RTX utilisait 13 659 Mio de VRAM, en gardait 2 389 Mio libres, et le PC gardait environ
27 Gio de RAM hote disponible sur 32 Gio. Le GPU revenait a 0 % d'utilisation apres requete.
Le pool vLLM reste volontairement prealloue : poids, KV et workspace utilisent le GPU pour Fabi
tout en conservant la reserve CUDA ; il ne faut pas confondre cette allocation stable avec une
fuite par prompt.

Une requete lancee juste apres l'ancienne exception EOS a ensuite attendu jusqu'au timeout. Un
restart complet a nettoye cet etat, et le restart isole RTX n'a pas reproduit le probleme sur un
etat sain. L'hypothese la plus forte est un etat frontend/executor Mac incomplet apres erreur
aval pendant une requete distribuee. Le correctif EOS empeche ce chemin nominal, mais la reprise
apres erreur worker doit encore obtenir un test injectant une faute aval puis prouvant eviction,
fencing et capacite du prompt suivant. Ne pas presenter cette hypothese comme une cause prouvee.

### Ordre de reprise mis a jour

1. terminer la CI `rc29`, installer les assets publics sur Mac et Windows, verifier SHA,
   manifests, imports, smoke `Request`, puis rejouer petit prompt et SSE ;
2. mettre a jour les pins IDE vers `rc29`, reconstruire l'application complete et refaire le
   parcours UI/OpenCode ;
3. priorite utilisateur suivante : enlever toutes les adresses Tailscale du trafic produit et
   qualifier deux vrais reseaux/NAT. Mesurer discovery, AutoNAT, hole punching, connexion directe
   et fallback relay ; une pipeline d'activations relay-only ne compte pas comme P2P direct ;
4. seulement ensuite reprendre replique, kill prefill/decode, epoch/fencing et replay KV ;
5. concevoir enfin login/device pairing, rotation et revocation multi-machine.

### Mise a jour push / installateur Windows rc29, 20 juillet 2026 16:45 Europe/Paris

Le repo IDE `main` est pousse jusqu'a `f9e2061` avec les pins runtime `v2.7.0-rc29`,
OpenCode `ea98e6ff8049c8a3191b5f009d808397fa1255eb` et Parallax
`c14c99759cc5b3b6e6cd6e11d74213309e7b7456`. Les validations locales associees a ce commit
restent celles documentees plus haut : tests extension, build TypeScript, bundle Theia/Electron
et packaging `electron-builder --dir` OK, application macOS non signee.

Apres la CI verte de `v2.7.0-rc29`, l'installation publique Windows depuis l'asset release a
revele un probleme d'installateur : `Invoke-WebRequest` telechargeait bien le manifeste `.parts`
de 74 octets, puis restait bloque sur le gros asset split `partaa` sans ecrire de fichier utile.
Ce n'etait pas une panne vLLM ni Parallax, mais le transport PowerShell du gros artefact GitHub.

Correctif runtime pousse sur `fabi/main` :

- `d129f19` — `fix: use curl for Windows split asset downloads`.

`install.ps1` utilise maintenant `curl.exe --fail --location --show-error --output` quand
disponible pour les assets et les checksums, avec fallback `Invoke-WebRequest`. L'asset
`install.ps1` attache a la release `v2.7.0-rc29` a ete remplace avec ce fichier corrige
(`sha256:d16ec0b38fdf18cbeb882bb374dcb4a1dfb0dd25cff0deee32c5926f6ed03695`, taille 13 537
octets, `updatedAt=2026-07-20T14:39:30Z` cote GitHub).

Un test d'installation Windows est en cours sur le PC RTX depuis ce script corrige copie en local
dans `%TEMP%`. Le chemin corrige progresse reellement : `curl.exe` a commence a telecharger
`fabi-windows-x64-cuda.tar.zst.partaa` (1,75 Gio) et affichait environ 57 Mio telecharges apres
1 min 20 s lors du dernier relevé. A cet instant, ne pas declarer Windows `rc29` qualifie :
il manque encore fin du download, assemblage, SHA256, extraction, manifeste relocalise, `pip
check`, smoke hardware-free `create_vllm_request`, redemarrage du worker et prompt/SSE homogene
Mac public rc29 + Windows public rc29.

Le scheduler de labo n'a pas encore ete bascule sur l'image `local/parallax-scheduler:c14c997`
construite sur le VPS ; il tournait encore sur l'image precedente pendant cette installation.
Cette bascule doit venir apres l'installation Windows publique pour eviter de melanger les causes.

TODO immediate apres ce push :

1. laisser finir l'installation Windows rc29 corrigee et consigner le resultat exact ;
2. si l'installation passe, restaurer/demarrer `FabiWorkerE2E`, deployer le scheduler `c14c997`,
   attendre le cluster DP 32k homogene et rejouer non-stream + SSE ;
3. si l'installation echoue, recuperer l'erreur precise du script corrige avant toute nouvelle
   modification ;
4. ensuite seulement attaquer le chantier demande par l'utilisateur : qualification hors
   Tailscale, avec preuve d'absence de trafic `100.x` et en distinguant bien meme-LAN/same-NAT
   d'un vrai test deux NAT.

### Qualification rc29 publique homogene et ordre de join, 21 juillet 2026

Cette sous-section remplace le statut provisoire ci-dessus. Les quatre repos etaient a jour par
`git pull --ff-only` au debut de reprise. Les etats pousses connus sont :

- `swarm-engine` `c14c99759cc5b3b6e6cd6e11d74213309e7b7456` sur
  `codex/dynamic-dp-product` ;
- `fabi-cli` `ea98e6ff8049c8a3191b5f009d808397fa1255eb` sur `dev` ;
- `fabi` runtime `e1c1d12` sur `main` apres les correctifs installateur Windows ;
- `fabi-IDE` `471de41b921fc392c0ba14389ea7005eddda873a` avant cette mise a jour de handoff.

L'installation Windows publique `v2.7.0-rc29` est terminee sur le PC RTX. L'archive assemblee
depuis les deux assets split avait la taille `2090104601` octets et le SHA256 attendu
`12d562a43b3e7669589e5cffd4c463c34e70fc721ccb903b5f6261abaf6ae365`. Le manifeste installe est :

- `fabi v2.7.0-rc29`, target `bun-windows-x64`, accel `cuda`, Python `3.12.7` ;
- OpenCode `ea98e6ff8049c8a3191b5f009d808397fa1255eb` ;
- Parallax `c14c99759cc5b3b6e6cd6e11d74213309e7b7456` ;
- `built_at=2026-07-20T13:45:54Z`.

`pip check` retourne `No broken requirements found`. Le smoke hardware-free
`create_vllm_request` avec `llguidance` et `xgrammar` passe. Le smoke d'import executor passe
avec le Python runtime correct `runtime/parallax-venv/Scripts/python.exe` :
`from parallax.server.executor.vllm_executor import VLLMExecutor` puis `ok-executor`. Les echecs
intermediaires precedents etaient des erreurs de quoting PowerShell/double SSH ou un chemin
Python suppose faux (`runtime-python/python.exe`) ; ne pas les interpreter comme une panne vLLM.

Les correctifs installateur Windows pousses sur `fabi/main` apres le tag release sont :

- `d129f19` — utiliser `curl.exe` pour les gros assets split ;
- `e7ea08d` — reprendre les downloads Windows bloques/stalles avec `--continue-at -`,
  `--speed-limit 1024`, `--speed-time 60`, six tentatives et timeout de connexion ;
- `e1c1d12` — refuser une installation si des processus executent encore depuis le root Fabi et
  accepter `FABI_TARBALL_PATH` pour valider une archive locale deja assemblee.

L'asset `install.ps1` attache a `v2.7.0-rc29` a ete remplace par cette version corrigee. Le tag
`v2.7.0-rc29` pointe toujours sur le commit release `27a66b3...`; `main` contient les correctifs
installateur post-release. Ne pas decrire ces commits comme faisant partie du tag sans recreer une
nouvelle release.

Le scheduler principal du VPS a ete bascule uniquement pour le swarm `qwen3-1_7b` en retaguant
`local/parallax-scheduler:c14c997` vers `local/parallax-scheduler:latest` puis
`docker compose up -d parallax-scheduler`. Le conteneur porte le label OCI
`org.opencontainers.image.revision=c14c99759cc5b3b6e6cd6e11d74213309e7b7456` et tourne sur
`0.0.0.0:3001`, TCP/UDP P2P `18080`. Les autres schedulers de modeles n'ont pas ete redemarres.

Deux sequences de join ont ete qualifiees :

1. Mac puis PC : le scheduler refuse d'abord le Mac seul (`frontend_nodes=1`, capacite totale
   insuffisante), puis alloue automatiquement Mac `[0,4)` et RTX `[4,28)` quand le PC rejoint.
   Les deux workers deviennent `available`, contexte supporte `32768`, direct peers reciproques
   et reservations KV a zero.
2. PC puis Mac : le PC seul reste `waiting`, `need_more_nodes=true`, sans fausse disponibilite
   malgre `total_cap=91`, parce que `frontend_nodes=0`. Quand le Mac frontend rejoint, le
   scheduler recalcule et alloue RTX `[4,28)` puis Mac `[0,4)`. Le cluster devient `available`,
   `prefill_contract_ready=true`, `max_supported_context_tokens=32768`, direct peers reciproques.

Sur la sequence inverse, les prompts avec le token du compte contributeur depuis le Mac donnent :

- non-stream `/no_think` : HTTP 200 en `7.051 s`, sentinelle exacte
  `FABI-RC29-REVERSE-ORDER-OK` ;
- SSE `/no_think` : HTTP 200, TTFT `0.840 s`, fin `2.761 s`, `20` chunks, `[DONE]`, sentinelle
  exacte `FABI-RC29-REVERSE-ORDER-SSE-OK`.

Un appel identique depuis le VPS sans token de compte contributeur retourne correctement HTTP 403
`contribution_required`; cela prouve que le gate reste actif et que consommer depuis une machine
non liee au compte ne contourne pas la contribution. Apres les prompts, le scheduler montre
`reserved_context_tokens=0` sur les deux shards, RTX `12675 MiB` utilises / `3373 MiB` libres /
`0 %` GPU, Mac `7224590336` octets disponibles et executor principal autour de `821 MiB` RSS.
La VRAM RTX reste preallouee pour poids/KV/workspace ; c'est attendu et ce n'est pas une fuite par
prompt.

Limite encore observee et importante pour le chantier NAT : les logs Lattica montrent toujours du
mDNS actif sur les interfaces Tailscale/LAN et des erreurs macOS `No route to host` sur mDNS. Le
chantier suivant doit donc reprendre l'audit deja fait sur libp2p/Lattica/Parallax officiel :
desactiver mDNS quand des initial peers publics sont fournis, enlever les multiaddrs `100.x` du
trafic produit, tester relay/DCUtR/hole punching, et prouver l'absence de trafic Tailscale. Le
test actuel reste une qualification Tailscale de labo, pas une preuve deux NAT reels.

TODO immediate actualisee :

1. **fait ci-dessous** — rejouer le gros contexte OpenCode sur le couple public `rc29` homogene
   (`~12 220` tokens entree + `4 096` tokens sortie reserves), mesurer TTFT, debit, RAM, VRAM,
   reservations KV et refus contexte trop grand ;
2. reconstruire/relancer Fabi IDE depuis le clone local complet et refaire le parcours UI complet :
   selection modele, connexion swarm, gate contribution, prompt OpenCode, streaming, outils,
   permissions, abort et changement de modele ;
3. commencer ensuite le chantier NAT hors Tailscale : patch mDNS/initial-peers inspire de
   Parallax officiel PR #141, configuration scheduler public, capture de routes/adresses et
   distinction explicite same-LAN/same-NAT vs deux NAT reels ;
4. ensuite seulement reprendre replique/failover : troisieme worker, kill prefill/decode,
   erreur propre sans replique, reroute avec replique, epoch/fencing et replay KV.

### Gros contexte OpenCode rc29 homogene, 21 juillet 2026

Le TODO 1 ci-dessus est maintenant qualifie sur le couple public `v2.7.0-rc29` homogene,
scheduler `c14c997`, workers Mac mini MLX + PC RTX CUDA. Le prompt a ete calibre avec le
tokenizer local Qwen du runtime Mac, pas avec une estimation de caracteres.

Resultats :

- gros contexte sentinelle : `12 266` tokens prompt, `max_tokens=4096`, HTTP 200, TTFT
  `9.791 s`, fin `11.527 s`, `18` chunks, sentinelle exacte
  `FABI-RC29-BIGCTX-SSE-OK` ;
- reservation observee pendant cette requete : `16 368` tokens sur Apple M4 et RTX 4080 SUPER,
  soit l'arrondi physique de `12 266 + 4 096 = 16 362` ;
- gros contexte long : `12 220` tokens prompt exacts, `max_tokens=4096`, HTTP 200, TTFT
  `9.559 s`, fin `58.002 s`, `470` chunks, `466` tokens de sortie mesures par le tokenizer,
  debit decode environ `9.62 tok/s`, sentinelle `FABI-RC29-BIGCTX-LONG-OK` presente ;
- reservation observee pendant la generation longue : `16 320` tokens sur chaque shard, soit
  l'arrondi de `12 220 + 4 096 = 16 316` ;
- refus trop grand : `28 755` tokens prompt + `4 096` sortie = `32 851` requis, HTTP 400 en
  `0.723 s`, code `context_length_exceeded`, message indiquant le maximum disponible `32 768` ;
  reservations avant et apres : zero sur les deux shards.

Etat apres charge :

- `/cluster/status_json` revient a `status=available`, `reserved_context_tokens=0` et
  `max_running_request=0` ;
- RTX 4080 SUPER : `13 659 MiB` utilises, `2 389 MiB` libres, `0 %` GPU apres requete ;
- Mac mini : `7 984 955 392` octets disponibles, executor principal autour de `1.09 Gio` RSS ;
- capacites KV publiees : RTX `81 712` tokens, Apple M4 `40 704` tokens, block size `16`.

Interpretation : le gros prefill explique le TTFT autour de 9,5-9,8 s. La VRAM RTX reste
preallouee de maniere stable pour les poids, KV et workspace vLLM ; le signal important est le
retour exact des reservations scheduler a zero et l'absence d'activite GPU residuelle apres
generation. Le prochain item produit est donc l'E2E IDE complet, puis le chantier NAT hors
Tailscale.

### Correctifs scheduler pression memoire et restart worker, 21 juillet 2026

Deux regressions produit ont ete trouvees pendant la reprise de l'E2E IDE et des tests
d'ordre de join. Elles viennent de cas Fabi reels qui ne sont pas couverts par Parallax
upstream : workers qui annoncent une enveloppe memoire utile live, et workers qui reviennent
par heartbeat avant leur `node_join` complet apres restart scheduler.

Recherche/verification avant correction :

- Parallax officiel garde le modele a deux phases : allocation de couches sous contraintes
  memoire/reseau, puis routing de requetes sur les pipelines disponibles ;
- le code upstream `GradientHQ/parallax` a le meme pattern structurel dans `dynamic_join` :
  calcul de `end_layer` depuis la capacite du node puis appel a `allocate()` sans garde
  explicite si la capacite devient nulle ou negative ;
- ce cas devient normal dans Fabi parce que les workers publient maintenant la memoire utile
  mesuree, pas la RAM physique. Un laptop/local IDE sous pression peut donc annoncer
  `usable_memory_bytes=0` et doit rester en standby au lieu de casser le scheduler.

Correctifs pousses sur `swarm-engine/codex/dynamic-dp-product` :

- `340d7829965b2bc7119bb8ebc67512f5de5a88b5` —
  `fix scheduler dynamic join for zero-capacity workers`
  - `BaseLayerAllocator.dynamic_join()` refuse maintenant les candidats invalides
    `[start,end)` au lieu d'appeler `allocate()` ;
  - `_adjust_end_layer_for_tail()` retourne un range vide ferme quand la capacite calculee
    est `<= 0` ;
  - `Scheduler.join()` garde le node en standby si le join dynamique est rejete, et protege
    la boucle d'evenements contre une `ValueError` ;
  - tests ajoutes : worker zero-capacity apres bootstrap, pipeline existante conservee.
- `062d4498af364893e6f580da71c72f5bd241740b` —
  `fix scheduler bootstrap retry after heartbeat registration`
  - si un `node_update` arrive pour un node deja auto-enregistre mais que le cluster n'a pas
    de full pipeline, le handler repasse par `enqueue_join(node)` ;
  - cela reutilise le chemin existant `refresh_registration()` pour rafraichir hardware,
    `supports_frontend`, token de compte et capacites, puis relance le bootstrap ;
  - tests ajoutes : rejoin d'un node waiting avec capacites completes, et chemin RPC
    `node_update` avant bootstrap.

Validation locale engine :

- venv local `.venv` cree dans `/Users/noagiannone/Documents/swarm-engine-dynamic` avec
  `python3.12 -m venv .venv` puis `pip install -e '.[mac, dev]'` ;
- `pytest tests/scheduler_tests/test_layer_allocation.py tests/scheduler_tests/test_scheduler.py tests/test_rpc_connection_handler.py -q`
  retourne `64 passed in 5.22s` ;
- `ruff check` cible signale encore des `E741` preexistants dans `layer_allocation.py`
  autour de variables nommees `l`; ces lignes ne viennent pas du correctif et restent a
  nettoyer separement si on veut rendre le lint strict sur tout le fichier.

Deploiement lab :

- image scheduler reconstruite sur le VPS avec
  `PARALLAX_COMMIT=062d4498af364893e6f580da71c72f5bd241740b` ;
- le conteneur principal a ete force-recree avec `docker compose up -d --force-recreate
  parallax-scheduler` ;
- label OCI courant verifie :
  `org.opencontainers.image.revision=062d4498af364893e6f580da71c72f5bd241740b`.

Cas reels rejoues :

1. **Worker IDE/local avec memoire utile nulle**
   - Fabi app packge `electron-app/dist/mac-arm64/Fabi.app` a ete lance depuis le clone local ;
   - l'app a spawn le worker local `parallax join` depuis
     `~/.local/share/fabi/runtime/parallax-venv/bin/parallax` ;
   - le scheduler a recu le node local Apple M4 avec `usable_memory_bytes=0` ;
   - avant correction cela produisait `Invalid allocation: start_layer 0 >= end_layer -7` et
     tuait `SchedulerEventLoop` ;
   - apres `340d782`, log attendu :
     `Rejecting dynamic join ... invalid candidate [0, 0), usable_memory_bytes=0,
     decoder_capacity=0, decoder_capacity_with_input=-7, decoder_capacity_with_input_and_head=-13`,
     puis `remains standby after dynamic join rejection` ;
   - le cluster Mac mini + RTX reste `available`, le node local reste `waiting`, aucune
     exception `Invalid allocation`/`Exception in thread`.

2. **Restart scheduler + heartbeats avant node_join complet**
   - apres un restart reel, les workers peuvent reapparaitre via `node_update` avant le
     `node_join` complet ;
   - avant `062d449`, le scheduler restait en `waiting`, `max_supported_context_tokens=0`,
     malgre les deux nodes visibles ;
   - apres `062d449`, le handler logge `update arrived before bootstrap completed;
     refreshing registration via join`, puis le bootstrap finit quand le vrai worker est propre.

3. **Doublons worker Mac mini**
   - pendant les relances, plusieurs anciens processus Parallax etaient encore presents sur le
     Mac mini et occupaient le port P2P `19080`, avec erreur Lattica `AddrInUse`;
   - tous les processus sous `/Users/gmbh/.local/share/fabi/runtime` ont ete arretes, puis un
     seul worker Mac a ete relance via `mac-worker-e2e.sh`.

Etat final lab apres nettoyage/relaunch :

- scheduler principal VPS : `062d449`, gate actif, port HTTP `3001`, P2P `18080` ;
- workers actifs :
  - Mac mini Apple M4 : `available`, `supports_frontend=true`, `remaining_context_tokens=63968`,
    direct peer RTX ;
  - PC Windows RTX 4080 SUPER : `available`, `supports_frontend=false`,
    `remaining_context_tokens=50272`, direct peer Mac ;
- allocation finale : Mac `[0,4)` puis RTX `[4,28)` ;
- `max_supported_context_tokens=32768`, `need_more_nodes=false`, reservations a zero.

Validation generation finale depuis le Mac mini avec le vrai token `~/.config/fabi/account-token` :

- `/v1/contribution/status` : `allowed=true`, `eligible_workers=2` ;
- SSE `/v1/chat/completions` : HTTP 200, TTFT `6.172 s`, fin `32.146 s`, `257` chunks,
  sentinelle `FABI-062D449-E2E-OK` presente ;
- apres generation : cluster toujours `available`, Mac et RTX `reserved_context_tokens=0`.

Limites notees :

- le test PC-seul strict a ete pollue par un worker Mac deja vivant/auto-reconnecte ; le cas
  PC-first reste valide cote logs quand le PC arrive avant le Mac, mais si on veut une preuve
  totalement isolee il faut d'abord ajouter un script de controle de lifecycle worker plus dur
  cote Mac/Windows ;
- le cleanup des nodes `waiting` morts n'est pas encore parfait : le heartbeat timeout actuel
  cible surtout les active nodes. Ce n'est pas bloquant pour le routing mais devra etre traite
  pour une UI propre ;
- l'E2E UI complet reste a finir : selection modele, prompt OpenCode depuis l'interface,
  tools/permissions, abort et changement de modele. La capture ecran automatique est bloquee
  par les permissions macOS Screen Recording.

TODO immediate actualisee :

1. finir l'E2E UI complet sur Fabi IDE packge local, maintenant que le scheduler ne casse plus
   sur worker local zero-capacity ;
2. ajouter un controle lifecycle worker propre pour les tests lab (`stop/start/status` Mac et
   Windows) afin d'eviter doublons, ports occupes et tests d'ordre pollues ;
3. nettoyer les nodes standby/waiting morts dans le scheduler ;
4. reprendre ensuite le chantier NAT hors Tailscale : desactiver/maitriser mDNS quand initial
   peers publics sont fournis, verifier relay/DCUtR/hole punching et prouver les routes sans
   adresses `100.x` ;
5. puis reprendre failover/replique.

### Lifecycle lab, standby cleanup et pression RAM IDE, 21 juillet 2026

Suite du bloc precedent. Objectif : stabiliser le lab pour que les tests d'ordre de join, l'E2E
IDE et le chantier NAT ne soient plus pollues par des workers fantomes ou des nodes `waiting`
morts.

Correctif pousse sur `swarm-engine/codex/dynamic-dp-product` :

- `ade9fbf304b2fd887bf37498284d85f42aec9500` —
  `fix scheduler stale standby cleanup`
  - `Scheduler.checking_node_heartbeat()` inspecte maintenant `self.node_manager.nodes`, pas
    uniquement les active nodes ;
  - un node en standby/waiting qui n'envoie plus de heartbeat est retire apres timeout ;
  - cela garde l'UI/status propre apres un worker local IDE refuse ou tue ;
  - tests ajoutes : retrait d'un standby stale sans casser la pipeline active.

Validation engine :

- `pytest tests/scheduler_tests/test_layer_allocation.py tests/scheduler_tests/test_scheduler.py tests/test_rpc_connection_handler.py -q`
  apres `062d449` : `64 passed` ;
- `pytest tests/scheduler_tests/test_scheduler.py tests/scheduler_tests/test_layer_allocation.py -q`
  apres `ade9fbf` : `60 passed`.

Deploiement scheduler lab :

- image VPS reconstruite avec
  `PARALLAX_COMMIT=ade9fbf304b2fd887bf37498284d85f42aec9500` ;
- conteneur principal force-recree avec `docker compose up -d --force-recreate
  parallax-scheduler` ;
- label OCI courant verifie :
  `org.opencontainers.image.revision=ade9fbf304b2fd887bf37498284d85f42aec9500`.

Correctifs IDE/lab dans `fabi-IDE/main` :

- `602774e8cf7a67d49af2dd4a9bddf201fefd2b63` —
  `tools: add robust lab worker lifecycle control`
  - `fabi-swarm/src/node/fabi-worker-tuning.ts` ne tue plus les process Parallax de facon
    large ; il cible uniquement les commandes sous le runtime Fabi
    `~/.local/share/fabi/runtime` ou `%LOCALAPPDATA%\fabi\runtime` ;
  - nouveau script `tools/lab-worker-control.sh` :
    `status|start|stop|restart mac|windows|all`, via `ssh vps`, puis Mac mini
    `gmbh@100.82.190.118` et PC Windows `gmbhl@100.105.234.82` ;
  - Mac : stop cible uniquement `/Users/gmbh/.local/share/fabi/runtime`, controle port `19080`,
    relance `/Users/gmbh/.local/share/fabi/mac-worker-e2e.sh` ;
  - Windows : controle la tache planifiee `FabiWorkerE2E` et tue uniquement les process dont la
    ligne de commande contient le runtime Fabi ;
  - validation : `bash -n tools/lab-worker-control.sh`, `tools/lab-worker-control.sh status mac`.
- correctif ajoute ensuite dans ce bloc de reprise :
  - `fabi-swarm/src/node/fabi-swarm-worker.ts` renforce le handler synchrone `process.on('exit')`
    du worker IDE : SIGINT du process group puis purge best-effort des enfants runtime Fabi ;
  - raison : une fermeture par `osascript quit` a laisse deux enfants Python
    `multiprocessing.resource_tracker`/`spawn_main` rattaches au runtime local, ce qui peut
    augmenter la pression RAM et fausser le prochain calcul de capacite.

Validation IDE locale :

- `yarn --cwd fabi-swarm test` : `19 passed` ;
- `yarn run build:fabi-ext` : OK ;
- `yarn run build:electron` : OK ;
- `yarn --cwd electron-app package:dir` : OK, app packgee dans
  `electron-app/dist/mac-arm64/Fabi.app` (non signee, attendu).

Tests d'ordre de join avec lifecycle propre :

1. Stop Mac + Windows via `tools/lab-worker-control.sh stop all`, puis recreate scheduler.
2. Start Windows seul :
   - le PC RTX rejoint en premier ;
   - le scheduler reste `waiting`, `need_more_nodes=true`, `max_supported_context_tokens=0`,
     car `frontend_nodes=0` ;
   - c'est le comportement attendu : un decoder RTX seul ne doit pas annoncer une pipeline
     consommable sans frontend.
3. Start Mac mini ensuite :
   - le scheduler alloue automatiquement RTX `[4,28)` puis Mac `[0,4)` ;
   - cluster final `available`, `need_more_nodes=false`, contexte `32768` ;
   - direct peers reciproques, reservations KV a zero.

Validation generation apres deploiement `ade9fbf` :

- depuis le Mac mini avec le vrai token du compte contributeur ;
- SSE HTTP 200, TTFT `5.451 s`, fin `31.398 s`, `257` chunks ;
- sentinelle `FABI-ADE9FBF-LIFECYCLE-OK` presente ;
- apres generation : cluster `available`, 2 nodes, `max_supported_context_tokens=32768`,
  reservations KV a zero.

E2E IDE minimal :

- Fabi app locale lancee depuis le clone complet :
  `electron-app/dist/mac-arm64/Fabi.app --args /tmp/fabi-ide-e2e-workspace-20260721` ;
- l'app a spawn un worker local via
  `~/.local/share/fabi/runtime/parallax-venv/bin/parallax join ...` ;
- ce Mac courant a annonce :
  `system_available_memory_bytes=3856809984`,
  `system_reserve_bytes=6442450944`,
  donc `usable_memory_bytes=0` ;
- le scheduler a refuse proprement le join dynamique :
  `Rejecting dynamic join ... invalid candidate [4, 4), usable_memory_bytes=0`,
  puis `remains standby after dynamic join rejection` ;
- la pipeline Mac mini + RTX est restee disponible et routable ;
- apres fermeture de l'app et timeout heartbeat, le node local standby a disparu du status ;
- cleanup local manuel effectue ensuite : plus aucun process
  `Fabi.app|parallax join|parallax-src/src/parallax/launch.py|runtime/parallax-venv` vivant.

Interpretation pression RAM :

- le refus du Mac courant n'est pas une regression scheduler : c'est la garde memoire produit ;
- avec 3.86 GB disponibles et 6.44 GB reserves pour macOS/apps, la capacite utile doit etre
  `0`, sinon Fabi risque de faire laguer la machine hote ;
- quand la memoire disponible remonte au-dessus de la reserve, le meme type de Mac peut annoncer
  une capacite utile positive (exemple observe plus tot : `usable_memory_bytes=2807496704`) ;
- le produit doit donc utiliser beaucoup de memoire quand elle est vraiment disponible, mais
  refuser ou rester standby quand la pression live passe sous la reserve OS.

Recherche NAT/Parallax a reprendre :

- sources primaires consultees : repo officiel `GradientHQ/parallax`, papier Parallax
  `arXiv:2509.26182`, docs/spec libp2p hole punching/DCUtR, papier Lattica `arXiv:2510.00183` ;
- conclusion technique : ne pas inventer un tunnel NAT maison. Parallax/Lattica est deja pense
  autour de libp2p, relay et DCUtR/hole punching ;
- chantier produit Fabi : exposer/configurer proprement initial peers/relays/announce addrs,
  empecher les adresses Tailscale `100.x` de servir de preuve produit, instrumenter direct vs
  relay, et definir un seuil ou relay-only est refuse si debit/latence ne respecte pas le
  contrat d'inference distribuee ;
- les erreurs mDNS observees sur macOS/Tailscale restent a traiter : elles ne cassent pas le
  lab actuel, mais le mode produit hors Tailscale doit etre teste en deux NAT reels avec preuves
  de routes et multiaddrs.

TODO immediate actualisee :

1. relancer Fabi IDE apres cleanup pour verifier qu'un quit normal ne laisse plus d'enfants
   runtime ;
2. finir le vrai E2E UI visuel : selection modele, connexion swarm, gate contribution, prompt
   OpenCode, streaming, tools/permissions, abort et changement de modele ;
3. commencer le chantier NAT hors Tailscale en s'appuyant sur Parallax/Lattica/libp2p
   relay/DCUtR, avec instrumentation direct/relay et exclusion des routes Tailscale ;
4. ensuite failover/replique : troisieme worker, kill prefill/decode, erreur propre sans
   replique, reroute avec replique, epoch/fencing et replay KV.

### Reserve RAM adaptative cross-platform, 21 juillet 2026

Le refus du Mac courant a revele que l'ancien plancher `PARALLAX_SYSTEM_RESERVE_GB=6` etait trop
conservateur pour les machines 16 Gio : il protegeait bien le desktop, mais transformait une
pression moderee en `usable_memory_bytes=0` trop souvent.

Recherche avant implementation :

- `psutil.virtual_memory().available` est le signal maintenu cross-platform deja present dans le
  runtime ; il mappe vers les compteurs OS pertinents : `MemAvailable` Linux, disponibilite
  physique Windows, compteurs VM macOS ;
- Apple documente la pression memoire comme une combinaison de memoire libre, swap, wired memory
  et file cache ; donc le bon principe n'est pas "RAM libre brute", mais "memoire disponible sous
  pression" ;
- Windows expose aussi le principe d'adapter l'usage memoire quand la ressource memoire devient
  basse via `CreateMemoryResourceNotification`/`QueryMemoryResourceNotification` ;
- vLLM/SGLang utilisent le meme principe produit cote VRAM : fraction utilisable par defaut puis
  baisse explicite en cas de pression/OOM, pas allocation de 100% de la memoire.

Correctif runtime pousse sur `swarm-engine/codex/dynamic-dp-product` :

- `a7ad1828ac5cdd28c08be59c7c12f20d0d7e651e` —
  `feat: adapt host memory reserve to pressure`
  - nouvelle fonction `adaptive_system_reserve_bytes(total, available)` ;
  - override utilisateur/lab `PARALLAX_SYSTEM_RESERVE_GB` toujours prioritaire ;
  - par defaut, reserve host calculee avec `psutil.available / total` :
    - pression normale : environ `20 %` RAM, borne `2-12 Gio` ;
    - pression elevee : environ `25 %` RAM ;
    - pression critique : environ `30 %` RAM ;
  - sur 16 Gio, l'ancien plancher fixe `6 Gio` devient :
    - `3.2 Gio` si la machine est verte ;
    - `4 Gio` si elle est sous pression elevee ;
    - `4.8 Gio` si elle est critique ;
  - le controleur de pression runtime utilise la meme reserve samplee au startup ;
  - le contrat de couche reste immutable pendant une generation : pas de resize vers le haut en
    live, pas de reallocations en boucle ; en pression critique soutenue, drain/restart propre.

Correctif wrappers Fabi :

- `fabi-cli/dev` pousse :
  `245acc710b27eca99c63c42898672e71df00bd73` —
  `fix: defer host memory reserve to runtime`
  - le CLI n'injecte plus `PARALLAX_SYSTEM_RESERVE_GB` par defaut ;
  - la reserve VRAM dediee CUDA `PARALLAX_CUDA_SYSTEM_RESERVE_GB` reste posee ;
  - un override explicite herite du shell reste respecte.
- `fabi-IDE/main` en cours dans ce bloc :
  - meme contrat cote `fabi-swarm/src/node/fabi-worker-tuning.ts` ;
  - `fabi-swarm/ARCHITECTURE.md` mis a jour : la reserve RAM host appartient au runtime
    adaptatif, pas au wrapper IDE.

Validation :

- engine :
  - `pytest tests/test_memory_budget.py tests/test_server_info_memory.py -q` → `14 passed` ;
  - `pytest tests/scheduler_tests/test_layer_allocation.py tests/scheduler_tests/test_scheduler.py tests/test_rpc_connection_handler.py tests/test_memory_budget.py -q`
    → `78 passed` ;
- IDE :
  - `yarn --cwd fabi-swarm test` → `19 passed` ;
- CLI :
  - `bun test src/swarm/worker.test.ts` depuis `packages/opencode` → `30 passed` ;
  - hook de push `bun turbo typecheck` → `4 successful`.

Effet attendu :

- Fabi utilise davantage la RAM disponible sur Mac 16 Gio quand le systeme est vert ;
- si le poste est vraiment sous pression, il reste standby au lieu de tuer le desktop ;
- Windows/Linux suivent le meme chemin runtime via `psutil.available` ;
- CUDA continue d'etre gere par `cudaMemGetInfo` + reserve VRAM dediee, independamment de la RAM
  host.

TODO immediate actualisee :

1. publier/rebuilder une release runtime qualifiee contenant `a7ad182`, puis installer sur Mac
   mini et PC RTX ;
2. relancer le test Mac courant/IDE pour comparer l'annonce memoire avec l'ancien cas
   `3.86 Gio available / 6.44 Gio reserve` ;
3. finir le vrai E2E UI visuel ;
4. reprendre NAT hors Tailscale ;
5. ensuite failover/replique.

#### Ajustement seuil de securite RAM, 21 juillet 2026

Apres relecture des patterns OS/orchestrateurs, le premier patch `a7ad182` restait trop base sur
un pourcentage de machine (`20/25/30 %`). Pour des Macs 8/16 Gio, ce modele garde encore trop de
memoire hors allocation et peut empecher toute contribution utile.

Sources/references du raisonnement :

- Apple : la pression memoire depend de la memoire libre, du swap, de la wired memory et du file
  cache ; il faut raisonner en pression/disponibilite, pas en RAM physique brute ;
- Linux : `MemAvailable` est l'estimation de ce qu'une nouvelle application peut prendre sans
  swapper ;
- Windows : les notifications de ressource memoire servent a reduire le working set quand la
  disponibilite baisse ;
- Kubernetes : les decisions sous pression utilisent des seuils `memory.available`, par exemple
  `memory.available<10%` ou une valeur absolue, pas une reserve proportionnelle agressive.

Decision produit :

- renommer mentalement `system_reserve_bytes` en seuil de securite disponible :
  "laisser au moins X Gio au systeme apres allocation" ;
- ne pas grossir fortement ce seuil avec la pression ; si le seuil est franchi, on drain/standby
  via le controleur de pression ;
- paliers par taille machine :
  - 8-10 Gio : normal `1.25 Gio`, eleve `1.5 Gio`, critique `2 Gio` ;
  - 16-20 Gio : normal `2 Gio`, eleve `2.5 Gio`, critique `3 Gio` ;
  - >20 Gio : normal `max(3 Gio, 10%)` cap `8 Gio`, eleve `max(4 Gio, 12.5%)` cap `10 Gio`,
    critique `max(5 Gio, 15%)` cap `12 Gio`.

Effet mesure sur les machines actuelles avec cette version :

- Mac actuel 16 Gio :
  - disponible `3.97 Gio`, pression elevee `24.8 %` ;
  - ancien fixe : reserve `6.00 Gio`, usable `0.00 Gio` ;
  - nouveau seuil : floor `2.50 Gio`, usable `1.47 Gio`.
- PC Windows 31.94 Gio :
  - disponible `18.10 Gio`, pression normale `56.7 %` ;
  - ancien fixe : reserve `8.00 Gio`, usable `10.00 Gio` ;
  - nouveau seuil : floor `3.19 Gio`, usable `15.00 Gio`.

Validation locale apres ajustement :

- engine :
  `pytest tests/test_memory_budget.py tests/test_server_info_memory.py tests/scheduler_tests/test_layer_allocation.py tests/scheduler_tests/test_scheduler.py tests/test_rpc_connection_handler.py -q`
  -> `79 passed` ;
- IDE : `yarn --cwd fabi-swarm test` -> `19 passed` ;
- CLI : `bun test src/swarm/worker.test.ts` depuis `packages/opencode` -> `30 passed`.

#### Decision d'architecture pour des milliers de workers, 21 juillet 2026

La comparaison de Parallax et Petals est maintenant formalisee dans
[`SWARM-SCALE-PETALS-DESIGN.md`](./SWARM-SCALE-PETALS-DESIGN.md). Ce document est une cible de
conception, pas une validation d'implementation.

Decision : conserver Parallax comme plan de donnees moderne (MLX, vLLM/SGLang, KV pagine,
continuous batching et activations P2P), mais construire un control plane Fabi inspire des
mecanismes prouves de Petals pour supporter beaucoup de workers et de model swarms : catalogue
de spans par leases, pipelines stables, builders/standby/replicas, preservation permanente de
la couverture, hysteresis, routes par requete, epochs/fencing et failover par replay.

Le document precise aussi l'evolution structurante a etudier : separer les couches dont les
poids sont charges (`hosted_span`) de la sous-plage executee pour une route
(`effective_span`). Cette capacite permettrait a terme d'utiliser les recouvrements sans
recharger les poids, mais exige des changements qualifies dans MLX, vLLM/SGLang, le KV et le
protocole. Elle ne doit pas etre simulee uniquement dans le routeur actuel.

## Repartition tardive, mode reseau public et correction du forwarding, 21 juillet 2026

Cette section est la source de verite la plus recente pour le laboratoire. Le scheduler et les
deux workers tournent sur le candidat moteur :

- `fb2b0219d14710b4ded98c0f09e364cbb7462715` —
  `fix: forward after standby layer assignment` ;
- scheduler VPS reconstruit depuis ce SHA exact ; label OCI
  `org.opencontainers.image.revision` verifie ;
- candidat installe sous `runtime-candidates/fb2b021/parallax-src` sur le Mac mini et Windows ;
- SHA-256 de `src/parallax/p2p/server.py` identique sur les deux machines et au checkout local :
  `0faf2f824764c40f1438d25bc07afdc0302ee5f07f775ba7e189c62dbe91ee55`.

### Repartition d'un worker arrive apres bootstrap

L'allocateur DP upstream minimise d'abord le nombre de stages. Quand le Mac, capable d'heberger
le frontend et tout le modele, est disponible au bootstrap, il peut donc produire seul une
pipeline valide. Le RTX plus rapide mais incapable d'heberger le frontend etait alors laisse en
standby sans nouvelle reconsideration.

Deux correctifs moteur precedents ont rendu ce chemin explicite et borne :

- `1814fd65b98d6005eb53888128db9fa378a38553` —
  `fix: drain late worker repartitioning` : reconfiguration globale seulement apres drain,
  frontiere exacte, fencing admission/inflight, rollback et plan RTT/roofline ;
- `e78daf6b9bfbb6e1127666ea3dbe35381299ba86` —
  `fix: reconsider workers skipped at bootstrap` : un worker valide ignore au bootstrap est
  place une seule fois dans la file du rebalance draine ; les variations de telemetrie ou de
  memoire ne declenchent pas de reallocations permanentes.

Validation locale avant laboratoire :

- apres `e78daf6` : `400 passed, 6 skipped` ;
- apres `fb2b021` : `403 passed, 6 skipped` ;
- Ruff sur les fichiers modifies : vert ; `git diff --check` : vert.

### Cause exacte de la generation suspendue Windows-first

Le test Windows-first a revele un bug Parallax upstream qui n'apparaissait pas dans l'ancien
couple stable `[0,4) -> [4,28)` :

1. Windows rejoignait seul, correctement en standby, avec une allocation `[None,None)` ;
2. a l'arrivee du Mac, le scheduler calculait automatiquement Mac `[0,1)` puis RTX `[1,28)` ;
3. `GradientServer` mettait a jour ses propres bornes, mais le
   `TransformerConnectionHandler` long-lived gardait la copie initiale `[None,None)` ;
4. lors du premier `rpc_pp_forward`, la telemetrie optionnelle `send_notify()` evaluait
   `block_end_index - block_start_index`, donc `None - None` ;
5. l'exception etait avalee et le RPC renvoyait quand meme un faux succes. Le Mac avait donc
   termine son RPC P2P, mais le multipart n'avait jamais ete place dans la socket locale du
   vLLM Windows.

Preuve du log par processus Windows avant correction :

```text
Error in rpc_pp_forward: unsupported operand type(s) for -: 'NoneType' and 'NoneType'
  File ".../p2p/server.py", line 107, in send_notify
    "total_blocks": block_end_index - block_start_index
```

Cela explique pourquoi les anciennes generations reussissaient : Windows recevait auparavant
`[4,28)` des son join initial, donc le handler RPC etait construit avec des bornes valides. Ce
n'etait ni une limite vLLM a une couche, ni un probleme RAM, ni une panne du lien Mac/RTX.

Correction `fb2b021` :

- une notification absente retourne avant tout calcul de span ;
- une notification configuree mais sans span est ignoree proprement ;
- l'enqueue locale des activations est le chemin donnees prioritaire et se fait avant la
  telemetrie ;
- une erreur d'enqueue n'est plus transformee en faux succes RPC ;
- le handler long-lived recoit atomiquement les nouvelles bornes a chaque changement de contrat ;
- trois tests de regression couvrent le standby sans span, la mise a jour dynamique puis
  forwarding, et la propagation d'une erreur d'enqueue.

Les sources primaires relues avant correction sont le code `GradientHQ/parallax` courant, ses
issues/PR, la documentation PyZMQ (contexts thread-safe, sockets non thread-safe) et la spec
ZeroMQ PUSH/PULL. L'upstream possede le meme ordre `send_notify` puis enqueue et ne contient pas
de correction pour le handler cree avant allocation. Le choix retenu conserve son plan de
donnees, mais rend la telemetrie strictement non bloquante.

### Matrice d'ordre de join qualifiee sur `fb2b021`

**Windows puis Mac** :

- Windows seul : cluster `waiting`, `frontend_nodes=0`, contexte routable `0` ;
- arrivee Mac : allocation automatique Mac `[0,1)` -> RTX `[1,28)` ;
- premiere generation post-correctif : HTTP 200, premier octet `4.801 s`, total `7.724 s` ;
- generation SSE structuree chaude : sentinelle exacte `FABI-FB2B021-SSE-OK`, TTFT contenu
  `0.853 s`, total `2.480 s` ;
- prefill CUDA observe sur le RTX : `191.378 ms` pour le second prompt.

**Mac puis Windows** :

- Mac seul : pipeline `[0,28)`, contexte mesure `37888`, chunked prefill `1024` ;
- arrivee RTX : rebalance draine automatique vers Mac `[0,1)` -> RTX `[1,28)` ;
- sentinelle exacte `FABI-FB2B021-MAC-FIRST-OK` ; HTTP 200 ; TTFT contenu `5.888 s`,
  total `7.608 s` ;
- aucune plage manuelle n'a ete fournie dans les deux scenarios.

Etat apres generations :

- cluster `available`, contexte routable `40960` ;
- RTX : capacite KV mesuree `63680` tokens, blocs `16` ;
- Mac : capacite KV mesuree environ `1.59 M` tokens, blocs `32` pour son shard d'une couche ;
- reservations KV `0` sur les deux, `max_running_request=0` ;
- direct peers reciproques.

### Portee exacte du test reseau public

Les nouveaux launchers de laboratoire `mac-worker-public-nat.sh` et
`windows-worker-public-nat.ps1` n'injectent aucune adresse Tailscale ni aucun pair prive. Ils
utilisent les relays/bootstrap officiels Lattica et DCUtR. Les observations sont :

- chaque worker rejoint le scheduler par l'IPv4 publique du VPS
  `37.59.98.16/udp/18080/quic-v1`, lien qualifie direct ;
- le trafic Mac/RTX a ete etabli directement sur le LAN local
  `192.168.10.82 <-> 192.168.10.29` ;
- aucune adresse `100.x` n'a servi de pair explicite au produit ;
- Tailscale reste cependant installe comme interface sur les machines, et mDNS journalise des
  erreurs sans impact sur cette interface ;
- ce test prouve donc le mode sans pair Tailscale explicite et le discovery meme-LAN. Il ne
  prouve pas encore le hole punching entre deux NAT independants.

Le helper `tools/lab-worker-control.sh` gere desormais `tailscale|public`, un candidat moteur
explicite, `screen` persistant sur macOS et une tache planifiee Windows sans limite d'execution.
Les launchers activent aussi `PARALLAX_PROCESS_LOG_DIR` avec un identifiant de session unique :
c'est ce qui a permis d'extraire la vraie trace Windows au lieu de se fier au stdout agrege.

### Etat Git pousse apres qualification

- `swarm-engine/codex/dynamic-dp-product` :
  `fb2b0219d14710b4ded98c0f09e364cbb7462715` ;
- `fabi-cli/dev` : `7b33cb048` — `fix: allow long vLLM cold starts` ; test cible
  `worker.test.ts` : `30 passed` ; hook de push TypeScript : `4 successful` ;
- `fabi-IDE/main` : `1f5bc97` — `tools: qualify public swarm lab workflows` ; tests
  `fabi-swarm` : `19 passed` ; syntaxe shell et `git diff --check` : verts.

Le launcher PowerShell a ete valide fonctionnellement par son deploiement puis par les deux
ordres de join sur le PC Windows. Aucun parseur PowerShell local n'etait disponible sur le Mac ;
ne pas presenter cette validation d'execution comme un lint statique separe.

TODO immediate actualisee :

1. executer le gros contexte OpenCode cible, environ `12 220` tokens d'entree + `4 096` reserves,
   et consigner TTFT, debit, RAM/VRAM, KV et rejet au-dessus de la limite ;
2. finir le vrai E2E UI visuel : modele, connexion, gate contribution, OpenCode/SSE, outils,
   permissions, abort et changement de modele ;
3. faire le vrai test entre deux reseaux/NAT independants, sans route `100.x`, avec preuve
   direct/relay et mesure du lien ;
4. ajouter une troisieme replique puis tester kill prefill/decode, erreur sans replique,
   reroute, epoch/fencing et replay KV ;
5. seulement ensuite concevoir login/device pairing multi-machine.

## Gros contexte sur repartition tardive `fb2b021`, 21 juillet 2026

Le gros contexte a ete rejoue sur le cluster public de laboratoire apres qualification des deux
ordres de join. Topologie active : Mac mini M4 `[0,1)` puis RTX 4080 SUPER `[1,28)`, scheduler et
workers sur `fb2b0219d14710b4ded98c0f09e364cbb7462715`, contexte routable `40960`.

Le prompt de type OpenCode contient du contexte TypeScript repetitif et une instruction finale.
Il a ete calibre avec le vrai tokenizer local `Qwen/Qwen3-1.7B` et son chat template : exactement
`12 220` tokens avant envoi. Il ne s'agit pas d'une conversion caracteres/tokens estimee.

Resultats SSE avec `max_tokens=4096` :

- premiere passe froide : HTTP 200, premier octet `7.239 s`, premier contenu `7.440 s`, fin
  `10.683 s`, `34` chunks et `31` tokens de contenu. La sentinelle attendue est presente, mais ce
  premier generateur avait place ses tokens de calibration apres l'instruction ; le modele a donc
  aussi reproduit des `x`. Ce n'est pas une panne du swarm et ce resultat n'est pas presente comme
  une sentinelle exacte ;
- passe longue chaude, avec padding deplace avant l'instruction : HTTP 200, premier octet
  `1.327 s`, TTFT contenu `1.536 s`, fin `28.975 s`, `273` chunks, `270` tokens de contenu,
  aucun token de raisonnement et sentinelle finale `FABI-FB2B021-BIGCTX-LONG-OK` presente ;
- debit decode utile de la passe longue : environ `9.84 tok/s`, mesure sur la fenetre entre le
  premier contenu et la fin ;
- le TTFT long est chaud parce que la premiere requete venait de remplir le cache de prefixe avec
  le meme gros contexte. Conserver `7.440 s` comme mesure froide et `1.536 s` comme mesure chaude,
  sans les comparer comme deux topologies differentes.

Reservations et admission :

- demande logique : `12 220 + 4 096 = 16 316` tokens ;
- reservation observee pendant `63` echantillons sur les deux shards : `16 320` tokens chacun,
  soit l'arrondi exact au bloc KV de `16` impose par la route ;
- avec `max-batch-size=1`, l'unique slot est occupe pendant le flux. Le champ historique
  `max_running_request` de `/cluster/status_json` vaut alors `0` car il expose en realite la
  capacite de requetes **restante**, pas le nombre de requetes actives ; le statut `waiting`
  pendant l'occupation est donc attendu ;
- trois secondes apres la fin : cluster `available`, reservations `[0,0]`, capacites restantes
  Mac `1 595 136`, RTX `63 680` tokens.

Mesures de pression pendant la passe longue :

- Mac mini : minimum `3 705 339 904` octets disponibles, pression psutil maximale `78.4 %`,
  RSS cumule des processus runtime maximal `3 401 105 408` octets, swap utilise `0` ;
- PC Windows : minimum `26 066 522 112` octets de RAM hote disponibles, pression maximale
  `24.0 %`, RSS runtime visible maximal `312 635 392` octets ;
- RTX 4080 SUPER : `14 403 MiB` VRAM utilises au maximum, `1 645 MiB` libres au minimum, pic GPU
  echantillonne `28 %`, puis `0 %` a la fin. Le pool GPU reste prealloue entre les requetes ; cette
  stabilite n'est pas une fuite KV.

Test de frontiere : un prompt calibre a `36 865` tokens avec `4 096` de sortie demande `40 961`,
soit exactement un token au-dessus du contrat. Reponse HTTP 400 en `0.752 s`, code
`context_length_exceeded`, message annoncant correctement le maximum `40 960`, puis reservations
toujours `[0,0]`.

TODO immediate actualisee :

1. finir le vrai E2E UI visuel depuis le clone local complet : selection modele, connexion,
   gate contribution, OpenCode/SSE, outils, permissions, abort et changement de modele ;
2. faire le vrai test entre deux reseaux/NAT independants, sans route `100.x`, avec preuve
   direct/relay et mesure du lien ;
3. ajouter une troisieme replique puis tester kill prefill/decode, erreur sans replique,
   reroute, epoch/fencing et replay KV ;
4. concevoir ensuite login/device pairing multi-machine.

## E2E IDE package, modes natifs et abort workspace, 22 juillet 2026

Le clone local complet `/Users/noagiannone/Documents/fabi-ide` a ete compile puis package avec
Node 22. Le changement code est `1603261` (`fix: preserve native chat lifecycle`). L'application
testee est `electron-app/dist/mac-arm64/Fabi.app`; elle n'est pas signee, ce qui est attendu pour
ce build de developpement.

### Cause des regressions UI et correction

Deux integrations locales contournaient le cycle de vie natif de Theia :

- le selecteur Agent/Ask etait rendu par React, puis deplace physiquement dans un autre parent
  DOM avec `insertBefore`. Au prochain rendu, React tentait de retirer le noeud de son ancien
  parent et levait `NotFoundError: Failed to execute 'removeChild' on 'Node'` ;
- quand le scheduler mono-slot passait temporairement de `ready` a `waiting` pendant notre
  propre requete, Fabi remplacait l'input entier par l'ecran de connexion. Cela detruisait
  l'editeur Monaco, le bouton natif `Cancel (Esc)` et l'etat `receivingAgent`; au remontage,
  Agent/Ask revenait donc au mode par defaut.

La correction suit les contrats de Theia 1.72.2 relus dans les sources installees :

- `ChatAgent.modes` expose maintenant directement `build = Agent` et `plan = Ask` ; Theia place
  le choix dans `request.modeId`, puis Fabi ne transmet a OpenCode que ces deux valeurs connues ;
- aucun noeud React n'est deplace manuellement ; le selecteur natif gere focus, clavier, portal
  et cycle de vie ;
- avant la premiere admission scheduler, l'input reste entierement absent ; apres cette premiere
  admission, son montage devient stable pour la vie du chat. Une perte de disponibilite le rend
  toujours read-only et bloque l'envoi, mais ne detruit plus brouillon, mode ou annulation ;
- le statut `Generation...` depend du tour OpenCode local, pas de la capacite restante du
  scheduler mono-slot ;
- l'abort OpenCode recoit maintenant le meme `directory` que le prompt. Sans ce scope, l'endpoint
  visait l'instance OpenCode par defaut et pouvait laisser la vraie generation workspace active ;
- le service de nommage Theia est neutralise pour Fabi : aucun `LanguageModel` Theia n'est
  volontairement enregistre, donc le nom derive de la requete est conserve sans lancer une
  inference de fond impossible ni journaliser `No language model found for chat session naming`.

Avant implementation, les sources primaires consultees ont ete le code officiel Theia du widget
de chat/selecteur et le code/documentation OpenCode 1.15 pour les primary agents, permissions,
scope workspace et endpoint d'abort. Aucun timeout arbitraire n'a ete ajoute.

### Validation du package reel

Gate et connexion :

- avec un credential local ne correspondant pas aux workers du labo, l'UI affiche
  `Contribution non reconnue` et ne monte aucun editeur ;
- avec le compte du Mac mini/RTX, `Qwen3-1.7B - Pret` apparait et l'input natif est monte ;
- le scheduler reste sur `fb2b021`, pipeline Mac mini `[0,1)` puis RTX `[1,28)`, contexte
  routable `40960`. Le worker du MacBook apparait en troisieme node `waiting`, sans couche ni
  reservation ; il ne fait pas partie de la route active.

Modes et streaming :

- requete UI en `Ask`, sentinelle assistant exacte `FABI-ASK-PERSIST-FINAL-OK` ;
- l'API OpenCode confirme `agent: plan` sur le message utilisateur et le message assistant ;
- apres la transition `waiting -> ready`, le selecteur affiche toujours `Ask`, un seul editeur
  est visible et aucune erreur page/console n'est remontee.

Permissions/outils :

- requete UI `Agent` demandant obligatoirement `bash pwd` ;
- carte `Autoriser/Refuser` visible et tour toujours annulable avant decision ;
- apres `Autoriser`, OpenCode expose un part `tool=bash`, `state=completed`, sortie exacte
  `/Users/noagiannone/Documents/NebuleAir_WiFi_V4`, puis la sentinelle
  `FABI-PERMISSION-PACKAGED-OK` ;
- l'UI revient a `Pret`, reste en `Agent`, conserve un seul editeur et ne produit aucune erreur
  page/console.

Abort :

- une generation longue a affiche l'action Theia native `Cancel (Esc)` en `11 ms` lors d'une
  premiere passe courte ;
- passe avec reservation effectivement observee : scheduler `waiting`, reservations KV
  `[17696,17680,0]` sur Mac mini, RTX et node local waiting ;
- clic UI sur Cancel, disparition de l'action et retour des reservations a `[0,0,0]` en environ
  `100 ms`, scheduler `available`, barre `Pret`, mode `Ask` et editeur toujours monte ;
- aucune erreur page/console.

Selection de modele :

- la liste reelle s'ouvre depuis l'UI et affiche Qwen3-1.7B (`3 nodes` annonces, dont un waiting)
  puis Qwen3-8B, Qwen3-Coder-30B, Qwen3-Coder-480B et GLM-4.5 a `0 node` ;
- la selection/connexion du modele actif est qualifiee. Un changement effectif vers un second
  modele ne l'est pas, car aucun second swarm n'est en ligne ; ne pas presenter l'ouverture de
  la liste comme un test de changement de modele reussi.

Validation locale finale :

- `yarn --cwd fabi-swarm test` : `25 passed` ;
- `yarn --cwd fabi-swarm build` : OK ;
- `yarn build:electron` : OK ;
- package Node 22 `electron-app package:dir` : OK ;
- `git diff --check` : OK.

TODO immediate actualisee :

1. priorite produit suivante : vrai test entre deux reseaux/NAT independants, sans route
   `100.x`, avec preuve direct/relay et mesure du lien ;
2. mettre temporairement un second swarm leger en ligne et qualifier un vrai changement de
   modele aller/retour dans l'IDE ;
3. ajouter une troisieme replique puis tester kill prefill/decode, erreur sans replique,
   reroute, epoch/fencing et replay KV ;
4. concevoir ensuite login/device pairing multi-machine.

## Qualification entre deux NAT independants, 22 juillet 2026

Cette qualification separe volontairement deux questions qui ne doivent pas etre confondues :

1. un client Fabi situe sur un autre reseau peut-il appeler le scheduler public puis recevoir une
   generation executee par une pipeline Parallax P2P normale ?
2. deux **workers** places derriere ces deux NAT precis arrivent-ils a faire passer leurs
   activations directement apres rendez-vous relay et DCUtR ?

Le premier cas est valide. Le second a echoue proprement sur cette paire de reseaux et constitue
une limite produit reelle a traiter, pas une generation reussie a sur-vendre.

### Sources relues et contrat exact de Lattica

Avant de modifier ou tester, les sources primaires suivantes ont ete relues :

- `GradientHQ/parallax` courant et sa construction Lattica
  `with_relay_servers(...).with_dcutr(True)` ;
- `GradientHQ/lattica` `v1.0.21`, y compris `network/core.rs`, `behaviour.rs`, le detecteur NAT
  STUN et les PR `#6` (direct connection check) / `#10` (NAT type check) ;
- la specification officielle libp2p DCUtR et la documentation hole punching libp2p.

Le contrat important de Lattica `1.0.21` est confirme dans le code : le circuit relay sert au
rendez-vous et au declenchement DCUtR, mais `ensure_direct_connection()` refuse un RPC lorsque
seule une adresse `/p2p-circuit` reste disponible avec l'erreur exacte
`Only relayed connection available for peer ...`. Le relay public n'est donc pas un fallback de
transport pour les activations Parallax dans cette version.

Le test STUN `is_symmetric_nat()` compare des mappings **UDP**. Il ne peut pas, a lui seul,
prouver que toute tentative TCP/QUIC echouera. Le commit moteur
`e7537bff449a4cd3ae3e282dd78bb842722e59bf` (`fix: qualify connectivity after NAT preflight`)
remplace donc les trois `exit(1)` anticipes par un avertissement. La securite n'est pas affaiblie :
seul un vrai RPC direct reussi peuple `direct_peer_ids`, et le scheduler continue de refuser une
pipeline dont le lien n'est pas qualifie. Le statut expose aussi `rtt_to_nodes_ms`, telemetrie deja
mesuree mais jusque-la invisible, sans publier les adresses IP des contributeurs.

Validation moteur avant deploiement : Ruff vert, `git diff --check` vert,
`405 passed, 6 skipped` sur la suite complete.

### Topologie effectivement testee

- MacBook actuel : LAN `10.0.1.54`, IPv4 publique `193.252.54.10`, sortie via `en1` et gateway
  `10.0.1.1` ; client Tailscale installe mais `Self.Online=false` pendant tout le test ;
- Mac mini et PC RTX : LAN `192.168.10.82` et `192.168.10.29`, IPv4 publique commune
  `2.54.142.226` ;
- scheduler VPS : IPv4 publique `37.59.98.16`, conteneur reconstruit et label OCI verifie sur
  `e7537bf` ;
- Mac mini et Windows charges depuis les candidats exacts
  `runtime-candidates/e7537bf/parallax-src` ;
- aucune adresse initiale ou annoncee `100.x` n'a ete fournie a Parallax.

Le routage du MacBook vers le VPS et vers l'IPv4 publique du LAN distant passait par `en1`, pas
par Tailscale. Les clefs SSH via le VPS ont uniquement servi au pilotage et a la collecte du labo ;
elles ne font pas partie du chemin produit.

### Test worker inter-NAT strict : relay etabli, direct DCUtR non obtenu

Pour retirer toute ambiguite same-LAN, mDNS a ete force a `0` sur les workers pendant cette phase.
Windows a rejoint en premier, puis le MacBook actuel :

- Windows seul a rejoint directement le scheduler public en QUIC et est reste standby, comme
  attendu sans frontend ; RTT worker -> scheduler environ `87 ms` ;
- l'arrivee du MacBook a produit automatiquement MacBook `[0,4)` puis RTX `[4,28)` ;
- les deux workers ont bien obtenu des connexions `/p2p-circuit` par les relays Lattica ;
- pendant plus de deux minutes, chaque probe a retourne
  `Only relayed connection available for peer ...` ;
- `direct_peer_ids=[]` des deux cotes, cluster `waiting`, aucune requete envoyee sur cette route.

L'ajout du Mac mini, toujours en mode strict, a confirme le meme comportement entre le MacBook et
le LAN distant. Le scheduler pouvait poser une allocation avant reception de la telemetrie directe,
mais le statut global restait `waiting` une fois le lien refuse. Il n'a pas automatiquement cherche
un autre sous-graphe connecte apres ce verdict. C'est un second chantier identifie : la selection
d'allocation doit devenir consciente du graphe de connectivite qualifie et se recalculer de facon
bornee lorsqu'un lien reste relay-only.

Ce resultat ne prouve pas que DCUtR echoue sur tous les NAT. Il prouve exactement que, sur cette
paire de reseaux au 22 juillet, le rendez-vous relay fonctionne mais que le direct requis par
Lattica `1.0.21` n'est pas obtenu. Le fail-closed Fabi evite correctement une generation suspendue
ou corrompue.

### E2E Parallax normal depuis le second reseau : valide

Les launchers ont ensuite ete remis au comportement produit hybride upstream : mDNS same-LAN et
relay/DCUtR coexistent. Apres un reset propre, Windows a rejoint en premier puis le Mac mini :

- allocation DP automatique Mac mini `[0,1)` -> RTX `[1,28)` ;
- `direct_peer_ids` reciproques ;
- socket directe observee
  `192.168.10.82:19080 -> 192.168.10.29:19080`, sans chemin `100.x` ;
- RTT P2P mesure apres stabilisation : RTX -> Mac `2.1084 ms`, Mac -> RTX `1.658792 ms` ;
- RTT workers -> scheduler public : environ `82-85 ms` ;
- cluster `available`, contexte routable `40960`, reservations finales `[0,0]`.

Depuis le MacBook actuel sur l'autre IPv4 publique, un appel SSE authentifie a ete envoye a
`https://server.undefinedstudio.fr/fabi-scheduler/v1/chat/completions`. Resultat :

- HTTP `200` ;
- contenu exact `FABI-CROSS-NETWORK-E2E-OK` ;
- premier evenement SSE `6.593 s`, TTFT contenu `6.651 s`, total `7.970 s` ;
- `14` chunks SSE ;
- `79` echantillons de statut, reservations maximales observees `112` puis `128` tokens sur les
  deux shards, et retour a zero ;
- appel de statut public depuis ce Mac : connexion TCP `39.9 ms`, TLS `80.6 ms`, TTFB
  `120.4 ms`.

Interpretation precise : le prompt client traverse HTTPS vers le scheduler public ; il n'a pas
besoin d'etre P2P. Les activations de la pipeline, elles, passent bien sur le lien P2P direct
Mac mini/RTX qualifie ci-dessus. Ce test valide donc la base Parallax/Fabi utilisee normalement
depuis un autre reseau, tout en conservant le resultat negatif du worker inter-NAT.

### Outillage et etat laisse au labo

Les launchers public enregistrent maintenant `RUST_LOG=info` par defaut afin que les preuves
Lattica `is_direct` soient disponibles. `tools/lab-worker-control.sh` rend aussi le demarrage Mac
idempotent : une seconde commande `start` ne cree plus un deuxieme `screen` qui echoue ensuite sur
`Address already in use`.

Etat final laisse en fonctionnement :

- scheduler `parallax-scheduler` sur `e7537bf` ;
- un worker Mac mini et un worker Windows sur le meme candidat ;
- pipeline `[0,1) -> [1,28)` disponible, direct peers reciproques, aucune reservation ;
- aucun worker de test actif sur le MacBook actuel.

TODO immediate actualisee :

1. concevoir le chemin reseau universel : qualifier d'autres types de NAT puis etudier un fallback
   relay explicite et borne (probablement relays Fabi regionaux, quotas, authentification, mesure du
   cout/debit) au lieu de simplement supprimer la verification directe de Lattica ;
2. rendre l'allocation/reallocation consciente du graphe de liens directs qualifies afin qu'un
   worker relay-only ne bloque pas une pipeline alternative valide ;
3. mettre temporairement un second swarm leger en ligne et qualifier un vrai changement de modele
   aller/retour dans l'IDE ;
4. ajouter une troisieme replique puis tester kill prefill/decode, erreur sans replique, reroute,
   epoch/fencing et replay KV ;
5. concevoir ensuite login/device pairing multi-machine.

## Transport universel Iroh, RPC produit et fallback relay, 22 juillet 2026

Le chantier ouvert par le resultat negatif DCUtR/Lattica entre les deux NAT a ete traite comme
un remplacement de transport borne, pas comme un contournement de `ensure_direct_connection()`.
Le commit moteur exact est
`961f64ad81fdb8db72e0f54c82955666ee801647` (`feat: add relay-capable Iroh runtime transport`),
pousse sur `codex/dynamic-dp-product`.

Le labo modele reste volontairement sur le rollback qualifie `e7537bf` : scheduler VPS, Mac mini
`[0,1)` et RTX `[1,28)` sont toujours disponibles sur Lattica. Iroh est opt-in via
`FABI_NETWORK_TRANSPORT=iroh` tant que les wheels natives des deux workers et une generation
modele complete ne sont pas qualifiees. Aucun succes du harness reseau ci-dessous ne doit etre
presente comme une generation Qwen deja passee sur Iroh.

### Recherche primaire et decision

Les sources relues avant implementation sont le code/documentation officiels Iroh `v1.0.3`,
`iroh-relay`, PyO3 `0.27.2`, Maturin, Petals/Hivemind et la documentation NAT/DERP de Tailscale.
Les principes retenus sont :

- Iroh fournit des endpoints Ed25519 authentifies, QUIC, hole punching, fallback relay chiffre et
  upgrade relay vers direct sans changer l'identite applicative ;
- Tailscale valide le modele operationnel « relay disponible immediatement, direct prefere des
  qu'il gagne » ;
- Petals/Hivemind conserve un pair joignable par relay et penalise son cout/debit au lieu de le
  declarer hors ligne ;
- le relay circuit Lattica/libp2p actuel reste adapte au rendez-vous/DCUtR, pas au fallback de
  grosses activations. Supprimer son refus relay-only aurait conserve le mauvais data plane.

Architecture detaillee et limites : `swarm-engine/docs/fabi-network-architecture.md`.

### Relay Iroh officiel qualifie sur le VPS

Le binaire officiel `iroh-relay v1.0.3` tourne sur le VPS avec TLS existant, authentification
Bearer, limites par client, QUIC address discovery et metriques locales :

- relay HTTPS TCP `4443` ;
- captive portal HTTP TCP `4442` ;
- address discovery QUIC UDP `7842` ;
- metriques liees a `127.0.0.1:9091` ;
- secret dans un fichier systemd root `0600`, jamais commite ni place sur la ligne de commande.

Le template systemd/config et la documentation sont dans `deploy/iroh-relay`. Le source officiel
`iroh-relay 1.0.3` confirme que `IROH_RELAY_ACCESS_TOKEN` remplace en memoire la liste
`access.shared_token` du TOML. Le template commite ne contient donc aucun credential.

### Qualification entre NAT et chemins observes

Le harness natif Rust a ete compile sur le Mac actuel, le Mac mini et Windows RTX. Resultats reels
avec payload BLAKE3 verifie :

- Mac actuel -> Mac mini, NAT independants, relay force : trois transferts de `64 MiB`, environ
  `1.10` a `1.67 MiB/s` ;
- le meme couple en mode automatique, Tailscale coupe sur le Mac actuel, est reste relay-only :
  le fallback reste donc utilisable lorsque le hole punching ne gagne pas sur cette paire ;
- Mac actuel -> Windows RTX, relay force : trois transferts de `16 MiB`, environ `1.16` a
  `1.58 MiB/s` ;
- Windows, `100 x 4 KiB` representatifs du decode : RTT moyen environ `130.7 ms`, p95
  `172.3 ms` ;
- annulation d'un stream `64 MiB` autour de `101 ms`, puis second `64 MiB` reussi sur la meme
  connexion QUIC ;
- deux endpoints locaux en mode automatique, connus uniquement par endpoint ID + URL relay, ont
  echange leurs candidats puis promu un chemin direct selectionne `10.0.1.54:51020`, RTT environ
  `0.217 ms`, tout en conservant le relay comme fallback. Aucune IP brute n'a ete publiee par le
  scheduler.

Un cas de backpressure non couvert par le premier harness a ensuite ete trouve pendant la revue :
si la file Python de chunks etait saturee, le client pouvait envoyer STOP_SENDING mais le serveur
restait bloque dans un write QUIC avant de liberer son generateur. Le correctif suit l'API QUIC
officielle `SendStream::stopped()` et la poll en concurrence avec chaque ecriture. Qualification
live finale sur relay force : generateur distant ferme en environ `22 ms`, chemin selectionne
`relay`, puis RPC unary reussi sur la meme connexion. Le scenario est conserve comme test
d'integration opt-in `tests/test_fabi_network_live.py` ; il ne lit le secret que depuis un env ou
un fichier explicite et est skippe dans la suite normale.

### Runtime RPC livre

Le nouveau crate `native/fabi-network` fournit :

- identite persistante creee atomiquement avec permissions owner-only sur Unix ; une cle corrompue
  echoue sans regeneration silencieuse ;
- protocole `FABINET1` versionne, tailles bornees a verifier avant allocation et digest BLAKE3 ;
- cache de connexions, unary RPC, stream RPC, deadline, reset d'un seul stream, backpressure et
  telemetrie des chemins direct/relay/RTT ;
- extension PyO3 ABI stable Python 3.10+, packagee par Maturin ;
- codecs applicatifs explicites MessagePack, protobuf, bytes et null. `pickle` est interdit sur le
  wire, contrairement au chemin historique Lattica ;
- dispatch serveur borne et pools inbound/outbound separes : une generation longue ne monopolise
  pas les heartbeats ;
- secret relay lu soit depuis `FABI_RELAY_TOKEN`, soit depuis `FABI_RELAY_TOKEN_FILE`. Sur Unix,
  un fichier lisible par groupe/autres est refuse.

L'integration scheduler/worker/chat est stagee derriere le flag Iroh. Le scheduler central reste
la source de verite pour membership, compte, contribution, allocation et route ; aucun DHT n'est
invente. Le refit de poids/Bitswap est refuse explicitement en mode Iroh jusqu'a qualification
d'un content plane separe.

Le modele de connectivite distingue maintenant :

- `reachable_peer_ids` : RPC qualifie par direct ou relay ;
- `direct_peer_ids` : chemin Iroh selectionne direct, ou RPC direct Lattica historique ;
- `relayed_peer_ids` : RPC qualifie dont le chemin Iroh selectionne est relay.

Une route relay-only Iroh est donc eligible ; une arete inconnue/non qualifiee reste fail-closed.
Le vrai handler scheduler `node_update` a ete passe a travers le relay avec propagation
reachable/relayed. La mesure continue de debit par pair et la penalite de cout type Petals ne sont
pas encore implementees : seul le type de chemin et son RTT sont publies, et le scheduler ne doit
pas pretendre que le RTT mesure le bandwidth.

### Validations exactes du commit `961f64a`

- suite Python complete : `417 passed, 7 skipped`, un warning de depreciation Starlette/httpx
  externe ;
- test live relay opt-in : `1 passed` ;
- tests Rust : `6 passed` ;
- `cargo clippy --all-targets --features python -- -D warnings` : OK ;
- `cargo check --features python-extension` : OK ;
- wheel locale macOS arm64 ABI3 construite/installee par Maturin : OK ;
- Ruff, Black et `git diff --check` : OK ;
- RPC Python live force relay : MessagePack, protobuf, erreur distante, deadline, stream SSE,
  erreur en milieu de stream, annulation et reutilisation de connexion : OK.

### TODO immediate actualisee

1. construire les wheels Maturin **nativement** sur Mac mini et Windows RTX, les installer dans
   leurs candidats et valider import, identite, unary/stream/cancel sans changer le labo qualifie
   avant succes ;
2. basculer un candidat complet scheduler + Mac mini + RTX sur `961f64a`, charger Qwen et qualifier
   prefill, decode, SSE, abort, heartbeats, gate contribution et reservations KV sur Iroh ;
3. ajouter mesure continue throughput/loss par arete et scoring direct/relay inspire de Petals,
   avec hysteresis pour eviter les reallocations permanentes ;
4. qualifier restart worker/relay, credentials invalides, relay regional secondaire et failover ;
5. mettre temporairement un second swarm leger en ligne et qualifier le changement de modele IDE ;
6. ajouter une troisieme replique puis tester kill prefill/decode, erreur sans replique, reroute,
   epoch/fencing et replay KV ;
7. concevoir ensuite le login/device pairing multi-machine et le bootstrap de credentials relay.

## Décision Fabi Swarm Protocol v3, 23 juillet 2026

La cible à grande échelle a été réévaluée depuis les sources, sans considérer le prototype
actuel comme une contrainte de compatibilité produit. La spécification normative est maintenant
[`FABI-SWARM-PROTOCOL-V3.md`](./FABI-SWARM-PROTOCOL-V3.md). Elle remplace la cible centralisée de
`SWARM-SCALE-PETALS-DESIGN.md`, conservée comme historique.

### Sources et code relus

- Petals `22afba6` : sélection autonome des blocs, annonces DHT avec TTL, construction du graphe
  de route, admission du cache mémoire et reconstruction de session après disparition d'un
  serveur ;
- Hivemind : DHT/libp2p prévu pour des collaborations de volontaires et utilisé par Petals ;
- Parallax upstream `162354a` et son papier : allocation DP/water-filling, routes par requête,
  DHT de télémétrie et adaptation au membership ;
- Iroh `1.0.3`, iroh-blobs, IPFS Bitswap et le protocole BitTorrent pour NAT/relay, contenu
  adressé, découverte de fournisseurs et réciprocité.

La conclusion corrige la décision précédente : Petals est la meilleure référence pour la
**sémantique du control plane communautaire**, tandis que Parallax/Fabi reste la meilleure base
pour le **plan de données et l'exécution moderne**. Il ne s'agit pas de faire fonctionner deux
frameworks concurrents. Fabi doit exposer un seul protocole avec des interfaces nettes et
réutiliser les algorithmes éprouvés derrière ces interfaces.

### Architecture décidée

- un swarm et un manifeste immuable par contrat exact de modèle/quantification ;
- placement de spans autonome et stable inspiré de Petals, guidé par des cartes de déficit mais
  sans scheduler propriétaire permanent ;
- leases signées et temporaires dans un catalogue distribué ; Hivemind est le premier candidat
  à prototyper, la DHT n'étant jamais autoritaire pour les réservations ;
- route complète calculée pour chaque génération avec le DAG/DP Parallax ;
- contexte et KV dérivés de `prompt + sortie réservée` pour cette route, sans tiers global 16k ou
  32k ;
- admission locale atomique par `PREPARE/COMMIT/RELEASE` avec TTL sur chaque worker ;
- distinction `hosted_span` / `effective_span` pour utiliser une sous-plage sans reload lorsque
  le backend sait réellement le faire ;
- Iroh comme transport RPC/activations et iroh-blobs comme content plane vérifié des poids ;
- plusieurs rôles créditables : exécution, réplica, poids, relay et audit. Une machine trop petite
  pour une couche d'un modèle peut contribuer autrement ou à une variante plus légère ;
- reprise Petals enrichie par journal de tokens, epochs, fencing et commit-before-SSE Fabi.

Le scheduler monolithique actuel est destiné à être décomposé en catalogue, placement local,
route planners interchangeables, admission locale et ledger. Les services Fabi restent requis
pour identité, contribution et API OpenCode, mais les activations et l'allocation permanente ne
dépendent plus d'une instance centrale unique.

### État réel et limites

Ce changement est une décision d'architecture, pas une validation runtime. Aucun DHT v3, route
planner distribué, admission prepare/commit, effective span ou iroh-blobs n'est encore livré.
Le transport Iroh n'a toujours pas passé une génération modèle complète Mac mini + RTX ; le labo
qualifié reste sur Lattica `e7537bf`.

Le worktree moteur contient aussi un patch local non commité de recherche de contexte continu
par pipeline. Il ne doit ni être perdu ni être présenté comme la cible v3 : la cible finale est
un contexte par route. Ce patch doit être testé/isolé avant le premier chantier protocolaire.

### Prochain ordre d'implémentation

1. préserver le rollback labo et qualifier une génération complète sur Iroh ;
2. introduire les schémas versionnés `ModelManifest`, `WorkerOffer`, `SpanLease`, `RoutePlan` et
   `ReservationLease` derrière un flag ;
3. implémenter route exacte + admission `PREPARE/COMMIT` sur le registre actuel afin de valider
   les invariants avant d'ajouter la DHT ;
4. brancher l'adaptateur rust-libp2p Kademlia en shadow mode, comparer les snapshots puis tester
   expiration/partition à 1 000 workers simulés ;
5. activer placement autonome, effective spans backend par backend et planners répliqués ;
6. ajouter iroh-blobs, multi-modèles, replay/failover et reçus de contribution.

### Première tranche implémentée

Le chantier moteur est isolé dans le worktree
`/Users/noagiannone/Documents/swarm-engine-v3`, branche `codex/swarm-protocol-v3`. Le commit
`03ca5d5` (`feat: add swarm v3 contracts and local admission`) est poussé sans modifier la branche
qualifiée `codex/dynamic-dp-product` ni son patch local de contexte continu.

Cette tranche ajoute :

- contrats Pydantic stricts et immuables pour `ModelManifest`, `WorkerOffer`, `SpanLease`,
  `RoutePlan`, `ReservationLease` et `ContributionReceipt` ;
- identité de swarm déterministe et sensible au tokenizer, poids, quantification et contrats
  d'exécution ;
- géométrie KV avec arrondi exact par worker et vérification des octets ;
- validation qu'une route couvre exactement toutes les couches sans trou ni chevauchement ;
- table d'admission KV locale thread-safe avec `PREPARE`, `COMMIT`, `RENEW`, `RELEASE`, TTL,
  idempotence, rejet de conflit et fencing d'epoch ;
- libération atomique de l'ancienne réservation lorsqu'un epoch plus récent est accepté.

Validation exacte à ce jalon : `15` tests v3 ciblés verts, dont une course de deux prepares sur la même
capacité ; suite moteur complète `454 passed, 7 skipped`, avec uniquement le warning externe
Starlette/httpx déjà connu ; Ruff et `git diff --check` verts. Aucun RPC runtime, DHT ou trafic
modèle n'utilise encore ces contrats.

## Route exacte, catalogue shadow et choix DHT du 23 juillet 2026

Deux tranches supplémentaires sont poussées sur `swarm-engine`, branche
`codex/swarm-protocol-v3`, sans toucher le worktree qualifié ni ses changements locaux :

- `41b937c` — `feat: plan exact request-scoped swarm routes` ;
- `e67e704` — `feat: define soft-state discovery semantics`.

### Route planner v3 réellement implémenté

`ExactRoutePlanner` compose une couverture contiguë `[0, num_layers)` à partir d'offres et de
leases immuables. Il :

- élimine offres/leases expirées, spans non `READY`, modèles incompatibles et workers qui
  n'annoncent pas le rôle d'exécution ;
- calcule le KV exact de chaque stage après arrondi au block size propre au backend ;
- respecte la différence entre un backend `FIXED` et un backend capable de `SUBSPAN` ;
- exige une métrique Iroh vivante entre chaque stage et pour le retour tail vers head du decode ;
- score calcul mesuré, RTT, goodput, perte et coût du relay ;
- produit un résultat déterministe indépendamment de l'ordre de découverte ;
- ne considère jamais ce plan comme une réservation : le `PREPARE/COMMIT` local reste requis.

La reprise `RECOVERABLE` est volontairement refusée pour l'instant : annoncer une tolérance aux
pannes sans calculer une couverture alternative complète serait mensonger. L'algorithme actuel
n'est pas encore déclaré apte à 10 000 workers ; sa complexité et ses index seront qualifiés par
les simulations prévues.

### Port `DiscoveryStore` et mode shadow local

Le port métier de découverte et son implémentation de référence `InMemoryDiscoveryStore` sont
livrés. Cette implémentation n'est pas présentée comme un DHT. Elle fixe et teste les sémantiques
que devra respecter l'adaptateur natif :

- soft state avec TTL strict (`expires_at_ms > snapshot_time`) ;
- séquences monotones par offre et par lease, idempotence et rejet d'un rollback ;
- conservation d'un watermark après collecte d'un payload expiré, afin qu'un message retardé ne
  ressuscite pas une ancienne capacité ;
- remplacement local du span d'un worker sans modifier les autres workers ;
- snapshots immuables, cohérents et triés de façon déterministe ;
- exclusion des leases orphelines et liens dont une extrémité n'a plus d'offre vivante ;
- publication thread-safe et convergence vers la séquence la plus haute sous arrivées
  concurrentes.

### Audit Hivemind, Lattica et rust-libp2p

Sources relues à leurs états courants : Hivemind `4bd43b7`, Lattica `f63a6ec`, rust-libp2p
Kademlia `0.56` et sa spécification officielle. La conclusion modifie le candidat d'implémentation
sans modifier les principes Petals :

- Hivemind reste une excellente source pour DHT TTL, sous-clés, validation et signatures, mais
  son packaging `p2pd` courant ne fournit que Darwin/Linux amd64/arm64 et rejette Windows. Il ne
  peut donc pas être une dépendance runtime obligatoire des workers Fabi ;
- Lattica est MIT et démontre l'intégration Python/rust-libp2p Kademlia/provider records. Son
  code actuel ne doit pas être copié en bloc : le comportement actif utilise `MemoryStore`, le
  `MultiStore` persistant n'y est pas branché et son encodage d'expiration convertit actuellement
  des nanosecondes comme des secondes ;
- importer Lattica entier réintroduirait RPC, relay/DCUtR, Gossipsub et Bitswap en parallèle
  d'Iroh, ce qui recréerait deux plans de données ;
- la cible est donc un adaptateur Kademlia minimal dans le crate natif `fabi-network`, derrière
  `DiscoveryStore`. Iroh reste seul responsable des RPC, activations, chemins direct/relay et
  contenus.

La spécification normative `FABI-SWARM-PROTOCOL-V3.md` est mise à jour avec cette décision. Les
enveloppes signées devront lier l'identité device Fabi, l'EndpointId Iroh et le PeerId libp2p sans
réutiliser implicitement un même secret entre protocoles.

### Validation exacte

- `29 passed` sur contrats, réservations, routing et discovery v3 ;
- suite moteur complète : `468 passed, 7 skipped` ;
- seul warning : dépréciation externe Starlette/httpx déjà connue ;
- Ruff et `git diff --check` verts ;
- commits poussés sur `origin/codex/swarm-protocol-v3`.

Aucun paquet réseau Kademlia natif, aucune signature wire, aucune comparaison shadow avec le
scheduler central et aucun trafic modèle n'utilise encore `DiscoveryStore`. La génération Iroh
complète Mac mini + RTX reste également à qualifier.

### Prochain ordre exact

1. définir l'enveloppe wire canonique signée et le binding des trois identités ;
2. implémenter l'adaptateur rust-libp2p Kademlia minimal dans `fabi-network`, avec TTL,
   réplication, quorum, taille maximale, persistence et validateurs explicites ;
3. brancher publication/lecture en shadow du registre central, sans router de trafic ;
4. simuler ordre, churn, expiration, partitions et convergence à 1/10/100/1 000 workers, puis
   profiler et borner le planner avant 10 000 ;
5. qualifier simultanément le rollback laboratoire et une génération Iroh complète Mac mini +
   RTX avant toute activation du nouveau catalogue.

## Enveloppes signées et premier réseau Kademlia v3 du 23 juillet 2026

Deux nouveaux commits sont poussés sur `swarm-engine/codex/swarm-protocol-v3` :

- `5ec02ed` — `feat: sign swarm discovery records` ;
- `06fb337` — `feat: embed signed Kademlia discovery`.

### Format signé réellement livré

Le crate `native/fabi-network` possède maintenant une enveloppe Protobuf bornée pour
`ModelManifest`, `WorkerOffer`, `SpanLease` et `LinkMetric`. Le choix cryptographique évite une
erreur classique : la documentation officielle Protobuf précise qu'une sérialisation
déterministe n'est pas canonique entre versions/langages. Fabi signe donc avec Ed25519 les
**octets exacts du corps transporté**, précédés du domaine `fabi/swarm/catalog/v3`, puis parse le
corps seulement après vérification.

Les validateurs natifs imposent :

- version protocolaire, type connu, payload non vide et enveloppe maximale de 32 Kio ;
- TTL strictement positif et au plus cinq minutes, expiration et skew d'horloge borné ;
- namespace logique lié à la clé Iroh du publisher pour offres, spans et métriques ;
- signature de 64 octets et EndpointId Ed25519 valide ;
- séquence monotone, idempotence exacte et refus d'une réutilisation conflictuelle ;
- clé Kademlia identique à la clé logique signée.

La clé Iroh stable signe le contenu applicatif. Une clé Ed25519 libp2p distincte et persistante
authentifie seulement le transport DHT ; elle est créée avec `create_new`, permissions `0600` sur
Unix, rechargée en Protobuf et jamais remplacée silencieusement si elle est corrompue. Il n'y a
donc pas de réutilisation implicite de secret entre Iroh et libp2p.

### Adaptateur Kademlia réellement livré

L'adaptateur utilise rust-libp2p `0.56.0`, protocole privé `/fabi/swarm/kad/3`, TCP chiffré Noise,
Yamux, Identify et Kademlia :

- les nœuds publics stables fonctionnent en `Mode::Server` ;
- les workers/laptops NAT fonctionnent en `Mode::Client`, conformément à la spécification
  libp2p, et ne polluent pas les routing tables ;
- les `PUT_VALUE` entrants sont en `StoreInserts::FilterBoth`, puis vérifiés par Fabi avant
  insertion ;
- les lecteurs attendent toutes les réponses et retiennent la plus haute séquence valide ;
- le publisher refuse aussi son propre rollback avant publication ;
- bootstrap, quorum, timeout, get/put et shutdown passent par une boucle d'événements bornée ;
- l'API est exposée sur le même `NetworkNode` PyO3 que le transport Iroh.

Le soft state est volontairement un `MemoryStore`, limité actuellement à 25 000 clés par routing
node. Ce n'est pas une omission de persistence : offres/spans/liens expirent en cinq minutes et
doivent revenir des heartbeats/répliques, pas du disque après un crash. L'identité réseau, elle,
est persistante. Les manifestes immuables suivront un registre/cache persistant séparé.

### Validation exacte et limites

- test Rust réel à trois participants : client writer → routing server → second client reader ;
- signature, tampering, foreign namespace, expiration, future clock, TTL maximal, idempotence,
  rollback et ordre des réponses testés ;
- `15` tests natifs avec feature Python verts ;
- Clippy `--all-targets --all-features -D warnings` vert ;
- wheel ABI3 macOS arm64 construite et importée ; surface DHT Python présente ;
- suite moteur : `468 passed, 7 skipped`, warning externe Starlette/httpx seulement ;
- workflow `.github/workflows/native-network.yml` ajouté pour construire/tester/importer les
  wheels sur Ubuntu, Windows et macOS.

À cet instant, le workflow GitHub nouvellement poussé n'est pas encore observé : **Windows n'est
pas déclaré validé**. Le test DHT est loopback, pas Internet/NAT. Le catalogue n'est pas branché
au scheduler central, ne route aucun prompt et n'a encore ni rate limiting/Sybil policy, ni liste
d'autorités autorisées à publier les manifestes, ni simulation de partition. Le plafond mémoire
doit être relié à un budget réel avant déploiement d'un routing node public.

### Suite exacte

1. obtenir les trois jobs CI natifs verts, corriger toute divergence Windows réelle ;
2. ajouter l'adaptateur Python `DiscoveryStore` qui sérialise les contrats v3, publie en shadow et
   compare DHT/registre central sans influencer les routes ;
3. définir la trust policy des manifestes, les limites par publisher/IP/account et la protection
   Sybil avant tout routing server public ;
4. ajouter les simulations churn/partition/expiration et profiler 1/10/100/1 000 puis 10 000
   workers ;
5. seulement ensuite déployer plusieurs routing nodes Kademlia et qualifier deux NAT réels en
   conservant Iroh comme unique plan de données.
