# Fabi : construire une session de code sur un modèle frontière distribué

28 septembre 2026. Suite expérimentale de [l'étude initiale](frontier-swarm-2026-09-28.md).

**Proposition : un ordonnanceur qui construit et conserve un parcours de calcul pour une session agentique, en choisissant ensemble le placement, les répliques, la longueur des blocs vérifiés et la durée de conservation du contexte.** Le modèle cible reste complet. Le collectif mondial distribue les ressources ; chaque génération emprunte un sous-ensemble choisi par mesures de latence, capacité et disponibilité.

Le livrable comprend une architecture de recherche, cinq scripts exécutables, des traces réelles de routage et deux expériences d'inférence. Il ne comprend pas encore un moteur distribué exécutant Kimi K3. Les résultats ci-dessous distinguent mesures matérielles, relecture de traces, calculs et hypothèses. La nouveauté scientifique de la combinaison n'est pas établie.

## 1. Ce que nous cherchons effectivement à inventer

L'unité d'ordonnancement devient la **session de code avec son prochain bloc de génération**, plutôt qu'une allocation de RAM indépendante de la requête. Une décision contient :

- les propriétaires des couches d'attention et de leurs états KV/récurrents ;
- les machines qui exécutent chaque ensemble d'experts, avec leurs répliques ;
- les frontières de pipeline et le trajet direct du résultat vers le client ;
- le mécanisme de proposition et sa largeur maximale ;
- les budgets de calcul, de mémoire, de transferts et de reprise après départ d'un pair ;
- une durée de réservation qui couvre éventuellement l'appel d'outil suivant.

L'hypothèse nouvelle à éprouver dans Fabi est que ces décisions doivent être couplées : un bloc de spéculation plus large peut solliciter davantage d'experts et saturer un pair ; une réplique peut supprimer une attente complète mais retirer de la place au contexte ; garder le contexte pendant des tests peut accélérer la session suivante mais réduire la concurrence. Des optimisations isolées peuvent donc s'annuler.

La fonction de coût proposée, à calibrer sur mesures, est :

```text
coût par token accepté =
  (temps de proposition
   + temps critique de vérification du bloc
   + coût de commit / rollback
   + migration amortie
   + reprise attendue après déconnexion)
  / nombre attendu de tokens acceptés
```

Le temps critique inclut les files et les transferts sur le graphe réel ; ce n'est pas la somme de tous les calculs qui peuvent se chevaucher. Les contraintes portent aussi sur le temps de première réponse, les pauses p95, le débit total et l'équité entre sessions. Les coefficients ne sont pas encore appris ni validés.

### Une boucle rapide et une boucle lente

**Pendant la génération**, les poids restent majoritairement à leur emplacement. On envoie les activations aux détenteurs des experts manquants et on regroupe les requêtes destinées au même pair. Le routeur original choisit toujours les experts ; une erreur de prédiction ne doit pas retirer un expert demandé. Le résultat revient directement au coordinateur de la session. Les décisions doivent éviter les redistributions globales par token.

**Entre les tours**, notamment pendant les tests et les outils, on peut préparer des répliques, restaurer un contexte, renouveler ou libérer une réservation. Le transfert n'est autorisé que si son bénéfice attendu dépasse son coût et son coût d'opportunité. Une pause de dix secondes ne permet pas de déplacer arbitrairement des centaines de gigaoctets.

```text
au début d'une session :
  identifier exactement modèle, format, tokenizer, contexte et isolation utilisateur
  sélectionner plusieurs placements réalisables sur la topologie mesurée
  comparer pipeline, experts distribués et placements mixtes
  réserver poids + état de session + marge d'exécution

avant chaque bloc :
  observer acceptations, temps des stages, files, experts et occupation mémoire
  proposer aucune spéculation, copie de code ou brouillon appris compatible
  choisir la largeur dont le gain estimé reste positif sous les budgets
  vérifier avec le modèle cible ; ne publier que les tokens validés
  conserver uniquement les états correspondant au préfixe accepté

pendant un outil :
  estimer le temps disponible et la probabilité de reprise
  comparer garder / décharger / reconstruire le contexte
  déplacer seulement les répliques amortissables avant leur prochaine utilisation
```

Ce protocole permet de construire un moteur de recherche concret. Il n'autorise pas encore une affirmation de performance.

## 2. Pourquoi cette organisation peut rester réellement pair-à-pair

Les groupes de calcul sont constitués de machines participantes ; ils ne supposent pas qu'un serveur central détienne le modèle. Un PC peut héberger quelques experts, une fraction de couche ou une partie du contexte s'il satisfait les contraintes matérielles. Les nœuds disponibles plus loin peuvent distribuer des poids, maintenir des répliques de secours et servir des tâches qui tolèrent une attente plus longue.

Un « groupe proche » est défini par un graphe de latences et de débits mesurés, pas par un pays ni une ville. Le seul fait d'être dans la même région ne prouve pas qu'une connexion résidentielle convient. Un placement peut avoir des groupes rapides internes et quelques frontières plus lentes entre groupes ; il faut alors compter ces frontières explicitement.

La contribution d'une machine de 8 Go est possible sans qu'elle soit nécessaire sur le chemin de chaque réponse. Le budget est la mémoire réellement disponible après OS, IDE, buffers et état de session. Une RAM de PC Windows ne devient pas de la VRAM par le protocole. L'ordonnanceur doit qualifier les kernels et le débit de chaque type de matériel.

Le registre peut être distribué ou répliqué. Le client choisit un coordinateur par session et peut le remplacer ; un journal du préfixe validé et des identifiants de checkpoints permet la reprise. Les poids peuvent être adressés par leur contenu. Leur intégrité ne prouve cependant pas l'honnêteté du calcul distant : réplication de contrôle et détection de résultats incorrects restent des travaux distincts. Le chiffrement du transport ne cache pas les activations au pair qui les traite.

## 3. Les mesures effectuées

### Matériel et protocole

Mac Apple M4, 16 Go : relecture des traces, vérification locale du patch et transport réseau. A100 SXM4 80 Go RunPod : inférence instrumentée. Aucun code privé du dépôt n'a été envoyé ; les prompts contiennent des fixtures synthétiques Python, TypeScript et SQL.

Modèle de sonde : `Qwen/Qwen3-30B-A3B-Instruct-2507`, révision `0d7cf23991f47feeb3a57ecb4c9cee8ea4a17bfe`, BF16, Transformers 4.57.1, Torch 2.8.0+cu128, SDPA. Ses 48 couches MoE sélectionnent 8 experts parmi 128. Le modèle entier est chargé sur le GPU ; ce n'est donc pas un benchmark distribué. [Configuration officielle](https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507/raw/main/config.json).

La sonde enregistre les vrais choix du routeur, sur trois prompts d'environ 2k, 8k et 16k tokens, puis 48 tokens de réponse et un suivi scripté de 39 tokens suivi de 48 tokens. Les sorties sont tronquées pour mesurer le mécanisme : ce n'est ni une évaluation agentique avec outils réels, ni une mesure de taux de résolution de bugs. Langue de programmation et longueur changent ensemble ; aucune causalité entre ces deux variables ne peut être isolée.

### Contexte conservé

| Cas | Tokens du prompt | Préfill froid | Ajout de 39 tokens au cache existant | KV final |
|---|---:|---:|---:|---:|
| Python | 1 973 | 3,527 s | 0,875 s | 0,193 Gio |
| TypeScript | 8 114 | 10,313 s | 0,917 s | 0,755 Gio |
| SQL | 16 308 | 19,254 s | 0,935 s | 1,505 Gio |

Pour Python seulement, le recalcul froid du **même transcript de reprise** coûte 3,767 s, contre 0,875 s en réutilisation : environ 4,30×. Le prochain token argmax est identique. La comparaison utilise les mêmes hooks de routage dans les deux parcours. Elle ne vérifie pas l'identité de tous les logits ni de toute une longue génération.

La conservation du contexte évite du calcul, mais consomme une ressource persistante. Ici le KV BF16 vaut 98 304 octets par token ; 100 sessions de 16 384 tokens représenteraient 150 Gio de KV, hors poids et tout autre état. Ce chiffre concerne ce Qwen, pas Kimi. Un cache qui reste en place est généralement plus utile qu'un cache qu'on déplace sur WAN à chaque tour.

### Placement d'experts : une hypothèse rejetée

On rejoue les routes réelles avec un budget abstrait permettant de garder la moitié des experts dans une zone proche. On suppose que tous les appels distants d'une même couche se chevauchent et que les couches restent dépendantes. Ce modèle ne mesure ni le matériel ni la capacité physique de cette zone.

| Politique, première réponse | Python : couches bloquées/token | TypeScript | SQL |
|---|---:|---:|---:|
| 64 experts/couche, fréquence du prompt | 43,83 | 43,90 | 45,12 |
| 24 couches complètes proches, 24 distantes | 24,00 | 24,00 | 24,00 |
| Allocation DP optimisant les barrières sur le prompt | 44,02 | 43,85 | 44,60 |
| Même DP, statistiques des 128 derniers tokens du prompt | 36,60 | 36,23 | 38,21 |
| Cache LRU dynamique, 64 experts/couche | 14,56 | 13,52 | 13,15 |

**Le premier optimiseur DP proposé n'est pas un succès.** Il optimise son échantillon d'apprentissage, mais le routage du prompt répété ne prédit pas assez bien celui de la réponse. Un placement de couches complètes le bat ; LRU le bat aussi. La politique DP ne doit donc pas être intégrée comme une amélioration démontrée.

LRU atteint environ 94–95 % de succès par expert sur la première réponse, tout en laissant 13–15 couches attendre. Sur les suivis, les attentes moyennes vont de 10,54 à 14,46 couches. La métrique « taux de succès du cache » est donc insuffisante.

LRU admet aussi environ 19–22 nouveaux experts par token sur la première réponse. Pour ce Qwen, un expert à quatre bits idéaux représenterait 2,36 Mo : cela ferait environ 46–51 Mo de nouveaux poids par token si chaque défaut nécessitait un téléchargement WAN. **Ce calcul ne mesure pas une exécution quantifiée** ; il montre pourquoi le bon score LRU ne justifie pas le streaming de poids sur une liaison résidentielle. Un cache local RAM/SSD et un calcul distant sur activation ont des coûts différents.

Un plan construit avec connaissance de toute la réponse obtient presque zéro barrière au même budget. Cette comparaison rétrospective ne constitue pas un prédicteur disponible. Elle illustre surtout combien une fuite du futur dans un benchmark rendrait l'idée artificiellement séduisante.

### Largeur de bloc et diversité des experts

Les fenêtres de tokens réellement générés sollicitent, en moyenne par couche :

| Fenêtre | Python | TypeScript | SQL |
|---|---:|---:|---:|
| 1 token | 8,00 | 8,00 | 8,00 |
| 4 tokens | 19,41 | 19,46 | 19,74 |
| 8 tokens | 28,81 | 29,16 | 30,32 |
| 16 tokens | 40,09 | 40,31 | 41,80 |

Ce sont les unions sur la séquence acceptée, pas des traces de propositions rejetées. Elles montrent que traiter un bloc plus large ne conserve pas le coût d'un seul token. Le véritable vérificateur devra mesurer ses propres unions d'experts, son débit et ses rejets.

### Proposition à partir du code existant

La deuxième expérience utilise le `prompt_lookup` déjà implémenté dans Transformers : huit tokens proposés au maximum, recherche de n-grammes jusqu'à trois tokens, génération greedy. Aucun second modèle n'est chargé. [Implémentation officielle épinglée](https://github.com/huggingface/transformers/blob/v4.57.1/src/transformers/generation/candidate_generator.py).

| Cas | Greedy | Lookup | Appels au modèle | Identité complète des tokens |
|---|---:|---:|---:|---|
| Réécrire le fichier avec une comparaison corrigée | 14,522 s ; 87 tokens | 7,333 s ; 87 tokens | 87 → 15 | Oui |
| Écrire un nouvel algorithme de tri topologique | 30,397 s ; 192 tokens | 50,252 s ; 193 tokens | 192 → 156 | Non, divergence au token d'indice 15 |

Une mesure par variante, même modèle et backend, kernels échauffés, prompt froid. Les durées incluent le préfill. La modification du fichier passe quatre contrôles locaux : expiration passée, égalité, valeur future et clé absente.

Le premier cas est encourageant : environ 1,98× plus rapide et 5,8× moins d'appels au modèle. Il ne prouve pas un gain WAN de 5,8× : chaque appel de vérification est plus large. Le second cas interdit de généraliser : ralentissement et échec de parité. La cause de la divergence, numérique ou liée à l'implémentation, n'est pas isolée. L'écart de longueur au plafond doit aussi être résolu. On ne déclare donc pas ce backend exact de bout en bout.

Comme la séquence du second cas diffère, ses durées ne constituent pas une comparaison contrôlée à travail identique. Elles suffisent à rejeter l'affirmation d'une accélération systématique avec sortie identique dans cette configuration.

Conséquence : la proposition de code existant mérite un mode dédié aux modifications, avec arrêt adaptatif et qualification de fidélité. Pour le raisonnement nouveau, comparer un brouillon appris compatible, un mécanisme fourni par le modèle et l'absence de spéculation. « Davantage de tokens proposés » n'est pas un objectif suffisant.

### Réseau réel

Un canal SSH persistant, compression désactivée, transporte des données synthétiques entre ce Mac et le pod US-MD-1. Douze observations conservées par taille après deux échauffements :

| Octets envoyés, puis renvoyés | Aller-retour médian |
|---:|---:|
| 1 | 94,56 ms |
| 4 096 | 102,17 ms |
| 16 384 | 128,15 ms |
| 65 536 | 146,64 ms |
| 262 144 | 171,50 ms |

C'est le coût de ce chemin et de cette pile SSH, pas le RTT universel d'Internet, une mesure QUIC, ni un benchmark d'inférence P2P. À titre de scénario seulement, 14 barrières de 100 ms feraient déjà 1,4 s par token avant calcul. Le placement doit donc éviter qu'un trajet de cette classe se répète à chaque couche.

## 4. Revenir aux vrais modèles frontière

Les métadonnées de fichiers Hugging Face ont été interrogées sans télécharger les poids frontière. Les sommes des fichiers safetensors sont archivées, avec les révisions :

| Checkpoint | Fichiers | Taille de fichiers |
|---|---:|---:|
| Kimi-K3, `f831ab66814297da540d832a5235f8e904f29d06` | 96 | 1 560 936 091 448 octets, soit environ 1,561 To décimal |
| GLM-5.3-BF16, `9d2398f478cab2de883137db3a36ad2c96205e24` | 282 | 1 506 667 387 408 octets, soit environ 1,507 To décimal |

Sources : [métadonnées Kimi](https://huggingface.co/api/models/moonshotai/Kimi-K3?blobs=true), [métadonnées GLM](https://huggingface.co/api/models/zai-org/GLM-5.3-BF16?blobs=true). Un checkpoint quantifié et un checkpoint BF16 ne se comparent pas à taille égale sans qualifier les formats. La taille de fichiers ne prédit pas exactement la mémoire résidente du backend.

Pour Kimi, stocker une seule copie de cette représentation exige au minimum 391 contributions de 4 Go, 196 de 8 Go, 98 de 16 Go ou 66 de 24 Go, en unités décimales. Ajouter état des sessions, buffers, fragmentation et répliques augmente ces besoins. Ce sont des seuils de stockage, pas un dimensionnement de service.

Son architecture change la conception : attention hybride KDA/MLA, état récurrent à restaurer, experts dans un espace latent et résidus entre blocs. Les frontières de pipeline doivent transférer tout l'état requis, pas uniquement un vecteur caché si le modèle en exige davantage. [Fiche officielle](https://huggingface.co/moonshotai/Kimi-K3), [support SGLang](https://github.com/sgl-project/sglang/blob/main/docs/cookbook/autoregressive/Moonshotai/Kimi-K3.mdx).

Avec les dimensions 3 × 3 584 × 3 072 et 4,25 bits par poids expert, un expert représente environ 17,55 Mo, et les 896 experts d'une couche environ 15,72 Go, avant le reste de la couche. Un transfert de cet expert prend au minimum 1,40 s à 100 Mbit/s utiles, sans latence ni concurrence. Une activation latente BF16 représente 7 168 octets avant protocole : envoyer le calcul vers les poids est souvent beaucoup moins volumineux. Le port MLX communautaire documente ces dimensions et ses limites ; ses résultats sur modèles élagués ne prouvent pas l'exécution du modèle intégral. [Source du port](https://github.com/PipeNetwork/kimi-k3-mlx).

Cette taille explique pourquoi plusieurs petits pairs devront parfois participer à une seule couche. **Le nombre de pairs total peut être grand sans que tous les échanges aient une grande latence, mais cette propriété doit être construite et mesurée.** Une mémoire mondiale disponible ne suffit pas si aucune topologie réalisable ne respecte le budget de génération.

## 5. Combinaison retenue et éléments à réutiliser

| Élément | Appui existant | Travail propre à Fabi restant |
|---|---|---|
| Découpage et découverte de pairs | Petals, Parallax ; analyse dans l'étude initiale | Placement mixte couches/experts pour 8–32 Go et état de session |
| Spéculation distribuée | Gradient DSD, travaux de spéculation MoE | Choix conjoint des propositions, de leur largeur et du parcours réseau |
| Localité des experts | ExFlow, GRACE, CAP, caches et préchargement | Objectif de barrières et de coût réel, robuste aux changements prompt/réponse |
| Réutilisation du contexte | Caches de préfixes et hiérarchies existantes | Réservations couvrant outils, états hybrides, départ de pairs, isolation |
| Propositions adaptées aux éditions | Prompt lookup et EfficientEdit | Association à la version des fichiers, déclenchement contrôlé, fidélité |
| Ordonnancement agentique | Agentix, AgentSysBench, AgentSpec | Minimiser le temps du travail de code complet et préserver l'équité |

La littérature récente renforce plusieurs précautions. SpecPrefetch distingue prédiction de transfert et routage effectif ; cette séparation protège le calcul du modèle. L'étude sur la gestion des experts par le noyau rappelle qu'un prédicteur peut améliorer peu la durée réelle malgré une précision intéressante. AgentSpec traite la spéculation dans des charges d'agents. [SpecPrefetch](https://arxiv.org/abs/2607.24787), [Kernel-Managed Tiering](https://arxiv.org/abs/2608.12103), [AgentSpec](https://www.microsoft.com/en-us/research/publication/agentspec-speculative-decoding-for-batch-inference-of-llm-agents/).

Un prototype public de génération WAN, Shard, rapporte des effets importants du placement géographique et des kernels, ainsi qu'une régression de la spéculation en arbre avant optimisation du vérificateur. Ce sont des résultats des auteurs, pas reproduits ici ; leurs conditions ne démontrent pas des sessions frontière à contexte long. L'intérêt pour Fabi est de réutiliser le découpage expérimental : proposer, vérifier, transférer, accepter et reprendre doivent être chronométrés séparément. [Journal technique Shard](https://github.com/leyten/shard/blob/master/docs/research/wan-speculative-decoding.md).

### Trois variantes à confronter

1. **Pipeline avec blocs vérifiés**, peu de logique de placement : référence indispensable. Peut gagner si les couches tiennent et si les connexions sont suffisamment rapides.
2. **Experts répartis avec attention conservée**, davantage de parallélisme mais des barrières par couche : intéressant seulement si ces échanges sont rapides et le fan-out maîtrisé.
3. **Placement mixte par session**, regroupant les dépendances coûteuses et exploitant les pauses : hypothèse principale. Il doit battre les deux précédents après comptabilisation de ses migrations et de son ordonnanceur.

L'élagage permanent d'experts, un routage modifié pour éviter les pairs distants ou une compression avec perte du contexte constituent d'autres variantes de modèle. Elles peuvent être étudiées séparément mais ne doivent pas être présentées comme l'accès transparent au même modèle frontière complet.

## 6. Le contexte agentique appartient au protocole

Le client conserve un journal versionné des messages, appels d'outils, observations et fichiers. Les observations sont ajoutées à un préfixe stable lorsque c'est possible. Une modification du contenu antérieur invalide le cache à partir de la première différence. Réutiliser arbitrairement le KV de fichiers indépendants n'est pas exact pour l'attention causale standard.

Un identifiant de cache doit lier le préfixe exact, le modèle et sa révision, le tokenizer, les positions, la configuration d'attention, le format d'état et le périmètre d'isolation. Le matériel/backend peut aussi affecter la compatibilité numérique. Le découpage des tokens accepté doit correspondre aux états KV ou récurrents effectivement conservés après spéculation.

Pendant un appel de tests, le scheduler estime : probabilité de reprise × coût de reconstruction évité, comparée au coût de garder la mémoire réservée. Les délais d'outils mesurés guident cette décision. Le contexte peut être déchargé sur la même machine avant d'envisager une migration distante. Précharger le résultat inconnu d'un outil n'est pas possible ; préparer des poids, des buffers ou un préfixe déjà connu l'est.

La compression du transcript par résumé peut être une politique de l'agent, mais change l'information donnée au modèle. Elle ne doit pas être comptée comme une compression exacte du moteur. Pour les kernels KDA et autres états récurrents, vérifier explicitement sauvegarde, restauration, branches spéculatives et rejets.

## 7. Accès gratuit et capacité du collectif

Le produit peut proposer un accès sans abonnement et sans quota fixe tant que la capacité collective le permet, avec partage équitable et files sous charge. Il ne peut garantir un nombre illimité de sessions instantanées pour une contribution arbitrairement petite.

Le crédit devrait rémunérer le service utile et vérifiable : exécution acceptée, réplique demandée disponible, transfert servi, disponibilité utile. La seule RAM annoncée n'est pas une preuve de contribution ; stocker une copie supplémentaire sans demande ne crée pas autant de capacité que servir un calcul critique. Les ressources hétérogènes demandent une comptabilité multidimensionnelle, faute de quoi le système peut manquer de GPU tout en distribuant des crédits de stockage.

Dans une région disposant de N pairs, le nombre de modèles résidents complets dépend approximativement du budget total utile divisé par poids + répliques + états, mais le débit exige ensuite une analyse des machines et liaisons les plus chargées. Augmenter les membres peut augmenter l'offre et la demande simultanément. L'équilibre ne découle pas du seul effet de réseau.

## 8. Conditions de validation de l'innovation

Avant de revendiquer un moteur frontière P2P utilisable pour coder :

1. **Fidélité.** Isoler l'échec de parité observé ; tester les logits aux premiers écarts, le greedy, les distributions si sampling, le rollback et les plafonds de génération. Vérifier plusieurs matériels, formats et longueurs. Les tests de bugs doivent compléter la comparaison de tokens.
2. **Frontière réel.** Épingler un checkpoint complet et des kernels supportés ; mesurer son véritable état, ses routes et sa mémoire. Les résultats Qwen ne se transfèrent pas quantitativement à Kimi.
3. **Distribution réelle.** Exécuter d'abord un nombre modeste de stages sur plusieurs machines avec vrais transports, puis augmenter le nombre. Mesurer séparément calcul, RTT, débit, files, préfill et vérification. Injecter des latences est utile mais ne remplace pas des pairs réels.
4. **Topologie réalisable.** Construire un placement sur un inventaire de machines 8–32 Go, avec réserve OS/IDE et mémoire du contexte. Refuser un SLO interactif si le graphe ne le permet pas ; conserver l'accès asynchrone ou attendre de la capacité.
5. **Agentique complète.** Sessions avec outils réels et contextes 8k/32k/128k, plusieurs langages, tâches inédites, pannes et changements de fichiers. Mesurer temps jusqu'au patch testé, tâches réussies, octets et énergie approximée par travail utile, pas seulement tokens/s.
6. **Ablations et concurrence.** Comparer les trois variantes, puis retirer successivement cache de session, proposition de code, placement et répliques. Tester plusieurs sessions et arrivées/départs. Comptabiliser tout transfert de préparation et tout calcul rejeté.

Le gain combiné ne doit pas être obtenu en multipliant les meilleurs facteurs de papiers indépendants. Une amélioration qui accélère une session en bloquant toutes les autres peut ne pas servir l'objectif collectif.

## 9. Reproduction et coût

Scripts :

- `agentic_trace_probe.py` : capture GPU des routes et mesure de conservation du contexte ;
- `analyze_agentic_routes.py` : relecture locale des caches et comparaison des plans ;
- `code_lookup_probe.py` : comparaison greedy / propositions issues du prompt ;
- `wan_transport_probe.py` : transport synthétique via SSH ;
- `frontier_swarm_bounds.py` : calculs de l'étude initiale.

Les résultats sont dans [results-2026-09-28](results-2026-09-28/), environ 6,2 Mo avant ajout des derniers logs. `metadata.json` fixe la configuration, `summary.json` décrit les cas, `route_analysis.json` contient toutes les politiques, `code_lookup.json` conserve tokens et sorties, `validation.json` consigne les échecs et les contrôles du patch. Les archives NPZ gardent les routes brutes.

Relecture locale avec un Python disposant de NumPy :

```bash
python analyze_agentic_routes.py results-2026-09-28
```

Sur l'image GPU utilisée, créer un venv avec accès au Torch système et installer Transformers 4.57.1, Accelerate 1.10.1, safetensors et sentencepiece. Les versions effectivement chargées et la révision du modèle sont archivées ; l'image est `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`. Exécuter les sondes depuis un dossier contenant leurs imports ; prévoir environ 61 Go pour les poids BF16 et assez d'espace pour leur téléchargement. Les fixtures sont générées par le script.

Pod `e3l7s9ponfwbqi`, tarif annoncé 1,59 USD/h, durée création–suppression 14,46 minutes : **estimation calcul 0,383 USD**, hors éventuels frais de disque et décalages de facturation. Le solde observé a diminué d'environ 0,352 USD à l'instant de vérification ; ce n'est pas une facture finale. Suppression HTTP 204, consultation suivante HTTP 404, dépense horaire du compte revenue à zéro. Le watchdog de 45 minutes a été désarmé après confirmation de suppression. Aucune clé API n'est dans ces fichiers.

**Décision de recherche : poursuivre le placement mixte lié aux sessions et la sélection adaptative des propositions. Abandonner le cache statique dérivé du prompt comme réponse au WAN, et ne pas qualifier la spéculation testée d'exacte tant que sa divergence n'est pas expliquée.**
