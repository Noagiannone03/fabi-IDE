# Repenser Fabi : grands modèles sur un collectif de petites machines

Étude du 28 septembre 2026. Recherche documentaire, analyse du contexte local et calculs analytiques ; aucun benchmark matériel nouveau. Les propositions ci-dessous ne sont pas une architecture validée ni une revendication de nouveauté scientifique.

**Conclusion de travail : le problème à optimiser est le nombre de dépendances réseau lentes sur le chemin d'une réponse, puis la capacité utile du collectif. Additionner la RAM ne suffit pas.** Une fédération de groupes de calcul proches, avec placement MoE et spéculation coordonnés, mérite d'être confrontée à un pipeline régional classique. Un MoE dispersé arbitrairement sur Internet est un candidat expérimental, pas le favori par défaut.

La demande de repartir à neuf prime sur les anciennes décisions. Aucun choix historique de backend, protocole, découpage, scheduler ou ordre des travaux ne constitue une contrainte de cette étude. L'objectif reste bien de servir le grand modèle lui-même. Un petit modèle peut proposer des brouillons, mais ne remplace pas silencieusement la cible.

## 1. Contexte retrouvé et limites de l'audit

### Sources locales

Les dossiers retrouvés comprennent `fabi-ide`, `fabi-cli`, `fabi`, `fabi-website`, `fabi-ide-desktop-stable`, `swarm-engine-v3`, `swarm-engine-dynamic`, `swarm-engine`, `swarm-engine-upstream-rebuild`, ainsi que les clones `parallax-upstream`, `petals-upstream` et `exo-upstream`.

L'index Codex a retourné 211 conversations potentiellement liées à Fabi, par chemin ou titre, représentant environ 512 Mo au moment de l'inventaire. Hors conversations du jour, un parcours programmatique a traité 182 423 lignes JSONL, repéré 740 messages utilisateur et 6 802 messages assistant dans les enregistrements de type message, puis extrait les passages techniques pertinents. Ce décompte ne comprend pas tous les formats possibles d'événements et ne signifie pas une lecture humaine exhaustive des 512 Mo. Les passages sur les expériences, MoE, latence et spéculation ont été examinés ; les commandes et sorties historiques ne sont pas toutes relues intégralement.

L'archive de transfert dans `fabi-cli/codex-session` a aussi été parcourue : 111 857 lignes, environ 297 Mo décompressés, du 20 juillet au 10 août. Elle recouvre une partie de l'historique local et ne constitue pas une conversation indépendante. Des mémoires Claude et l'inventaire Cursor du projet sont accessibles. Les conversations ChatGPT qui ne seraient ni exportées ici ni accessibles via un outil connecté ne peuvent pas être considérées comme lues.

Un balayage documentaire a couvert 322 fichiers Markdown, environ 3,66 Mo, dans les principaux dossiers Fabi et anciennes variantes, hors dépendances et sous-arbres `packages`. Les documents centraux et les passages de mesures ont fait l'objet d'une lecture ciblée approfondie ; les traductions OpenCode et tous les détails des anciens handoffs ne sont pas prétendus lus ligne par ligne.

### Ce que les éléments locaux établissent

| Élément | Observation locale | Portée |
|---|---|---|
| IDE | Theia/Electron, extension swarm, intégration OpenCode | Interface et orchestration, distinctes du calcul du modèle |
| CLI | Fork OpenCode ; historique transféré dans `codex-session` | Client agentique et distribution |
| Moteur récent | `swarm-engine-v3`, HEAD `105653b` | Placement principalement par plages de couches ; contrat spéculatif encore décrit comme dormant dans le code consulté |
| Distribution | Méta-dépôt `fabi`, HEAD `caa0447` | Bundles de runtime et versions épinglées |
| Hébergement documenté | VPS OVH, domaine `server.undefinedstudio.fr`, registre/schedulers ; Mac mini et PC RTX comme workers ; RunPod pour certaines qualifications | Topologie historique, pas état live vérifié aujourd'hui |
| Mesures historiques | Environ 7,6–9,9 tokens/s selon les essais, et TTFT froid parfois 40–52 s sur des prompts agentiques de 13–15k tokens | Résultats de configurations anciennes, notamment petits modèles ; aucune extrapolation à Kimi K3 |
| Spéculation | Contrats, rollback et contrôleur préparés ; absence de preuve consultée d'accélération produit sur gros MoE WAN | Ne pas confondre mécanisme écrit et bénéfice mesuré |

Références locales : [handoff et mesures](../HANDOFF-SWARM-2026-07-17.md), [spéculation](../FABI-ADAPTIVE-SPECULATIVE-DECODING.md), [placement](../FABI-CONTEXT-AWARE-PLACEMENT-V3.md), [confidentialité](../P2P-PRIVACY-THREAT-MODEL.md). Les fichiers `src/swarm_protocol/placement.py`, `speculative.py` et `speculative_control.py` du moteur corroborent le découpage par plages et le statut des fondations spéculatives.

Les historiques récents font apparaître des trous de couverture, des chevauchements mal interprétés et une génération HTTP 200 dont le texte était incorrect. Ce sont des problèmes de réalisation, pas une preuve de l'impossibilité physique du projet. Inversement, réussir un test unitaire ou charger les poids ne prouve pas le service interactif.

Les modifications locales préexistantes de l'IDE ont été préservées. Aucun worker, serveur, pod payant, modèle installé ou service distant n'a été modifié pendant cette étude.

## 2. Reformuler les exigences pour pouvoir chercher

L'objectif comporte au moins cinq problèmes distincts :

1. **Capacité mémoire** : conserver les poids accessibles et assez de mémoire de travail.
2. **Latence d'une requête** : produire une réponse utile rapidement.
3. **Débit collectif** : servir plusieurs utilisateurs sans saturer les machines.
4. **Disponibilité** : continuer malgré les départs et les connexions instables.
5. **Réciprocité** : donner un accès en échange d'un service réellement utile.

Une solution peut améliorer l'un et dégrader les autres. La réplication accélère et fiabilise, mais consomme plus de RAM. La spéculation accélère parfois une réponse, mais peut diminuer le nombre de réponses simultanées. Le batching augmente le débit total, mais introduit de l'attente.

« Sans latence » doit devenir un objectif d'expérience : temps jusqu'au premier contenu, temps jusqu'à la première modification utile, débit validé et pauses p95/p99. Une dépendance causale distante ne peut pas avoir un temps nul. En revanche, on peut la supprimer par placement, la payer moins souvent, ou préparer du travail avant qu'elle ne bloque.

Le préfill traite le prompt ; le cache KV évite de recalculer tout le passé. Cela ne supprime pas le parcours du modèle pour chaque nouveau token. La spéculation propose plusieurs tokens puis les vérifie ensemble. Elle réduit le nombre de passages séquentiels par token accepté, sans supprimer le calcul de validation.

Les MoE sont fréquents parmi les grands modèles, mais tous les modèles ne sont pas MoE. Un expert est généralement un sous-réseau d'une couche, pas un agent autonome « spécialiste Python ». Le routeur sélectionne des experts à partir de l'état courant, couche après couche. Ce qui circule principalement entre stages est une activation, pas simplement un token textuel.

## 3. Taille des modèles : ce que la RAM collective permet réellement

La fiche officielle de **Kimi K3** indique 2,8 billions de paramètres au sens français, soit 2 800 milliards, 104 milliards activés, 93 couches, 896 experts et 16 experts sélectionnés par token, avec deux experts partagés. Elle décrit des poids MXFP4 et une architecture hybride KDA/MLA. Ces particularités rendent le support backend aussi important que la taille mémoire. [Fiche officielle Kimi K3](https://huggingface.co/moonshotai/Kimi-K3).

Pour GLM, la fiche **GLM-5.2** pointe désormais vers **GLM-5.3-BF16** : il serait incorrect de présenter 5.2 comme la dernière version. La configuration 5.2 est un exemple directement inspectable : 78 couches, dont trois denses, 256 experts routés et huit activés. Le choix final doit épingler une révision, un format et des kernels, au lieu de viser un nom mouvant « dernier GLM ». [GLM-5.3](https://huggingface.co/zai-org/GLM-5.3-BF16), [configuration GLM-5.2](https://huggingface.co/zai-org/GLM-5.2/raw/main/config.json).

**Calcul idéal, poids seuls à quatre bits, Go décimaux :**

`poids = paramètres × 4 / 8`

| Taille illustrative | Poids seuls | Pairs offrant 4 Go chacun | 8 Go chacun | 16 Go chacun | 24 Go chacun |
|---|---:|---:|---:|---:|---:|
| 671 milliards | 335,5 Go | 84 | 42 | 21 | 14 |
| 1 000 milliards | 500 Go | 125 | 63 | 32 | 21 |
| 2 800 milliards | 1 400 Go | 350 | 175 | 88 | 59 |

Ce sont des minima de stockage agrégé sous cette représentation idéale, **pas des configurations de service**. Il faut ajouter échelles de quantification, tenseurs de précision différente, alignement, buffers, activations, KV ou états récurrents, système, IDE et réplication. La fragmentation et les formats peuvent augmenter le nombre réel de pairs. Un PC de 16 Go n'offre pas 16 Go au modèle. Sur Windows, RAM et VRAM ne sont pas un unique pool à bande passante uniforme.

Conséquence structurelle : à cette échelle, même une couche complète peut dépasser le budget d'un petit PC. Le ratio moyen 1 400/93 vaut environ 15 Go par couche pour l'exemple Kimi ; c'est seulement un indicateur de granularité, pas la taille exacte de chaque couche. Un découpage uniquement « couches entières » ne suffit donc pas toujours : il faut experts, sous-tenseurs, stockage hiérarchique, ou combinaison de ces mécanismes.

Les paramètres activés réduisent le travail d'un token ; ils ne rendent pas les autres poids inutiles pour les tokens suivants. Un système peut les conserver sur SSD plutôt qu'en RAM, mais paie alors les lectures et les défauts de cache. Il faut mesurer l'ensemble de travail sur une vraie session, pas seulement un token.

## 4. Les bornes qui orientent la recherche

### 4.1 Pipeline : capacité en parallèle, dépendances en série

Pour une séquence sans spéculation, approximation d'un passage :

`T_token ≈ somme(calcul des stages) + somme(transferts exposés) + retour du token + attente`

Exemple hypothétique : 39 frontières à 20 ms **aller simple** imposent déjà 780 ms de propagation sur le chemin, soit au mieux environ 1,28 token/s avant calcul et retour. Ce n'est pas un benchmark ni une règle disant qu'il faut un RTT complet par frontière. Avec 1 ms, le même terme tombe à 39 ms. Le nombre de pairs et leur distance doivent être considérés ensemble.

Le pipeline peut faire avancer plusieurs requêtes simultanément : il améliore alors l'utilisation et le débit collectif. Il ne transforme pas les dépendances d'une seule séquence en calcul indépendant.

### 4.2 Experts distants : le maximum de plusieurs réponses, à chaque couche

Un appel MoE distribué ressemble à : attention → routage → experts en parallèle → agrégation → couche suivante. Avec 75 couches MoE et un aller-retour exposé de 40 ms à chacune, on paie environ 3 secondes de réseau par passage, même si le calcul des experts était instantané.

Illustration de cache, avec hypothèse simplificatrice d'indépendance : si `h` est la probabilité qu'un expert demandé soit local et `k` le nombre d'experts sélectionnés,

`P(au moins un expert distant dans une couche) = 1 - h^k`

| Géométrie illustrative | Hit local par expert | Couches attendant au moins un expert distant en moyenne | Surcoût à 40 ms/couche, sans recouvrement |
|---|---:|---:|---:|
| 75 couches, top-8 | 95 % | 25,24 | 1,010 s |
| 75 couches, top-8 | 99 % | 5,79 | 0,232 s |
| 75 couches, top-8 | 99,9 % | 0,60 | 0,024 s |
| 92 couches, top-16 | 99 % | 13,67 | 0,547 s |
| 92 couches, top-16 | 99,9 % | 1,46 | 0,058 s |

Les routages réels sont corrélés : cette table est une analyse de sensibilité, pas une prédiction. Elle montre pourquoi le bon indicateur est le **nombre de couches réellement bloquées et leur temps d'attente**, pas seulement le taux de cache global. Les pannes et la latence de queue des experts populaires aggravent les longues pauses.

### 4.3 Déplacer les poids ou envoyer le calcul ?

Exemple analytique d'un expert à trois matrices, dimensions 6 144 et 2 048, à quatre bits : environ 18,9 Mo de poids. À 100 Mbit/s, son transfert idéal prend environ 1,51 s, avant latence et protocoles. Une activation de quelques dizaines de ko est beaucoup plus légère.

Il est donc souvent préférable d'envoyer une activation au propriétaire de l'expert que de rapatrier les poids pour un seul usage. En revanche, copier les poids devient intéressant si beaucoup de futurs appels réutilisent la copie. Il faut compter la bande passante montante du propriétaire, la RAM du destinataire et la concurrence avec les générations actives.

### 4.4 La spéculation a une limite d'acceptation et une limite mémoire

Dans un modèle simplifié à probabilité d'acceptation constante `α`, avec `γ` candidats et un token correctif/bonus :

`E[tokens validés par tour] = 1 + α + … + α^γ`

| α | γ = 4 | γ = 8 | γ = 16 |
|---|---:|---:|---:|
| 0,50 | 1,94 | 2,00 | 2,00 |
| 0,70 | 2,77 | 3,20 | 3,33 |
| 0,85 | 3,71 | 5,12 | 6,25 |
| 0,95 | 4,52 | 7,40 | 11,64 |

Un bloc proposé de 16 tokens ne donne donc pas mécaniquement un gain ×16. Le coût du draft et de la validation, le rejet, les branches et les transferts s'ajoutent. Le bon ratio est le temps total par token effectivement validé.

Autre effet : sous tirage uniforme indépendant entre tokens, avec `E` experts et `k` activés par token, l'union attendue d'experts sur `B` tokens est :

`U(B) = E × [1 - (1 - k/E)^B]`

Pour `E=896, k=16`, elle passe de 16 experts à un token à environ 120 à huit tokens et 224 à seize tokens, **par couche**. Les poids ne sont pas nécessairement tous résidents simultanément, mais leur mouvement et leur calcul doivent être planifiés. Les corrélations peuvent réduire cette union ; seul un relevé de routage réel la déterminera.

### 4.5 Servir tout le monde reste un problème de capacité

Exemple explicitement fictif : 10 000 pairs, 80 pairs par groupe complet, chaque groupe produisant 20 tokens/s agrégés. Le réseau produit 2 500 tokens/s ; à 10 tokens/s par utilisateur actif, il sert environ 250 utilisateurs simultanément, avant préfill, réplication et marge. Doubler les utilisateurs et les pairs ne crée pas automatiquement un droit illimité pour chacun.

Le nombre décisif est la fraction d'utilisateurs qui génèrent en même temps et la contribution accumulée pendant les périodes d'inactivité. Une garantie de service exige de la réserve et une admission avant saturation. Le coût par tâche de code réussie est plus pertinent que le seul débit brut.

## 5. Travaux existants : apport et limite pour Fabi

| Travail | Ce qu'il apporte | Ce qu'il ne prouve pas |
|---|---|---|
| [Petals, NeurIPS 2023](https://arxiv.org/abs/2312.08361), [code](https://github.com/bigscience-workshop/petals) | Inférence collaborative, placement hétérogène et reprise ; expériences 70B/176B sur Internet | Service mondial interactif d'un MoE de plusieurs billions sur des machines 8–32 Go |
| [Parallax](https://github.com/GradientHQ/parallax), [article](https://arxiv.org/abs/2509.26182) | Kernels existants, pipeline, scheduling et batching | Le support d'un modèle dans une liste ne garantit ni son découpage fin ni sa performance WAN |
| [Gradient DSD](https://arxiv.org/html/2511.11733v1) | Amortir la communication par vérification de plusieurs tokens | Les expériences décrites utilisent Llama/Qwen 8B sur 4–8 A800 et InfiniBand 100 Gbit/s. La vérification relâchée est distincte de l'équivalence distributionnelle exacte |
| [exo](https://github.com/exo-explore/exo) | Formation de clusters locaux, exploitation des interconnexions rapides | Thunderbolt/RDMA local ne se transporte pas sur Internet domestique |
| [prima.cpp](https://github.com/OpenCPIL/prima.cpp) | Cluster domestique hétérogène, contraintes mémoire et stockage | Les résultats 30–70B ne qualifient pas le WAN à l'échelle trillion |
| [llama.cpp RPC](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/rpc/README.md) | Backend distribué réutilisable pour expériences | Son RPC n'est pas à lui seul un protocole de réseau public hostile ; la documentation avertit de ses limites de sécurité |
| [Mesh/Skippy](https://github.com/Mesh-LLM/mesh-llm) | Runtime distribué déjà présent dans l'écosystème Fabi | Une primitive de vérification disponible n'est pas une campagne E2E réussie |
| [KTransformers](https://github.com/kvcache-ai/ktransformers) | Exploiter CPU/GPU et la mémoire hétérogène pour les MoE | La bande passante mémoire locale ne s'additionne pas comme une interconnexion Internet |
| [Hivemind](https://github.com/learning-at-home/hivemind), [Learning@home](https://arxiv.org/abs/2002.04013) | Antécédents sérieux des experts décentralisés et de l'entraînement collaboratif | Un résultat d'entraînement ne règle pas la dépendance autoregressive de l'inférence |
| [MoE-Infinity](https://arxiv.org/abs/2401.14361) | Cache d'experts guidé par les activations | Pas une validation automatique sur WAN avec churn |
| [OD-MoE](https://arxiv.org/html/2512.03927v1) | Prédiction et chargement anticipé d'experts | Son banc Mixtral comporte dix nœuds RTX 3090, un shadow model sur deux GPU, 128–192 Go de DRAM/nœud et Ethernet 1 Gbit/s. « <1 Go GPU/worker » n'est pas « PC de 8 Go » ; le lien de code de cette version est un placeholder anonyme |
| [SP-MoE](https://arxiv.org/abs/2510.10302), [MoE-SpeQ](https://arxiv.org/abs/2511.14102) | Coupler spéculation, offload et préparation des experts | Le bénéfice PCIe doit être réévalué en présence de RTT WAN |
| [MoE-SpAc](https://arxiv.org/html/2603.09983v1) | Arbitrer cache, draft et calcul hétérogène selon l'utilité | Banc décrit : RTX 4090 unique, PCIe 4.0, cible Qwen3-30B-A3B, draft Qwen3-4B-FP8 ; pas un swarm Internet |
| [ExFlow](https://arxiv.org/abs/2401.08383) | Affinité entre experts de couches successives | L'affinité statistique n'enlève pas les agrégations obligatoires |
| [GRACE-MoE](https://arxiv.org/abs/2509.25041) | Groupement et réplication avec sélection locale de copies, annoncés sans perte | Preuve multi-GPU, pas flotte de laptops ; vérifier disponibilité du code, annoncée après acceptation |
| [CAP](https://arxiv.org/abs/2607.05116) | Placement par coactivation et arbitrage communication/calcul | Sa composante pruning modifie le calcul : séparer placement exact et suppression approximative |
| [Janus](https://arxiv.org/abs/2512.13525) | Séparer les ressources attention et experts | Sur WAN, cette séparation peut ajouter un aller-retour par couche |
| [FlowSpec](https://arxiv.org/abs/2507.02620), [DFlash](https://arxiv.org/abs/2602.06036) | Pipelines spéculatifs et brouillons parallèles | Compatibilité draft/cible, mémoire et rendement collectif restent à qualifier |
| [EfficientEdit](https://arxiv.org/abs/2506.02780) | Réutiliser le code existant comme brouillon et accélérer les éditions | Le code nouveau, le raisonnement et les appels d'outils n'ont pas tous la même prévisibilité |

Ces résultats sont des antécédents à réutiliser et des hypothèses à reproduire. Aucun facteur d'accélération publié n'est multiplié avec un autre pour inventer une promesse Fabi.

## 6. Douze options, sans architecture imposée

| Option | Mécanisme et intérêt | Risque principal | Expérience décisive |
|---|---|---|---|
| A. Pipeline régional équilibré | Couches regroupées pour réduire les frontières, plusieurs requêtes en vol | Une couche peut dépasser la RAM ; lenteur du stage limitant | Baseline avec frontières et budgets mémoire réels, pas seulement nombre de pairs |
| B. Experts dispersés mondialement | Chaque petit PC héberge des experts ; mémoire très distribuable | Barrière réseau à chaque couche, attente du plus lent | RPC d'un vrai expert sous RTT 20/50/100 ms, puis accumulation sur toutes les couches |
| C. Groupes proches, modèle réparti à l'intérieur | Forte communication dans le groupe ; échange mondial au niveau requêtes/poids | Il faut réunir assez de capacité proche pour couvrir le modèle | Nombre de groupes complets réalisables à partir d'une vraie matrice RTT/mémoire |
| D. Attention et KV stables, experts proches | Séparer l'état de session des experts sans état ; répliquer les chauds | Backbone/KV coûteux et appels distants répétés | Profil mémoire hors experts, p95 de l'attente à chaque couche |
| E. Poids froids sur SSD/RAM, calcul près du demandeur | Élargit le stockage utilisable sans imposer une énorme VRAM | Fautes de cache et bande passante de chargement | Octets lus/transférés par token validé sur longue session |
| F. Spéculation exacte WAN | Payer une traversée pour plusieurs tokens acceptés | Brouillons coûteux, rejets, union d'experts et mémoire | Débit validé ET utilisateurs servis sous charge, avec parité |
| G. Placement par coactivation et réplication | Garder ensemble les experts souvent utilisés ensemble, copier les goulets | Déplacement des poids, popularité variable, duplication RAM | Replay de traces contre placement naïf, LRU/LFU et méthode publiée |
| H. Préparation pendant les outils | Utiliser compilation, tests et attente utilisateur pour chauffer les prochaines ressources | Résultat d'outil inconnu, travail inutile, vol de capacité | Réduction du délai après retour d'outil, transferts et énergie inclus |
| I. Préfill séparé du decode | Ressources et batching adaptés aux deux phases, réemploi des préfixes | Migration KV lourde ; cache de préfixe seulement si contenu compatible | Gain net après sérialisation, transfert et validation des états |
| J. Quantification/pruning/compression d'activations | Moins de poids ou de trafic | Dégradation du modèle, kernels indisponibles | Qualité code et débit au format exact, pas juste perplexité |
| K. Modèle entraîné pour peu d'échanges | Groupes de couches/experts autonomes plus longtemps, messages moins fréquents | Réentraînement coûteux, aucune garantie de niveau frontière | Prototype réduit validant le principe ; cible géante reste un projet séparé |
| L. Service coopératif avec soutien externe | Réserve sponsorisée ou publicité pour absorber les pointes | Coût toujours réel, dépendance et plafonds | Comptabilité de ressources et coût par tâche réussie |

Les options C, F et G sont compatibles, mais leurs gains ne sont pas indépendants. D peut battre A dans un réseau proche et perdre massivement sur WAN. E peut servir de plan de capacité, sans être une solution de latence. K est la piste la plus radicale si l'objectif impose une rupture du graphe causal ; elle ne permet pas d'exécuter le Kimi existant sans modification.

Des agents plus petits travaillant en parallèle peuvent aider des tâches indépendantes, mais leur ensemble ne devient pas le modèle frontière demandé. De même, BitTorrent est pertinent pour distribuer des poids immuables ; chaque morceau d'un fichier est indépendant, contrairement aux couches d'un forward pass.

## 7. Quatre hypothèses de recherche à construire pour Fabi

### H1 — Placer selon les attentes évitées, à granularité mixte

**Proposition.** Le planificateur choisit entre blocs de couches, groupes d'experts et répliques d'experts, en minimisant les attentes exposées d'une session. Il ne cherche ni à utiliser tous les pairs dans une route ni seulement à couvrir tous les octets.

Construire un graphe de calcul avec dépendances réelles, puis un hypergraphe des experts coactivés. Ajouter mesures de calcul, RTT, uplink, file, fiabilité, mémoire de travail et coût de migration. Comparer plusieurs placements sur ce même graphe ; certaines petites machines hébergent des experts d'un stage sans ajouter un nouveau stage séquentiel.

La fonction à tester ressemble à :

`p95(temps par token validé) + coût des déplacements + pénalité de capacité perdue`

avec contraintes de mémoire, disponibilité et qualité. Une réplication est rentable quand le temps d'attente futur évité dépasse son installation et la valeur de la mémoire immobilisée. Les paramètres du coût sont mesurés, pas des poids arbitraires présentés comme optimaux.

**Antécédents.** ExFlow, GRACE-MoE et CAP explorent déjà affinité, placement et réplication. L'hypothèse Fabi porte sur leur combinaison avec petites mémoires, groupes WAN et p95 de sessions agentiques. Ce n'est pas une invention prouvée comme nouvelle.

**Test qui peut la tuer.** Les ensembles d'experts actifs sont trop diffus, ou la migration consomme davantage que les attentes évitées. Un oracle utilisant les futurs accès doit être comparé aux méthodes réalistes : si même l'oracle ne gagne pas, abandonner ce cache/placement dans ce régime.

### H2 — Choisir ensemble le brouillon et les experts qu'il mobilisera

**Proposition.** Au lieu de maximiser seulement le taux d'acceptation ou la longueur du draft, sélectionner une fenêtre ou un arbre de brouillons sous budget d'experts, de RAM et de trafic. Le draft/MTP fournit, quand l'architecture le permet, des indices de futurs accès ; un prédicteur séparé est une alternative à comparer.

Critère expérimental :

`tokens validés attendus / (draft + vérification + réseau exposé + rollback)`

La décision pénalise les propositions nécessitant de nombreux experts absents ou un pair surchargé. Pendant le calcul du draft, préparer les experts chez leurs propriétaires ou près du groupe de vérification. Le résultat publié reste décidé par la cible exacte.

**Point technique crucial.** Anticiper l'identité d'un expert permet de charger ses poids, pas de calculer exactement sa sortie avant de connaître son activation d'entrée. Un résultat calculé sur une activation approchée ne devient pas exact par un simple « delta » en raison des non-linéarités. La correction doit refaire le calcul nécessaire ou disposer d'une preuve spécifique.

**Exactitude.** En greedy, comparer au choix de la cible à chaque position. En sampling, utiliser une construction d'acceptation/rejet et une distribution corrective valides ; un brouillon biaisé vers des experts locaux exige de connaître la distribution de proposition correspondante. L'égalité de seeds n'est pas une preuve d'égalité distributionnelle. La référence est la cible au format quantifié retenu, pas automatiquement son original BF16. [Spéculation exacte, Leviathan et al.](https://arxiv.org/abs/2211.17192).

**Antécédents.** SP-MoE, MoE-SpeQ et MoE-SpAc montrent que coupler les décisions est déjà une direction de recherche. L'extension proposée vise le coût des barrières WAN et les petits budgets, avec une baseline de qualité identique.

**Test qui peut la tuer.** Le prédicteur occupe trop de mémoire ; une vérification plus large réveille trop d'experts ; le débit d'une session progresse mais le service collectif régresse. Dans ces cas, conserver une fenêtre plus petite ou aucune spéculation.

### H3 — Préparer des ressources pendant les temps morts du travail de code

**Proposition.** Un agent alterne génération, outils, validation et attente humaine. Utiliser ces intervalles pour placer des poids, garder les bons préfixes, préparer une réplique et recueillir des statistiques de routage. Cela donne parfois des secondes d'avance, bien plus qu'une prédiction de la couche suivante.

Exemple : pendant un test lancé par l'utilisateur, conserver les préfixes compatibles et copier vers son groupe des experts dont la réutilisation est probable. Au retour du test, calculer normalement avec son résultat réel. Le préfill de la continuation inconnue n'est pas prétendu déjà exécuté.

Le contrôleur doit comparer cette préparation à d'autres usages des mêmes ressources : servir un autre utilisateur, conserver du KV, ou économiser de l'énergie. Arrêter la préparation dès qu'elle perturbe une génération interactive. Ne pas déduire une identité « expert Python » sans traces.

**Antécédents.** MoE-Infinity pour la localité des activations ; EfficientEdit pour le réemploi du code. L'idée à éprouver est l'horizon spécifique des pauses d'outils et la réplication anticipée du prochain tour.

**Test qui peut la tuer.** Changement fréquent de projet ou de tâche, retours d'outils peu prévisibles, pas assez de pauses, ou saturation du réseau. Comparer à la simple conservation LRU et à l'absence de préparation.

### H4 — Distinguer contribution utile et présence dans la génération courante

**Proposition.** Un PC lent de 8 Go peut héberger une copie rare, calculer des experts dans son groupe, alimenter des téléchargements, préparer une réplique ou proposer des brouillons compatibles. Il n'a pas besoin de devenir une étape obligatoire de la réponse qu'il reçoit.

Les ressources rapides rendent le service interactif ; les ressources plus lentes peuvent augmenter la disponibilité et diminuer les coûts de préparation. Le choix de rôle dépend de mesures, de la demande et du budget laissé au système. Huit Go de RAM ne garantissent pas qu'un rôle d'inférence rapide est toujours disponible.

Le crédit doit représenter le service marginal réellement rendu : temps critique évité, calcul correct, disponibilité utile ou transfert demandé. Une machine qui conserve une copie inutile ne produit pas la même valeur qu'une machine qui débloque une région. Une mesure marginale parfaite serait trop coûteuse ; approximation auditée, plafond et comparaison à des politiques simples sont nécessaires.

**Antécédents.** Séparation stockage/calcul, réplication et réciprocité P2P sont connus. L'hypothèse porte sur un ordonnancement et des incitations qui favorisent la capacité manquante, plutôt que d'allonger les routes pour montrer « tout le monde contribue ».

**Test qui peut la tuer.** La valeur des rôles lents est trop faible pour financer l'usage demandé ; les copies sont coûteuses à vérifier ; les crédits encouragent le trafic artificiel ou la collusion. Une limite de consommation explicite reste alors nécessaire.

## 8. Architectures à mettre réellement en concurrence

### Candidate 1 : groupes proches et pipelines classiques

Une requête rejoint un groupe capable de couvrir le modèle, composé de nombreuses petites machines si nécessaire. Le modèle y reste réparti ; aucun gros serveur individuel n'est requis par principe. Un unique échange longue distance avec le groupe peut coûter moins que des dizaines de sauts WAN internes.

À l'intérieur, sélectionner pipeline, experts ou tensor parallel selon les mesures. « Même région » n'est pas synonyme de faible RTT : deux connexions fibre proches peuvent avoir un mauvais chemin opérateur. Former les groupes à partir des liens mesurés et de leurs capacités, pas du pays déclaré.

Principal risque : un réseau de volontaires peu dense peut avoir assez de RAM mondiale mais aucun groupe proche complet. Il faut mesurer cette densité, surtout au démarrage. Multiplier trop tôt les modèles disperse encore la capacité.

### Candidate 2 : attention répartie stable et pools d'experts proches

Garder KV/états et couches d'attention sur des hôtes stables ; distribuer les experts sans état dans le groupe, répliquer les chauds et préparer les froids. Un expert peut être remplacé plus simplement qu'un stage portant tout l'état d'une session, mais sa panne reste bloquante s'il n'existe aucune copie disponible.

Cette candidate ne suppose pas que toute l'attention d'un modèle trillion tient sur un laptop. Mesurer le backbone, éventuellement le découper lui aussi. Une copie du backbone sur chaque PC pourrait annuler le gain de mémoire.

### Candidate 3 : MoE WAN direct avec forte anticipation

Accepter des experts éloignés, utiliser H1–H3 pour réduire les attentes, spéculer par blocs et conserver des répliques proches. C'est la candidate qui correspond le plus directement au swarm mondial imaginé, mais aussi celle qui doit démontrer le plus de gains : barrières par couche, churn et union d'experts.

Ne pas l'écarter uniquement par intuition ; lui opposer un oracle puis une implémentation mesurée. Si sa borne idéale est déjà incompatible avec l'objectif, arrêter cette branche sans construire tout un nouveau moteur.

### Candidate 4 : modèle conçu pour le réseau

Pour diminuer radicalement les échanges internes, apprendre une architecture où un groupe exécute davantage de travail avant une interaction distante : macro-blocs, experts persistants, routage tenant compte de la topologie, ou génération par blocs. Les [modèles de diffusion par blocs](https://arxiv.org/abs/2503.09573) explorent une autre organisation de la génération, mais demandent plusieurs calculs et ne garantissent pas de gain WAN.

Cette branche implique adaptation, distillation ou entraînement ; elle n'est pas une façon gratuite de conserver exactement le dernier GLM/Kimi. Son budget et ses critères de qualité doivent être séparés du moteur pour poids existants.

## 9. Gratuité, concurrence et Freebuff

Freebuff annonce un agent gratuit financé par publicité. Sa page actuelle présente une allocation quotidienne, des limites de session et des restrictions d'accès ; elle ne décrit donc pas une ressource illimitée et gratuite à produire. Le financement publicitaire est une piste économique, pas une méthode de calcul distribué. Aucune marge réelle ni coût d'inférence interne n'a été vérifié. [Freebuff](https://freebuff.ai/), [offre annonceurs](https://freebuff.ai/advertisers).

Pour Fabi, comparer trois politiques :

- **Coopérative stricte** : crédits pour contribution utile, files et quotas proportionnés ; aucun achat obligatoire, mais service non illimité.
- **Coopérative soutenue** : dons, organisations partenaires, groupes communautaires disponibles longtemps, petite réserve financée collectivement.
- **Hybride financé** : publicité ou offre payante volontaire finance les pointes et le démarrage. Le noyau P2P reste mesuré séparément pour ne pas masquer une dépendance complète au cloud.

L'électricité, les transferts, les relays et l'usure ne disparaissent pas. La mutualisation est particulièrement intéressante si les machines contribuent longtemps et les utilisateurs génèrent par intermittence. Un quota identique en échange de n'importe quelle quantité de RAM peut devenir intenable.

Dans un MoE distribué, compter simplement des « tokens calculés » serait trompeur : le coût dépend des couches, experts, préfill, contexte, format et matériel. Des reçus signés prouvent l'origine d'une déclaration, pas l'exactitude du calcul. Contrôles aléatoires, recomputation partielle et réputation peuvent réduire la fraude, avec un coût et sans garantie cryptographique générale.

## 10. Confidentialité et disponibilité comme contraintes de performance

Le chiffrement réseau protège contre l'interception et certains relays ; il n'empêche pas un worker de lire son entrée. Des activations ne sont pas une anonymisation. Le [modèle de menace local](../P2P-PRIVACY-THREAT-MODEL.md) documente même la transmission de tokens dans l'ancien protocole. Pour du code privé, des groupes de confiance et des politiques explicites sont une contrainte produit réelle.

Le hash vérifie des poids immuables ; il ne vérifie pas qu'un pair a honnêtement exécuté un expert. Répliquer tous les calculs multiplierait le coût. FHE, MPC et preuves de calcul méritent une recherche séparée, mais aucun résultat consulté ne permet ici de les annoncer compatibles avec l'objectif interactif sur laptops.

Disponibilité illustrative : si 80 pairs indépendants sont chacun disponibles avec probabilité 0,99 à un instant, la route exigeant les 80 n'est disponible qu'avec probabilité `0,99^80 ≈ 44,8 %`. Ce n'est pas une estimation du swarm ; les pannes sont aussi corrélées. Des copies indépendantes et des routes alternatives consomment donc une part importante de la RAM ajoutée.

Le registre de découverte n'a pas besoin de voir les activations. Un control plane fédéré est compatible avec des chemins de calcul P2P. La décentralisation doit être précisée : propriété des machines, absence de serveur de calcul obligatoire, gouvernance, découverte et économie sont des dimensions différentes.

## 11. Expériences pour trancher avant une réécriture

Les objectifs ci-dessous sont des seuils de travail proposés, à ajuster au produit, pas des performances obtenues.

### E0 — Figer les comparaisons

Choisir une cible frontière disponible et ses formats, tokenizer, sampling, contexte et kernels. Garder Kimi K3 comme cible extrême ; une cible plus petite peut servir d'instrument de recherche, sans devenir le produit final par défaut. Identifier poids d'experts, backbone, KV/états et mémoire de vérification. Mesurer avec et sans IDE ouvert.

Fixer les objectifs séparément : par exemple au moins 10 tokens validés/s pour l'interactif, p95 des pauses de sortie inférieur à une seconde, et TTFT chaud inférieur à cinq secondes. Pour le froid, publier une courbe 8k/32k/128k au lieu de promettre le même TTFT. Pour l'agent autonome, mesurer délai jusqu'au patch correct et tâches réussies/heure.

### E1 — Relevés de routage et oracle

Utiliser des tâches de code publiques : édition répétitive, fonction nouvelle, débogage, grand dépôt et outils. Relever expert/couche/token, coactivation, union sur fenêtres, octets et réutilisation entre tours, sans conserver de code privé. Réserver des tâches hors échantillon pour ne pas suradapter le placement.

Comparer placement aléatoire, contigu, LRU/LFU, affinité publiée et oracle connaissant les futurs accès. Inclure le coût de chargement et l'état initial froid. Si même l'oracle ne permet pas assez de localité à la mémoire disponible, éliminer la promesse de cache WAN quasi parfait.

### E2 — Mesurer un stage et un expert véritables

Sur les matériels déjà accessibles : mesurer un vrai expert et un vrai bloc d'attention, aux formats cibles. RAM/VRAM disponibles de 4/8/16/24 Go, contexte et draft compris. RTT contrôlés 2/20/50/100 ms et débits 20/100/1 000 Mbit/s, uplink/downlink distincts. Les liens artificiellement limités sont une émulation, pas une preuve de réseau domestique.

Le test de couche peut utiliser un fragment du modèle géant ; il ne qualifie pas une génération complète. Inclure échauffement, contention de l'IDE et stockage. Distinguer transfert de poids, transfert d'activations et temps de calcul.

### E3 — Spéculation et placement ensemble

Matrice : fenêtres 0/4/8/16 ; suffixe de code, MTP et draft compatible ; cache figé ou adaptatif ; concurrence 1/4/16/64 lorsque la mémoire le permet. Tester les combinaisons et leurs ablations séparées.

Mesurer tokens validés/s, p95 des pauses, experts distincts, octets/token, énergie si disponible, RAM maximale, annulations et tâches réussies. Une moyenne fluide ne doit pas cacher une sortie par rafales après de longues pauses. Aucun appel d'outil irréversible ne part sur des tokens non validés.

### E4 — Pauses d'outils et préparation

Comparer aucune préparation, LRU, H3 et oracle, sur tâches hors échantillon. Compter le bénéfice après chaque retour d'outil, les copies inutiles et les ralentissements infligés aux autres utilisateurs. L'optimisation doit améliorer le travail terminé, pas seulement déplacer son coût ailleurs.

### E5 — Concurrence et churn

Simuler d'abord avec distributions issues des mesures, puis vérifier sur plusieurs accès résidentiels réels. Faire varier mix de matériels, départs, pertes, congestion et demandes de contexte. Ne jamais appliquer une latence moyenne identique à toutes les paires en prétendant simuler le monde.

Publier : nombre de sessions soutenues au SLO, files, refus, couverture après panne, coût de réplication, temps de reprise et contribution des PC de 8 Go. Un simulateur doit se recalibrer sur les mesures, pas constituer sa propre preuve.

### Décisions d'arrêt et de poursuite

- H1 est abandonnée dans un régime si l'oracle n'offre pas de marge ou si les migrations consomment le gain.
- H2 est désactivée dans un régime si elle ne réduit pas le coût par token validé ou dégrade la capacité sous le SLO choisi.
- H3 est abandonnée si le gain après outil ne rembourse pas le coût collectif de préparation.
- La candidate WAN directe est abandonnée pour l'interactif si même les liens optimistes et la meilleure acceptation plausible restent trop lents ; elle peut rester pertinente pour du batch.
- Une nouvelle architecture de modèle ne progresse que si son évaluation de qualité montre qu'elle peut satisfaire le besoin de code, et si son coût d'entraînement est finançable.

## 12. Ordre de recherche recommandé

**Commencer par la faisabilité mémoire et le profil d'experts du modèle cible, puis par l'oracle de placement.** Ce résultat indique si la meilleure chance vient de groupes proches, d'un cache d'experts, de spéculation ou d'une nouvelle architecture. Il évite de reconstruire une plateforme entière autour d'une hypothèse déjà condamnée par ses propres besoins mémoire.

Ensuite confronter les candidates 1, 2 et 3 sur les mêmes ressources et tâches. Réutiliser les kernels, formats, réseaux et méthodes de la littérature quand ils répondent au problème. Conserver le moteur historique comme point de comparaison éventuel, sans lui donner un statut privilégié.

Le pari de recherche le plus cohérent à ce stade est **un réseau mondial de groupes de calcul, avec placement mixte, préparation d'experts et vérification par blocs choisies ensemble**. Son intérêt est conditionnel : il faut assez de capacité proche, une localité d'experts exploitable et un rendement économique soutenable. L'étude n'établit pas encore qu'un swarm arbitraire de PC 8–32 Go pourra fournir Kimi K3 à vitesse interactive pour tous ses membres.

Les calculs des tableaux sont reproductibles avec [le script analytique](frontier_swarm_bounds.py). Ils servent à orienter et réfuter des hypothèses ; ils ne remplacent aucune des expériences matérielles ci-dessus.
