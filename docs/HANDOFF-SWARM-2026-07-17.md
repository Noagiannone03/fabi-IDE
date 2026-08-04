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

## Membership sharded Petals/Hivemind et `DiscoveryStore` natif du 23 juillet 2026

Le commit moteur `8788c8680f7f6cb8602fe646832f029261841a86`
(`feat: add sharded model membership discovery`) est poussé sur
`swarm-engine/codex/swarm-protocol-v3`. Le worktree qualifié
`/Users/noagiannone/Documents/swarm-engine-dynamic` et son patch local n'ont pas été modifiés.

### Problème découvert avant de brancher Python

Le premier adaptateur Kademlia savait publier et lire une clé exacte. Il ne pouvait pas encore
répondre proprement à « quels workers servent ce modèle ? » : Kademlia standard ne fournit pas de
`LIST(prefix)`, et le planner ne connaît pas à l'avance les EndpointIds qui composent les clés
`offer/<endpoint>` et `span/<model>/<endpoint>`.

Le code Petals/Hivemind a été relu jusque dans `declare_active_modules`, `DHTProtocol`,
`DictionaryDHTValue`, `DHTLocalStorage.store_subkey` et `_SearchState.add_candidate`. Petals écrit
une sous-clé par peer et par module ; Hivemind conserve une expiration par sous-clé et fusionne les
dictionnaires reçus de plusieurs répliques. C'est une extension réelle du protocole, pas un
`GET(prefix)` caché.

Les provider records libp2p ont également été comparés dans la documentation et le code officiels.
Ils renvoient des `PeerId`, la récupération de la valeur reste hors scope de cette API et le
`MemoryStore` limite par défaut les providers d'une clé à `K = 20`. Ils conviennent aux fournisseurs
de blobs, mais utilisés seuls pour les workers ils auraient imposé un mapping d'identité
supplémentaire, une hot key et des lookups N+1. Cette voie n'a donc pas été forcée.

### Implémentation réellement livrée

Le crate `fabi-network` porte maintenant une sémantique de sous-clés signées, sharded et bornée :

- nouveau record `ModelMember`, clé `fabi/swarm/v3/member/<model_swarm_id>/<shard>` ;
- `256` shards fixes ; le shard vient du hash de l'EndpointId Ed25519, donc un publisher ne peut pas
  choisir arbitrairement sa partition ;
- chaque entrée garde sa signature Iroh, sa séquence et son TTL indépendants ; le conteneur de set
  n'est jamais une autorité et n'est pas cru sans revérifier toutes ses entrées ;
- fusion déterministe par EndpointId et plus haute séquence, indépendante de l'ordre d'arrivée ;
- une entrée invalide/expirée ne peut pas empoisonner les entrées honnêtes ;
- même séquence avec deux contenus signés converge par digest déterministe et reste une preuve
  d'équivocation exploitable par la future politique de réputation ;
- maximum `512` entrées et `256 Kio` par shard, paquet Kademlia et `MemoryStore` bornés ;
- un routing server fusionne delta individuel et snapshot répliqué avant insertion ;
- lecture des 256 shards avec concurrence 16 ; une vraie erreur réseau d'un shard fait échouer le
  snapshot, tandis qu'un shard `NotFound` est correctement interprété comme vide.

Le binding PyO3 expose maintenant `model_member`, `catalog_get_members` et
`catalog_get_model_members`.

Le nouveau `DhtDiscoveryStore` Python sérialise réellement les contrats v3. Son
`ModelMemberAdvertisement` reprend le meilleur pattern de Petals `ServerInfo + next_pings` : chaque
entrée signée contient le `WorkerOffer`, le `SpanLease` et les métriques réseau sortantes encore
vivantes, bornées aux huit meilleurs liens par nature de chemin, perte, RTT puis débit. Une lecture
sharded produit donc directement la matière du planner sans 2N lectures
supplémentaires. Les records exacts offre/span/lien restent publiés pour lookup ciblé et audit.

Les contrôles Python refusent notamment :

- une offre dont `endpoint_id` ne correspond pas à la clé Iroh qui signe ;
- une lease sans offre locale correspondante ;
- un lien dont la source n'est pas le worker local ou dont la cible n'a pas d'endpoint connu ;
- une advertisement distante dont l'offre prétend un autre EndpointId que le signataire ;
- un snapshot partiel présenté comme complet.

Une collision volontaire de `worker_id` entre deux EndpointIds est résolue de façon déterministe
par la vue signée la plus récente. La future attestation de device/account devra ensuite décider
qui est autorisé à revendiquer ce nom.

### Validation exacte

- tests natifs du commit membership : `18 passed`, dont serveur Kademlia + deux writers dans le
  même shard + reader, puis lecture des 64 shards alors configurés ;
- Clippy `--all-targets --all-features -- -D warnings` vert ;
- tests Python ciblés contrats/discovery/routing : `25 passed` ;
- suite moteur complète : `471 passed, 7 skipped` ; seul warning externe Starlette/httpx connu ;
- Ruff vert et `git diff --check` vert ;
- wheel ABI3 macOS arm64 release construite, installée dans un venv vierge et nouvelles méthodes
  importées avec succès ;
- la CI du commit précédent `06fb337`, run `29991752219`, est entièrement verte sur Windows,
  Ubuntu et macOS : tests, wheel, installation et import ;
- la CI du commit membership `8788c86`, run `29993456967`, est entièrement verte sur Windows,
  Ubuntu et macOS : format, Clippy strict, tests DHT, wheel ABI3, installation et import.

### Correction de dimensionnement 10 000 workers

La mesure du JSON réel a invalidé la première hypothèse de 64 shards : une advertisement occupe
`1 080` octets sans lien, `1 481` avec deux liens, `2 687` avec huit liens et `4 301` avec seize.
Avec 10 000 workers, 64 shards pouvaient donc franchir la borne de `256 Kio` bien avant la limite
de 512 entrées.

Le commit moteur `d6c9abed273e3d01eab867389da88d4cfb21926f`
(`fix: bound membership shards at ten thousand workers`) corrige le contrat plutôt que de relever
arbitrairement la limite :

- 256 shards déterministes, toujours imposés par l'EndpointId signé ;
- au plus huit liens sortants utiles par advertisement, suivant le pattern borné `next_pings` de
  Petals ; tous les liens exacts restent disponibles séparément pour audit ;
- fixture déterministe de 10 000 EndpointIds : les 256 shards sont utilisés et le maximum observé
  reste inférieur ou égal à 64 membres ;
- fixture wire de 64 annonces signées avec payload de `2 800` octets : le set fusionné reste sous
  `256 Kio` ;
- validation locale après correction : `20` tests natifs, Clippy strict, `471 passed, 7 skipped`
  Python, Ruff et `git diff --check` verts ;
- CI multiplateforme du push : run `29993962688`, entièrement verte sur Windows, Ubuntu et macOS,
  y compris tests, Clippy strict, wheels ABI3, installation et imports du catalogue membership.

### Limites honnêtes et suite

Le `DhtDiscoveryStore` n'est pas encore branché au registre/scheduler historique en shadow et ne
route aucun prompt. La fixture établit une borne de paquet pour une population déterministe de
10 000 workers, mais ne prouve pas encore churn, charge CPU/réplication ou adversaires. Il manque
encore rate limits, quota mémoire réel du routing node, défense Sybil,
attestation account/device, autorités de manifestes et simulation de partition/churn.

Le prochain ordre est :

1. **terminé** — les trois jobs du run `29993962688` sont verts ;
2. **terminé dans `02b8e93`** — manifestes immuables construits depuis les révisions et digests
   réels du registre de modèles, sans hashes factices ;
3. brancher ensuite le store en shadow du registre central et comparer les snapshots sans
   influencer le trafic ;
4. ajouter simulations de distribution de shards, expirations, ordre, partitions et churn à
   1/10/100/1 000 puis 10 000 workers avec budgets mémoire/paquets/CPU ;
5. définir trust policy des manifestes, quotas par publisher/account/IP et comportement shard
   plein ;
6. étudier un accélérateur incrémental officiel libp2p Rendezvous/Gossipsub derrière le même port,
   analogue à un tracker BitTorrent mais jamais autoritaire, seulement si les mesures le
   justifient ;
7. déployer plusieurs routing nodes, tester deux NAT réels, puis reprendre la génération modèle
   complète Iroh Mac mini + RTX et l'admission `PREPARE/COMMIT` de bout en bout.

## Manifestes modèles immuables et content-addressed du 23 juillet 2026

Le commit moteur `02b8e93b907725c19051cbb7e709556cd0906ea7`
(`feat: build immutable model artifact manifests`) est poussé sur
`swarm-engine/codex/swarm-protocol-v3`. Il n'est toujours pas déployé sur le labo qualifié et le
worktree `/Users/noagiannone/Documents/swarm-engine-dynamic` n'a pas été modifié.

### Recherche et décision

Les sources officielles Hugging Face ont été vérifiées jusque dans `HfApi.model_info`,
`RepoSibling`, `BlobLfsInfo`, le cache local et `hf_hub_download`. Avec
`files_metadata=True`, le Hub fournit commit, chemin, taille, Git OID et métadonnées LFS. Le cache
nomme les fichiers Git par SHA-1 et les fichiers LFS par SHA-256 : un `blob_id` Git de 40 caractères
ne doit donc jamais remplir un champ SHA-256.

Le format OCI descriptor/manifest a servi de pattern maintenu : une référence de contenu porte au
minimum digest, taille et media type ; le manifest racine référence des collections ordonnées.
Petals a aussi été relu sur `from_pretrained`, ses index de shards, révisions et `dht_prefix`.
Petals sait charger un bloc à une révision donnée mais ne construit pas une identité cryptographique
complète tokenizer + graphe + poids + contrats d'exécution. Fabi garde son routing communautaire,
mais ne copie pas cette faiblesse d'identité.

Le code Parallax réel a enfin été suivi dans les loaders MLX, vLLM et SGLang. Deux contraintes ont
changé l'implémentation :

- `trust_remote_code=True` est utilisé pour certains modèles, donc le code Python du repo fait
  partie du graphe, pas seulement `config.json` ;
- vLLM et SGLang résolvent actuellement le dtype depuis `config.json`, tandis que MLX peut recevoir
  l'argument worker. Le builder refuse donc un dtype commun contredit par le config au lieu de
  publier un contrat que CUDA ignorerait.

### Implémentation livrée

- `ArtifactDescriptor` borné : chemin POSIX relatif sûr, taille, SHA-256, media type et rôle
  `architecture`, `tokenizer` ou `weight` ;
- `ModelArtifactIndex` trié, sans doublons, maximum 100 000 pièces ;
- résolution en deux appels : ref humaine vers SHA complet, puis `files_metadata=True` sur ce SHA ;
- poids LFS liés directement à leur SHA-256 officiel et leur taille, sans téléchargement ;
- petits fichiers Git téléchargés à la révision immuable puis SHA-256 calculé sur les octets ;
  plafond 64 Mio sans LFS, fail closed au-delà ;
- README, licence et contenu éditorial exclus ; config, code distant, tokenizer/chat template,
  poids et index de shards inclus ;
- racines de collections SHA-256 canonicalisées avec séparation de domaine inspirée d'OCI ;
- hashes RoPE/contexte, attention/KV et prefill dérivés du config normalisé et du contrat wire ;
- alias dtype et quantification canonicalisés ; configuration de quantification fingerprintée ;
- normalisation Qwen/Minimax extraite dans `parallax.utils.model_config`, module pur partagé :
  importer le registre de manifestes ne charge plus Torch, NumPy ni ZMQ ;
- workflow multiplateforme étendu aux fichiers `swarm_protocol`, avec tests protocolaires dans un
  environnement Python 3.12 minimal après installation de la wheel native.

### Preuves exactes

Smoke réseau réel, sans télécharger les poids, sur `Qwen/Qwen3-0.6B` :

- révision immuable `c1899de289a04d12100db370d81485cdf75e47ca` ;
- sept artefacts runtime : deux architecture, quatre tokenizer, un poids ;
- `model.safetensors` : `1 503 300 328` octets, SHA-256 LFS
  `f47f71177f32bcd101b7573ec9171e6a57f4f4d31148d38e382306f42996874b` ;
- `ModelSwarmId` reproductible
  `02cdee21bda4ddb34c9d63b507304f3a12ab1a1739b10831a3dc1391b9733819` ;
- `bf16` et `bfloat16` produisent la même identité ; README ignoré, modification du code runtime
  ou du dtype produit une autre identité.

Validation locale finale :

- suite Python complète `479 passed, 7 skipped` ; seul warning externe Starlette/httpx connu ;
- `20` tests natifs, Clippy strict et Ruff ciblé verts ;
- extraction de la normalisation couverte par `52 passed` sur manifestes, contrats, config statique
  et shard loader ;
- venv Python 3.12 vierge avec seulement Pydantic, huggingface-hub et pytest : `16 passed` avec
  `--noconftest` ; le premier essai par `python3` local a correctement refusé Python 3.14.6 car le
  projet déclare `<3.14`, ce n'est pas une validation 3.14 ;
- CI du commit : run `29995144474`, entièrement verte sur Windows, Ubuntu et macOS, y compris
  tests de manifestes, tests DHT, Clippy strict, wheels ABI3, installation et imports.

### Limites et prochain ordre

Le builder produit des hashes réels, mais il ne publie encore rien dans le DHT et ne route aucune
requête. Il manque la signature par une autorité de registre, la persistance et récupération de
`ModelArtifactIndex`, la vérification worker après download, le mapping exact couches → fichiers,
les adaptateurs ModelScope/local, puis le branchement shadow.

Ordre recommandé :

1. obtenir les trois jobs du run `29995144474` verts ;
2. définir l'enveloppe signée d'autorité et la politique de rotation/révocation ;
3. persister l'index complet par `model_swarm_id`, faire vérifier chaque blob local et produire les
   `weight_hashes` exacts de chaque span ;
4. brancher ensuite `DhtDiscoveryStore` en shadow et comparer registre historique / vue v3 sans
   influencer le trafic ;
5. reprendre quotas/Sybil, simulations de churn et qualification multi-routing-nodes/NAT réels.

## Autorité TUF, vérification locale et shadow Parallax du 23 juillet 2026

Le commit moteur `28cd0775eccc1aeecf0fa20471555cba7b461a13`
(`feat: connect trusted worker shadow reports`) est poussé sur
`swarm-engine/codex/swarm-protocol-v3`. Le worktree qualifié
`/Users/noagiannone/Documents/swarm-engine-dynamic` et le labo v2 n'ont pas été modifiés. Ce palier
est volontairement **shadow-only** : les générations réelles utilisent toujours le scheduler et
les réservations qualifiés.

### Recherche et choix de confiance

Les sources officielles suivantes ont été lues avant l'implémentation :

- python-tuf, API `Metadata`, `ngclient.Updater`, exemples de repository et rotation de root,
  source `c3e5ea6977bfaf370b37fd202f47059c9581f489` ;
- spécification TUF : rôles root/targets/snapshot/timestamp, seuils, expiration, consistent
  snapshots, protection rollback/freeze et continuité old-root/new-root ;
- securesystemslib et `CryptoSigner`, source
  `0593df312ceb40dcc390c84050547443742b6ed4` ;
- cache officiel huggingface_hub, source
  `e8bb3199451824621bcdcb92b7ba0d86586ef5b6` : les snapshots sont des symlinks vers le répertoire
  sibling `blobs`, donc interdire tout symlink aurait cassé le cache maintenu ;
- observabilité vLLM/SGLang : distinction prompt/prefill, génération/decode, TTFT/ITL et métriques
  de tokens réellement ordonnancés.

Sigstore reste pertinent pour la provenance des releases, mais ne remplace pas le registre de
modèles : TUF fournit directement seuils d'autorité, révocation/rotation, expiration et
anti-rollback. Fabi dépend maintenant explicitement de `tuf==7.0.0` et
`cryptography>=40.0.0` au lieu de réimplémenter ces garanties.

### Registre de modèles réellement livré

- `ModelRegistryBundle` lie le `ModelManifest` compact à son `ModelArtifactIndex` complet et
  recalcule les trois racines architecture/tokenizer/poids avant acceptation ;
- catalogue TUF signé `catalog.json` : résolution nom humain + commit immuable + variante
  dtype/quantification vers `model_swarm_id`, avec refus des variantes ambiguës ;
- publisher operator-side : targets, snapshot et timestamp versionnés, consistent snapshots,
  écriture atomique et publication du timestamp en dernier ;
- clés injectées sous forme de `Signer` : aucune clé privée n'est créée, loggée ou persistée par le
  runtime ;
- seuil configurable par rôle et rotation de root signée simultanément par l'ancien et le nouveau
  seuil ; la nouvelle root peut retirer les clés compromises ;
- client `TrustedModelRegistry` initialisé uniquement depuis une root fournie hors bande : aucun
  TOFU silencieux ; `ngclient` vérifie la chaîne root → timestamp → snapshot → targets, la taille
  et le hash du bundle ;
- tests d'altération de target, timestamp expiré, rollback, seuil incomplet, substitution
  manifest/index et rotation root 2-of-2.

Le labo pourra commencer en 1-of-1 pour les rôles en ligne timestamp/snapshot/targets, mais cette
configuration devra être explicitement marquée staging. La root de production reste destinée à
un seuil offline ; aucune clé de production n'existe à ce stade.

### Vérification exacte des poids du span

Le worker ne dérive plus ses `weight_hashes` d'une hypothèse :

- l'index safetensors/PyTorch signé est vérifié avant parsing ;
- le même normaliseur de clés et la même règle couches/endpoints que les loaders Parallax calculent
  les fichiers exacts de `[start_layer, end_layer)` ;
- toute référence de `weight_map` absente de l'index signé est rejetée ;
- checkpoints non shardés acceptés seulement s'il existe exactement un fichier poids signé ;
- chaque fichier utilisé est vérifié en streaming par taille et SHA-256, avec détection d'un
  changement pendant le hash ;
- les symlinks officiels Hugging Face vers `blobs` sont acceptés, mais uniquement si les octets de
  la cible satisfont toujours le descriptor signé ;
- tokenizer vérifié seulement pour un worker annonçant le rôle frontend ; un exécuteur pur ne doit
  pas télécharger des octets qu'il n'utilise pas ;
- un seul thread de vérification lourd peut tourner par worker. Une succession de réallocations ne
  lance donc pas plusieurs hashages concurrents qui satureraient disque, CPU et heartbeat.

La géométrie KV n'est plus réduite à une constante globale : le manifeste porte un nombre
d'octets/token pour chaque couche. Les architectures attention uniformes actuelles remplissent le
vecteur avec la géométrie exacte du config ; une architecture recurrente/state-space est refusée
tant qu'un contrat cache spécifique n'existe pas. Le planner additionne la géométrie du subspan
réel.

### Branchement shadow aux workers et au scheduler actuels

`FABI_SWARM_V3_MODE=shadow` active un chemin isolé :

- le heartbeat v2 reste synchrone et prioritaire ; récupération TUF et hashage de poids tournent
  hors du thread de heartbeat ;
- un worker publie dans son `node_update` un `WorkerOffer` et un `SpanLease` v3 seulement après
  récupération indépendante du bundle signé et vérification locale ;
- erreurs et contrats incomplets deviennent `waiting_contract`, `verifying` ou `rejected`, sans
  arrêter le runtime v2 ;
- les vrais transferts d'activations v2 alimentent un EWMA de goodput par peer. La taille mesurée
  est celle du message effectivement envoyé au peer, pas le batch d'origine avant regroupement ;
- les executors publient séparément les tokens prefill et decode réellement ordonnancés par MLX,
  vLLM ou SGLang, divisés par leur temps de traitement ; seuls les workers `max_sessions == 1`
  exposent actuellement ces scalaires au planner v3 ;
- le scheduler conserve le report sans le mélanger aux champs v2, récupère lui-même le bundle TUF,
  exécute `ExactRoutePlanner`, compare la route v3 aux couvertures complètes v2 et expose le résultat
  dans `/cluster/status` ;
- les états expliquent les divergences, notamment `missing_executor_throughput` et
  `missing_link_goodput`, plutôt que de fabriquer des valeurs par défaut.

Le DHT reste le futur plan de découverte. Pour ce premier shadow, les advertisements transitent
dans le RPC scheduler déjà qualifié afin de comparer sans ouvrir un nouveau chemin de panne. Elles
ne sont pas encore publiées par `DhtDiscoveryStore` et ne pilotent aucun prompt.

### Validation exacte

- suite moteur complète : `498 passed, 7 skipped` ; seul warning externe Starlette/httpx connu ;
- hooks pre-commit, Ruff et `git diff --check` verts ;
- `20` tests natifs, `cargo fmt --check`, Clippy tous targets/features avec warnings interdits ;
- tests spécifiques : cache HF symlink, poids altéré, index référençant un fichier non signé,
  TUF tamper/expiry/rollback/rotation, heartbeat non bloquant, absence de hashages concurrents,
  compteurs MLX/vLLM/SGLang, shadow agreement et shadow sans métriques ;
- smoke Hub réel `Qwen/Qwen3-0.6B`, même commit
  `c1899de289a04d12100db370d81485cdf75e47ca`, 28 couches, géométrie KV `4 096`
  octets/token/couche, bundle TUF `2 355` octets ;
- l'ajout de la géométrie KV au contrat change légitimement l'identité : nouveau `ModelSwarmId`
  `76390f00bf883056baf3ab07c74908b7a1cdd99bed9ca161daa286e4e85218d2` ;
- vérification locale réelle du poids 0.6B **non faite** : le cache du Mac courant ne contient pas
  `model.safetensors` (ni tous les tokenizer files). Le test a échoué proprement en
  `FileNotFoundError`, aucun téléchargement de 1,5 Go n'a été lancé implicitement ;
- CI multiplateforme du commit : run `29997876299`, encore **queued** à cette écriture. Ne pas la
  déclarer verte avant les trois conclusions Windows/Ubuntu/macOS.

### Limites et prochain ordre exact

1. obtenir les trois jobs verts du run `29997876299` ;
2. ajouter l'outil opérateur de staging avec stockage de clés chiffré/permissions strictes, publier
   le bundle exact du modèle labo et distribuer seulement la root publique pinée ;
3. brancher la vérification dans l'admission **avant** le chargement du nouvel executor. En shadow,
   elle qualifie l'annonce v3 après le READY v2 ; ce n'est pas encore une garantie pré-load ;
4. publier les mêmes advertisements signées dans `DhtDiscoveryStore` et comparer vue RPC, vue DHT
   et scheduler historique ;
5. déployer le shadow sur VPS + Mac mini + RTX, provoquer les deux ordres de connexion, lancer de
   vrais prompts et mesurer agreement/divergence, TTFT, débit, KV, RAM et chemins direct/relay ;
6. seulement après ces preuves, activer PREPARE/COMMIT v3 pour une fraction de trafic avec rollback
   immédiat vers le scheduler qualifié ;
7. poursuivre churn/partition, quotas/Sybil, plusieurs routing nodes, deux NAT réels puis
   failover/répliques.

## Route active, catalogue DHT et placement autonome v3 du 23 juillet 2026

Trois commits moteur ont été poussés sur `swarm-engine/codex/swarm-protocol-v3` :

- `5aaf64c` — `feat(swarm-v3): authorize active request routes` ;
- `7463543` — `feat(swarm-v3): add autonomous placement foundations` ;
- `1a35a3b` — `feat(swarm-v3): drive autonomous worker reloads`.

La ref distante vérifiée après push est
`1a35a3b864611aed6b05c58f6d77f3e6ed5faf80`.

### Recherche et décisions reprises

Petals officiel `22afba627a7eb4fcfe9418c49472c6a51334b8ac` a été relu dans
`server.py`, `block_selection.py`, les annonces DHT et le cycle
`JOINING → ONLINE → OFFLINE`. Le pattern conservé est : placement local depuis la couverture
partagée, refus d'ouvrir un trou de couverture, annonce non prête pendant le chargement,
redémarrage du conteneur de modules et nettoyage mémoire. Fabi y ajoute les réservations KV,
epochs et identités Iroh qui manquent à ce cycle.

Le format SafeTensors officiel et le chemin de métadonnées Hugging Face déjà maintenu dans Fabi
servent à calculer les octets exacts par couche et par endpoint. Le manifeste de production porte
désormais ce profil ; le placement autonome refuse un manifeste qui ne l'a pas au lieu d'estimer
la taille. Les changements de poids modifient donc légitimement le `ModelSwarmId` du bundle de
staging à republier.

### Route et admission réellement actives

- le budget réel `prompt_tokens + reserved_output_tokens` entre dans le planner v3 ;
- `RoutePlan` et commandes de réservation sont signés avec l'EndpointId Iroh ;
- le coordinateur fait `PREPARE` en parallèle, puis `COMMIT`, renouvelle les sessions dans un
  thread indépendant et nettoie toute préparation partielle ;
- chaque worker vérifie l'identité du coordinateur, son span local, les octets KV exacts,
  l'epoch et la route avant prefill, chaque hop et abort ;
- `route_id` et `route_epoch` passent réellement dans le protobuf et le data plane ;
- un worker sans métrique de débit reste éligible : la performance est marquée incomplète au lieu
  d'inventer une valeur ;
- le timeout de heartbeat configuré est enfin lu ; l'enveloppe de capacité reste stable pendant
  une génération et la pression live est séparée pour ne pas recompter les poids chargés.

### Catalogue DHT réellement branché

- `IrohTransport` démarre optionnellement le DHT Kademlia natif en `client` ou `server`, avec
  identité libp2p persistante, bootstraps explicites et fermeture coordonnée ;
- les workers publient une advertisement cohérente offre + lease + huit liens maximum dans une
  boucle coalescée hors heartbeat ;
- le scheduler publie et renouvelle le manifeste vérifié, lit les 256 shards hors requête et
  conserve un snapshot immuable ;
- en présence du catalogue, la route active utilise le membership DHT et non plus l'existence du
  worker dans le tableau central ;
- le manifeste DHT doit être strictement identique au bundle TUF local. La DHT ne devient jamais
  l'autorité du modèle ;
- la maintenance de route utilise aussi la liveness du snapshot DHT.

### Placement et reload worker réellement implémentés

La politique calcule tous les spans contigus exacts qui tiennent dans
`stable_memory_envelope_bytes`, poids, endpoints et KV arrondi compris. Elle classe la couverture
minimale, le déficit de réplication rempli et la couverture pondérée avec tie-break déterministe.
Un backend fixed ne bouge que si chaque couche qu'il abandonne possède déjà une autre lease
`READY`. Réservations actives, cooldown et hystérésis empêchent les oscillations.

`FABI_SWARM_V3_PLACEMENT=autonomous` active le chemin worker :

1. lecture DHT asynchrone, jamais dans le heartbeat ;
2. barrière atomique `DRAINING` dans `WorkerExecutionAdmission` ;
3. refus des nouveaux `PREPARE`, mais `RENEW/RELEASE/FENCE` restent disponibles pour drainer ;
4. publication DHT `DRAINING` séquencée ;
5. passage de la nouvelle plage et de sa génération dans `SharedState` ;
6. arrêt frontend avant executor, rotation des IPC et chargement de la nouvelle plage ;
7. réouverture seulement après poids vérifiés, KV mesuré et annonce `READY` de la même génération ;
8. détection d'un exitcode executor non nul ; publication de l'erreur au contrôleur, nouvel epoch
   local et reload de la dernière plage vérifiée. Sans ancienne plage, le worker échoue fermé.

L'ancien scheduler ne peut plus appliquer un context replan, un late-join rebalance ou un
rebalance de départ pendant une route v3 active. L'intention de rebalance après départ est
mémorisée puis rejouée après drain, elle n'est pas perdue.

### Validations exactes

- suite Python complète au commit `1a35a3b` : `548 passed, 7 skipped` ;
- seul warning : dépréciation externe Starlette/httpx déjà connue ;
- Ruff ciblé et `git diff --check` verts ;
- Rust `cargo fmt --check`, `cargo test --all-targets` : `21 passed` ;
- Rust `cargo clippy --all-targets -- -D warnings` vert ;
- tests ajoutés : DHT client/server et cleanup, membership sans N+1, route DHT sans nœud central,
  drain concurrent, rollback génération, absence de reload pendant route v3, publisher
  non bloquant, ordre d'arrivée déterministe et passage réel vers `SharedState`.

Ces preuves sont locales et simulées. Le workflow GitHub du push `1a35a3b` n'avait pas encore de
résultat visible au moment de cette écriture ; Windows ne doit donc pas être déclaré revalidé pour
ces commits.

### Limites honnêtes et ordre de reprise

- **non testé au labo** : aucune génération `1a35a3b` n'a encore tourné sur VPS + Mac mini + RTX ;
- **bootstrap froid encore transitoire** : le scheduler historique fournit la première plage avant
  que le worker autonome puisse la déplacer. Il faut publier une intention `BUILDING` vérifiée
  depuis l'offre de capacité pour supprimer cette dernière autorité de placement ;
- le registre staging doit être republié avec le profil exact de poids, ce qui change le swarm id ;
- le rollback de chargement est couvert en tests, pas encore provoqué avec MLX/vLLM réels ;
- il manque encore simulation churn/partition 1/10/100/1 000/10 000, quotas/Sybil, plusieurs
  routing servers, iroh-blobs, réplica/failover et replay KV.

Ordre exact :

1. attendre les trois jobs CI Windows/Ubuntu/macOS du commit `1a35a3b` ;
2. reconstruire le wheel natif et le registre staging exact ;
3. déployer un routing server DHT sur le VPS sans toucher au service 1.7B qualifié ;
4. activer le client DHT + v3 active sur Mac mini et RTX, vérifier les deux ordres d'arrivée ;
5. générer avec 12 220 tokens d'entrée + 4 096 réservés, SSE, abort, outils et changement modèle ;
6. provoquer reload, échec de reload, départ pendant prefill/decode et mesurer TTFT, débit, KV,
   RAM, direct/relay ;
7. seulement après ces preuves, concevoir le cold join totalement autonome et le failover à
   réplica.

## Replay froid exact et promotion de route v3 du 27 juillet 2026

Cette section est le point de reprise le plus récent pour le failover. Deux commits sont poussés
sur `swarm-engine/codex/swarm-protocol-v3` :

- `1e15437` — `feat(swarm-v3): journal exact generation recovery` ;
- `8f6310a` — `feat(swarm-v3): resume exact streams on backup routes`.

La ref distante a été vérifiée à `8f6310a`. Le worktree qualifié
`/Users/noagiannone/Documents/swarm-engine-dynamic` et le service labo existant n'ont pas été
modifiés.

### Recherche primaire et décision

Petals officiel `22afba627a7eb4fcfe9418c49472c6a51334b8ac` a été relu dans
`client/inference_session.py` : après perte d'un span, il choisit une nouvelle couverture et
rejoue l'historique des hidden states pour reconstruire les caches d'attention. Fabi conserve cet
invariant de reconstruction mais ajoute le journal de tokens, la réservation worker-disjointe,
les epochs et le commit-before-SSE nécessaires à un service multi-client.

Le frontend Rust officiel vLLM v0.24 a été étudié au commit immuable
`ee0da84ab9e04ac7610e28580af62c365e898389`. La reprise n'utilise pas un décodeur ou un parser
d'outils maison : un patch Fabi injecte le préfixe commis dans les décodeurs reasoning/tool calls
officiels, tandis que l'engine reçoit `prompt original || sortie commise` pour reconstruire le KV.
SGLang PD/Mooncake/NIXL ont aussi été relus. Le transfert direct de KV n'est pas retenu comme
premier chemin de correction : il exige un contrat backend/layout/version beaucoup plus strict et
des corruptions KV inter-nœuds sont encore rapportées dans le projet. Exo confirme l'intérêt du
placement topologique, mais ne fournit pas ce contrat de reprise agentique.

### Chemin de reprise réellement implémenté

1. Le planner réserve une route primaire et une route complète dont les workers sont disjoints.
2. Le premier chunk vLLM lie les IDs exacts du prompt au manifeste, tokenizer, dtype, contrats
   prefill/KV, route et epoch.
3. Chaque token reasoning, contenu ou outil est journalisé avant que son SSE soit visible.
4. Une perte de route ou une fin de flux sans `[DONE]` promeut le secours avec un nouvel epoch.
5. Le coordinateur consomme ce secours, clôt l'ancienne autorité par journal + leases et tente un
   RPC `FENCE` sur tous les anciens stages encore joignables.
6. Le nouveau head appelle `/inference/v1/chat-replay`. Le renderer doit reproduire exactement les
   IDs du prompt ; le nouvel engine préfill le prompt étendu et le frontend réinjecte le préfixe
   dans ses parsers maintenus.
7. Le gateway compare les IDs rejoués au journal, masque les événements déjà livrés puis expose
   seulement les nouveaux événements. Les compteurs prompt/completion/total sont réécrits pour la
   requête originale.
8. Une divergence, un secours indisponible ou une seconde panne produit une erreur OpenAI
   terminale propre. Il n'existe ni boucle infinie, ni re-tokenisation, ni continuation inventée.

Le patch est versionné sous `patches/vllm-v0.24.0-fabi-chat-replay.patch`. `install.sh` pince
désormais le commit vLLM exact, vérifie que le patch s'applique et inclut son SHA-256
`6c5ee14c59f8ea1ff02b3f97d3fd8a5849668e980fa3fccafa654f6819a8cdef` dans l'identité du frontend.

### Portée exacte de la garantie

Le replay froid exact n'est annoncé que pour `temperature=0` ou `top_k=1`. Un seed seul ne rend
pas l'état RNG portable entre MLX, vLLM et SGLang. Les requêtes sampled restent donc
`RESTARTABLE`. Sont également refusés comme recoverable : stop strings, guided/structured
decoding, logprobs, thinking budget, beam search et pénalités de fréquence/présence/répétition non
neutres. Les pénalités explicites neutres `0/0/1` restent acceptées.

Le journal est borné et process-local. Il ne permet pas encore à un autre routing server de
reprendre après le crash du routing server courant. Une route possède un seul secours réservé :
après sa promotion, la garantie descend honnêtement à `RESTARTABLE`.

### Validations exactes

- suite Python complète : `666 passed, 7 skipped`, seul warning externe Starlette/httpx connu ;
- Ruff ciblé sur tous les fichiers modifiés et `git diff --check` verts ;
- `97 passed` sur failover, handler SSE, scheduler, active routes, worker RPC et install ;
- patch appliqué à la source vLLM exacte ; `cargo check -p vllm-chat -p vllm-server` vert ;
- deux tests Rust ciblés `/inference/v1/chat-replay` verts : préfill du préfixe exact +
  continuation, et refus d'un prompt rendu différent ;
- `cargo clippy -p vllm-chat -p vllm-server --lib --tests -- -D warnings` vert ;
- le Clippy `--all-targets` global n'est pas déclaré vert : un exemple vLLM amont déclenche avec
  Rust 1.97 un warning futur sur le type de `temperature(0.0)`, hors patch Fabi ;
- tests Python : coupure après un token puis continuation sans doublon, mismatch prompt/token,
  SSE d'erreur, replay prématurément terminé, usage corrigé, seconde panne sans secours.

Le lint Ruff global du dépôt contient encore 85 erreurs historiques hors fichiers modifiés dans
les benchmarks et modèles MLX. Elles ne sont pas introduites par ces commits et n'ont pas été
mélangées à ce jalon.

### Limites honnêtes et prochaine reprise

La reprise fonctionne dans les tests intégrés, mais **n'est pas encore qualifiée sur des workers
réels**. Le labo actuel Mac mini + RTX forme ensemble une seule pipeline ; il ne fournit pas une
seconde couverture worker-disjointe. Ne pas déclarer le failover produit prêt sans au moins une
troisième couverture complète.

Ordre exact :

1. vérifier la CI Windows/Ubuntu/macOS des commits `1e15437` et `8f6310a` ;
2. construire le frontend vLLM patché depuis le commit piné, puis reconstruire le runtime/wheel ;
3. déployer ce runtime sur VPS, Mac mini et RTX sans écraser le rollback qualifié ;
4. revalider génération normale, SSE, outils, permissions, abort, contribution et gros contexte ;
5. ajouter une route worker-disjointe réelle, puis tuer head/milieu/tail pendant prefill et decode ;
6. mesurer temps de reconstruction, TTFT après panne, débit, RAM/KV et comportement direct/relay ;
7. persister/répliquer le journal entre routing servers ;
8. poursuivre journal d'activations, réplique chaude, iroh-blobs, multi-modèles, reçus de
   contribution, quotas/Sybil et pairing multi-machine.

## Découverte V3-only, registre produit et qualification après redémarrage du 28 juillet 2026

Trois nouveaux commits sont poussés :

- `swarm-engine/codex/swarm-protocol-v3` :
  `2c564cc1089e9d832c1f0896c0a56383d78b07db`
  (`fix(swarm-v3): publish Iroh scheduler identity`) ;
- `fabi/main` : `1fd9b60` (`fix(registry): discover active V3 Iroh swarms`) ;
- `fabi-IDE/main` : `41133b9` (`feat: make IDE discovery V3-only`).

### Correction de la découverte sans parsing de logs

`/cluster/status_json` publie maintenant deux champs machine-readable :
`scheduler_endpoint_id` et `network_transport`. `SchedulerManage.get_peer_id()` lit directement
`iroh_transport` et ne dépend plus de l'alias de compatibilité Lattica. Le registry consomme cet
EndpointId avant tout fallback logs et le conserve sous `schedulerPeer` pour ne pas casser le
contrat v1 existant ; il publie aussi `networkTransport=iroh`.

En mode `swarm_v3_shadow.mode=active`, les champs historiques
`prefill_contract_ready`, `pipeline_ready` et `routing_ready` ne décident plus de la disponibilité.
Le registry exige simultanément `status=available` et `swarm_v3_shadow.state=route_ready`. Une
route `no_feasible_route`, même avec un ancien statut optimiste, reste donc fermée. Les schedulers
historiques restent lisibles uniquement pour diagnostic.

L'IDE ne retombe plus silencieusement sur le swarm 1.7B/Lattica si le registry est indisponible :
son fallback pointe vers `qwen3-4b-v3`, Qwen3-4B et l'EndpointId Iroh qualifié. Le fetch ponctuel
de statut préfère `scheduler_endpoint_id`; le parsing de `node_join_command` ne subsiste que comme
fallback de lecture historique. Le helper labo versionné sait maintenant piloter explicitement le
profil `iroh` sur macOS et Windows sans confondre ses propres processus `awk` avec un worker.

### Déploiement et preuves exactes

Le scheduler VPS utilise l'image
`local/parallax-scheduler:swarm-v3-2c564cc`, construite comme overlay source sur l'image
`9cee193` et étiquetée avec le SHA complet exact. Le conteneur précédent est conservé arrêté sous
`parallax-scheduler-qwen3-4b-v3-pre-2c564cc`. Les mêmes volumes de cache, état, identité, root TUF
et secret relay ont été réutilisés.

Le binaire registry Linux self-contained déployé sous systemd a le SHA-256
`05831dcfccc7a7b0b355c4049dc0cb183de8762621f0c5ad438855e28b958e37`; l'ancien binaire est
conservé sous `/opt/fabi-registry/fabi-registry.pre-1fd9b60`.

Après redémarrage propre Mac mini + RTX, la V3 a volontairement traversé
`waiting_workers`, `no_feasible_route`, `scheduler_transition` puis `verifying`. Elle n'a annoncé
`route_ready` qu'après la nouvelle lease DHT et la vérification locale des poids RTX. L'état public
final observé est :

- `status=available`, `swarm_v3_shadow.state=route_ready`, deux workers acceptés ;
- EndpointId scheduler
  `e88817843267aed089d8aa88bcca70426c3bfe93670289eaddd6abb74009b625` ;
- `networkTransport=iroh`, `pipelineReady=true`, `routingReady=true` ;
- capacité de contexte mesurée publiée : `25 072` tokens ;
- smoke génération authentifiée après déploiement : HTTP 200, SSE jusqu'à `[DONE]`, zéro erreur,
  TTFT `4,999904 s`, total `6,423056 s`.

Validations locales : suite moteur `730 passed, 7 skipped` avec le seul warning externe
Starlette/httpx déjà connu ; Ruff ciblé vert ; registry typecheck, build Linux et `16 passed` ;
build TypeScript IDE vert et `27 passed`.

### Bootstrap relay produit : décision issue du code Iroh officiel

L'audit du chemin installable a confirmé une limite importante : le worker lancé par l'IDE ne
reçoit pas encore le profil complet V3 (relay, DHT, root TUF et répertoires d'état), et le runtime
qualifié déclaré par l'IDE reste `v2.7.0-rc29` / Parallax `c14c997...`, antérieur au moteur V3 de
ce jalon. Le chemin manuel qualifié fonctionne ; le chemin utilisateur « installer puis
contribuer » n'est donc **pas encore** déclaré prêt.

Ne pas embarquer ou retourner le secret relay partagé dans l'IDE. Le code officiel Iroh 1.0.3,
exactement la version pincée par Fabi, documente que `shared_token` ne peut être révoqué qu'en
redémarrant le relay. Il fournit à la place un contrôle d'accès HTTP par EndpointId et couvre aussi
une allow-list dynamique avec révocation des connexions actives :

- [documentation officielle du contrôle d'accès relay](https://github.com/n0-computer/iroh/blob/7d8c9bf05d3f77dd0ef85f5f2f028f4fd0e72f55/iroh-relay/README.md#access-control) ;
- [tests officiels de révocation à chaud](https://github.com/n0-computer/iroh/blob/7d8c9bf05d3f77dd0ef85f5f2f028f4fd0e72f55/iroh-relay/tests/runtime_auth.rs).

Le design retenu pour la prochaine étape est donc : identité Iroh stable créée localement,
enrôlement HTTPS court avec credential de compte et preuve de possession, allow-list EndpointId
persistée avec TTL/révocation, puis `access.http` côté relay. Le worker ne reçoit plus le secret
global. Il faut implémenter et tester ce bootstrap avant de déclarer tous les chemins V3 prêts.

### Ordre de reprise exact

1. implémenter l'enrôlement EndpointId et le contrôle `access.http` du relay, avec stockage
   persistant, TTL, révocation, limites et tests de bootstrap/reconnexion ;
2. définir un profil de connexion V3 versionné dans le registry : relay URL, EndpointId scheduler,
   bootstraps DHT et endpoints TUF, sans secret ;
3. livrer la root TUF publique pinée dans le runtime et faire construire automatiquement les
   chemins identité, catalogue, fence DB et état V3 sur macOS/Windows/Linux ;
4. reconstruire une nouvelle release runtime depuis le commit moteur qualifié, valider les trois
   artefacts CI puis l'installer sur Mac mini et RTX ;
5. faire l'E2E depuis un clone IDE local complet : sélection modèle, install runtime, enrôlement,
   contribution autonome, prompt OpenCode, SSE, outils, permissions, abort et changement modèle ;
6. seulement ensuite reprendre la route de secours worker-disjointe et les kills prefill/decode.

## Enrôlement relay automatique, bootstrap IDE et qualification réelle du 28 juillet 2026

Cette section remplace l'ordre de reprise relay ci-dessus. Le chemin sans secret global est
maintenant implémenté et qualifié sur le VPS, le Mac mini et le RTX. Les commits poussés sont :

- `swarm-engine/codex/swarm-protocol-v3` :
  `98889e6216c00bc3aca3c91136e0203426d37316` (`feat(network): enroll Iroh endpoints
  automatically`) puis `c91ab3dad373fe60e267178e274fe89739915ea5` (`fix(ci): install protocol
  HTTP dependency`) ;
- `fabi/main` : `adc6a71` (`feat(registry): authorize relay endpoints dynamically`),
  `ba85065` (`fix(registry): separate relay infrastructure identities`) puis `855ceb5`
  (`fix(registry): accept Iroh relay node header`) ;
- `fabi-IDE/main` : `427284d` (`feat: bootstrap V3 workers automatically`).

### Design produit retenu après recherche primaire

Le design combine des invariants déjà éprouvés au lieu d'exposer le token partagé Iroh :

- comme Tailscale, la clé privée du device reste locale et seule l'identité publique est enrôlée ;
- comme libp2p AutoNAT/Circuit Relay v2/DCUtR, le relay est un chemin de repli borné, pas une
  identité partagée ni une obligation pour le trafic worker-to-worker ;
- comme Petals, l'identité et les annonces sont durables, la joignabilité est mesurée et le
  réseau continue à se réparer hors du chemin d'inférence ;
- l'implémentation utilise directement `access.http` d'Iroh 1.0.3. Iroh envoie l'EndpointId au
  registre et n'autorise la connexion que pour un HTTP 200 dont le corps est exactement `true`.

Sources primaires relues :

- [Iroh relay access control 1.0.3](https://github.com/n0-computer/iroh/blob/7d8c9bf05d3f77dd0ef85f5f2f028f4fd0e72f55/iroh-relay/README.md#access-control) ;
- [libp2p DCUtR](https://docs.libp2p.io/concepts/nat/dcutr/) et
  [Circuit Relay](https://docs.libp2p.io/concepts/nat/circuit-relay/) ;
- [Tailscale node keys](https://tailscale.com/kb/1010/node-keys) ;
- Petals officiel au commit `22afba627a7eb4fcfe9418c49472c6a51334b8ac`, notamment le cycle
  serveur/DHT/relay ;
- [Microsoft App Control : audit des binaires bloqués](https://learn.microsoft.com/windows/security/application-security/application-control/app-control-for-business/deployment/audit-appcontrol-policies)
  et [catalogues signés](https://learn.microsoft.com/windows/security/application-security/application-control/app-control-for-business/deployment/deploy-catalog-files-to-support-appcontrol).

Le blocage de compilation Cargo sur le PC Windows (`os error 4551`) venait bien d'Application
Control qui refusait les `build-script-build.exe` temporaires non approuvés. La politique n'a pas
été désactivée et aucune exclusion locale n'a été ajoutée. La solution produit est de construire
les wheels dans la CI, les vérifier puis les distribuer par le runtime.

### Contrat d'enrôlement réellement implémenté

Le moteur natif Rust crée une preuve Ed25519 avec préimage binaire versionnée et domaine séparé.
Le worker envoie credential de compte, EndpointId, timestamp et nonce unique au registre HTTPS
avant d'ouvrir Iroh. Une boucle indépendante renouvelle la lease toutes les six heures ; les
échecs ont retry/backoff et ne bloquent ni heartbeat ni génération. La clé Iroh stable reste dans
le répertoire data Fabi.

Le registre Bun valide simultanément le credential de compte, la possession de la clé, la fenêtre
temporelle et le nonce anti-replay. Les leases sont persistées dans SQLite WAL, bornées à seize
devices actifs par compte, expirent après 24 heures et peuvent être révoquées. Le callout relay est
protégé par un bearer machine-à-machine distinct. Les identités d'infrastructure scheduler et
catalog router vivent dans une allowlist opérateur séparée : elles ne prétendent jamais être des
devices contributeurs.

Le profil public `workerConnection` contient uniquement relay URL, URL d'enrôlement, bootstrap
DHT et URLs TUF. L'IDE :

1. télécharge ce profil ;
2. vérifie HTTPS et la structure du contrat ;
3. télécharge une root TUF de taille bornée ;
4. compare son SHA au pin **embarqué dans l'IDE**, pas seulement au hash retourné par le serveur ;
5. écrit root et profil atomiquement avec permissions owner-only ;
6. prépare automatiquement identité Iroh, identité DHT, état V3 et fence DB ;
7. lance le worker en `iroh`, DHT client, placement autonome et V3 active.

`FABI_RELAY_TOKEN` et `FABI_RELAY_TOKEN_FILE` hérités sont supprimés de l'environnement du worker.
Une installation neuve n'a donc plus de secret relay global à copier. Le seul prérequis utilisateur
restant est le login/credential de compte déjà nécessaire au gate de contribution.

### Écart doc/code Iroh découvert pendant la bascule

La documentation et le commentaire de `iroh-relay` 1.0.3 annoncent le header
`X-Iroh-Endpoint-Id`, mais la constante du binaire publié vaut en réalité `X-Iroh-NodeId`. Le
registre suivait initialement la documentation et recevait donc `null`, ce qui a correctement
fermé toutes les connexions. Une capture limitée à ce seul header sur la boucle locale a isolé
l'écart. `855ceb5` accepte désormais les deux orthographes et les teste, afin de supporter le
binaire piné comme une future correction upstream.

Le debug Iroh affiche la configuration complète et a inscrit le bearer M2M dans le journal pendant
ce diagnostic. Ce bearer a immédiatement été considéré compromis, remplacé dans les deux services
et les processus ont été redémarrés au niveau `info`. Aucun credential de compte worker ni secret
utilisateur n'a été exposé. Ne jamais réactiver `RUST_LOG=iroh_relay=debug` sur ce service sans
filtrage de la structure `ServerConfig`.

### CI, artefacts et déploiement exacts

La première matrice du commit `98889e6` a échoué avant les tests protocole parce que le workflow
minimal installait le projet avec `--no-deps` sans installer `requests`, pourtant déclaré dans
`pyproject.toml`. Ce n'était pas un échec Rust ou Windows. `c91ab3d` corrige la dépendance CI.

Le run GitHub Actions `30360413957` est vert sur Windows, macOS et Ubuntu. Chaque job a exécuté
formatage, Clippy warnings interdits, tests Rust/Python bindings et DHT trois nœuds, build wheel,
installation réelle de la wheel, import de l'API native, tests contrats/trust/discovery/shadow puis
upload. Les actions v4/v5 produisent seulement un avertissement de dépréciation Node 20 à traiter
séparément.

Artefacts installés au labo :

- Windows ABI3 x64 CI : SHA-256
  `b99ac940c74b7b207c599127ed12b2c3d914243497b375d1e66ce0308bbbe190` ;
- macOS ARM64 : SHA-256
  `6fc7933d4d0ff48db7c5640b433d9ad74884ffbcb7a6810318ff88e7db8e6508` ;
- root TUF bootstrap : SHA-256
  `7ef69b40b4ba41fc8da5742f54303b388fe3192585a8f45b452079861ac3f0ce`.

Le binaire registry `855ceb5` déployé sur le VPS a le SHA-256
`aa26c5356aa069fd7092b5b5172eefc5de317f01f899c8745579d9f0c3fad559`. Les versions précédentes
et les configs relay précédentes sont conservées en backups explicites. Le relay utilise désormais
`access.http.url = http://127.0.0.1:3002/v1/network/relay-access`; le service n'importe plus
`relay.env` et charge seulement le bearer HTTP privé.

### Qualification labo après migration

Les quatre identités nécessaires sont autorisées : scheduler `e888…b625`, catalog router
`5884…8d75`, RTX `c4a8…3714` et Mac mini `eac4…64ec`. Les métriques relay après stabilisation
montrent quatre clients uniques, quatre connexions acceptées, aucun disconnect et des octets dans
les deux sens. Aucun refus n'a été observé pendant les 90 secondes du contrôle final.

Le VPS était encore pollué par six schedulers historiques V2/Lattica sans workers. Ils ont été
arrêtés sans suppression ; seuls `parallax-scheduler-qwen3-4b-v3` et `fabi-catalog-router-2`
restent actifs. Le registre public ne publie plus qu'un swarm.

Après connexion Windows puis Mac et reformation autonome :

- Mac mini M4 : layers `[0,25)`, MLX prêt, KV mesuré `16 384` tokens ;
- RTX 4080 SUPER : layers `[25,36)`, vLLM prêt, KV mesuré `164 960` tokens ;
- route `available` / `route_ready`, deux workers `healthy`, réservations revenues à zéro ;
- contexte routable exact `16 384`, limité par l'enveloppe live du Mac au démarrage ;
- lien worker-to-worker direct qualifié, aucun worker dans `relayed_peer_ids` ;
- workers vers scheduler via relay, RTT observés environ `87-90 ms`.

Le premier appel depuis le Mac courant a reçu HTTP 403 `contribution_required`. Les empreintes ont
confirmé que ce Mac utilise un autre compte que le Mac mini et le RTX : le gate fonctionne et n'a
pas été contourné par l'enrôlement réseau.

Depuis le compte réellement contributeur du Mac mini, le vrai E2E OpenAI/SSE a retourné :

- HTTP 200 ;
- premier événement `1,223 s`, premier contenu `1,729 s`, total `3,846 s` ;
- `19` chunks, `[DONE]` reçu ;
- contenu exact `FABI-DYNAMIC-RELAY-E2E-OK` ;
- route toujours disponible et réservations KV à zéro après la génération.

### Validations et limites honnêtes

- moteur `98889e6` : `736 passed, 7 skipped`, seul warning Starlette/httpx externe connu ;
- natif : `cargo fmt`, Clippy tous targets/features avec `-D warnings`, `23 passed` ;
- registre : `25 passed`, typecheck et build Linux verts ;
- IDE : `29 passed` et build TypeScript vert ;
- preuve inter-langages : la preuve produite par le Rust natif a été acceptée par le registre Bun ;
- tests registre couvrent credential, signature, timestamp, replay nonce, limite devices,
  révocation, infrastructure séparée et les deux headers Iroh.

Ce jalon ne signifie pas encore « release utilisateur terminée ». Restent obligatoires :

1. publier une nouvelle release runtime multi-OS contenant `98889e6/c91ab3d` et ses wheels, puis
   faire consommer cette release par l'IDE au lieu des candidats labo ;
2. tester une installation IDE réellement neuve depuis un clone local complet : fetch profil,
   root TUF, création identité, enrôlement, contribution, redémarrage et renouvellement de lease ;
3. faire l'E2E UI complet OpenCode : sélection modèle, streaming, outils, permissions, abort et
   changement de modèle ;
4. refaire le gros contexte ~12 220 tokens d'entrée + 4 096 réservés. La route live actuelle est
   exactement à 16 384 et ne doit donc pas accepter un budget supérieur ;
5. provoquer expiration/révocation d'une lease active et vérifier la déconnexion puis le
   ré-enrôlement après login ;
6. ajouter une vraie route worker-disjointe, kills prefill/decode, promotion, fencing et replay KV ;
7. persister/répliquer le journal entre plusieurs routing servers, puis poursuivre quotas/Sybil,
   multi-modèles et pairing multi-machine.

## Nettoyage définitif V2 et premier parcours UI packagé du 28 juillet 2026

Le premier lancement de l'application macOS packagée a révélé deux problèmes d'intégration
distincts, sans rapport avec le moteur d'inférence :

- les actions `Fabi Swarm` et `Chat IA` de l'accueil visaient une ancienne vue/anciens identifiants
  de commande. Le commit IDE `a3b4de1` les branche sur la commande réelle `fabi.newChat` ;
- cinq conteneurs scheduler V2 arrêtés possédaient encore une politique de redémarrage Docker et
  s'étaient relancés. Le catalogue publiait alors plusieurs anciens modèles ; l'IDE sélectionnait
  le premier, Qwen3-1.7B, dont le profil n'avait pas de `schedulerPeer`. C'est la cause exacte de
  l'écran grisé `Aucun peer scheduler trouvé pour ce swarm`.

Les conteneurs exacts `parallax-scheduler`, `parallax-scheduler-qwen3-8b`,
`parallax-scheduler-glm-4_5`, `parallax-scheduler-qwen3-coder-30b` et
`parallax-scheduler-qwen3-coder-480b` ont d'abord reçu `restart=no`, ont été arrêtés proprement,
puis ont été supprimés explicitement à la demande de l'opérateur. Aucune donnée ni aucun conteneur
hors de cette liste n'a été supprimé. Le VPS ne conserve plus que
`parallax-scheduler-qwen3-4b-v3` pour l'inférence et `fabi-catalog-router-2` pour le catalogue.

Le registre public retourne désormais uniquement `qwen3-4b-v3`, avec :

- peer scheduler `e888…b625`, transport `iroh` et protocole worker V3 ;
- `pipelineReady=true`, `routingReady=true`, contexte annoncé `16 384` ;
- deux nœuds actifs et la route Mac mini M4 vers RTX 4080 SUPER prête.

Après actualisation, l'application packagée affiche bien `Qwen3-4B`, `3 nœuds` et `48 Go` ; le
message d'absence de peer a disparu. Le troisième nœud est le Mac de développement lancé par
l'IDE. Il rejoint réellement Iroh, renouvelle ses heartbeats et est vu `healthy`. Sous la charge
initiale il annonçait `2 316 206 080` octets utilisables et le placement autonome lui a choisi
`[25,31)`, soit six couches. Le selective download a matérialisé six fichiers d'environ 202 Mo,
puis l'exécuteur MLX a chargé 1,128 Go de poids et réservé 0,75 Go de KV pour 32 768 tokens.
Le nœud est ensuite passé `available / ready / healthy` et l'input de l'IDE s'est déverrouillé.
Le scheduler n'a pas dégradé la route déjà prête.

Un essai intermédiaire avec une enveloppe momentanément plus grande a choisi huit couches
`[25,33)`, puis le runtime MLX a correctement refusé le contrat KV 32k lorsque la pression live
ne laissait plus de marge après chargement. Aucun OOM système n'a eu lieu. Le superviseur a
redémarré le worker et le placement suivant a retenu les six couches qui tiennent réellement.
Cette boucle doit encore être améliorée pour re-sélectionner localement un span plus court sans
redémarrer tout le process.

La comparaison avec Petals `22afba6` confirme le comportement attendu : un nouveau serveur choisit
les blocs les moins couverts en incluant les annonces `JOINING`, les matérialise, puis ne se
rééquilibre que si le gain est suffisant et si le mouvement ne rend pas le swarm disjoint. La V3
Fabi suit ce principe avec une demande cible de deux répliques par couche ; ce test démontre qu'une
pipeline déjà complète n'empêche pas un nouveau worker de prendre une tranche.

L'IDE avait toutefois un défaut de présentation : après 35 polls espacés d'une seconde,
`no_eligible_worker`
devenait artificiellement `Contribution non reconnue`, alors qu'un selective download légitime
peut durer plusieurs minutes. Ce timeout sémantique est supprimé. Tant que le worker est sain,
le statut reste `Préparation de ta contribution`, les vérifications continuent avec backoff
exponentiel borné et jitter, et seuls `invalid_credential`/`missing_credential` deviennent un
refus définitif. Les 32 tests du paquet et son build TypeScript sont verts.

La release runtime `v2.7.0-rc31` est encore en qualification au moment de cette note : les builds
Linux ARM CPU, Linux x64 CPU et macOS ARM MLX sont verts ; Linux CUDA, macOS Intel et Windows CUDA
sont encore en cours. L'IDE pointe localement vers rc31 pour la qualification, mais ce pin ne doit
être commité qu'après les six jobs verts et l'installation réelle sur le Mac mini et le PC RTX.

## Gros contexte OpenCode, saturation et drain mémoire du 29 juillet 2026

Cette section remplace le statut provisoire rc31 ci-dessus. Le run release rc31
`30363519448` s'est terminé entièrement vert sur Linux ARM/x64 CPU, Linux x64 CUDA,
Darwin ARM MLX, Darwin Intel CPU et Windows x64 CUDA.

### E2E UI réel et budget de sortie adaptatif

L'application macOS a été reconstruite depuis le clone local complet avec Node 22. Un vrai prompt
OpenCode contenant `13 548` tokens d'entrée a été envoyé sur la route labo 16k avec `2 048` tokens
de sortie réservés, soit `15 596 <= 16 384`. La réponse exacte a été streamée jusqu'au bout :

- TTFT froid `52,160 s`, débit `7,62 tok/s`, `133` tokens de sortie ;
- génération suivante à chaud : TTFT `2,306 s`, environ `7,57 tok/s` ;
- réservations relâchées après génération.

L'essai volontaire `13 496 + 4 096 = 17 592` a été refusé puisque la route 16k ne peut pas porter
ce contrat. OpenCode 1.15 calcule son budget d'entrée en soustrayant `limit.output` de
`limit.context`. L'IDE réserve donc localement `min(4 096, floor(context / 8))` : 2k sur une
route 16k et 4k à partir de 32k. Un override explicite reste disponible pour les expériences.

### Couverture chargée distincte de la capacité instantanée

Pendant une génération, les leases annoncent correctement zéro KV instantanément libre. Le
scheduler transformait toutefois cette saturation en `no_feasible_route`, puis le registre et
l'IDE affichaient à tort un nouveau bootstrap du modèle. Le commit moteur
`217d5ba` ajoute une planification structurelle exacte qui remplace uniquement le KV libre par
l'enveloppe KV mesurée, sans ignorer leases, poids, liens ou liveness. Le statut V3 distingue :

- `structural_pipeline_ready` : au moins une route complète est chargée ;
- `admission_ready` : une nouvelle requête peut être réservée maintenant.

Le registre `cf40e03` et l'IDE utilisent cette séparation. Une route chargée mais saturée affiche
`Swarm occupé`, jamais `Bootstrapping du modèle`.

### Cause et correction du worker bloqué sous pression mémoire

Le Mac de développement a ensuite franchi le seuil critique de mémoire. La détection et la
fermeture d'admission étaient correctes, mais `_wait_executors_check_layer_change` posait
`_memory_shutdown_requested` puis continuait d'attendre un exécuteur qui ne pouvait pas deviner
ce signal. Le même log était donc répété chaque seconde et le worker restait indéfiniment
`warming`.

Petals `22afba627a7eb4fcfe9418c49472c6a51334b8ac` a été relu dans `server.py`,
`block_selection.py`, `memory_cache.py`, `utils/dht.py` et
`client/inference_session.py`. Son invariant pertinent est : retirer l'admission, terminer les
requêtes, annoncer la transition, fermer explicitement handlers/runtime/backends, nettoyer les
caches CUDA/MPS, puis seulement recharger.

Le commit moteur poussé `591cc3b8f338a763fb0540cc4d5be36097c484be`
(`fix(runtime): complete critical memory drain`) remplace le booléen ambigu de supervision par
trois issues typées : sortie normale, reload de placement et arrêt mémoire. Une pression critique
rend exactement une issue terminale lorsque `current_requests == 0`, ou à la fin du délai de
sécurité borné. Le lanceur ferme alors frontend, exécuteurs et P2P dans l'ordre ; le superviseur
IDE redémarre ensuite le worker et l'enveloppe mémoire est recalculée depuis la disponibilité live.
Il n'existe toujours aucun redimensionnement vers le haut ni réallocation continue pendant une
génération.

Validations :

- tests ciblés pression/lancement : `38 passed` ;
- suite moteur complète : `739 passed, 7 skipped`, seul warning externe Starlette/httpx connu ;
- Ruff ciblé, format et `git diff --check` verts ;
- IDE : build TypeScript et `35 passed`.

### Comparaison Petals/Exo encore à intégrer

La V3 respecte déjà l'autorité de placement demandée : en mode active, le scheduler refuse un
worker legacy, ignore ses éventuelles couches retournées et le worker choisit seul son span depuis
le catalogue/DHT signé. Le VPS reste coordinateur de requête, de réservations et de streaming.

Deux améliorations de placement restent néanmoins réelles :

1. Petals pondère la couverture par le débit de chaque serveur. Fabi collecte déjà le débit et
   l'utilise pour estimer les routes, mais `CapacityDemandMap.uniform(..., desired_replicas=2)`
   compte encore les répliques de manière uniforme lors du choix autonome du span.
2. Exo actuel filtre ses cycles par mémoire/backend/RDMA et préfère une route dont les nœuds ont
   déjà téléchargé le modèle. Fabi possède mémoire exacte, compatibilité backend, métriques
   direct/relay et téléchargement sélectif, mais la localité du cache de shards n'entre pas encore
   dans le score de placement.

Petals reste plus décentralisé pour la reprise d'une session : le client remplace un span depuis
la DHT et rejoue son historique d'activations sur le remplaçant. Fabi implémente une garantie plus
forte pour OpenCode : route de secours worker-disjointe réservée, journal de tokens avant SSE,
promotion avec nouvel epoch, fencing et replay `prompt + préfixe commis`. Cette garantie passe les
tests intégrés mais n'est pas qualifiée sur une vraie seconde couverture complète.

### Release rc32 en cours et ordre de reprise

Les pins immuables sont poussés :

- `fabi-cli/dev` `c1406947c364d0cbd39b17177342408d674cb1a4` ;
- `swarm-engine/codex/swarm-protocol-v3`
  `591cc3b8f338a763fb0540cc4d5be36097c484be` ;
- `fabi/main` `10ce5a11fb572c56a314dfe8d67792377e2dec5f`.

Le tag `v2.7.0-rc32` est poussé. Le run release `30429459757` est en cours ; ne pas déclarer cette
release qualifiée avant les six jobs verts.

Ordre exact :

1. attendre et diagnostiquer toute plateforme rc32 en échec, surtout Windows CUDA ;
2. installer rc32 sur Mac mini et RTX, confirmer les SHA/manifestes et redémarrer les deux workers ;
3. déployer le scheduler moteur `591cc3b` et le registre `cf40e03`, puis vérifier états structurel
   et admission pendant une génération ;
4. reconstruire l'IDE avec son pin rc32, refaire sélection, contribution, SSE, outils,
   permissions, abort et changement de modèle ;
5. provoquer une pression critique contrôlée sur un worker sans requête puis avec requête active,
   et vérifier un seul drain, départ DHT, restart et span plus petit ;
6. ajouter une deuxième couverture complète avec RunPod ou d'autres machines et qualifier les
   kills prefill/decode, promotion, fencing et replay ;
7. intégrer ensuite demande pondérée par débit/popularité et localité des shards, avec simulation
   de centaines/milliers de workers avant toute bascule.

## Coordination client, capacités Biscuit et reprise Petals du 29 juillet 2026

Cette section est un jalon de développement local **non encore commité ni déployé**. Elle complète
la décision V3-only : le placement des couches reste autonome côté workers, et la coordination
d'une génération doit normalement vivre dans un agent Fabi local. Le gateway VPS reste un fallback
V3 pour les environnements où un client Iroh local ne peut pas tourner ; il ne redevient pas un
scheduler de placement.

### Décision issue de la comparaison Petals/Fabi

Petals reconstruit une session en replanifiant depuis sa DHT et en remplaçant le span fautif ; il
ne réserve pas un deuxième pipeline complet pour chaque requête. Fabi doit reprendre cette propriété
comme comportement normal, tout en conservant ses invariants plus stricts : budget KV exact,
PREPARE/COMMIT, epoch/fencing, journal de tokens avant SSE et contrôle de contribution.

Les politiques de reprise deviennent explicites :

1. `best_effort` ;
2. `replan_cold`, qui choisit une nouvelle route puis rejoue prompt + tokens déjà commis ;
3. `activation_replay`, qui remplace si possible le span/suffixe fautif depuis un historique
   d'activations borné ;
4. `reserved_route` et `hot_replica`, garanties coûteuses et opt-in.

La route de secours complète pré-réservée ne doit donc plus être le défaut. Une couverture
alternative observée dans la DHT est une possibilité structurelle, pas une garantie de capacité.

Sources primaires relues :

- Petals `sequence_manager.py`, `inference_session.py` et `block_selection.py` au commit
  `22afba627a7eb4fcfe9418c49472c6a51334b8ac` ;
- Hivemind pour DHT/leases ;
- Exo pour topologie, mémoire/backend/RDMA et localité des téléchargements ;
- spécification Biscuit et implémentation Rust Eclipse Biscuit 6.0.

### Socle effectivement implémenté dans `swarm-engine-v3`

Le moteur natif Rust utilise désormais `biscuit-auth = 6.0.0` pour émettre et vérifier hors ligne
des capacités Ed25519 scellées. Une capacité est liée simultanément à :

- permit et compte ;
- request et model swarm ;
- EndpointId du coordinateur client réellement authentifié par Iroh ;
- SHA-256 des **octets exacts déjà signés** du `RoutePlan`, sans resérialisation ambiguë ;
- epoch, budget de contexte maximal, politique de reprise et expiration.

La durée maximale est cinq minutes avec skew borné. Une capacité copiée ne peut pas autoriser un
autre coordinateur, plan, modèle, epoch, contexte ou niveau de reprise. Les identifiants de
révocation Biscuit font 64 octets, donc 128 caractères hexadécimaux ; le test du vrai wheel a
détecté et corrigé une première modélisation erronée en SHA-256/64 caractères.

`WorkerExecutionAdmission` n'est plus couplé techniquement à un unique coordinateur global :

- `FixedCoordinatorRouteAuthority` préserve le runtime gateway actuel pendant la migration ;
- `CapabilityRouteAuthority` accepte un agent Fabi dynamique seulement avec le Biscuit exact ;
- l'identité du coordinateur, le plan et le permit sont stockés par route ;
- COMMIT/RENEW/RELEASE, frontend et data plane sont vérifiés contre cette route ;
- un `FENCE` dynamique sans route admise est refusé ;
- un plan signé dont `coordinator_id` diffère du signataire est refusé.

Le keyset de capacité et les révocations sont une cible TUF `route-authorities.json`. L'opérateur
du registre sait la publier lors d'`init-staging` et `publish`. Le worker charge le keyset signé au
démarrage, le rafraîchit sur un thread indépendant pour ne bloquer ni PREPARE ni heartbeats,
conserve le dernier état authentifié pendant une panne réseau, puis fail-close à son expiration.
La rotation vérifie aussi l'absence de recul de génération.

L'émetteur de service refuse de signer tant que :

- le plan et l'appelant Iroh ne correspondent pas ;
- le plan sort du modèle, du contexte, de l'expiration ou des politiques accordées au permit ;
- sa propre clé publique n'est pas active dans le keyset TUF courant.

Enfin `RouteReservationCoordinator` accepte maintenant un authorizer de plan. Un test intégré
construit un pipeline deux workers sans coordinateur VPS configuré : le client signe le plan,
obtient un Biscuit, transmet PREPARE aux deux workers puis réalise COMMIT, RENEW et RELEASE.

### Validations exactes de ce jalon local

- `157 passed` pour `tests/test_swarm_protocol_*.py` ;
- suite moteur complète : `748 passed, 7 skipped`, avec le seul warning externe
  Starlette/httpx déjà connu ;
- `4 passed` pour les tests Rust Biscuit ;
- `cargo check --all-features`, `cargo clippy --lib --all-features -- -D warnings` et
  `cargo fmt --check` verts ;
- wheel ABI3 macOS ARM release construit, installé, importé, puis émission/vérification,
  mauvais digest, expiration et révocation testés via l'API Python réelle ;
- tests TUF couvrant signature, rotation, révocation, substitution de key ID, panne registre et
  expiration.

L'avertissement Rust restant vient de la dépendance transitive Biscuit
`proc-macro-error2 2.0.1`, signalée comme future-incompatible mais acceptée par la toolchain
actuelle. Il n'est ni masqué ni interprété comme une validation future.

Le run runtime rc32 `30429459757` est désormais entièrement vert, y compris Windows CUDA et Linux
CUDA. Cela qualifie la construction des artefacts rc32, mais **rc32 n'a pas encore été installé et
revalidé sur le Mac mini et le RTX** dans ce jalon.

Le socle a été poussé dans `swarm-engine/codex/swarm-protocol-v3` au commit
`c4eab05b0ef7dcf0234565fc8ee00d34fcd1a089`. Le run natif `30433012518` est entièrement vert sur
Ubuntu, macOS 15 et Windows : fmt, Clippy strict, tests Rust/Python/DHT, construction et
installation des trois wheels ABI3, import de leur surface, 157 tests protocole puis upload.
Seuls les avertissements GitHub Actions Node 20 déjà connus restent présents.

### Reprise exacte

1. exposer l'émission de permit/capacité au Request Agent local avec ledger atomique et quotas ;
2. exécuter le planner DHT et `RouteReservationCoordinator` dans le runtime local Fabi ;
3. servir localement l'API OpenAI/OpenCode et le SSE commit-before-publish ;
4. remplacer la pré-réservation de secours par replanification à froid, puis ajouter l'historique
   d'activations borné pour le remplacement de span façon Petals ;
5. conserver le gateway coordonné actuel comme fallback V3 explicite ;
6. publier/installer un runtime contenant ce socle, puis qualifier Mac mini + RTX + troisième
   worker, NAT, churn et kills prefill/decode ;
7. seulement après, basculer l'IDE packagé sur le Request Agent local par défaut.

## Ledger atomique des permits et émission idempotente du 29 juillet 2026

Le premier point de la reprise ci-dessus est désormais implémenté côté moteur, sans encore être
exposé par une API publique de l'IDE ni déployé sur les machines du labo.

### Contrat transactionnel

`SqliteRoutePermitLedger` fournit le backend durable mono-instance de l'autorité de contribution :

- WAL SQLite, `busy_timeout`, clés étrangères et transactions `BEGIN IMMEDIATE` ;
- quota de permits actifs par compte pris atomiquement, y compris entre deux connexions/processus ;
- clé d'idempotence `(account, request, coordinator EndpointId)` ;
- permit lié au modèle, au contexte maximal, aux politiques de reprise et à une expiration ;
- claim de plan lié au digest exact, avec compare-and-swap d'epoch ;
- même epoch + même digest idempotent, fork au même epoch refusé, recul d'epoch refusé ;
- expiration et release qui rendent la capacité de compte disponible ;
- persistance de chaque capability émise et de son identifiant de révocation Biscuit.

Le fichier qui contient les capabilities bearer est créé en mode `0600` sur Unix et un fichier
préexistant lisible par le groupe ou les autres utilisateurs est refusé. L'API de service dépend
d'un `RoutePermitLedger` structurel plutôt que de SQLite directement : SQLite est le backend
correct pour une autorité Fabi mono-instance ; un adaptateur PostgreSQL avec transactions et
verrous de ligne reste requis avant de distribuer horizontalement plusieurs autorités d'émission.

### Émission sûre face aux retries

Le binding Rust exporte maintenant
`route_capability_root_revocation_id(public_key, token)`. Il authentifie d'abord la signature
Biscuit, puis extrait l'identifiant du bloc d'autorité que le ledger doit pouvoir révoquer.

`RouteCapabilityService` enchaîne :

1. lecture du permit actif et vérification du compte ;
2. signature du `RoutePlan`, identité Iroh du Request Agent, TUF, contexte, modèle, durée et
   politique ;
3. claim atomique du digest/epoch ;
4. retour de l'émission déjà stockée en cas de retry exact ;
5. sinon émission Biscuit, persistance, puis réponse.

Si deux appels concurrents fabriquent momentanément deux tokens, l'insertion atomique choisit le
premier et tous les appelants retournent ce token persistant. Un retry après perte de réponse ne
crée donc ni deuxième autorisation exploitable ni branche d'epoch. Un contrat différent sur le
même epoch est refusé. La révocation du permit retourne tous les identifiants Biscuit encore
vivants ; le vérificateur Rust les refuse effectivement.

Cette étape suit les primitives documentées de SQLite (`BEGIN IMMEDIATE`/WAL) et garde un contrat
de stockage transposable aux transactions et row locks PostgreSQL. L'ancien pattern de lock Redis
`SETNX` n'a pas été retenu comme source de vérité : il ne fournit pas à lui seul les invariants
multi-lignes quota + epoch + émission nécessaires.

### Validations exactes

- suite Python complète : `755 passed, 7 skipped`, seul warning externe Starlette/httpx connu ;
- tests ciblés capability/ledger/coordinator : `16 passed` ;
- Rust : `28 passed`, dont cinq tests Biscuit/capability ;
- `cargo fmt --check` et `cargo clippy --all-targets --all-features -- -D warnings` verts ;
- Ruff ciblé et `git diff --check` verts ;
- wheel ABI3 macOS ARM release reconstruite, réinstallée et testée via l'extension réelle ;
- la CI native vérifie désormais explicitement les quatre exports de capability sur Linux,
  macOS et Windows.

Le moteur correspondant est poussé sur `codex/swarm-protocol-v3` au commit
`9cce7171b8c7e5237f2440c4347e7b57f27d7486`. Le workflow `30434984193` est entièrement vert sur
Ubuntu, macOS 15 et Windows, y compris wheels ABI3, imports, Rust/DHT et tests protocole.

Une commande locale additionnelle `cargo test --all-features` n'est pas comptée comme validation :
sur ce Mac elle tente de lier la `cdylib` PyO3 de test sans les symboles Python et échoue au linker.
`cargo test` normal, la wheel Maturin réelle et les tests Python natifs passent. Le workflow
multi-OS supporté construira et installera la wheel avant les tests protocole.

### Reprise exacte après ce jalon

1. exposer création/release/révocation de permit et émission de capability derrière
   l'authentification du Request Agent et le gate de contribution réel ;
2. déplacer planner DHT et `RouteReservationCoordinator` dans le runtime local ;
3. servir l'API OpenAI/OpenCode locale et son journal SSE commit-before-publish ;
4. implémenter `replan_cold`, puis le replay borné d'activations façon Petals ;
5. intégrer l'état du Request Agent et les erreurs typées dans l'IDE ;
6. publier le runtime, l'installer sur Mac mini/RTX, ajouter une couverture complète, puis
   qualifier NAT, churn et kills prefill/decode.

## Autorité HTTP du Request Agent et quota partagé du 29 juillet 2026

Le moteur `5ccea9f37e67bb36a5cb9fa69621cedfb0678558`, poussé sur
`codex/swarm-protocol-v3`, expose maintenant le ledger précédent au Request Agent sans créer une
deuxième autorité de contribution.

### API et invariants

Trois routes V3 sont montées avant le frontend statique :

- `POST /v1/swarm/route-permits` ;
- `POST /v1/swarm/route-capabilities` ;
- `DELETE /v1/swarm/route-permits/{permit_id}`.

La création de permit exige le credential Bearer du compte et un header `Idempotency-Key` qui
devient le `request_id` signé. Le scope est `(account, Request Agent EndpointId, request id)`.
Un retry exact rend le premier permit même si le slot est depuis occupé ; réutiliser la clé avec
un modèle, contexte, TTL ou ensemble de politiques différent rend HTTP 422. Cette sémantique suit
le draft IETF HTTPAPI Idempotency-Key plutôt qu'un retry ad hoc.

Avant une nouvelle émission, l'autorité vérifie :

- credential valide et worker READY du même compte ;
- modèle demandé identique au swarm réellement servi ;
- contexte demandé inférieur ou égal à la limite live ;
- slot de contribution disponible ;
- mode `FABI_GATE=on` et V3 active.

Le gate compte maintenant ensemble les générations gateway et les permits locaux. Un worker qui
ouvre un slot ne peut donc pas lancer simultanément une requête via chaque chemin. Les lectures de
compteur SQLite restent des SELECT non bloquants ; seules les mutations quota/epoch prennent
`BEGIN IMMEDIATE`.

L'émission de capability revalide l'ownership du compte, l'EndpointId Iroh, la signature, le plan
exact et le keyset TUF. La release est account-scoped : un permit absent et celui d'un autre compte
rendent tous deux 404 pour ne pas créer d'oracle d'existence. Les erreurs sont typées
401/403/409/410/422/429/503 avec `Retry-After` sur les états temporaires.

L'autorité est fail-close et ne démarre que si ces deux secrets/états opérateur existent :

- `FABI_ROUTE_CAPABILITY_PRIVATE_KEY`, seed Ed25519 hex owner-only déjà publié dans
  `route-authorities.json` ;
- `FABI_ROUTE_PERMIT_DB`, stockage persistant owner-only.

Elle exige aussi Iroh, planner V3 active et gate actif. La clé est vérifiée contre le snapshot TUF
dès le démarrage, puis via le cache TUF non bloquant. Une clé n'est jamais générée silencieusement
au runtime, car sa clé publique doit passer le workflow de signature TUF.

Seuls `best_effort` et `replan_cold` sont publiquement accordés. `activation_replay`,
`reserved_route` et `hot_replica` restent fermés tant que leurs garanties ne sont pas
implémentées et qualifiées.

### Validations exactes

- suite moteur complète : `759 passed, 7 skipped`, warning externe Starlette/httpx connu ;
- tests HTTP/gate/ledger ciblés : `27 passed` ;
- Ruff ciblé et `git diff --check` verts ;
- documentation opérateur ajoutée dans `docs/fabi-request-agent-authority.md` ;
- le workflow natif du commit `5ccea9f` teste désormais l'API HTTP et le partage de quota sur les
  trois OS. Le run `30436044965` est entièrement vert sur Ubuntu, macOS 15 et Windows.

### Reprise exacte

1. surveiller le workflow multi-OS de `5ccea9f` et corriger sans contournement tout échec ;
2. implémenter le client d'autorité et le planner DHT dans le Request Agent local ;
3. y exécuter `RouteReservationCoordinator` avec le capability reçu ;
4. servir OpenAI/OpenCode et le SSE local commit-before-publish ;
5. remplacer la route de secours par `replan_cold`, puis ajouter le replay d'activations borné ;
6. intégrer les états et erreurs Request Agent dans l'IDE ;
7. provisionner/publier la clé opérateur, produire un runtime, puis seulement déployer et
   qualifier Mac mini, RTX, NAT, churn et kills.

## Premier runtime local Request Agent du 29 juillet 2026

Le moteur `1ae0d9ea365a5f625e3cb1c0f40f419b823ac377`, poussé sur
`codex/swarm-protocol-v3`, contient désormais le cœur de coordination locale. Ce jalon ne sert pas
encore l'API OpenAI et ne bascule donc pas l'IDE.

`RequestAgentAuthorityClient` fournit un client HTTPS borné :

- HTTPS obligatoire sauf loopback explicite ;
- credential Bearer jamais exposé par l'API publique de l'objet ;
- timeouts connexion/lecture ;
- réponses limitées à 1 MiB et JSON objet obligatoire ;
- propagation typée du code, statut et `Retry-After` ;
- `Idempotency-Key` stable sur la création du permit.

`RequestAgentRouteRuntime` réalise maintenant localement :

1. chargement du bundle modèle vérifié TUF ;
2. lecture d'un snapshot modèle depuis la DHT native ;
3. égalité exacte entre manifeste DHT et manifeste TUF ;
4. allocation durable d'un nouvel epoch ;
5. demande d'un permit pour le contexte exact ;
6. planification `ExactRoutePlanner` sur offres/leases/liens du snapshot ;
7. signature du plan avec l'EndpointId Iroh local ;
8. obtention du Biscuit par l'autorité HTTPS ;
9. PREPARE/COMMIT puis lease longue via `RouteReservationCoordinator` ;
10. RENEW et RELEASE depuis le client, avec release du permit en `finally`.

Deux appels identiques pour le même `request_id` rendent la même réservation locale. Un contrat
différent avec le même ID est refusé. Renew et release partagent un verrou par requête : une release
ne peut pas courir en parallèle avec un renew et laisser ce dernier ressusciter une lease. La
release est idempotente et utilise toujours la dernière version renouvelée.

`from_environment()` assemble le produit avec Iroh, DHT en mode client, bootstrap, registre TUF,
credential owner-only, autorité HTTPS et `SqliteEpochAllocator` namespacé par EndpointId. Un échec
partiel ferme le transport.

Validations :

- trois nouveaux tests couvrent plan DHT/TUF, identité locale, permit/capability, retry,
  renew/release et erreurs HTTP ;
- tests ciblés Request Agent/coordinator/DHT : `15 passed` ;
- suite moteur complète : `762 passed, 7 skipped` ;
- Ruff ciblé et `git diff --check` verts ;
- le workflow multi-OS du commit `1ae0d9e` est encore en cours.

Limites explicites :

- pas encore de boucle automatique de renouvellement pendant une génération longue ;
- pas encore de frontend/data plane OpenAI local ni de journal SSE ;
- `replan_cold` est autorisé mais le remplacement/replay après panne n'est pas encore branché ;
- aucune clé opérateur ni ce runtime n'a encore été déployé sur VPS/Mac mini/RTX.

Reprise exacte :

1. surveiller le CI `1ae0d9e` ;
2. ajouter le gestionnaire de lease automatique indépendant du streaming ;
3. brancher le frontend de la première étape et le data plane sur la route locale ;
4. ajouter journal SSE commit-before-publish et abort ;
5. implémenter replanification froide + replay prompt/tokens commis ;
6. seulement ensuite intégrer l'IDE, publier le runtime et qualifier le labo.

## Keepalive indépendant du Request Agent local du 29 juillet 2026

Le jalon précédent est désormais qualifié par le workflow natif
`30436557739`, entièrement vert sur Ubuntu, macOS 15 et Windows. Le moteur
local suivant ajoute le cycle de vie automatique des leases de route sans le
coupler au frontend OpenAI ni au streaming SSE. Il est poussé sur
`codex/swarm-protocol-v3` au commit
`250b1b554a2c0178755f1ba3bd56790c270d6444`. Son workflow `30437753008` est
entièrement vert sur Ubuntu, macOS 15 et Windows.

### Sémantique retenue

La boucle de maintenance du `RequestAgentRouteRuntime` est un thread dédié.
Elle ne dépend ni de l'arrivée d'un token, ni d'un heartbeat SSE, ni de la
durée du prefill ou d'un outil OpenCode. Elle reprend les invariants déjà
qualifiés dans l'ancien runtime actif au lieu d'introduire un second modèle :

- horloge murale seulement pour les contrats signés, horloge monotone locale
  pour juger les fenêtres de lease ;
- deadline locale démarrée avant le RPC, donc volontairement conservatrice ;
- renouvellement normal à 20 secondes pour une lease de 60 secondes ;
- retry court seulement si le budget maximal d'une nouvelle tentative et la
  garde d'expiration tiennent encore avant la dernière deadline reconnue ;
- seul un accusé de renouvellement reçu à temps prolonge la deadline locale ;
- un renouvellement reçu trop tard, une fenêtre devenue insuffisante ou des
  erreurs persistantes retirent d'abord la route du data plane local, puis
  déclenchent RELEASE et libération du permit en best effort ;
- `release`, renouvellement manuel et renouvellement automatique utilisent le
  même verrou par requête.

La gestion de ces verrous compte maintenant les appels actifs et les waiters.
Cela corrige une course présente dans le premier runtime local : un `release`
pouvait supprimer l'entrée du verrou alors qu'un nouveau `reserve` attendait
encore ce même objet, puis laisser la nouvelle réservation sans verrou
enregistré.

`active_reservation()` rend toujours la dernière version reconnue de la
réservation, ce qui évite qu'un data plane conserve l'objet antérieur à un
renew automatique. `status()` expose route, epoch, modèle, contexte, politique,
TTL restant, nombre d'échecs et dernier échec, sans exposer permit, credential
de compte ni Biscuit.

Les patterns primaires relus pour cette étape sont l'API Lease/KeepAlive
d'etcd, notamment la règle qu'une réponse du serveur est la connaissance
client de l'opération commise, ainsi que la boucle de session/reconstruction de
Petals et le runtime actif V3 existant. Une absence de tokens ne sert jamais de
détecteur de panne.

### Validation exacte

- tests Request Agent/coordinator : `14 passed` ;
- suite moteur complète : `766 passed, 7 skipped` ;
- quatre nouveaux tests déterministes, sans `sleep`, couvrent renouvellement
  dû, retry transitoire, refus avant franchissement de deadline et accusé reçu
  trop tard ;
- Ruff ciblé, format et `git diff --check` verts ;
- le seul warning de la suite complète reste la dépréciation externe
  Starlette/httpx déjà documentée.

### Limite de sécurité encore ouverte

La boucle entretient les leases des workers, mais un permit/capability
d'autorité reste aujourd'hui borné à cinq minutes. Le data plane local ne doit
pas transformer ce keepalive en autorisation infinie. Avant de qualifier des
générations dépassant cette durée, il faut soit rafraîchir explicitement
permit et capability auprès de l'autorité et faire revalider cette nouvelle
borne par les workers, soit borner puis replanifier proprement avec un nouvel
epoch. Cette propriété doit être traitée avec le frontend local ; elle n'est
pas déclarée validée ici.

### Reprise exacte

1. committer/pousser ce keepalive et attendre son workflow multi-OS ;
2. construire le frontend OpenAI/OpenCode local autour du Request Agent ;
3. ajouter le journal durable commit-before-publish, abort et états typés ;
4. implémenter `replan_cold` avec nouvel epoch et replay du prompt + préfixe
   commis, sans route de secours pré-réservée par défaut ;
5. relier ces états à l'IDE ;
6. publier un runtime, provisionner la clé TUF opérateur, puis qualifier Mac
   mini, RTX, troisième worker, NAT et kills prefill/decode.

## Autorisation renouvelable des générations longues du 29 juillet 2026

La limite ouverte du jalon précédent est résolue dans le moteur
`7c6899481fde5bd0b7e758092727ed66849c4a34`, poussé sur
`codex/swarm-protocol-v3`. Une génération n'est plus bornée par la durée du
premier permit et aucun silence de tokens ou de SSE n'est utilisé comme
détecteur de panne.

### Chaîne d'accusés explicites

Avant chaque extension des leases KV des workers, le Request Agent :

1. envoie un keepalive HTTP authentifié par le compte pour le permit existant ;
2. l'autorité revalide qu'un worker READY du même compte contribue toujours et
   que le swarm demandé sert réellement ;
3. le ledger SQLite avance atomiquement une
   `authorization_generation` monotone et rend la nouvelle expiration ;
4. l'autorité émet un nouveau Biscuit pour la même route signée, le même epoch
   et cette génération précise ;
5. chaque worker authentifie le peer Iroh et la commande RENEW, vérifie le
   Biscuit avec le keyset TUF, refuse un rollback de génération et refuse une
   lease KV qui dépasserait l'expiration de la capability.

Un retry de keepalive possède une clé d'idempotence stable. La transaction
`BEGIN IMMEDIATE` rend deux keepalives concurrents strictement monotones, y
compris depuis deux connexions SQLite. Les émissions sont persistées par
`(permit, epoch, authorization_generation)` ; une réponse perdue peut donc
être rejouée sans créer un droit différent. La release/révocation couvre le
Biscuit initial et tous les refresh encore vivants. Les anciennes lignes sont
bornées et nettoyées.

Le TTL n'est pas une estimation de la durée d'inférence. Il borne seulement la
durée pendant laquelle une réservation orpheline peut survivre après le
dernier accusé réellement reçu. Prefill lent, decode long, outil OpenCode ou
absence complète de sortie ne changent donc rien tant que le plan de contrôle
continue à obtenir ses accusés.

Cette conception reprend des mécanismes établis :

- leases/KeepAlive avec TTL retourné par le serveur dans etcd ;
- rotation de credentials courts sur connexion authentifiée dans SPIRE ;
- capability décentralisée, faits ambiants et identifiants de révocation de
  Biscuit.

Les références primaires et le contrat opérateur sont consignés dans
`docs/fabi-request-agent-authority.md` du moteur.

### Migrations et compatibilité

Le ledger ajoute `authorization_generation` et `initial_ttl_ms` à
`route_permits`, plus des tables séparées pour les refresh et les clés de
keepalive. Une base existante est migrée et son TTL contractuel initial est
reconstruit avant le premier retry. `initial_ttl_ms` reste immuable : prolonger
un permit ne transforme pas un retry de la création originale en conflit.

Les routes dynamiques refusent désormais un RENEW nu. Les routes fixes de
migration refusent inversement un wrapper de capability. Ce fail-close évite
qu'un ancien Request Agent puisse maintenir indéfiniment une route V3
autorisée une seule fois.

### Validation exacte

- suite moteur complète : `772 passed, 7 skipped` ;
- test déterministe d'une génération sans aucun événement SSE/token, maintenue
  au-delà de trois fois sa lease initiale par onze chaînes d'accusés ;
- tests de retry idempotent, ownership, contribution disparue, concurrence
  SQLite, générations monotones, rollback, capability expirée, TTL KV trop
  long, révocation et migration ;
- wheel native reconstruite et vérification réelle des nouveaux faits Biscuit ;
- `cargo fmt --check`, Clippy strict, tests Rust capability, Ruff et
  `git diff --check` verts ;
- seul warning : dépréciation externe Starlette/httpx déjà connue.

Le workflow multi-OS `30439601623` de `7c68994` est entièrement vert sur
Ubuntu, macOS 15 et Windows. Aucun runtime de ce jalon n'est encore publié ni
installé sur le VPS, le Mac mini ou la RTX.

### Reprise exacte

1. surveiller la CI multi-OS de `7c68994` ;
2. construire le frontend OpenAI/OpenCode local et envoyer le data plane sur
   la réservation V3 active ;
3. ajouter journal SSE durable commit-before-publish et abort ;
4. implémenter `replan_cold` avec nouvel epoch et replay du prompt + tokens
   déjà commis ;
5. exposer ces phases et erreurs Request Agent dans l'IDE ;
6. publier le runtime et provisionner clé TUF/relay sur installation neuve ;
7. installer Mac mini + RTX, puis qualifier NAT, churn et kills
   prefill/decode avant toute promesse produit.

## Frontend OpenAI local du Request Agent du 29 juillet 2026

Le moteur `d2a5657d4405311b0057481d3b3ea5cd126f52aa`, poussé sur
`codex/swarm-protocol-v3`, possède maintenant le premier chemin produit où le
client local planifie et exécute réellement sa route V3. Le VPS reste
l'autorité de contribution/capability ; il ne choisit pas la pipeline et ne
transporte ni activations ni tokens.

### Exécution locale

Le nouveau binaire `fabi-request-agent` expose sur loopback :

- `GET /health`, limité à `ready`/`waiting` ;
- `GET /v1/models` ;
- `GET /v1/request-agent/status` ;
- `POST /v1/chat/completions`, streaming et non-streaming.

Les routes OpenAI et le statut détaillé exigent le même Bearer de compte que
l'autorité. Le CLI refuse toute adresse non-loopback. Le credential n'est
jamais exposé par le statut.

Le manager local réutilise `RequestHandler`,
`TransformerConnectionHandler`, l'abort explicite et les enveloppes HTTP/SSE
existantes. Pour une requête :

1. il rend le chat avec le tokenizer local ;
2. il demande au `RequestAgentRouteRuntime` une route exacte depuis le snapshot
   DHT ;
3. il réserve permit, capability et KV avec sa propre identité Iroh ;
4. il transmet au head les fences route/epoch et la table complète ;
5. le head retokenize avec le frontend vLLM réellement chargé ;
6. un désaccord de tokens libère la route et force un nouveau plan avant
   l'inférence ;
7. chat et abort passent directement entre Request Agent et head Iroh ;
8. la fin HTTP/SSE libère route et permit.

La sélection du contexte n'utilise aucun palier configuré. Le runtime prend un
seul snapshot DHT et effectue une recherche binaire avec `ExactRoutePlanner`
sur les géométries KV live. Ce probe ne brûle ni epoch, ni permit, ni
réservation. La limite haute provient de `config.json` signé.

Le Request Agent ne télécharge pas les poids. Il matérialise seulement les
artefacts architecture/tokenizer de la révision immuable, vérifie taille et
SHA-256 de chacun contre l'index TUF, puis charge le tokenizer depuis ce
snapshot local vérifié. Tous les chemins réseau de téléchargement utilisent
donc le même contrat signé que les workers.

### Validation exacte

- suite moteur complète : `778 passed, 7 skipped` ;
- tests frontend/Request Agent ciblés : `14 passed` ;
- OpenAI non-streaming, SSE jusqu'à `[DONE]`, tokenisation head, fences,
  libération, statut, modèles, JSON invalide, authentification et bind loopback
  couverts ;
- vérification positive puis corruption d'un artefact frontend TUF couverte ;
- probe à `600 000` tokens sur la géométrie déterministe du test : limite
  exacte `524 288`, sans permit ni route active ;
- Ruff, format, `git diff --check`, syntaxe TOML/YAML et aide du CLI verts ;
- le seul warning reste la dépréciation externe Starlette/httpx.

Le workflow `30440691116` de `d2a5657` est en attente au moment de ce handoff.
Le workflow inclut désormais explicitement le frontend Request Agent et
installe `uvicorn` sur Ubuntu, macOS et Windows.

### Limite honnête et reprise exacte

Ce premier frontend laisse volontairement `should_capture_generation_tokens`
à false. Il fournit donc aujourd'hui l'exécution V3 locale et l'abort, mais une
perte de route renvoie encore une erreur propre ; elle ne déclenche pas encore
le replay. Cette limite évite de déclarer une reprise sans journal durable.

Prochaines étapes :

1. ajouter le journal local durable commit-before-publish ;
2. brancher `OpenAIRecoveryStream` et le contrat d'échantillonnage exact ;
3. sur panne, libérer/fencer l'ancienne route, reprendre un nouvel epoch,
   replanifier depuis la DHT puis appeler `chat-replay` avec prompt + tokens
   commis ;
4. intégrer les phases Request Agent dans l'IDE ;
5. publier et qualifier le runtime au labo.

## Replanification froide exacte et journal durable du 29 juillet 2026

Le moteur `853a3db411e3c76f8e71ae227fba53760302a3fe`, poussé sur
`codex/swarm-protocol-v3`, ferme localement la boucle de reprise du Request Agent. Il n'utilise
plus la route worker-disjointe pré-réservée de l'ancien chemin centralisé : après une panne, le
client local reconstruit une nouvelle route complète à partir d'un snapshot DHT frais.

### Ce qui est réellement implémenté

Le nouveau `SqliteRecoveryJournal` est un journal local borné :

- transactions `BEGIN IMMEDIATE`, mode WAL et `synchronous=FULL` ;
- fichier owner-only sur POSIX ;
- IDs exacts du prompt et de chaque token de sortie, positions et checksums ;
- commit d'un lot de tokens avant sa publication dans le flux SSE ;
- réouverture après redémarrage, détection de corruption, limites de requêtes et de tokens ;
- abandon explicite des générations inachevées trouvées au démarrage.

Le chemin de génération capture le prompt depuis le RPC de tokenisation authentifié de la vraie
tête avant de lancer l'inférence. Une mort pendant le prefill, avant le premier token, laisse donc
déjà assez d'état durable pour reconstruire la requête.

`RequestAgentRouteRuntime.replan_cold()` réalise ensuite :

1. conservation du même permit de contribution et keepalive explicite de ce permit ;
2. exclusion cumulative de tous les workers de la route défaillante ;
3. nouvelle lecture DHT, toujours vérifiée contre le bundle TUF signé ;
4. allocation d'un nouvel epoch ;
5. planification et réservation d'une nouvelle couverture complète ;
6. release et fencing best effort de l'ancienne route ;
7. replay de `prompt original || tokens de sortie commis` via
   `/inference/v1/chat-replay`.

Une seconde panne pendant le replay peut déclencher un nouveau replan : il n'existe plus de
backup unique consommable. Si le réseau ne possède aucune autre couverture complète, le client
reçoit une erreur typée et les ressources sont libérées ; Fabi ne fabrique jamais une
continuation depuis du texte re-tokenisé ou un KV partiel.

La garantie exacte reste limitée aux contrats déterministes actuellement qualifiés
(`temperature=0`, ou contrat exact équivalent). Les requêtes échantillonnées restent
`RESTARTABLE` tant qu'un état RNG portable entre vLLM, MLX et SGLang n'est pas défini.

### Rapport avec Petals

Le code officiel Petals au commit `22afba6` a été relu, en particulier
`petals/client/inference_session.py`. Petals garde chez le client les hidden states d'entrée de
chaque span ; lors d'une panne, il bannit le peer, reconstruit le chemin depuis la DHT et renvoie
l'historique au premier span remplacé afin de régénérer son cache d'attention. Il ne copie donc
pas directement un KV privé depuis le serveur mort.

Fabi adopte immédiatement la propriété la plus importante de ce design — replanification côté
client sans backup réservé — mais conserve les tokens comme journal universel. Cette base
fonctionne entre workers hétérogènes et ne suppose pas que vLLM/CUDA et MLX partagent leurs
layouts KV. Un futur chemin rapide pourra négocier un replay d'activations ou un connecteur KV
seulement lorsque modèle, révision, plage de couches, dtype, backend et format sont compatibles.
L'interface officielle KV Connector V1 de vLLM, NIXL et LMCache sont des bases pertinentes pour
RTX vers RTX ; elles ne sont pas considérées comme une solution validée pour RTX vers MLX.

### Validation exacte

- suite Python complète : `788 passed, 7 skipped` ;
- sous-ensemble exact du workflow natif : `232 passed` ;
- Ruff sur tous les fichiers modifiés et `git diff --check` verts ;
- E2E local decode : A publie un token puis tombe, B rejoue et continue sans doublon ;
- E2E local prefill : A tombe sans publier de token, B reconstruit puis termine ;
- persistance SQLite, corruption, capacité, reprise après réouverture et replans successifs
  couverts ;
- le workflow natif multi-OS `30442659106` est encore en cours au moment de cette écriture.

Les deux workflows en échec précédents ont identifié des dépendances hermétiques réelles :
`30440691116` manquait `aiohttp`, puis `30441095223` déclenchait l'import eager de ModelScope.
Le workflow installe désormais la dépendance requise et ModelScope n'est importé que si ce
backend optionnel est sélectionné. Les étapes Rust, DHT native et wheels des runs précédents
étaient déjà vertes.

### Limites et reprise exacte

Ce jalon n'est pas encore publié ni déployé. Le Mac mini et la RTX forment actuellement une seule
pipeline complète ; leur duo ne peut pas prouver un failover. La prochaine qualification doit
ajouter un troisième worker ou une seconde couverture complète, éventuellement via RunPod avec
un coût inférieur à 1 EUR/h, puis tester :

1. exposition dans l'IDE des phases `planning`, `reserving`, `prefilling`, `recovering`,
   `replaying`, `ready` et des erreurs typées ;
2. publication du runtime, clé opérateur TUF et provisioning relay sur installation neuve ;
3. installation Mac mini + RTX et confirmation des versions exactes ;
4. NAT sans route Tailscale produit, chemin direct/relay et mesures ;
5. kill réel de la tête, d'un worker milieu et de la queue pendant prefill puis decode ;
6. pannes successives, retour tardif de l'ancienne epoch, abort et absence de couverture ;
7. contexte OpenCode d'environ 12 220 tokens d'entrée + 4 096 réservés, avec TTFT, débit,
   mémoire et KV.

Le replay d'activations façon Petals est désormais une optimisation planifiée, pas une condition
de correction. Il ne doit être ajouté qu'après cette qualification matérielle, avec négociation
de compatibilité, quotas mémoire et fallback obligatoire vers le replay de tokens.

## Request Agent réel, runtime autonome et intégration IDE du 30 juillet 2026

Le moteur V3 final de ce jalon est
`4b4add07aab595eeb922b8705821d85d82b0b65e`, poussé sur
`codex/swarm-protocol-v3`. Le workflow natif multi-OS `30531028011` est
entièrement vert sur Ubuntu, macOS et Windows.

### Deux fautes détectées uniquement par le vrai chemin HTTP

Le premier lancement Windows par module quittait immédiatement avec code zéro :
`backend.server.request_agent_frontend` définissait `main()` mais ne l'appelait
pas sous `python -m`. Le commit `55323c3` ajoute le contrat `__main__` et un test
subprocess réel de `python -m ... --help`, au lieu de vérifier seulement la
forme de la commande.

La première réservation HTTP réelle échouait ensuite avant le prepare avec un
`UnicodeDecodeError`. `SignedControlMessage.model_dump(mode="json")` tentait de
décoder comme UTF-8 les octets arbitraires d'une signature Biscuit. Le commit
final `4b4add0` configure Pydantic avec `ser_json_bytes="base64"` et
`val_json_bytes="base64"`. Le test HTTP utilise maintenant une signature
contenant volontairement des octets non UTF-8 et vérifie son round-trip.

Enfin, le worker produit doit annoncer
`FABI_SWARM_V3_COORDINATION_MODE=client`. Le mode par défaut `fixed` est réservé
au coordinateur de migration et refuse correctement une capability dynamique.
L'IDE et le helper de labo provisionnent désormais explicitement le mode
client ; Mac et Windows ont été observés avec cette valeur dans leur
environnement effectif.

### Preuve de génération réelle avant publication

Le scheduler VPS actif a été reconstruit depuis l'exact commit `4b4add0` dans
l'image `local/parallax-scheduler:swarm-v3-4b4add0`. Il conserve ses volumes
catalogue/état, sa clé d'autorité, son token relay et sa racine TUF. Le probe
correct de déploiement est `/cluster/status_json`, pas l'ancien
`/cluster/status`.

Avec les candidats exacts `4b4add0` sur les deux machines, la DHT a formé la
route Mac `[0,21)` puis RTX `[21,36)`, les deux workers `READY`, admission
active, lien de données direct et contexte live maximal `39 264` tokens.

Deux générations ont traversé le Request Agent local, sans proxy d'inférence
sur le VPS :

- essai court : HTTP 200, 18 chunks SSE, `[DONE]`, TTFT `18,517 s` ; les 16
  tokens ont été consommés par le raisonnement Qwen, donc aucun texte final ;
- essai qualifié `/no_think`, `max_tokens=128` : HTTP 200, TTFT `14,321 s`,
  durée `15,248 s`, 9 chunks, `finish_reason=stop`, contenu `OK.`.

Un flux long a ensuite été fermé dès le premier contenu. L'abort a libéré la
route : `active_routes=0`. Le journal durable contenait alors 3 entrées, dont
2 complétées et 1 abortée, aucune échouée, avec 102 IDs de tokens résidents.
Cette preuve couvre le streaming SSE réel, l'abort, permit/capability, la route
Mac vers RTX et le data plane hors VPS. Elle ne couvre pas encore une panne
matérielle avec route de remplacement.

### Release rc36 et défaut d'installation neuve

Le runtime `82698d9d30ebcf284f07273c46bd488898b8a7a9`, tag
`v2.7.0-rc36`, embarque exactement :

- OpenCode/Fabi CLI `b7ece1419fddb21226e9ca1107825265feed86b1` ;
- moteur `4b4add07aab595eeb922b8705821d85d82b0b65e` ;
- transport natif `0.1.0`.

Le workflow release `30531991673` est entièrement vert, y compris Windows
CUDA et les six actifs. Mais l'installation publique sur un Mac mini sans
Homebrew a honnêtement échoué avant téléchargement : `zstd n'est pas
installé`. La release est donc construite, mais pas qualifiée comme
installation neuve autonome.

La solution ne télécharge ni Homebrew ni un script tiers. Le runtime au commit
`70af7a528d27396811c140df5bff7ec127f5fa5e` construit un petit actif
`fabi-unzstd-<plateforme>` depuis le target officiel
`facebook/zstd@v1.5.7` `zstd-decompress` :

- source officielle épinglée et vérifiée par SHA-256 ;
- binaire macOS de 226 Kio dépendant seulement de `libSystem` ;
- binaire Linux statique musl, indépendant de la version glibc de la machine ;
- binaire Windows provenant de l'actif win64 officiel épinglé ;
- sidecar SHA-256 obligatoire et attestation GitHub de chaque helper ;
- préférence pour un zstd système déjà présent, sinon téléchargement et
  vérification du helper sans privilèges administrateur.

Les tests transactionnels Ubuntu et Windows forcent ce chemin local qualifié,
refusent un helper altéré avant toute mutation, et vérifient que les identités,
racines et états V3 survivent à l'upgrade. Le run de branche `30545840720` est
vert.

Le vrai Mac mini a ensuite été installé directement depuis les actifs publics
`rc37`, sans `zstd` système et sans `FABI_ZSTD_PATH`. L'installateur a
téléchargé et vérifié le helper autonome, vérifié le SHA du tarball, relocalisé
56 fichiers, sauvegardé l'ancien runtime puis activé le nouveau. Le manifeste
installé annonce exactement `v2.7.0-rc37`, OpenCode `b7ece14`, moteur
`4b4add0`, MLX et transport `0.1.0`. L'identité worker et la racine TUF sont
restées présentes, et
`python -m backend.server.request_agent_frontend --help` retourne zéro.

Le tag `v2.7.0-rc37` pointe sur `70af7a5`. Son workflow release
`30546072051` est encore en cours au moment de cette écriture ; ne pas déclarer
ses six actifs qualifiés avant sa fin.

### IDE V3 local

Les modifications IDE non encore poussées au moment de cette note remplacent
le data plane scheduler par le Request Agent loopback :

- processus supervisé séparément du worker, identités Iroh/DHT persistantes
  distinctes et readiness publiée par rename atomique ;
- bind loopback strict, Bearer de compte, restart seulement après preuve
  `close` du process et backoff borné ; après SIGKILL, un garde-fou testé
  libère réellement la fermeture de l'IDE même si Node/OS omet `close` ;
- flux de phases reconnectable par SSE/`Last-Event-ID` :
  `planning`, `authorizing`, `reserving`, `prefilling`, `decoding`,
  `recovering`, `replaying` et états terminaux ;
- OpenAI Theia et OpenCode utilisent l'URL locale du Request Agent, plus l'URL
  scheduler VPS ;
- les changements async de modèle/endpoint sont protégés par génération ;
- Windows exécute les deux outils via le Python relocalisé et `-m` ;
- le runtime qualifié attendu devient `v2.7.0-rc37`.

L'installeur intégré télécharge lui aussi le helper zstd de la release et refuse
un SHA absent ou divergent. Son téléchargement respecte maintenant la
backpressure officielle des `Writable` Node : quand `write()` renvoie false,
il attend `drain` avant de lire le chunk suivant. Un disque lent ne peut donc
plus transformer le téléchargement multi-Gio en tampon RAM non borné ; une
erreur d'écriture telle qu'un disque plein est propagée. Le premier test public
de ce chemin a aussi révélé des milliers de callbacks de progression
dupliqués ; ils sont maintenant bornés à un changement de pourcentage ou de
message, sans timer de polling.

Les coupures transitoires utilisent maintenant une reprise HTTP bornée conforme
à RFC 9110. Une portion n'est concaténée que si le serveur a d'abord fourni un
ETag fort, puis accepte `Range` avec le même validateur dans `If-Range`. Sans
validateur ou après une réponse `200`, le fichier est réécrit ; les erreurs
client déterministes telles que `404` ne sont pas retentées. Le test coupe une
vraie réponse HTTP locale après 64 Kio, observe le second échange `206`, puis
compare l'archive finale octet par octet.

Le chemin intégré complet a aussi installé `rc37` dans une racine temporaire
depuis GitHub : tarball et helper publics, deux SHA, extraction, relocalisation,
imports des modules puis manifeste exact. La racine temporaire de 982 Mio a été
supprimée après le test.

Validations locales actuelles :

- `fabi-swarm`: 49 tests sur 49 ;
- build TypeScript `fabi-swarm` vert ;
- build Electron complet vert, zéro erreur browser/node/electron ;
- `git diff --check` vert.

### Reprise exacte après rc37

1. attendre les six builds et la publication des helpers de `rc37` ;
2. installer `rc37` depuis les actifs publics, sans zstd préinstallé ni
   `FABI_ZSTD_PATH`, sur Mac mini et RTX ;
3. vérifier les MANIFEST exacts et la conservation des états persistants ;
4. relancer les deux workers depuis le runtime installé, sans source candidate,
   puis reformer la route DHT ;
5. refaire Request Agent, génération SSE et abort depuis le runtime public ;
6. lancer le vrai E2E UI et vérifier statuts/phases, outils, permissions,
   abort et changement de modèle ;
7. ajouter une couverture complète supplémentaire puis qualifier kills
   prefill/decode, replans successifs et absence de couverture ;
8. seulement ensuite qualifier deux NAT indépendants et le gros contexte
   OpenCode d'environ 12 220 tokens + 4 096 réservés.

## Installation IDE réelle, registre V3 et budget MLX stable du 30 juillet 2026

L'intégration IDE décrite ci-dessus a été validée puis poussée sur `main` au
commit `2bed2c84c9f4ddcf4310ac7b6b535c5f66acf914`. Le clone local complet, non
dataless, a réellement installé `rc37` depuis les actifs GitHub publics avec le
helper zstd autonome. Le manifeste installé annonce exactement OpenCode
`b7ece1419fddb21226e9ca1107825265feed86b1`, moteur
`4b4add07aab595eeb922b8705821d85d82b0b65e`, MLX et transport natif `0.1.0`.
Le token de compte et la racine TUF ont survécu à la transaction.

### Contrat registre observé par la vraie application

Le premier démarrage Electron a révélé une boucle de redémarrage du Request
Agent avant même sa création. Le registre public publiait légitimement
`data.swarm_v3_shadow.catalog.model_swarm_id`, mais le scanner lisait
`data.swarm_v3_shadow.model_swarm_id`. Il renvoyait donc `null` à l'IDE.

Le runtime/registre au commit
`82a52f3a6a9bf130141abfc9bc6855d3c47877f0` lit maintenant d'abord le contrat
imbriqué réel et conserve le chemin racine uniquement comme compatibilité de
rolling upgrade. Les 27 tests registre et le typecheck sont verts. Le binaire
Linux a été reconstruit, déployé atomiquement sur le VPS et le service est
actif. Le registre public renvoie désormais l'identité exacte
`46e338001cbca3a457b8e513950d62cc10fc7866226529e7b27825a737797b57`.
Après ce déploiement, un second démarrage Electron a gardé un seul Request
Agent stable et `ready` sur loopback, séparé du worker.

Les anciens binaires de registre compilés sur le VPS ont été bornés au binaire
actif et à un seul rollback `pre-82a52f3`, ce qui a récupéré environ 974 Mio.
Les états, clés et volumes du scheduler n'ont pas été supprimés.

### Défaut de budget MLX découvert sur le Mac 16 Gio

Le worker autonome du Mac courant choisissait correctement `[0,4)`, puis
refusait tout KV après avoir chargé ses poids. Le budget initial lui accordait
environ 2 Gio. Une fois 1,48 Gio de poids Metal chargés, la baisse de
`psutil.available` franchissait un palier de réserve adaptative ; le
`CacheManager` recalculait alors la réserve OS et interprétait les propres
poids du worker comme une nouvelle pression externe. La limite processus se
réduisait rétroactivement à la mémoire active et la capacité KV tombait à
zéro.

Le moteur `c261ecb0592e799b93226c6817d0f2260131e1ab`, poussé sur
`codex/swarm-protocol-v3`, fixe la réserve système choisie au démarrage d'une
génération de worker. La disponibilité live continue de borner la marge : une
vraie pression externe réduit donc toujours la capacité, mais le chargement
des propres poids ne change plus de palier de réserve.

Validation :

- suite moteur complète : `802 passed, 7 skipped` ;
- Ruff ciblé et `git diff --check` verts ;
- test déterministe 16 Gio : réserve initiale 2,5 Gio, limite 2 Gio, poids
  1,5 Gio puis marge KV correcte de 0,5 Gio ;
- vrai démarrage Electron avec ce moteur : placement autonome `[0,4)`, limite
  MLX 2,22 Gio, poids 1,48 Gio, allocation KV 0,60 Gio, 1 222 blocs et contexte
  maximal annoncé 39 104 tokens ; l'exécuteur est devenu `READY` ;
- l'application de test a ensuite été arrêtée proprement pour rendre sa
  mémoire au poste de travail.

OpenCode/Fabi CLI `10c110c3d07f7039b7afb91ca67fc815ab2458bc`,
poussé sur `dev`, épingle ce nouveau moteur pour que le chemin de réparation ne
réinstalle pas silencieusement l'ancien commit. Son test d'installateur et le
typecheck complet monorepo sont verts.

### État honnête de `rc37` et correction Windows

`rc37` ne doit pas être qualifiée comme release multi-OS complète. Le run
`30546072051` a publié les actifs CPU/MLX, mais le build Windows CUDA a échoué
après avoir correctement construit le runtime, le wheel réseau natif et le
tarball de 2,0 Gio. La faute était dans la construction du helper zstd :
Git Bash invoquait GNU tar sur le ZIP officiel Windows, format que ce tar ne
sait pas extraire.

Le runtime `46c44ebdabeb34634a0e5ece60c6e3c93ec26fd6`, poussé sur `main`,
utilise désormais `Expand-Archive`/`System.IO.Compression`, l'implémentation
ZIP native documentée par Microsoft, après conversion explicite des chemins
MSYS. Le SHA-256 de l'actif zstd officiel reste vérifié avant extraction. Un
test Windows court construit et exécute maintenant ce helper à chaque push
avant les builds de release. Le même commit verrouille exactement le CLI
`10c110c3d` et le moteur `c261ecb`.

Le run de branche `30550310129` est entièrement vert, y compris la construction
et l'exécution du helper sur `windows-latest`. Le tag `v2.7.0-rc38` pointe
exactement sur `46c44eb`; son run release `30550407042` est encore en cours.
Ne pas qualifier `rc38` avant le succès et la publication de ses six actifs.
Ensuite :

1. attendre les six actifs de `rc38`, surtout Windows et Linux CUDA ;
2. forcer sur la RTX Windows l'installation publique sans zstd WinGet dans le
   `PATH`, puis vérifier manifeste, helper, TUF et identité persistante ;
3. installer le même runtime sur le Mac mini ;
4. démarrer RTX puis Mac pour tester l'ordre inverse, la sélection autonome
   des spans et la route complète ;
5. refaire Request Agent, SSE, abort et gros contexte depuis les runtimes
   publiés ;
6. ajouter l'A40 RunPod seulement après cette baseline afin de prouver une
   seconde couverture et le relay TCP-only, puis exécuter churn et kills.

## Qualification publique rc38 et pipeline client-side du 31 juillet 2026

Le run release `30550407042` est maintenant entièrement vert : les huit jobs
Ubuntu, Windows, Linux CPU/CUDA, Darwin arm64 MLX/x64 CPU et Windows CUDA ont
réussi, et tous les actifs publics attendus sont publiés. Le runtime
`v2.7.0-rc38` pointe toujours exactement sur
`46c44ebdabeb34634a0e5ece60c6e3c93ec26fd6` et contient :

- OpenCode/Fabi CLI `10c110c3d07f7039b7afb91ca67fc815ab2458bc` ;
- moteur `c261ecb0592e799b93226c6817d0f2260131e1ab` ;
- transport natif `0.1.0`.

### Installations publiques réelles

La RTX Windows a été installée depuis les actifs publics en forçant un `PATH`
sans `zstd.exe`. Le log prouve le téléchargement du helper autonome, sa
vérification, la reconstruction des deux parties du tarball CUDA, la
vérification SHA-256 et l'activation transactionnelle. Le manifeste installé
annonce exactement `rc38`, CUDA, Python `3.12.7` et les révisions ci-dessus.
La racine TUF qualifiée
`7ef69b40b4ba41fc8da5742f54303b388fe3192585a8f45b452079861ac3f0ce`,
les identités worker/catalogue et `relay.env` ont survécu. La RTX 4080 SUPER
est détectée avec 16 376 Mio.

Le vrai installeur intégré de l'IDE a ensuite installé le même `rc38` public
sur le Mac courant, avec le helper autonome, puis validé le manifeste MLX, la
racine TUF, les imports et
`python -m backend.server.request_agent_frontend --help`. Après activation
réussie seulement, il a conservé le rollback immédiat `rc37` et supprimé huit
anciens rollbacks gérés, soit environ 17 Gio, sans toucher aux identités ni aux
états persistants.

La politique de rétention est poussée dans le runtime au commit
`9cc11c8b515ac1f670c40917a1bd3f1d9b75a32a` et dans l'IDE au commit
`41795b76c862566cfbc46fec150424e52b865898`. Elle est couverte par trois
installations successives et un rollback sur shell, PowerShell et Node. Le run
multi-OS de branche runtime `30610502029` est vert. Attention : le tag immuable
`rc38` précède ce commit runtime ; son installateur standalone ne supprime donc
pas encore les rollbacks historiques. L'installeur IDE courant le fait, et une
prochaine release runtime devra embarquer `9cc11c8`.

L'IDE épingle désormais officiellement `rc38` au commit
`f34286399303e2bfc58a6270d5c19c65c00d8e8f`. Ses 49 tests et son build
TypeScript sont verts ; le build Electron complet avait déjà été validé sans
erreur avec ces mêmes constantes.

### Ordre inverse et placement autonome

Les workers ont été relancés exclusivement depuis leurs runtimes `rc38`
installés, RTX d'abord puis Mac mini. Sans instruction de couches venant du
VPS :

- la RTX a choisi `[1,36)`, chargé 35 couches et annoncé 25 072 tokens KV ;
- seule, elle a publié `no_feasible_route`, ce qui est correct puisque la
  couche zéro manquait ;
- le Mac mini a ensuite choisi `[0,1)` et annoncé 899 264 tokens KV ;
- la première calibration Mac vers RTX a été refusée pendant la convergence
  DHT, car la RTX n'avait pas encore autorisé le nouveau pair ;
- la boucle normale catalogue/topologie a convergé en environ une minute,
  sans patch ni redémarrage.

La route finale est `Mac [0,1) -> RTX [1,36)`, `route_ready`, admission active,
les deux liveness `healthy`, contexte live 25 072 et contrat planifié 16 384.
Les workers se voient directement sans relay entre eux ; les dernières
mesures observées étaient environ 16 à 22 ms de RTT inter-worker et 88 à 92 ms
vers l'autorité VPS. Cette preuve valide l'arrivée dans l'ordre inverse et le
placement client-side progressif. L'IDE devrait toutefois présenter cette
minute comme une synchronisation réseau, pas comme une panne définitive.

### Générations depuis le Request Agent local

Le data plane OpenAI est maintenant réellement client-side :

1. l'IDE parle en HTTP/SSE au Request Agent loopback ;
2. le Request Agent lit la DHT, construit et réserve sa route ;
3. le prompt et les tokens circulent entre le client et les workers via Iroh ;
4. le VPS ne transporte que permis, epoch/fencing, registre et bootstrap. Il
   peut servir de relay chiffré si le NAT l'impose, mais le scheduler ne proxy
   plus le SSE d'inférence.

Un premier essai avec la credential locale a correctement échoué par
`no_eligible_worker` : le Mac courant et le Mac mini ont deux tokens de compte
différents. La qualification a donc injecté uniquement en mémoire la
credential du labo dans le Request Agent, sans remplacer le token persistant
local. Cela confirme aussi que le login/device pairing multi-machine reste une
fonction produit indispensable.

Avec cette identité de labo, le chemin public `rc38` a produit :

- génération courte : HTTP 200, `[DONE]`, contenu `OK.`, phases
  `planning -> authorizing -> reserving -> prefilling -> decoding ->
  completed`, TTFT 9,189 s et durée 10,956 s ;
- abort client après le premier fragment : journal SQLite durable
  `aborted`, 31 tokens prompt et 4 tokens commis, puis
  `active_routes=[]` et `max_running_request=0` côté coordinateur ;
- gros contexte OpenCode : exactement 12 220 tokens prompt calculés par le
  tokenizer Qwen, 4 096 tokens de sortie réservés, soit 16 316 ; HTTP 200,
  `[DONE]`, contenu `OK.`, 7 tokens commis, TTFT 16,824 s et durée 18,683 s ;
- dépassement propre : 22 000 + 4 096 = 26 096 tokens a été refusé en 3,228 s
  par HTTP 400 `context_length_exceeded`, avec la capacité live exacte 25 072,
  avant toute réservation ou phase de génération.

Un snapshot juste après la génération montrait 15 154 Mio GPU résidents sur
la RTX, 894 Mio libres, aucune réservation KV résiduelle et aucun swap sur le
Mac mini. La sortie de sept tokens est trop courte pour publier un débit de
decode représentatif ; un essai long reste nécessaire pour mesurer un débit
stable.

### Reprise exacte après cette baseline

La baseline `rc38` Mac mini + RTX est donc qualifiée pour installation
publique, placement autonome, contribution gate, SSE, abort et gros contexte.
Elle ne prouve pas encore un failover matériel. La suite ordonnée est :

1. vrai E2E Electron/OpenCode : outils, permissions, abort UI, changement de
   modèle et présentation propre de la convergence DHT ;
2. login/device pairing afin qu'un même compte soit provisionné sans copie
   manuelle sur plusieurs machines ;
3. seconde couverture complète, par exemple A40 RunPod à moins de 1 EUR/h,
   puis kills réels pendant prefill/decode, replay exact, fencing d'ancienne
   epoch, pannes successives et absence de couverture ;
4. deux NAT indépendants sans route Tailscale produit, avec preuve séparée du
   chemin client->tête et inter-worker, direct ou relay ;
5. génération longue pour débit stable, pression mémoire pendant prefill et
   decode, puis répétition du contexte maximal.

## Frontend qualifié portable et couche zéro Windows du 31 juillet 2026

La limitation observée sur la RTX n'était pas une incapacité de CUDA ou de
vLLM à exécuter la première ou la dernière couche. Le runner Parallax Windows
sait déjà charger les embeddings, les blocs et la tête LM correspondant à son
span. La RTX publiait `supports_frontend=false` parce que le frontend HTTP Rust
qualifié n'était pas livré sur Windows : son bootstrap héritait un descripteur
de socket POSIX et son module listener compilait directement les types Unix de
Tokio. Le placement V3 empêchait donc correctement ce nœud de prendre la
couche zéro, car une route sans point d'entrée OpenAI/SSE aurait été
inutilisable.

La piste d'un frontend Python distinct a été écartée après audit du runtime
réel RTX. Son wheel Windows vLLM 0.16 n'a pas le même protocole de manager que
le frontend Python vLLM courant, invoque des opérations `Utility` non
implémentées par Parallax et ne porte pas l'extension Fabi
`/inference/v1/chat-replay`. L'utiliser aurait créé deux comportements selon
l'OS et régressé le replay exact. Le fork Windows SystemPanic a aussi été
inspecté ; sa version observée conserve notamment un port ZMQ Windows fixe et
ne constitue pas un remplacement propre du frontend qualifié.

Le moteur au commit
`a898ae67731f2e693a8e7dddb2f63a4beb878cf2`, poussé sur
`codex/swarm-protocol-v3`, porte donc le frontend Rust officiel vLLM 0.24
épinglé au lieu de le remplacer :

- le mode POSIX existant garde l'héritage atomique `--listen-fd` ;
- Windows reçoit un mode natif `--listen-address HOST:PORT`, mutuellement
  exclusif, et le processus Rust lie directement son socket TCP ;
- le listener Unix est compilé uniquement sur Unix et une implémentation Axum
  TCP portable est compilée ailleurs ;
- la supervision `vllm-managed-engine` garde `setpgid` et les signaux sur Unix,
  tandis que Windows utilise l'outil système documenté
  `taskkill /PID … /T /F` pour terminer un arbre de processus ;
- `install.sh` trouve désormais aussi `Scripts/python.exe`, résout le suffixe
  `.exe`, construit avec `protoc` fourni par Chocolatey si nécessaire et
  installe `Scripts/vllm-rs.exe` ;
- le launcher Parallax sélectionne le contrat adapté à l'OS tout en conservant
  exactement les mêmes handlers SSE, outils, abort et replay.

Une première version compilable utilisait directement la chaîne fournie par
`args.host`. L'audit du vrai lancement produit a montré que sa valeur par
défaut est `localhost`, alors que Clap désérialise `--listen-address` en
`SocketAddr` numérique. Le moteur final résout donc explicitement ce nom à la
frontière Python, fixe `localhost` à `127.0.0.1` pour rester cohérent avec les
health checks Fabi et formate aussi correctement IPv6. Deux tests couvrent ce
cas réel ; ne qualifier aucun des commits intermédiaires `3ee1c9c`,
`214cb7f`, `4cd6976` ou `d2a8d0a`.

Le patch s'applique proprement après le patch de replay sur une copie neuve du
source vLLM épinglé. Les tests Rust ciblés du parseur et des listeners passent
sur macOS, les 20 tests Python ciblés passent, Ruff est vert et la suite moteur
complète donne `805 passed, 7 skipped`. Une tentative de cross-compilation
macOS vers MSVC a atteint la dépendance C `ring` puis s'est arrêtée faute de
headers du SDK Windows ; elle n'est volontairement pas comptée comme preuve
Windows.

OpenCode/Fabi CLI
`0690c4045d8023e20e97d148527446b28aa70a4a`, poussé sur `dev`, épingle ce
moteur. Ses trois tests d'installateur et le typecheck monorepo sont verts. Le
runtime `962a5198addbbc39717c061ba810aa36e108033e`, poussé sur `main`, verrouille
ces deux révisions et inclut désormais `vllm-rs.exe` dans le tarball Windows
CUDA avec un smoke test de disponibilité. Le commit parent `fafd4d0` conserve
trois jours les artefacts des déclenchements manuels afin de tester un paquet
candidat sans publier de tag.

Le premier build Windows natif `30614860582` a révélé que le listener lui-même
compilait, puis que le crate officiel `vllm-managed-engine` appelait encore
sans `cfg(unix)` `pre_exec`, `setpgid`, `kill` et `SIGKILL`. Son artefact de
debug est incomplet et ne doit pas être installé. La correction finale
s'applique proprement avec les deux patches sur un clone vierge ; `cargo fmt`,
les deux tests managed-engine, les trois tests listener et les deux tests CLI
frontend sont verts sur macOS.

Le second build Windows natif `30617311029` a franchi ce crate, puis révélé
dans le serveur un réglage `TCP_NODELAY` qui supposait encore que tout flux
était le `Either<TcpStream, UnixStream>` Unix. Le patch final sélectionne
maintenant le flux TCP direct sur Windows et protège aussi les imports
spécifiques ; les mêmes tests Rust et Python sont verts après cette
correction.

L'audit exhaustif suivant ce second échec a aussi trouvé dans le binaire CLI
le handler `SIGTERM` Tokio propre à Unix. Le patch final sélectionne désormais
`Ctrl-C + SIGTERM` sur Unix et `Ctrl-C` sur Windows ; aucune autre référence
Unix non protégée ne subsiste dans le source Rust parcouru.

Le workflow manuel final `30619668658` construit maintenant les six plateformes
depuis `962a519`. Au moment de cette mise à jour, il est encore en cours : ne
pas qualifier la couche zéro RTX sur la seule base des tests macOS. Cette
séparation permet d'installer le paquet final dans un slot candidat, de garder
`rc38` comme rollback et de ne créer `rc39` qu'après la vraie qualification.

Suite exacte :

1. obtenir un build manuel vert sur `962a519` et télécharger l'artefact
   `windows-x64-cuda` ;
2. l'installer dans le slot candidat de la RTX sans écraser `rc38` ;
3. vérifier que la RTX annonce réellement `supports_frontend=true`, prend un
   span commençant à zéro et forme une route complète avec le Mac mini ;
4. qualifier SSE, abort, outils et budget exact `12 220 + 4 096` depuis cette
   tête Windows ;
5. seulement alors publier `v2.7.0-rc39`, mettre à jour l'IDE et refaire le
   même test depuis les actifs publics.

## Tête Windows réelle et identité des permis du 31 juillet 2026

Le workflow candidat `30619668658` est finalement entièrement vert sur les
six plateformes. Son tarball Windows CUDA a été installé dans un slot candidat
sur la RTX sans écraser le rollback `rc38`. Le binaire
`Scripts/vllm-rs.exe` est bien celui du candidat et la RTX annonce désormais
`supports_frontend=true`.

### Qualification de la RTX comme tête et worker complet

La RTX a choisi seule `[0,36)`, sans instruction de placement du VPS, puis a
chargé embeddings, 36 blocs et tête LM. Elle est devenue `READY`, a formé à
elle seule une route complète et a annoncé une capacité KV live de 23 264
tokens. Le Mac mini `rc38` est resté disponible et a choisi `[0,21)`, mais le
Request Agent a correctement préféré la route RTX en un seul saut.

Depuis ce frontend Windows natif :

- une génération SSE réelle a répondu HTTP 200 en 6,7 secondes avec la
  sentinelle exacte `WINDOWS HEAD OK` ;
- un abort client a libéré la route et toutes les réservations ;
- après les essais, `active_routes=[]`, `max_running_request=0` et les deux
  workers sont restés `ready`.

Cette preuve ferme la limitation historique : Windows CUDA peut maintenant
prendre la première couche, les couches intermédiaires et la dernière couche.
Le placement continue de dépendre de la mémoire et du coût réseau réels, pas
de l'OS.

### Défaut exact découvert par le gros contexte

Le premier essai OpenCode exact de 12 220 tokens d'entrée et 4 096 tokens
réservés a été correctement recalibré par la tête Windows à 12 229 tokens
après application de son template canonique. Le Request Agent a donc relâché
le permis initial 16 316 et demandé le contrat exact 16 325. Il réutilisait
toutefois l'identifiant logique comme clé HTTP `Idempotency-Key`. L'autorité a
refusé le second payload, comme elle le devait, puisque la même clé ne peut pas
désigner deux contrats différents.

Le comportement fail-closed de l'autorité a été conservé. Le design suit le
contrat d'idempotence documenté par
[l'IETF](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header),
[AWS](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html)
et [Stripe](https://docs.stripe.com/api/idempotent_requests) : une répétition
réseau du même payload garde la même clé, tandis qu'un payload différent
reçoit une autre clé même s'il appartient à la même requête logique.

Le moteur final
`32f8770507a91e6aa46f5b520055816b4d979bf6`, poussé sur
`codex/swarm-protocol-v3`, sépare donc :

- `logical_request_id`, stable pendant calibration, replan et journal SSE ;
- une empreinte SHA-256 d'idempotence dérivée de l'endpoint coordinateur, du
  modèle, du budget contexte, des politiques de reprise et du TTL.

Le ledger SQLite migre en place vers `logical_request_id` sans reconstruire la
table ni perdre les permis historiques. La colonne historique `request_id`
reste la clé d'idempotence. Les tests couvrent la répétition exacte, le passage
16 316 vers 16 325 avec la même identité logique, la migration rc38 et la
stabilité de l'empreinte. Résultats :

- 63 tests ciblés verts ;
- suite moteur complète : `808 passed, 7 skipped` ;
- Ruff et `git diff --check` verts.

Le CLI `12f66554f566b39c59a253bb59e88a3ff3d92505`, poussé sur `dev`,
épingle exactement ce moteur. Ses trois tests installateur et son typecheck
monorepo sont verts. Le runtime
`bd668d5482cc4fd241117646e9b32c5a6440cecd`, poussé sur `main`,
verrouille exactement ce CLI et ce moteur ; `verify-runtime-lock.sh` est vert
sur les clones locaux exacts. Ne pas utiliser le commit CLI intermédiaire
`b985...` : une révision moteur complète y avait été reconstruite à tort
depuis un SHA abrégé, et le verrou runtime a bloqué cette erreur avant toute
release.

### Déploiement du contrat corrigé et nouvelle preuve OpenCode

L'image coordinateur VPS
`local/parallax-scheduler:swarm-v3-32f8770` porte l'étiquette OCI exacte
`32f8770507a91e6aa46f5b520055816b4d979bf6`. Elle a remplacé atomiquement
l'ancien conteneur en conservant les 40 variables, les clés, les volumes, le
réseau hôte, l'epoch 116 et un conteneur de rollback. La migration du ledger a
réussi et les workers M4 et RTX se sont reconnectés `ready`.

Le test OpenCode a alors produit :

- calibration client : 12 220 + 4 096 = 16 316 ;
- calibration canonique Windows : 12 229 + 4 096 = 16 325 ;
- HTTP 200 en 20,142 secondes ;
- contenu exact `FABIOPENCODE-62219` ;
- usage retourné : 12 229 prompt, 11 completion, 12 240 total ;
- zéro route ou réservation KV résiduelle.

Le ledger prouve une seule identité logique, un permis 16 316 relâché puis un
permis 16 325 distinct relâché. Ce n'est donc ni une relaxation de l'autorité
ni une réutilisation ambiguë.

Le workflow candidat multi-OS `30628467184` est entièrement vert : les deux
transactions d'installation et les six tarballs ont réussi, Windows CUDA
inclus. Le tag léger `v2.7.0-rc39` a donc été créé sur l'unique commit testé
`bd668d5482cc4fd241117646e9b32c5a6440cecd`.

Son premier run de publication est `30631691410`. Le job Darwin arm64 MLX a
échoué avant le build parce que le runner GitHub n'a plus pu joindre
`github.com:443` pendant huit secondes au checkout du CLI exact. Le même
checkout avait réussi juste avant, le candidat identique est vert et aucun
code n'était en cause. La relance ciblée du job échoué est terminée avec
succès le 3 août. Le run, ses deux transactions d'installation et ses six
builds sont donc tous verts. La release publique préliminaire `v2.7.0-rc39`
contient ses 31 actifs attendus, dont les deux parties Windows CUDA, leur
manifeste et somme SHA-256, l'extracteur autonome et les trois installateurs.

### Installation publique Mac et requalification mixte du 3 août 2026

Le Mac mini a été installé depuis les actifs publics `v2.7.0-rc39`. Son
`MANIFEST` vérifié contient exactement :

- OpenCode `12f66554f566b39c59a253bb59e88a3ff3d92505` ;
- Parallax `32f8770507a91e6aa46f5b520055816b4d979bf6` ;
- cible `bun-darwin-arm64`, accélération `mlx`, réseau natif `0.1.0`.

Au démarrage autonome, le worker a choisi `[0,24)` et tenté le contexte
32 768. Le contrat mémoire live a mesuré un plafond de 22 624 tokens et refusé
proprement cette enveloppe : 2,07 Go restaient disponibles pour 3 Go requis.
Le worker s'est fenced puis a fait une seule convergence vers 16 384, sans
boucle de réallocation. Il est devenu `ready` avec 18 240 tokens KV mesurés,
5,236 Go de poids et 1,67 Go de KV. Il n'y a eu ni swapin ni swapout observé.

Le PC téléchargeait en parallèle, à la demande de l'utilisateur, un GGUF
Qwen3-Coder de 17,665 Go. Ce téléchargement n'a pas été interrompu. Ollama a
été arrêté sans suppression sur Windows et le profil Colima `openclaw` a été
arrêté sans suppression sur le Mac. RunPod a été envisagé pour ne pas disputer
la connexion du PC, mais l'API a refusé la création avant allocation avec HTTP
402, solde insuffisant : aucun pod n'a existé et aucun coût n'a été engagé.

La RTX a ensuite été relancée depuis le slot candidat Windows déjà qualifié,
sans télécharger Fabi ni toucher au GGUF. Aucune session Windows interactive
n'était ouverte : la tâche `InteractiveToken` accepte `/Run` mais ne démarre
pas hors session. La documentation Microsoft confirme que `S4U` peut démarrer
sans session, mais lui retire l'accès réseau et aux fichiers chiffrés ; ce
mode ne convient donc pas à un worker P2P. La qualification de laboratoire a
utilisé une session SSH persistante avec le contexte utilisateur réel. Le
produit devra choisir explicitement entre lifecycle lié à l'IDE et vrai
service Windows provisionné, sans stocker implicitement un mot de passe.

La route mixte Mac public `rc39` + RTX candidate est devenue `route_ready` :

- les deux workers `ready`, liveness `healthy` ;
- Mac `supports_frontend=true`, RTX candidate `supports_frontend=false` ;
- lien inter-worker direct, aucun relay inter-worker, RTT annoncé entre 11 et
  26 ms ;
- capacité de route 18 240 tokens, aucune réservation résiduelle.

Preuves depuis le Request Agent local exact `32f8770` :

- SSE `/no_think` : HTTP 200, TTFT 5,663 s, contenu exact
  `RC39 ROUTE OK` ;
- abort client volontaire après 7,002 s : le Request Agent avait encore une
  route au premier poll, puis route locale et coordinateur à zéro moins de
  deux secondes plus tard ;
- contexte OpenCode : 12 220 tokens locaux + 4 096 réservés, recalibrés par
  la tête à 12 229 + 4 096 = 16 325, HTTP 200 en 57,832 s, contenu exact
  `FABIOPENCODE-62219`, usage 12 229 prompt + 11 completion ;
- après les trois scénarios : `active_routes=[]`, aucun échec récent, aucun
  replan froid et `reserved_context_tokens=0` sur les deux workers.

Reste avant de qualifier complètement la release dans l'IDE : laisser finir
le téléchargement utilisateur, installer le paquet Windows public `rc39`,
répéter les preuves depuis ce paquet exact, puis seulement mettre à jour la
constante runtime de l'IDE et exécuter son E2E Electron/OpenCode.

## Admission mémoire initialisée et politique de contribution du 3 août 2026

### Cause exacte du worker local bloqué

Le worker du Mac de développement n'était pas lent pendant un chargement : il
était en `STANDBY` sans span possible. La première annonce avait été calculée
avant le processus MLX réel avec 0,98 Gio utilisable. Le placement avait choisi
`[24,27)`, puis l'exécuteur initialisé ne disposait plus que de 0,17 Gio
additionnel. Les trois couches consommaient 0,564 Gio et le KV 32k demandait
encore 0,38 Gio : `MemoryContractError`, puis redémarrage. La seconde annonce
figeait 170 Mio et ne se rafraîchissait jamais, même si la pression baissait.

Le Mac 16 Gio n'était pas vide. Les mesures système ont montré environ :

- Arc : 4,2 Gio RSS ;
- Cursor : 2,4 Gio ;
- Fabi/Electron : 1,3 Gio ;
- VS Code : 1 Gio ;
- plus Zoom, Outlook, le runtime et les services macOS ;
- 2,1 Gio de swap utilisé au premier diagnostic, avec pression noyau
  `warning`.

La formulation IDE « ton worker charge et vérifie » était donc fausse. Le gate
ne distinguait pas un worker en construction d'un worker connecté mais sans
mémoire sûre.

### Recherche primaire et choix de politique

Les implémentations et documentations suivantes ont été relues avant le
correctif :

- Apple décrit la mémoire disponible comme consultative et changeante, et
  fournit les événements `normal`, `warning`, `critical` via
  `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE` ;
- MLX précise que `set_memory_limit` reste une limite indicative et expose
  `max_recommended_working_set_size`, `get_active_memory` et la mémoire de pic ;
- vLLM initialise le runtime, charge le modèle, profile le pic non-Torch et les
  activations, puis attribue seulement le reliquat au KV ;
- Ollama macOS calcule la mémoire libre depuis `HOST_VM_INFO64`, utilise le plus
  petit de la mémoire système et Metal sur mémoire unifiée et conserve 512 Mio
  de coût runtime Metal ; sur les autres GPU, son minimum est 457 Mio ;
- Exo place proportionnellement à `psutil.virtual_memory().available` et suit
  les pics MLX ;
- Petals estime poids/cache/workspace avant de choisir le nombre de blocs, mais
  son cas macOS reste essentiellement une réduction manuelle du nombre de
  blocs ;
- llama.cpp sépare poids, KV et buffers de calcul et son placement récent fait
  des allocations virtuelles de test avant de réduire contexte/offload.

Sources : [Apple memory pressure](https://developer.apple.com/documentation/dispatch/dispatch_source_type_memorypressure),
[MLX memory limit](https://ml-explore.github.io/mlx/build/html/python/_autosummary/mlx.core.set_memory_limit.html),
[vLLM GPU worker](https://docs.vllm.ai/en/latest/api/vllm/v1/worker/gpu_worker/),
[Ollama Darwin memory probe](https://github.com/ollama/ollama/blob/main/discover/gpu_info_darwin.m),
[Ollama device overhead](https://github.com/ollama/ollama/blob/main/ml/device.go),
[Exo placement](https://github.com/exo-explore/exo/blob/main/src/exo/master/placement_utils.py),
[Petals server placement](https://github.com/bigscience-workshop/petals/blob/main/src/petals/server/server.py).

Le produit suit désormais la politique agressive mais mesurée d'Ollama, comme
demandé : 512 Mio de coût runtime par défaut sur MLX et CUDA, puis plafond
officiel MLX ou profilage vLLM/SGLang. Les variables
`PARALLAX_SYSTEM_RESERVE_GB` et `PARALLAX_CUDA_SYSTEM_RESERVE_GB` conservent un
override opérateur littéral.

### Correctif moteur V3

Le moteur final `f02149e7a5af47ea4d8442538e2c69bc8f1450b1`, poussé sur
`codex/swarm-protocol-v3`, introduit une admission en deux phases :

1. le contrôleur P2P démarre sans annoncer une capacité définitive ;
2. un processus de préflight initialise le vrai backend MLX ou CUDA, ses
   imports, son contexte distribué et le contexte de chaque GPU ;
3. ce processus reste vivant pendant `STANDBY`, échantillonne la capacité
   réellement additionnelle et publie une enveloppe stabilisée ;
4. une baisse est appliquée immédiatement ; une hausse exige trois mesures
   cohérentes ;
5. dès qu'un span passe `BUILDING`, l'enveloppe est figée, le préflight sort et
   cède sa place au vrai exécuteur ;
6. l'exécuteur conserve l'autorité finale après poids/workspace et refuse un KV
   qui ne tient pas physiquement.

La correction élimine aussi un double comptage MLX : le DHT annonçait parfois
la limite totale du processus alors que le manifeste compare uniquement poids
et KV. Il annonce maintenant `additional_bytes`, donc exclut les allocations
déjà possédées par le runtime initialisé.

Un worker sans span reste connecté avec la décision explicite
`insufficient_live_memory`. Si la mémoire revient, sa nouvelle offre est
publiée automatiquement sans toucher aux routes actives. L'API contribution
renvoie un état agrégé lié au compte, sans identifiant de peer. L'IDE affiche
désormais `Contribution en veille — mémoire insuffisante`, la capacité sûre et
la reprise automatique, au lieu d'un faux chargement.

Sur le Mac local, le préflight final a mesuré 6 857 949 184 octets disponibles
et annoncé 6 321 078 272 octets, soit 5,89 Gio utilisables après les 512 Mio de
coût Metal. Avec la mesure précédente de 2,70 Gio disponibles, la même politique
aurait annoncé environ 2,20 Gio, et non zéro. La limite MLX officielle du M4 16
Gio observée est 12 713 115 648 octets : Fabi ne peut donc pas monopoliser les
16 Gio physiques même quand le système est vide.

Validations locales :

- suite moteur complète finale : `817 passed, 7 skipped` ;
- 85 tests ciblés admission/placement/gate verts ;
- Ruff sur tous les fichiers touchés et `git diff --check` verts ;
- IDE : 49 tests verts ;
- CLI : trois tests installateur verts et typecheck monorepo vert ;
- préflight MLX réel exécuté sur le M4, sans worker ni machine distante modifiés.

Un dernier audit du chemin de lancement a trouvé une incohérence avant
publication : le moteur utilisait bien son nouveau défaut CUDA de 512 Mio,
mais l'IDE et le CLI injectaient encore automatiquement l'ancien override
`PARALLAX_CUDA_SYSTEM_RESERVE_GB=1.5` ou `2`. Le candidat `30801726224` a été
annulé : même s'il avait compilé, il n'aurait pas constitué la preuve de la
politique produit Windows/Linux demandée.

Le CLI final `4e1381353f718eb8e1e31cbd54d59a84150f88f4`, poussé sur `dev`,
supprime ces paliers matériels et laisse l'admission au runtime initialisé sur
Apple, CUDA et CPU. Les overrides explicitement posés par un opérateur restent
respectés. Le test CLI couvre maintenant CUDA 8 et 16 Gio sans variable
injectée ; 27 tests worker et le typecheck monorepo sont verts. L'IDE applique
le même contrat et ses 49 tests sont verts. Les deux anciens launchers de labo
Windows effacent également l'override historique afin de tester le défaut
produit.

Le runtime `688a6f1942275ba4eaa284606d914bf11d787b07`, poussé sur `main`,
verrouille ce CLI final et le moteur
`f02149e7a5af47ea4d8442538e2c69bc8f1450b1` ;
`verify-runtime-lock.sh` est vert sur les clones exacts. Le push `30802544505`
a correctement rejoué les transactions mais, conformément à la condition du
workflow, a ignoré les tarballs hors tag. Le vrai candidat multi-OS est donc le
déclenchement manuel `30802614546` sur la même tête exacte. Ses deux
transactions d'installation et ses six tarballs sont tous verts, Windows CUDA
inclus. Le tag léger `v2.7.0-rc40` a donc été créé sur l'unique commit candidat
`688a6f1942275ba4eaa284606d914bf11d787b07`. Le workflow de publication est
`30807023196`; ne qualifier la release publique qu'après ses six builds,
attestations, uploads et le contrôle du nombre d'actifs.

Une seconde mesure locale avec import complet de l'exécuteur MLX a observé
8 062 664 704 octets disponibles et annoncé 7 525 793 792 octets, soit 7,01
Gio de contribution après la marge de 512 Mio. Cette valeur est volontairement
différente de la mesure précédente : elle prouve que l'offre suit la mémoire
réellement récupérable au lieu d'un palier calculé une fois pour toutes.

Le VPS était encore servi avant déploiement par l'image qualifiée
`local/parallax-scheduler:swarm-v3-32f8770`. L'image candidate
`local/parallax-scheduler:swarm-v3-f02149e` a été construite à côté depuis le
SHA complet ; son label OCI est exact et un smoke test isolé importe
`parallax`, le transport natif protocole 1 et le nouveau contrôleur de capacité.
Le conteneur actif, ses 40 variables, son volume d'état, ses clés montées, son
réseau hôte et sa politique de restart ont ensuite été repris à l'identique
lors de la bascule atomique.

La première création a refusé une ligne vide ajoutée par le format d'inspection
Docker. Le trap de déploiement a restauré immédiatement `32f8770` et son probe
`/v1/models` est resté vert. Après filtrage de cette ligne vide, la seconde
bascule a réussi : le coordinateur actif porte `f02149e…`, expose le modèle,
conserve 40 variables et le réseau hôte, affiche zéro restart et aucune erreur
récente. Le seul rollback conservé est
`parallax-scheduler-qwen3-4b-v3-pre-f02149e-20260803T102829Z`, sur l'image
`32f8770`; douze conteneurs de rollback plus anciens et déjà arrêtés ont été
supprimés, sans supprimer leurs images ni les volumes.

Le statut de contribution public répond maintenant avec le nouvel état agrégé
`worker_state=standby` pour le worker local encore sous `rc39`. Il ne renvoie
logiquement pas encore sa nouvelle capacité : cette preuve exige l'installation
du runtime `f02149e` côté worker.

L'artefact candidat `dist-darwin-arm64-mlx` de `30802614546` a été téléchargé
sans activation. Ses deux SHA-256 sont valides et son manifeste contient
exactement OpenCode `4e138135…`, Parallax `f02149e…`, réseau natif `0.1.0` et
MLX arm64. Le source embarqué contient bien les deux défauts runtime MLX/CUDA
à 512 Mio. Comme il s'agit du workflow manuel, sa version de manifeste est
`main` ; seule la reconstruction depuis le tag devra porter
`v2.7.0-rc40`.

Le clone IDE local complet a ensuite été compilé avec Node 22 : les trois
extensions `fabi-branding`, `fabi-swarm`, `fabi-spaces`, puis les bundles
Theia browser, node et Electron terminent avec zéro erreur. Ce résultat ne
remplace pas le futur E2E visuel sur le runtime public, mais ferme le risque
d'un test limité aux seuls fichiers TypeScript unitaires.

### Activation publique et preuves mémoire réelles

L'actif public Apple Silicon de `v2.7.0-rc40` a été installé une première fois
dans une racine temporaire isolée. Le SHA-256, les 58 relocalisations et les
imports du module `runtime_capacity` sont valides ; son `MANIFEST` porte bien
le tag `rc40`, OpenCode `4e138135…` et Parallax `f02149e…`. Une commande de
smoke a d'abord demandé par erreur une classe `RuntimeCapacityController` qui
n'existe pas : il s'agissait d'un mauvais nom dans le diagnostic, pas d'un
défaut du paquet. Le module réel expose `StableCapacityTracker` et
`run_runtime_capacity_probe` et s'importe correctement.

Le même actif public a ensuite été installé transactionnellement sur le Mac
mini, puis le worker Iroh a été redémarré avec le launcher de labo qui passe
explicitement la source du runtime installé. Le préflight MLX a publié trois
échantillons stables de 10,16 à 10,18 Gio. Le placement autonome a choisi
`[0,24)`, chargé 5,236 Go de poids et dimensionné poids + KV à 9,068 Go. Le
worker est `ready` avec 41 856 tokens KV. Le coordinateur est revenu à
`available` / `route_ready`, sans erreur ni restart ; le lien Mac mini -> RTX
est direct.

Le Mac de développement a également reçu l'actif public, sans fermer
Electron. Le premier GET direct a reçu HTTP 500 depuis l'edge GitHub FRA avant
toute activation ; l'ancien runtime est donc resté intact. L'actif a ensuite
été téléchargé via l'API GitHub, son SHA vérifié, puis installé par la même
transaction. Seul le groupe du worker a reçu SIGINT ; son superviseur IDE l'a
relancé automatiquement 30 secondes après sa sortie propre.

Sous la charge réelle de cette machine, le nouveau préflight a publié 6,76 à
6,87 Gio au lieu des 170 Mio figés de `rc39`. Le worker a choisi `[24,36)`,
téléchargé uniquement les plages signées nécessaires, chargé 2,980 Go de
poids et réservé 2,99 Go de KV. Il sert maintenant 65 408 tokens KV. Le statut
global accepte les trois workers, reste `route_ready`, et le gate public du
compte local répond `allowed=true`, `reason=eligible`, avec un worker éligible.
Cette preuve montre à la fois que Fabi utilise réellement la machine et qu'un
poste plus occupé reçoit une tranche plus petite que le Mac mini.

Après chargement, `psutil` mesurait encore environ 1,52 Gio disponibles et le
contrôleur restait `normal`. Le système avait toutefois comprimé/swapé des
pages pendant le chargement : cette politique est volontairement agressive,
comme Ollama, et non sans coût. La protection live reste active : trois
échantillons sous le seuil `warning` ferment les nouvelles admissions ; deux
échantillons sous le seuil `critical` drainent la génération puis la
redémarrent avec une enveloppe recalculée. Une route active n'est jamais
retaillée en boucle.

Le HTTP 500 réel a motivé un durcissement séparé de l'installation. Le runtime
`d420447` applique désormais les retries bornés officiels de curl à tous les
GET POSIX et une boucle compatible Windows PowerShell 5.1 au fallback
`Invoke-WebRequest`. L'IDE applique le même contrat aux petites métadonnées
`.parts` et `.sha256`, en ne retentant que 408, 429, 5xx et les erreurs réseau ;
un 404 déterministe n'est jamais masqué. La transaction shell, le build des
trois extensions, les 16 tests runtime ciblés et les 51 tests IDE sont verts.
Le lancement accidentel de `npm test` à la racine a seulement indiqué que ce
script npm n'existe pas ; la commande de suite correcte est
`node --test fabi-swarm/test/*.test.js`, qui est verte.

La publication taggée `30807023196` est finalement entièrement verte : deux
transactions d'installation et six builds, y compris Linux CUDA et Windows
CUDA. La release publique préliminaire `v2.7.0-rc40` contient exactement ses
31 actifs attendus. Son tag léger pointe sur le candidat testé
`688a6f1942275ba4eaa284606d914bf11d787b07`, tandis que `main` contient en plus
le durcissement téléchargement `d420447bbe7b83f76658d04c7893bf19755ec994`,
validé par le workflow push `30809498479` entièrement vert.

### Cycle de vie worker et Request Agent

L'E2E local a exposé un défaut indépendant de l'admission mémoire : avant un
redémarrage, le nettoyage des orphelins considérait tout processus dont la
commande contenait la racine du runtime comme un worker. Il pouvait donc tuer
le Request Agent local, puis provoquer dans l'IDE un faux retour à
`bootstrapping` après une génération ou une reconnexion.

Le nettoyage reconnaît désormais uniquement les racines Parallax réelles :
`parallax ... join`, `python -m parallax.cli join` ou `parallax/launch.py`.
Sur Unix, les groupes de processus détachés sont signalés ; sur Windows,
`taskkill /T` ferme l'arbre du worker. Le nettoyage a lieu avant le nouveau
spawn pour supprimer la course où le nouveau worker pouvait être pris pour un
orphelin. Le Request Agent, OpenCode et les autres sidecars de la même release
ne correspondent jamais à ce filtre. Ce choix suit les contrats officiels
[Node `detached`](https://nodejs.org/api/child_process.html) et
[Microsoft `taskkill /T`](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill).

La preuve ne repose pas seulement sur le test unitaire. Dans l'application
Electron réelle, le worker PID `64187` et le Request Agent PID `64188` étaient
prêts sur un cluster `available`. Après SIGINT contrôlé du seul groupe worker,
Fabi a lancé le nouveau worker PID `64964` tout en conservant exactement le
Request Agent PID `64188`. Les trois nœuds sont ensuite revenus `available`,
pipeline structurelle et admission actives. Le build Electron complet
browser/node/electron termine avec zéro erreur et les 51 tests IDE passent.

Pendant l'installation publique de la RTX, son arrêt volontaire a aussi
révélé un mensonge d'état dans l'IDE : il affichait `Contribution déjà
utilisée` alors que le coordinateur confirmait `active_requests=0`, aucune
route active et `reason=swarm_not_ready`. La réponse de contribution
`capacity_reached` mise en cache avant le changement de topologie gagnait à
tort sur l'état transport live. `requireContribution` traite désormais le
gate seulement si la route est actuellement prête ; un départ de peer, une
route occupée ou un swarm incomplet invalide donc immédiatement ce verdict
périmé. Le test `reports a loaded but saturated route` couvre la régression,
les 51 tests restent verts et l'application Electron a été reconstruite puis
relancée avec ce correctif.

## Découverte, couverture autonome et reprise du swarm du 3 août 2026

### Deux pannes distinctes derrière « aucun swarm joignable »

Le symptôme IDE a d'abord correspondu à une panne de découverte : le
conteneur actif `parallax-scheduler-qwen3-4b-v3` avait été recréé sans les cinq
labels Docker consommés par le registre (`fabi.swarm`, `fabi.swarm.id`,
`fabi.swarm.model`, `fabi.swarm.name`, `fabi.swarm.url`). Le scheduler et son
endpoint modèle restaient sains, mais le catalogue public ne pouvait plus le
publier. Le conteneur a été recréé atomiquement avec les mêmes 40 variables,
volumes, mounts, réseau hôte, restart policy et image, en restaurant les cinq
labels. Le rollback arrêté
`parallax-scheduler-qwen3-4b-v3-pre-labels-20260803T1228Z` est conservé. Le
registre public publie de nouveau `qwen3-4b-v3` ; le fichier Compose historique
ne porte toutefois pas encore ces labels et ce risque de déploiement doit être
fermé dans la source avant la prochaine bascule.

La découverte restaurée, deux workers étaient bien annoncés mais leurs spans
fixes étaient Mac mini `[0,32)` et Mac local `[0,10)` pour un manifeste de 36
couches. La fin `[32,36)` n'était donc couverte par personne. Le contrôleur
autonome refusait de déplacer le worker redondant tant qu'une autre route
complète ne survivait pas au mouvement. Comme aucune route n'existait encore,
ce garde créait un interblocage de bootstrap.

### Alignement sur la règle d'équilibrage de Petals

Le code officiel Petals `src/petals/server/block_selection.py` a été relu avant
la correction. Petals protège une chaîne qui sert déjà : il refuse un
déplacement lorsque le débit minimum courant est positif et deviendrait nul.
En revanche, si la chaîne est déjà discontinue, il autorise un déplacement qui
améliore sa couverture. Fabi applique maintenant le même invariant, avec ses
contraintes plus fortes de contexte, endpoints et leases :

- une route complète existante doit survivre au départ du worker déplacé ;
- sans route complète, le worker peut réparer la couverture seulement si une
  autre copie `READY` conserve chacune de ses couches actuelles ;
- le nouveau span doit strictement améliorer le score exact du planificateur.

Le moteur final
`9d16bfd1b2dc52c80eee20802b518246c32792c9`, poussé sur
`codex/swarm-protocol-v3`, couvre le cas exact 36 couches : `[0,10)` en doublon
avec `[0,32)` migre vers `[32,36)`. Les 25 tests ciblés passent, Ruff et le
formatage sont verts, et la suite complète donne `819 passed, 7 skipped`.
Il inclut aussi le correctif parent
`6ee749aec5fe2267ee439fec453cf68d3169a864`, qui évince les requêtes terminales
propagées et libère leur slot d'admission local.

Le CLI
`f38b5fd0723d8b2499b5199ce67ac3f6a31ff830`, poussé sur `dev`, qualifie ce
moteur ; ses trois tests installateur et le typecheck monorepo sont verts. Le
runtime `7a82a07d68822452efbaf8c27f3e20021080a352`, poussé sur `main`, verrouille
exactement ce CLI et ce moteur. `verify-runtime-lock.sh` est vert sur les deux
clones exacts. Le workflow push `30814909486` valide les transactions Linux et
Windows. La matrice manuelle exacte `30815023024` construit encore les six
plateformes au moment de cette écriture ; aucun nouveau tag ne doit être créé
avant ses six résultats verts et la qualification réelle Mac/Windows.

### Preuve live après relance de l'IDE

L'application Electron locale avait été fermée proprement à
`2026-08-03T12:41:46Z`; son worker avait donc quitté le swarm. Le registre ne
voyait logiquement plus que le Mac mini `[0,32)` et annonçait une route
incomplète. Après relance normale de l'IDE, le runtime installé a cette fois vu
l'offre du Mac mini avant son premier choix et a sélectionné seul `[32,36)`.
Cette observation confirme que le VPS n'attribue pas les couches en V3 : les
workers choisissent leurs spans depuis l'état DHT.

La route obtenue est restée stable pendant six probes espacés de cinq secondes :

- Mac mini `eac4e808…` : `[0,32)`, `READY`, 20 992 tokens KV ;
- Mac local `993a92a3…` : `[32,36)`, `READY`, 222 560 tokens KV ;
- deux offres, deux leases et deux liens Iroh relay qualifiés ;
- `structural_pipeline_ready=true`, `admission_ready=true`, contexte de route
  20 992 tokens et aucune réservation résiduelle.

Un premier stream authentifié a traversé les deux workers. Un second appel
immédiat a reçu temporairement HTTP 500 parce que l'autorité a répondu
`swarm_not_ready` pendant la transition d'admission ; ce résultat n'est pas
masqué et doit être rejoué avec le runtime exact qui inclut `6ee749a`. Une
nouvelle génération `/no_think` a ensuite répondu HTTP 200 avec le contenu
exact `FABI SWARM OK`, TTFT 5,312 s et durée totale 8,646 s. Après la requête,
les deux workers sont restés sains, la route est `route_ready`,
`max_running_request=0` et les réservations KV sont revenues à zéro.

## Autorité dynamique, état durable OpenCode et génération longue du 3 août 2026

### Deux causes réelles derrière le nouveau tour bloqué

Un redémarrage manuel du worker Mac mini avait omis
`FABI_SWARM_V3_COORDINATION_MODE=client`. Le runtime installé acceptait alors
encore la valeur historique `fixed` et refusait l'enveloppe signée du Request
Agent avec `fixed coordinator admission does not accept a capability
envelope`. Une relance par le launcher qualifié a immédiatement reformé la
route Mac mini `[0,32)` -> Mac local `[32,36)` et un stream direct a répondu
exactement `FABI V3 PRODUCT OK` en 9 s.

Le produit ne dépend désormais plus de cette variable : en mode V3 actif, le
worker construit toujours son autorité à partir du registre de confiance et
des capabilities signées. Une valeur héritée `fixed` ne peut donc plus
réactiver silencieusement l'ancien placement. Le moteur
`faa90ad90900b04377056153498af021d49b9e82`, le CLI
`38c127d8ceb3a46fd7c64a2b2f5e61ddda998e39` et le runtime
`250955e52a7728ab8f0180f66fd603cd12aaf5ac` sont poussés respectivement sur
`codex/swarm-protocol-v3`, `dev` et `main`. Les tests ciblés du moteur, les
trois tests installateur, le typecheck CLI et `verify-runtime-lock.sh` sont
verts. La suite moteur donne `819 passed, 7 skipped`; un test d'import en
sous-processus a dépassé une fois son timeout fixe de 10 s sous charge, puis a
passé isolément en 0,82 s. Cette anomalie de timing n'est pas présentée comme
un défaut fonctionnel résolu.

Le tour Electron observé à `15:24:56` a ensuite obtenu sa route et commencé le
prefill réel, puis a échoué à `15:25:52` avec `Worker route was lost`. Les
keepalives du permis devenaient `503` pendant que la génération occupait la
seule pipeline. Le correctif parent `623f177` renouvelle désormais un permis
existant d'après la contribution live sans exiger qu'une seconde route libre
soit admissible. Il ne supprime ni le contrôle de compte ni la preuve que le
worker contribue encore.

### Déploiement VPS attesté par le contenu

La première tentative de déploiement a produit un diagnostic trompeur : le
script imprimait son succès via `SystemExit(0)`, puis son bloc
`except BaseException` interceptait aussi ce succès et restaurait l'image
`ab9c8ff`. Le label du candidat était donc exact, mais le conteneur actif était
revenu à l'ancien code. Ce n'était ni Docker Compose ni un superviseur. La
comparaison du SHA de l'image active et l'inspection de la méthode Python
importée ont permis d'établir cette cause avant tout nouveau test.

Le candidat a été reconstruit avec l'argument Docker exact
`PARALLAX_COMMIT=faa90ad90900b04377056153498af021d49b9e82`. Son smoke test ne
contrôle plus seulement le label : il importe le paquet installé et vérifie
que `ContributionGate.keepalive_route_permit` ne contient plus le garde
`serving_ready`. La seconde bascule utilise une condition de succès normale,
conserve l'ancien conteneur sous
`parallax-scheduler-qwen3-4b-v3-pre-faa90ad-r2-20260803T134504Z` et vérifie
l'ID d'image après démarrage. L'actif est maintenant
`local/parallax-scheduler:swarm-v3-faa90ad-r2`, conserve ses 40 variables et
ses cinq mounts, expose `/v1/models`, et importe bien le code `faa90ad`.

Après ce redémarrage, les deux workers se sont réannoncés sans commande de
placement du VPS. Ils ont conservé leurs décisions autonomes publiées dans la
DHT : Mac mini `[0,32)`, Mac local `[32,36)`. La route est revenue
`available`, `route_ready`, avec 22 048 tokens de contexte réellement
supportés et les deux liens relay qualifiés. Le scheduler reste donc un
coordinateur de requête, d'autorité et d'observabilité ; il ne distribue pas
les couches en V3.

Une génération synthétique longue, sans outil et lancée via le Request Agent
local, a ensuite traversé les deux workers pendant 198,101 s. Elle a reçu HTTP
200, un `[DONE]`, 211 chunks et 548 caractères ; son TTFT était de 152,882 s,
notamment avec le chargement/prefill de ce test. Tous les renouvellements du
même permis ont répondu `200` au-delà de trois minutes, puis le Request Agent
a envoyé le `DELETE` terminal. La capacité du compte est revenue à
`allowed=true`, `active_requests=0`, la pipeline à `available` et les deux
workers sont restés `healthy`. Le défaut de perte à 60 s est ainsi reproduit
sur l'ancien actif et fermé sur l'actif exact.

Le champ d'observabilité `swarm_v3_execution.active_routes` retombe toutefois
à zéro après un rafraîchissement de capability alors que le data plane est
encore en decode. Les logs workers et le ledger de permis restent cohérents,
mais cette projection ne doit pas encore être utilisée comme unique preuve
d'activité ; son cycle de vie doit être corrigé séparément.

### Réconciliation durable des tours IDE

La source officielle OpenCode confirme que `session.status` expose les états
`busy`, `retry` et `idle`, et que `GET /session/status` fournit leur projection
durable. Les événements SSE ne sont qu'un flux de changements et peuvent être
manqués lors d'une reconnexion ; le moteur de retry OpenCode peut en outre
continuer un 5xx retryable. Fabi conserve donc le SSE pour la réactivité, mais
réconcilie maintenant chaque tour accepté avec `/session/status` après la
connexion et après le POST du prompt. Une session absente ou `idle` termine le
tour ; `busy`, `retry` et tout état inconnu le gardent actif. L'abort libère
également toujours l'état local dans son `finally`.

Le helper pur `fabi-code-turn-state.ts` et son test empêchent le retour d'un
faux `Generating` persistant après perte d'un événement de bord. Les 53 tests
`fabi-swarm` passent et le build TypeScript est vert. L'application Electron
reste lancée par son chemin produit normal, avec worker et Request Agent
automatiques. Le tour utilisateur antérieur au déploiement a bien échoué et
n'a pas été rejoué automatiquement, afin de ne pas exécuter deux fois ses
outils ; `/session/status` est revenu vide avant de demander un nouvel essai.

Le workflow runtime manuel `30817748887`, sur le SHA exact `250955e`, a déjà
validé les transactions Windows et Linux ainsi que les tarballs
`linux-arm64-cpu`, `linux-x64-cpu` et `darwin-arm64-mlx`. Les builds
`darwin-x64-cpu`, `linux-x64-cuda` et surtout `windows-x64-cuda` sont encore en
cours au moment de cette écriture. Aucun tag public ne doit être créé avant la
fin verte des six artefacts et leur installation réelle sur le Mac mini et la
RTX.

## Acquittement OpenCode asynchrone et E2E Electron du 4 août 2026

### Cause exacte du faux tour bloqué

Le correctif de réconciliation du 3 août utilisait encore
`POST /session/{id}/message`. La source exacte du fork OpenCode 1.15 qualifié
(`4e138135…`) confirme que cette route reste attachée au tour complet : dans le
test réel, les headers HTTP ne sont arrivés qu'après 21,83 s. OpenCode fournit
déjà le contrat destiné à un frontend découplé :
`POST /session/{id}/prompt_async`, qui répond `204` immédiatement, puis
`GET /session/status`, le journal des messages et `/event` portent la vie du
tour.

La mesure sur le binaire installé a aussi montré pourquoi un simple changement
de route aurait créé une autre régression. Le `204` arrive environ 8 ms après
le POST, alors que la session est encore absente de `/session/status` à +0,
+1 et +10 ms ; elle devient `busy` seulement vers +100 à +140 ms. Une session
idle est volontairement retirée de cette map. « Absente » signifie donc soit
« pas encore observée », soit « terminée » : ce n'est pas un booléen terminal
sans mémoire du tour.

Fabi utilise maintenant une machine d'état explicite :

- il photographie les IDs des messages assistant durables avant la soumission ;
- il envoie le prompt par `prompt_async` et ne garde aucune connexion HTTP
  pendant le prefill/decode ;
- avant d'avoir vu `busy`, `retry`, un état futur ou un `step-start`, une
  session absente est `unobserved`, jamais `idle` ;
- après un état actif observé, une disparition ou un `idle` solde le tour ;
- si les deux bords SSE ont été manqués, un nouveau message assistant n'est
  terminal que lorsqu'il possède un `finish`, `time.completed` ou `error`
  durable.

Le timeout de sécurité de dix minutes reste un garde ultime contre un sidecar
irrécupérable ; il ne sert pas à deviner la vie d'une génération ni celle du
réseau. Les tests couvrent notamment la fenêtre `204 -> busy` et le repli par
historique durable.

### Deux défauts UI révélés par le vrai Electron

Un status swarm pouvait demander un rendu entre la construction d'un
`FabiChatInputWidget` et l'attachement de son `ChatModel`. Le getter local
appelait alors `_chatModel.getRequests()` et produisait une exception à chaque
rafraîchissement, même depuis l'instance de chat Theia invisible. L'input ne
rend désormais jamais le parent avant cet attachement ; une requête ne peut
pas non plus être considérée active sans modèle. Le test de visibilité couvre
ce cycle de vie. Après rebuild et redémarrage, un tour complet n'a produit
aucune nouvelle exception `getRequests`.

La barre compacte donnait également priorité à la phase Request Agent
`prefilling`, qui peut être en retard sur les tokens déjà reçus par OpenCode.
Tout delta texte/réflexion persistant est maintenant une preuve locale de
decode et fait afficher `Génération…`. Les phases explicites `recovering` et
`replaying` restent prioritaires. Sur le troisième tour Electron, le premier
delta de réflexion observé a bien remplacé `Préparation du contexte…` par
`Génération…` pendant que la réponse continuait à streamer.

### Preuves produit de bout en bout

Le test n'a pas appelé directement le backend : Electron a été lancé depuis
le clone local complet, l'onglet `Fabi AI` a été ouvert et le prompt a traversé
le widget Theia, le sidecar OpenCode, le Request Agent local et la route V3
réelle. Le premier tour a rendu exactement `FABIELECTRON-804`. Le message
assistant durable porte `finish=stop`, sans erreur, avec 53,351 s entre sa
création et sa complétion. La barre est revenue à `Prêt`, `/session/status` à
`{}`, `active_routes` à `[]` et `last_failure` est resté nul. Un second tour
sur le bundle incluant le garde de cycle de vie a rendu exactement
`FABIELECTRON-805` en environ 46,2 s et a libéré les mêmes états sans exception
UI.

L'abort natif a enfin été exercé pendant un vrai decode long via le contrôle
Theia `Cancel (Esc)`. OpenCode est passé de `busy` à une map vide, la route V3
a été libérée et l'IDE est revenu à `Prêt`. Le dernier message durable porte
`MessageAbortedError` / `Aborted` avec `time.completed`; il n'est donc pas
confondu avec une fin normale. Une première injection physique CDP avait été
interceptée par la couche de hover Theia et n'a pas été comptée comme preuve ;
le clic DOM suivant a appelé le handler React du contrôle produit.

La suite `fabi-swarm` contient maintenant 55 tests, tous verts. Le build complet
des extensions puis des bundles Theia browser, node et Electron termine avec
zéro erreur. Les workers Mac mini et RTX sont restés lancés sur le runtime
qualifié pendant ces tests. Le port DevTools `9333` n'était qu'un moyen de
diagnostic lié à loopback et ne fait pas partie du produit.

Ce cycle valide le prompt, le streaming, la fin durable et l'abort. Il ne
valide pas encore une permission d'outil, une modification de fichier, le
changement de modèle en cours de session, ni un kill réseau prefill/decode avec
replan froid ; ces scénarios restent à exécuter et ne sont pas présentés comme
terminés.

## Contrat de contexte frontend et erreurs SSE du 4 août 2026

### Cause du tour interrompu après lecture de fichiers

Le défaut a été reproduit depuis le vrai Electron/OpenCode, puis suivi jusqu'au
frontend RTX. Le premier appel contenait exactement 13 616 tokens d'entrée et
a généré 851 tokens normalement. Après l'outil `glob`, le tour suivant
contenait 16 721 tokens. Le frontend `vllm-rs.exe` de la RTX avait été ramené à
`max_model_len=16384` par la réconciliation mémoire, mais son lease V3
n'exposait que la capacité KV agrégée. Le planificateur confondait donc deux
grandeurs différentes : le nombre total de tokens KV hébergeables entre les
requêtes et la longueur maximale d'une requête sur ce frontend.

La requête trop longue était admise, puis le worker recevait un HTTP 400 local.
`TransformerConnectionHandler.chat_completion` injectait le JSON HTTP brut
dans le flux RPC avant que le Request Agent ajoute son événement SSE terminal.
Comme ce JSON ne portait ni préfixe `data:` ni double saut de ligne, le parseur
EventSource conforme WHATWG l'absorbait avec l'événement suivant. L'adaptateur
OpenAI compatible de l'AI SDK ne voyait finalement que `[DONE]` et produisait
son `finishReason=other`; OpenCode n'avait donc ni texte, ni erreur durable à
afficher. Ce n'était pas un crash de l'outil de lecture, ni un timeout de
génération.

### Contrat retenu

`SpanLease` publie désormais un `max_context_tokens` positif et obligatoire,
distinct de `kv_geometry.allocatable_bytes`. Le worker annonce la limite
effective réellement donnée à son frontend ; une baisse adaptative met à jour
à la fois la géométrie KV et cette limite. En mode autonome, le passage READY
conserve le contexte planifié au lieu de le reconstruire depuis la capacité KV
totale. Le planificateur exact refuse maintenant toute pipeline dont un span ne
supporte pas `prompt + output réservé`, même si son agrégat KV serait assez
grand.

Le data plane vérifie aussi le statut HTTP local avant de streamer. Une erreur
est transportée dans l'enveloppe HTTP binaire déjà définie par le protocole,
puis le Request Agent la convertit en exactement un événement OpenAI SSE
`data: {...}\n\n`, suivi de `data: [DONE]\n\n`. Le message et les champs
`type`, `param` et `code` sont conservés lorsqu'ils existent. Cette fin est
marquée terminale afin de ne pas ajouter ensuite une erreur générique ou un
abort en doublon.

Le choix suit les contrats des sources primaires relues avant modification :
la validation de `max_model_len` dans
[vLLM](https://github.com/vllm-project/vllm/blob/main/vllm/config/model.py), le
parseur OpenAI compatible de
[Vercel AI SDK](https://github.com/vercel/ai/blob/main/packages/openai-compatible/src/chat/openai-compatible-chat-language-model.ts),
la persistance des erreurs dans le
[processor OpenCode](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts)
et le framing défini par la
[spécification WHATWG SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html).

### Validation et versions qualifiées

Les tests ajoutés couvrent le cas exact d'un worker ayant beaucoup de KV mais
un frontend 16 384, la baisse dynamique du contexte publié, le transport d'un
HTTP 400 sans octet JSON parasite et les deux seuls événements SSE attendus.
Les 75 tests ciblés passent. La suite moteur complète donne `823 passed,
7 skipped`; le sous-ensemble exact du workflow réseau natif donne `251
passed`. Le wheel `parallax-0.1.2-py3-none-any.whl` se construit, Ruff ciblé et
`git diff --check` sont verts. Le lint global expose encore 85 erreurs
antérieures hors de ce changement et n'est pas présenté comme vert.

Le moteur `a1f9fe02fe3d87e19cbdb8fd93aab55e939f8d6a` est poussé sur
`codex/swarm-protocol-v3`. Le CLI
`95c0b2013f4e46aa8010033b8a2c622a4bfe48d0`, poussé sur `dev`, verrouille ce
moteur ; ses trois tests installateur et son typecheck monorepo passent. Le
runtime `f2e2a5a050976719de27d8036719be2357c39c1a`, poussé sur `main`,
verrouille exactement ces deux révisions ; la vérification du lock et les
transactions POSIX/Windows passent. Le workflow `Native network`
`30908097126` est vert sur Ubuntu, macOS et Windows.

Le VPS importe déjà l'image exacte
`local/parallax-scheduler:swarm-v3-a1f9fe0`, dont le smoke test vérifie par
introspection le nouveau champ, son utilisation par le planificateur et le
framing SSE. Le conteneur actif conserve 40 variables, cinq mounts, le réseau
hôte, les cinq labels de découverte et la restart policy `unless-stopped`; il
sert `/v1/models` sur le port configuré 3025. Le précédent `faa90ad-r2` reste
arrêté comme rollback immédiat. Le nettoyage du cache de build Docker inutilisé
a récupéré 23,56 Gio sans supprimer image, conteneur, volume ni état produit.

La bascule de qualification a commencé sans affaiblir ce contrat strict. Le
Mac mini et le Mac local utilisent l'artefact Apple Silicon construit depuis
`f2e2a5a`, dont le manifeste porte OpenCode `95c0b20` et Parallax `a1f9fe0`.
La RTX utilise temporairement le paquet natif Windows `rc40`, mais charge le
checkout candidat `a1f9fe0` depuis une racine séparée et réversible ; cette
étape qualifie le code et les dépendances natives déjà installées, pas encore
l'artefact final Windows du candidat. Le workflow manuel runtime
`30909255842` a terminé les quatre tarballs CPU/MLX et poursuit encore les deux
builds CUDA Linux/Windows. Aucun nouveau tag public ne doit être créé avant
leur fin verte et l'installation de l'artefact Windows exact.

La RTX a reproduit le cas mémoire attendu pendant cette qualification : son
premier frontend 32k a mesuré une limite réelle de 28 512 tokens et a refusé
le contrat ; le worker s'est fenced, a rechargé le frontend à 16 384 puis a
publié 23 264 tokens de capacité KV et une limite de requête distincte de
16 384. Le snapshot coordinateur du 4 août à 15:13 affiche les trois workers
`ready`, la RTX autonome `[0,36)`, le Mac mini `[0,22)` et le Mac local
`[22,36)`. Il expose `max_supported_context_tokens=16384`,
`admission_ready=true` et une route V3 active complète. Cette observation est
la preuve live que le nouveau champ ferme l'admission sur la limite frontend
effective au lieu de déduire 32k de l'agrégat KV.

### Faux diagnostic d'installation dans l'IDE

Après installation transactionnelle du candidat Apple Silicon, l'IDE local
affichait encore une erreur d'installation. Le moteur n'était ni absent ni
corrompu : les constantes produit de l'IDE qualifient encore volontairement
`v2.7.0-rc40`, tandis que le manifeste de l'artefact manuel est nommé `main`
et porte les nouvelles révisions. Le resolver fail-closed rejetait donc
correctement ce runtime, mais supprimait l'explication et le présentait comme
un binaire absent.

Le labo relance maintenant Electron avec les quatre overrides explicites du
contrat (`version=main`, OpenCode `95c0b20`, Parallax `a1f9fe0`, réseau natif
`0.1.0`). Le backend rapporte alors `installed=true`; le worker et le Request
Agent sont démarrés automatiquement, et `/health` du frontend local répond
200 `ready`. Ce mécanisme ne sera pas nécessaire dans la release packagée :
les constantes seront mises à jour vers le nouveau tag immuable après la CI
CUDA.

Le diagnostic produit conserve le refus strict mais expose désormais la cause
exacte : runtime incomplet, moteur OpenCode absent, ou « mise à jour du moteur
requise » avec les champs du manifeste incompatibles. Le chemin de connexion
réutilise ce diagnostic au lieu d'afficher « moteur non installé ». Un test
reproduit un runtime entièrement présent construit depuis une mauvaise
révision Parallax. Les 56 tests `fabi-swarm`, le build TypeScript de toutes les
extensions Fabi et `git diff --check` passent.

Un smoke OpenAI authentifié sur ce frontend local a ensuite traversé la route
réelle et terminé avec un événement `finish_reason=length` puis exactement un
`[DONE]`. Un second appel contenant 17 009 tokens d'entrée et 16 tokens de
sortie réservés a été refusé avant tout envoi au data plane : HTTP 400,
`context_length_exceeded`, avec les valeurs réelles « 17 025 requis » et
« 16 384 supportés ». Les trois workers sont restés `healthy`, sans route
active résiduelle. Le candidat prouve donc à la fois le chemin nominal et la
fermeture propre du contexte trop grand.

## Conception du placement adaptatif au contexte du 4 août 2026

L'échec propre du tour OpenCode à 21 758 tokens a révélé deux sujets séparés.
Le fork OpenCode possède le défaut upstream documenté dans l'issue `#10634` :
son contrôle de compaction à la fin d'une étape ne compte pas encore les
sorties d'outils qui entreront dans l'appel suivant. Ce correctif frontend
reste à implémenter. Indépendamment, une politique de placement destinée au
code ne peut pas optimiser un unique contexte global de 16k ou 32k.

La politique autonome active dans `a1f9fe0` a été relue avant toute
modification. `CapacityDemandMap` est encore un tableau uniforme par couche,
appelé avec deux répliques, et `AutonomousPlacementPolicy` reçoit un seul
`context_tokens`. Elle calcule correctement les poids exacts plus le KV du
span, préserve la couverture, ferme une route incomplète et applique cooldown
et hystérésis. Elle ne sait toutefois pas encore comparer une route rapide
16k, une route native 40k, une variante longue 128k, la concurrence de
sessions et le coût réseau. Aucun changement moteur n'a été appliqué pendant
cette phase de conception.

Les sources primaires Petals, Exo, Helix, HexGen, vLLM, SGLang, llm-d, Qwen et
OpenCode ont été relues. La conclusion est de conserver le placement autonome
Petals, mais de remplacer son objectif par un déficit de **routes complètes**
par classes de contexte cumulatives. Chaque worker calculera localement une
frontière de Pareto span/contexte/concurrence/débit/hops. Un span plus étroit
ne sera retenu que s'il augmente une capacité réellement demandée, ferme une
route ou renforce une redondance ; étaler les couches sans limite dégraderait
le decode et la robustesse.

Le design complet est consigné dans
`docs/FABI-CONTEXT-AWARE-PLACEMENT-V3.md` et lié depuis la section 8.3 du
protocole V3. Il précise notamment :

- un profil de contexte signé par variante de modèle ; une configuration
  RoPE/YaRN différente a un `ModelSwarmId` distinct ;
- un `CapacityDemandMap` modèle × région × classe de contexte, alimenté par
  de la télémétrie agrégée, bornée et expirable ;
- une capacité imbriquée : une route 128k peut servir 16k, mais le routeur
  applique un coût d'opportunité afin de ne pas consommer la dernière capacité
  longue lorsqu'une route courte équivalente est libre ;
- une admission toujours exacte en pages KV par requête, et non des pipelines
  physiquement réservés par classe ;
- une première passe Petals peu coûteuse puis une évaluation exacte et bornée
  des meilleurs candidats inspirée du graphe/max-flow Helix ;
- un oracle OR-Tools CP-SAT pour les petits scénarios et le simulateur Helix
  pour les traces/réseaux hétérogènes ; ces solveurs ne sont pas dans la boucle
  P2P produit ;
- des baselines max-layers, Petals, Exo, V3 uniforme et V3 multi-classes à
  comparer avant toute réallocation réelle.

Le modèle Qwen3-4B illustre le besoin. Son contrat officiel possède 36 couches,
8 têtes KV de dimension 128 et 40 960 tokens natifs. En BF16, le KV vaut 4 096
octets/token/couche : un span de 4 couches coûte environ 640 Mio à 40 960,
contre 3,438 Gio pour 22 couches. Qwen qualifie YaRN jusqu'à 131 072 mais avertit
que le réglage statique peut pénaliser les textes courts ; la variante native
et la variante longue ne doivent donc pas être mélangées dans le même contrat.

Le simulateur officiel Helix a été inspecté dans un répertoire temporaire. Il
fournit un placement MILP, un routeur max-flow et des traces Azure Code, mais
ces anciennes complétions sont beaucoup plus courtes que les tours agentiques
Fabi déjà observés à 13 601 puis 19 710 tokens après outils. La validation
combinera donc traces publiques, longueurs Fabi anonymisées et longue traîne
synthétique bornée par les contextes réellement qualifiés. Il n'existe aucune
base sérieuse pour déclarer 200k comme « moyenne » ; 128k/256k sont des voies
de service à qualifier, pas des constantes inventées.

L'ordre retenu est : étendre le manifeste avec le contexte explicite, définir
les classes et la télémétrie, calculer la frontière locale, construire
simulateur/oracle, remplacer le déficit uniforme, ajouter le coût de rareté au
route planner, comparer les décisions en shadow **dans V3 uniquement**, puis
qualifier Mac local + Mac mini + RTX avant d'autoriser la réallocation guidée
par la demande.

### Première tranche de contrat et de calcul local

La première tranche est maintenant implémentée dans le checkout moteur
`/Users/noagiannone/Documents/swarm-engine-v3`, sans activation sur les workers
du labo. `ModelManifest` signe désormais `model_max_context_tokens` et une
échelle `context_classes` strictement croissante dont le dernier élément est la
limite exacte. Le builder la dérive de la configuration immuable et refuse un
modèle sans limite finie. Le route planner refuse une requête au-dessus de
cette limite même si un worker la surestime, et les commandes registry exposent
les deux champs pour l'exploitation. Cette évolution change volontairement le
`ModelSwarmId`; les bundles devront être reconstruits et republiés avant une
future qualification live.

Le moteur possède aussi, encore hors du chemin actif, un snapshot de demande
`ContextCapacityDemandMap` versionné par modèle et région. Ses classes sont
expirables, strictes, sans prompts ni identités, et contiennent seulement des
agrégats bornés : couverture souhaitée, poids de demande, arrivées admises,
file, refus, durée p95 et confiance. La validation fail-closed vérifie le
`ModelSwarmId`, l'échelle signée, le nombre de couches et l'expiration. Une
couverture 64k compte cumulativement pour les classes inférieures ; une lease
16k ne compte jamais pour 32k/64k.

`AutonomousPlacementPolicy.memory_frontier()` énumère enfin les compromis
mémoire exacts `(span, contexte, sessions)` sur l'enveloppe stable : poids
signés plus KV arrondi aux blocs, au moins une session réelle, respect du rôle
frontend, puis suppression des points dominés. Le débit mesuré, les liens, les
blobs déjà présents et la confiance seront ajoutés lors de la seconde passe ;
ils ne pourront pas affaiblir cette contrainte mémoire.

Validation actuelle : 68 tests ciblés et 206 tests `test_swarm_protocol_*`
passent, Ruff ciblé et `git diff --check` sont verts. La suite complète donne
`826 passed, 7 skipped` et un seul échec MLX dépendant de l'état mémoire du Mac
local : le modèle du test occupe 2,803 Go pour une limite processus calculée à
2,78 Go, ce qui laisse zéro bloc KV. Ce résultat n'est pas présenté comme un
succès ; il confirme justement que zéro bloc ne doit jamais devenir une offre
de capacité. Aucun commit, bundle registry, déploiement ou basculement live de
cette tranche n'a encore été effectué.

Le premier noyau de simulation est également présent. Le module optionnel
`placement_simulator.py` utilise NetworkX pour calculer le max-flow de routes
complètes par classe. Il sépare les slots concurrents, qui utilisent
`max_sessions`, des routes indépendantes, qui plafonnent chaque worker à une
unité afin de ne pas présenter plusieurs sessions sur le même domaine de panne
comme de la redondance.

L'oracle CP-SAT a dû être isolé sous `tools/context_placement_oracle`. La
version officielle OR-Tools 9.15 requiert protobuf 6.x, incompatible avec le
contrat moteur protobuf `>=7.35.1,<8`; une tentative d'installation dans le
venv moteur a révélé le conflit, puis OR-Tools et ses dépendances ont été
retirés et protobuf 7.35.1 restauré. `pip check` est de nouveau vert. L'oracle
vit donc dans son propre paquet et échange uniquement du JSON : au plus une
option par worker, flux conservé de la couche zéro à la dernière, capacité KV
partagée entre classes pour ne pas compter deux fois un slot long. Ses deux
tests passent dans un venv Python 3.12 séparé. La validation protocole atteint
désormais 209 tests verts. Il reste à générer les populations 8/16 Gio, à
importer les traces et à comparer les heuristiques avant d'intégrer un score
shadow.

Le score shadow initial est désormais explicable et orientable par la demande
agentique. Il additionne le gain de routes indépendantes complètes, le gain de
slots concurrents et la fraction pondérée des déficits de couches par classe.
Un test de piège oppose un worker capable soit d'héberger le modèle complet en
10k, soit la moitié en 20k : lorsque la demande longue est dix fois plus forte,
le score choisit la progression 20k même si la petite route pourrait être
fermée immédiatement. Ce n'est pas encore la politique live et les poids ne
sont pas codés comme une constante produit ; ils viendront de la télémétrie
agrégée et d'un plancher long-contexte explicite.

Les nouveaux contrats ont été séparés dans `context_placement.py` afin de ne
pas transformer la politique active en fichier monolithique. La frontière
mémoire exige maintenant une limite de contexte backend qualifiée en plus de
la limite native du modèle. L'extraction du contexte privilégie
`max_position_embeddings`, champ architectural utilisé par Transformers, et
n'utilise `model_max_length` qu'en fallback ; le metadata tokenizer ne peut
donc plus réduire silencieusement un contrat architectural réel.

Le projet officiel `llm-d-inference-sim` a été cloné en lecture seule au commit
`0d46c7142a2e6d30e48c4ec732917af515442479`. Il fournit déjà la file, la
saturation, TTFT/ITL par token, le cache KV, les événements ZMQ avec replay et
l'injection de pannes. La validation Fabi réutilisera ce data plane simulé et
le combinera au graphe max-flow de spans P2P, au lieu de réécrire une file et
un modèle de latence maison.

Validation après séparation : 222 tests protocole/config passent ; la suite
large avec les deux variantes `test_decode_pipeline_multiple_steps` exclues
donne `837 passed, 6 skipped, 2 deselected`. L'exclusion est déclarée : CUDA
n'est pas disponible sur ce Mac et la variante MLX reste sensible à la
pression mémoire live. Les deux tests CP-SAT passent dans le venv isolé, Ruff,
`pip check` et `git diff --check` passent. Le wheel
`parallax-0.1.2-py3-none-any.whl` se construit et contient les nouveaux modules
ainsi que l'extra optionnel NetworkX, sans OR-Tools dans le runtime.
