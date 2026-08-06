# Placement V3 adaptatif au contexte et aux charges de code

Date de conception : 4 août 2026

Ce document complète `FABI-SWARM-PROTOCOL-V3.md`. Il définit le placement à construire avant de
modifier la politique autonome actuelle. Le but n'est pas de maximiser aveuglément le nombre de
couches par worker, ni le contexte maximal d'une unique route. Le but est de maximiser la part de
la demande réelle que le swarm peut servir, avec une latence acceptable, de la redondance et un
nombre de rechargements borné.

## 1. Conclusions qui structurent le design

1. **Le contexte est une propriété d'une route complète et d'une requête**, jamais une constante
   globale du swarm.
2. **Le placement des poids et l'admission KV sont deux problèmes liés mais distincts.** Le span
   chargé détermine les poids résidents et les octets KV par token du worker. Les pages KV sont
   ensuite réservées exactement, requête par requête.
3. **Une grande capacité de contexte est imbriquée.** Une route 128k peut servir une requête 16k.
   Une classe de contexte est donc un objectif de capacité et de routage, pas une partition
   physique rigide du cluster.
4. **Répartir davantage n'est pas toujours meilleur.** Des spans plus étroits libèrent de la
   mémoire pour le KV, mais ajoutent des frontières réseau, augmentent la latence de decode et la
   probabilité qu'un pair disparaisse pendant une génération.
5. **La taille du modèle ne suffit pas à prédire le coût du contexte.** Le poids dépend du nombre
   de paramètres et de la quantification ; le KV dépend notamment des couches d'attention, du
   nombre de têtes KV, de leur dimension et du dtype. Un grand modèle GQA/MQA peut avoir un KV par
   token plus favorable qu'un modèle plus petit en MHA.
6. **200k ne doit jamais être une valeur produit arbitraire.** Chaque variante publie une limite
   native ou étendue réellement qualifiée. Une configuration RoPE/YaRN différente produit un
   contrat et un `ModelSwarmId` différents, même si les poids de base peuvent partager le cache
   disque.
7. **La demande doit être observée, agrégée et résistante aux oscillations.** Une requête isolée
   ne déplace aucun worker. Le placement suit un déficit durable de service, avec hystérésis,
   cooldown, drain et coût de téléchargement/reload.

## 2. Ce qui est repris des systèmes existants

### Petals

Petals apporte les bonnes primitives décentralisées : annonces temporaires dans la DHT, choix
autonome d'un span, prise en compte des spans `JOINING`, équilibrage du débit minimal par couche et
refus d'un déplacement qui rendrait une chaîne auparavant complète disjointe. Son client construit
aussi un chemin depuis la DHT et utilise un graphe de latence qui combine calcul, RTT et capacité
de cache annoncée.

Fabi conserve ces invariants, mais ne reprend pas le score mono-dimensionnel. Petals choisit une
longueur de span avant le placement et n'optimise pas simultanément plusieurs fenêtres de contexte,
la concurrence KV, les endpoints, les relays et les domaines de panne.

### Exo

Exo filtre d'abord les cycles réseau réellement utilisables, les backends et la mémoire, préfère le
plus petit cycle capable d'héberger le modèle, favorise les poids déjà téléchargés puis répartit les
couches proportionnellement à la mémoire disponible. Fabi reprend l'ordre des contraintes :
topologie et faisabilité d'abord, optimisation ensuite. Le simple partage proportionnel à la RAM ne
suffit toutefois pas pour des pairs Internet ni pour plusieurs classes de contexte.

### Parallax

Parallax fournit l'exécution pipeline, le profilage des backends, le DP de route et le water-filling
calcul/mémoire. Fabi réutilise ces mécanismes comme estimateurs de débit et solveurs locaux. Ils ne
redeviennent pas une autorité centrale de placement.

### Helix et HexGen

Helix modélise les GPU et les liens hétérogènes dans un graphe capacitaire, utilise un placement
MILP hors ligne et un routage max-flow. HexGen formalise également le placement asymétrique sur des
GPU et réseaux hétérogènes. Fabi reprend l'idée de mesurer la **capacité de routes complètes**, pas
seulement la couverture de chaque couche. Le solveur lourd reste un oracle de simulation ; les
workers produit utilisent une approximation décentralisée et bornée.

### vLLM, SGLang et llm-d

vLLM mesure la mémoire non-KV après initialisation réelle puis attribue le reste au cache paginé.
SGLang et llm-d combinent localité de préfixe, charge et état KV pour le routage. Fabi reprend :

- le profilage autoritaire après chargement ;
- le KV paginé et l'admission en octets plutôt qu'une préallocation par fenêtre nominale ;
- l'affinité de préfixe sans ignorer la pression et la file d'attente ;
- la séparation entre variantes de service adaptées à des distributions de charge différentes.

## 3. Géométrie mémoire exacte

Pour un worker `w`, un span `s`, un profil backend `b` et une requête `r` :

```text
resident(w, s, b) = exact_weights(s)
                  + measured_runtime_fixed(w, s, b)
                  + measured_workspace(w, s, b, prefill_chunk, batch)

kv(r, s) = round_to_blocks(r.prompt + r.reserved_output)
         * sum(kv_bytes_per_token_by_layer[s])

resident + sum(kv des réservations actives) <= live_stable_envelope(w)
```

La décision de placement utilise les poids exacts du manifeste et un profil backend local déjà
mesuré. Une estimation peut classer des candidats `BUILDING`, mais elle ne crée jamais une lease
`READY`. Après chargement, le frontend et l'executor publient les limites réellement mesurées ;
l'admission échoue fermée si elles sont inférieures au contrat.

Le `max_sessions` ne doit plus prétendre qu'un worker peut héberger plusieurs sessions maximales.
Pour une classe `c`, la capacité KV instantanée est :

```text
session_slots(w, s, c) = floor(available_kv_pool_bytes / kv_bytes(s, c))
```

Elle reste une photographie d'observabilité. Chaque `PREPARE` réserve les octets exacts sous le
verrou local du worker.

## 4. Frontière de capacité d'un worker

Avant de rejoindre, le worker énumère ses spans contigus compatibles. Pour chaque span, il calcule
une petite frontière de Pareto :

```text
(span, contexte maximal qualifié, slots par classe, débit prefill, débit decode,
 nombre de frontières induites, coût de téléchargement, confiance du profil)
```

Un point est éliminé s'il est dominé par un autre qui offre au moins autant de contexte, de
concurrence et de débit avec un coût inférieur. Cette frontière répond proprement au cas des PC 8
ou 16 Gio : le worker peut découvrir que huit couches donnent une bonne route 16k, alors que deux
couches apportent une capacité 64k réellement demandée. Il ne choisit pas automatiquement le span
le plus petit ou le plus grand.

La frontière hypothétique reste locale. La DHT publie seulement le span matérialisé, le pool KV
réel, la limite frontend réelle et quelques métriques de service. Cela évite de multiplier la
taille des annonces par tous les spans possibles.

## 5. Profils de contexte par variante de modèle

Le registre signé doit exposer un `ContextProfile` explicite, pas seulement le hash du contrat :

```text
native_max_tokens
qualified_max_tokens
rope_mode + rope_parameters
backend_qualifications
context_classes
prefill_chunk_profiles
```

Les limites signées décrivent uniquement des bornes réellement qualifiées et, si nécessaire, des
objectifs de service stables. Elles ne décrivent jamais la capacité d'une machine. La lease d'un
worker annonce toujours son plafond KV exact mesuré et aligné sur les pages de son backend :
`10 432`, `12 960` ou `23 264` sont des valeurs valides qui ne doivent pas être arrondies à une
puissance de deux.

Une échelle compacte comme `8 192, 16 384, 32 768, 40 960` peut rester utile pour afficher des SLO
et comparer des scénarios reproductibles, mais elle n'est ni une allocation, ni un mécanisme de
repli mémoire, ni la représentation primaire de la demande. Modifier la distribution des requêtes
ou connecter un nouveau worker ne doit pas changer le manifeste signé ni le `ModelSwarmId`.

Ces objectifs ne sont pas des allocations séparées. Ils servent à :

- compresser la télémétrie de demande ;
- exprimer les déficits de capacité ;
- comparer deux placements ;
- protéger la capacité rare lors du routage.

Une capacité dans une classe haute compte aussi pour toutes les classes inférieures. Les calculs de
déficit doivent donc être cumulatifs afin de ne pas compter deux fois la même route.

## 6. Demande multidimensionnelle sans seuils matériels prédéfinis

Le tableau uniforme actuel par couche devient un résumé versionné par :

```text
ModelSwarmId × région réseau × classe de contexte
```

La distribution des tailles de requête est transportée par un histogramme exponentiel borné et
fusionnable, suivant le modèle stable `ExponentialHistogram` d'OpenTelemetry (ou une bibliothèque
DDSketch maintenue si son format de sérialisation est retenu). Cela évite des frontières produit
inventées : la résolution s'adapte à la plage observée, plusieurs résumés régionaux se fusionnent,
et une réduction de résolution conserve un sous-ensemble exact des frontières dans le cas
OpenTelemetry.

Le planificateur dérive à chaque snapshot un petit ensemble de points de décision à partir :

- des quantiles de demande observés et de la longue traîne ;
- des plafonds KV exacts annoncés par les workers READY/BUILDING ;
- des limites natives ou étendues réellement qualifiées du modèle ;
- des objectifs de service explicitement garantis.

Un point transitoire comme `21 758` ou `30 752` peut donc influencer le score sans devenir une
constante de code, un nouveau manifeste ou un quota physique. Le résumé conserve au minimum :

- taux d'arrivée admis et légitime ;
- demandes en file et refus `no_context_route` ;
- durée de service / occupation KV observée ;
- capacité prête estimée ;
- routes indépendantes souhaitées ;
- déficit de débit, de KV et de domaines de panne ;
- fenêtre d'observation, expiration et confiance.

Pour les conversations agentiques, le nombre brut de requêtes n'est pas le signal principal. La
pression utile combine la concurrence déduite des arrivées et durées, l'occupation en
KV-octets × temps, les sessions actives susceptibles de continuer, la croissance observée après
outils, les files et les refus de routes longues. Un plancher produit maintient une capacité
32k/64k/128k minimale même pendant une accalmie ; il ne disparaît pas sur la seule absence récente
de requêtes. Les poids finaux sont agrégés, bornés par crédit et publiés sans contenu utilisateur.

Les compteurs sont agrégés sans prompt ni identité utilisateur. Ils sont bornés par compte et par
crédit afin qu'un attaquant ne puisse pas provoquer mille rechargements avec de fausses requêtes
128k. L'histogramme ne déclenche jamais seul un mouvement : le protocole convertit ses quantiles en
conseil expirant, puis exige toujours gain de route complète, hystérésis, drain et validation
mémoire du backend.

Ce résumé est un conseil signé/expirable. Il ne donne aucun ordre de couches. Les workers restent
les auteurs de leur placement.

## 7. Fonction d'utilité décentralisée

Pour chaque classe, le snapshot régional est converti en graphe de spans et de liens compatibles.
La capacité utile est la capacité de **routes complètes** sous les limites KV, frontend, calcul et
réseau. Le principe max-flow de Helix donne une borne de débit ; le route planner exact valide les
meilleurs chemins et leurs domaines de panne.

Le choix d'un nouveau worker se fait en deux passes :

1. score Petals peu coûteux sur tous les spans : trous de couches, débit minimal, intents
   `BUILDING`, poids déjà présents ;
2. évaluation exacte des meilleurs candidats seulement : nouvelles routes complètes par classe,
   capacité KV, nombre de hops, direct/relay, TTFT/ITL, redondance et churn.

Le classement est lexicographique avant d'être pondéré :

1. respecter manifeste, mémoire, backend, endpoint et joignabilité ;
2. ne jamais casser la dernière route prête d'une classe garantie ;
3. fermer une route manquante pour la classe utile minimale ;
4. maximiser le gain de demande servie pondérée, puis la capacité longue rare ;
5. améliorer la redondance entre domaines de panne indépendants ;
6. améliorer le bottleneck de débit ;
7. minimiser hops, relay, TTFT et ITL ;
8. minimiser téléchargement, reload et éviction de blobs ;
9. appliquer fairness et jitter déterministe.

Une formulation conceptuelle du potentiel est :

```text
U(snapshot) = somme_classe poids_demande[c]
              * min(capacite_service[c], cible[c])
              - pénalité_latence
              - pénalité_corrélation_de_panne
              - coût_churn
```

Le worker bouge seulement si `U(après) - U(avant)` dépasse un seuil durable et amortit le coût du
reload. Un span plus étroit n'est choisi que s'il rend une classe demandée réellement servable,
augmente sa concurrence ou ferme une route ; « davantage de contexte théorique mais aucune route »
n'a aucune valeur.

## 8. Voies de service pour le code

Le produit expose des objectifs de service, pas des clusters figés :

| Voie logique | Priorité | Placement attendu |
| --- | --- | --- |
| interactive | TTFT/ITL et disponibilité | peu de hops, routes entières ou spans larges, bonne concurrence |
| code standard | outils multi-tours et contexte natif | compromis contexte/débit, affinité de préfixe/session |
| code profond | longues explorations et gros dépôts | spans plus étroits, contexte qualifié élevé, concurrence plus faible |
| batch/replay | débit et reprise froide | tolère davantage de délai, utilise la capacité momentanément libre |

Une même route peut appartenir à plusieurs voies. Le routeur choisit la meilleure route capable de
tenir le besoin exact, mais ajoute un **coût d'opportunité de contexte** : une petite requête ne
prend pas la dernière route 128k si une route 32k comparable est libre. Il n'y a pas de réserve
fixe permanente ; la protection de la capacité rare suit le déficit observé et disparaît lorsque
la demande longue disparaît.

Les tours d'une même session privilégient une route dont le préfixe est encore en cache, à condition
que sa charge et son état réseau restent acceptables. Les événements KV réels, comme dans llm-d,
valent plus qu'une simple heuristique basée sur l'identifiant de session.

## 9. Exemple Qwen3-4B

Le modèle officiel possède 36 couches, 8 têtes KV de dimension 128 et un contexte natif de 40 960.
Avec un cache BF16, cela représente 4 096 octets par token et par couche. À titre d'ordre de
grandeur vérifiable par le manifeste :

| Span | KV à 16 384 | KV à 40 960 | KV à 131 072 |
| --- | ---: | ---: | ---: |
| 4 couches | 256 Mio | 640 Mio | 2 Gio |
| 22 couches | 1,375 Gio | 3,438 Gio | 11 Gio |
| 36 couches | 2,25 Gio | 5,625 Gio | 18 Gio |

Ces chiffres montrent pourquoi un petit worker peut prendre moins de couches pour rendre une route
longue possible. Ils montrent aussi pourquoi il ne faut pas étaler sans limite : passer de deux à
dix stages ajoute huit frontières à chaque token décodé.

Qwen qualifie officiellement YaRN jusqu'à 131 072 pour cette famille et avertit que le YaRN
statique peut dégrader les textes courts. La variante native et la variante longue doivent donc
avoir des contrats RoPE distincts. Le contexte 16 384 du laboratoire actuel est une limite du
frontend qualifié de cette route, pas la limite théorique du modèle.

## 10. Contexte code : ne pas confondre ancienne trace et produit agentique

Le simulateur Helix inclut une trace Azure Code, mais elle représente surtout des complétions de
code courtes. Elle ne modélise pas correctement un agent OpenCode qui accumule système, historique,
lectures de fichiers, sorties d'outils et sortie réservée. Le laboratoire Fabi a déjà observé un
tour qui passe de 13 601 tokens à 19 710 après une seule série d'outils.

La validation utilisera donc trois sources complémentaires :

1. traces Azure Code/Conversation pour la reproductibilité avec Helix ;
2. traces Fabi anonymisées contenant seulement les longueurs, phases, durées et causes de refus ;
3. une longue traîne synthétique 32k/64k/128k/256k, bornée par les variantes réellement
   qualifiées.

Il n'existe pas aujourd'hui de preuve sérieuse que 200k soit « la moyenne » d'un agent de code.
Fabi doit pouvoir offrir une voie 128k/256k lorsque le modèle et le réseau le permettent, mais doit
aussi réduire le contexte inutile grâce au compactage proactif, aux repo maps et aux sous-agents
d'exploration synthétiques.

## 11. Stabilité sous churn et pression mémoire

- Une variation de mémoire ne change jamais immédiatement le span d'une route active.
- Sous pression, le worker ferme d'abord de nouvelles admissions, puis draine si la pression est
  durablement critique.
- Une baisse de capacité affecte d'abord les futures requêtes et publie une nouvelle génération de
  lease ; une réservation engagée reste fenced par son epoch.
- Une hausse doit être stable sur plusieurs mesures avant de devenir un nouveau candidat.
- Le changement de span exige cooldown, gain minimal, absence de réservation et couverture prête.
- Les demandes sont lissées sur une fenêtre bien plus longue qu'un tour ; aucun timer n'est utilisé
  comme preuve qu'une génération a planté.

## 12. Validation avant activation

### Oracle hors ligne

Pour les petits scénarios, un modèle OR-Tools CP-SAT calcule un optimum de référence avec les
contraintes exactes poids/KV/endpoints/routes. Pour les graphes plus grands, le simulateur Helix
fournit le max-flow et les métriques réseau. Ces outils restent dans les tests et le laboratoire,
pas dans la boucle de décision de chaque worker.

### Baselines à battre

- maximum de couches par worker ;
- placement Petals par déficit de couche/débit ;
- partage Exo proportionnel à la mémoire ;
- politique V3 actuelle avec deux répliques uniformes ;
- nouvelle politique multi-classes.

### Scénarios

- populations configurables dominées par 8/16 Gio, avec une minorité 24/48/64+ Gio ;
- modèles 4B, 8B, 30B/32B, 70B et MoE, avec géométries KV différentes ;
- direct, relay, régions, bande passante et RTT hétérogènes ;
- arrivée et départ en rafale, panne pendant prefill/decode, pression mémoire ;
- demandes courtes, distribution Azure Code et longues sessions agentiques ;
- poids absents, partiellement présents et totalement présents.

### Métriques d'acceptation

- fraction de demandes servies par classe ;
- p50/p95/p99 TTFT et ITL ;
- goodput et concurrence ;
- routes et domaines de panne indépendants par classe ;
- octets de poids téléchargés et rechargements par heure ;
- temps de convergence après churn ;
- KV inutilisé, refus pour contexte et préemptions ;
- fairness et crédit utile par worker.

Le premier déploiement est un **shadow score dans V3** : la nouvelle politique calcule et journalise
sa décision à côté de la décision V3 active sans charger un second runtime et sans réintroduire V2.
Le placement réel ne bascule qu'après comparaison déterministe et simulation de churn.

Le simulateur de charge ne sera pas réécrit à la main. Le projet officiel
`llm-d-inference-sim` fournit déjà files, saturation, TTFT proportionnel aux tokens, ITL, cache KV,
événements ZMQ et injection de pannes. Fabi le combine avec son propre graphe max-flow de spans,
car llm-d simule des répliques vLLM complètes et non une pipeline de couches P2P. L'oracle CP-SAT
reste isolé du runtime : OR-Tools 9.15 dépend de protobuf 6.x tandis que le moteur qualifié dépend de
protobuf 7.x.

## 13. Ordre d'implémentation retenu

1. étendre le manifeste signé avec le profil de contexte explicite ;
2. introduire les classes cumulatives et le résumé de demande versionné ;
3. calculer la frontière locale span/contexte/concurrence ;
4. construire le simulateur et l'oracle CP-SAT ;
5. remplacer le `CapacityDemandMap.uniform` par un déficit calculé sur l'histogramme adaptatif, les
   capacités KV exactes présentes et les objectifs de service signés ;
6. ajouter l'évaluation exacte des meilleurs candidats et le coût de churn ;
7. ajouter le coût d'opportunité de contexte et l'affinité KV au route planner ;
8. valider en shadow V3, puis sur Mac local + Mac mini + RTX ;
9. étendre aux traces RunPod, NAT, churn et milliers de workers simulés ;
10. seulement ensuite autoriser les réallocations autonomes guidées par la demande.

## 14. Sources primaires

- [Petals — placement autonome](https://github.com/bigscience-workshop/petals/blob/22afba627a7eb4fcfe9418c49472c6a51334b8ac/src/petals/server/block_selection.py)
- [Petals — route client et capacité de cache](https://github.com/bigscience-workshop/petals/blob/22afba627a7eb4fcfe9418c49472c6a51334b8ac/src/petals/client/routing/sequence_manager.py)
- [Exo — placement et sélection de cycle](https://github.com/exo-explore/exo/blob/b5375f8cee4368d09e1ce96a56b9f81fb0bc81aa/src/exo/master/placement.py)
- [Exo — répartition pipeline](https://github.com/exo-explore/exo/blob/b5375f8cee4368d09e1ce96a56b9f81fb0bc81aa/src/exo/master/placement_utils.py)
- [Helix — simulateur, MILP et max-flow](https://github.com/Thesys-lab/Helix-ASPLOS25)
- [HexGen — placement hétérogène](https://arxiv.org/abs/2311.11514)
- [vLLM — profilage de mémoire et KV disponible](https://docs.vllm.ai/en/latest/api/vllm/v1/worker/gpu_worker/)
- [SGLang — routage cache-aware et charge](https://github.com/sgl-project/sglang/blob/main/docs/advanced_features/sgl_model_gateway.md)
- [llm-d — routage précis par événements KV](https://github.com/llm-d/llm-d/blob/main/guides/precise-prefix-cache-aware/README.md)
- [llm-d — simulateur d'inférence maintenu](https://github.com/llm-d/llm-d-inference-sim)
- [Qwen3-4B — contexte natif et YaRN qualifié](https://huggingface.co/Qwen/Qwen3-4B)
- [DDSketch — quantiles distribués fusionnables](https://arxiv.org/abs/1908.10693)
- [OpenTelemetry — modèle stable ExponentialHistogram et perfect subsetting](https://opentelemetry.io/docs/specs/otel/metrics/data-model/#exponentialhistogram)
- [OR-Tools CP-SAT — solveur de contraintes](https://developers.google.com/optimization/cp/)
- [OpenCode — overflow après sorties d'outils](https://github.com/anomalyco/opencode/issues/10634)
