# Fabi Swarm Protocol v3 — réseau communautaire multi-modèles

Statut : architecture cible, décidée le 23 juillet 2026. Aucun mécanisme décrit ici ne doit
être présenté comme livré tant que sa phase de qualification n'est pas inscrite dans
`HANDOFF-SWARM-2026-07-17.md`.

Ce document est normatif pour la prochaine génération du swarm Fabi. Il remplace la cible de
control plane centralisée de `SWARM-SCALE-PETALS-DESIGN.md`, mais ne remplace ni l'état réel du
handoff, ni les contrats de failover déjà détaillés dans `SWARM-FAILOVER-DESIGN.md`.

## 1. Décision

Fabi construit un seul moteur cohérent, et non deux frameworks empilés :

- **sémantique de swarm Petals** pour la découverte, les leases temporaires, le placement
  autonome de spans, la stabilité face au churn et la reconstruction après panne ;
- **moteur Parallax/Fabi** pour MLX, vLLM/SGLang, le calcul exact de capacité, le pipeline
  parallelism, le KV paginé, le batching et les routes optimisées ;
- **Iroh** comme unique transport applicatif des activations, RPC et transferts de contenu,
  avec chemin direct préféré et relay chiffré disponible ;
- **iroh-blobs** pour distribuer des poids adressés par contenu, vérifiables et reprenables ;
- **rust-libp2p Kademlia** pour le catalogue de leases, derrière le port `DiscoveryStore`.
  Petals/Hivemind fournit les sémantiques de référence et Lattica un donneur MIT utile, mais ni le
  package Hivemind actuel (pas de binaire P2P Windows) ni Lattica entier ne devient une seconde
  stack RPC. Iroh ne fournit pas un catalogue applicatif arbitraire : son Mainline DHT sert à
  retrouver l'adresse d'un endpoint, pas à remplacer ce catalogue ;
- **services Fabi répliqués** pour l'identité, les droits de consommation, la comptabilité et
  l'entrée OpenAI/OpenCode. Ils ne possèdent ni les poids ni l'allocation permanente des
  workers.

Le scheduler monolithique actuel est donc découpé. Il reste de la planification, mais aucune
machine centrale ne donne en permanence toutes les instructions à tout le réseau.

```text
                         catalogue global de modèles
                  manifestes signés + bootstrap des swarms
                                    |
                  +-----------------+-----------------+
                  |                                   |
          swarm modèle A                       swarm modèle B
       DHT de leases éphémères               DHT de leases éphémères
          /       |       \                     /          \
     Mac 8G   PC 16G   GPU 48G             Mac 16G      GPU 24G
       |          |         |                   |            |
       +-- poids/spans prêts et capacités exactes publiées --+
                                    |
                    route planner Fabi répliqué/stateless
             snapshot -> route complète -> réservations atomiques
                                    |
                activations P2P Iroh, direct ou relay mesuré
```

## 2. Ce que « décentralisé » signifie précisément

Décentralisé ne signifie pas « aucune infrastructure » ni « chaque pair fait n'importe quoi ».

- La **découverte** des workers utiles survit à la perte d'un scheduler grâce aux leases DHT.
- Le **placement des poids** est choisi par les workers à partir de l'état partagé ; un
  optimiseur peut conseiller, jamais rendre un worker captif d'un coordinateur disparu.
- La **route d'une requête** est calculée à la demande par n'importe quelle instance compatible
  du route planner.
- L'**admission KV** est autoritaire sur chaque worker, pas dans une vue DHT éventuellement
  périmée.
- Les **activations** circulent directement entre les workers de la route ; elles ne traversent
  pas le catalogue, le registre ou le ledger.
- L'**identité, les droits et les crédits** restent des services cohérents, répliqués et
  auditables. Une DHT ne doit pas décider qu'un compte a payé ou qu'un token a été commité.

Les services Fabi peuvent être indisponibles sans faire perdre les poids déjà téléchargés. Une
nouvelle requête publique peut en revanche être refusée tant que son droit de consommation ne
peut pas être vérifié. C'est un échec sûr, pas une fausse décentralisation.

## 3. Les quatre plans du produit

### 3.1 Plan de découverte

Il contient des données réplicables et temporaires : modèles, fournisseurs de blobs, workers,
spans prêts, capacités et résumés de télémétrie. Il utilise des leases signées avec expiration.
Il tolère les doublons, les retards et des vues momentanément différentes.

### 3.2 Plan de contrôle de requête

Il transforme une demande exacte en route complète, réserve ses ressources, attribue un epoch,
tient le journal de tokens et clôture ou reprend la génération. Il est distribué entre plusieurs
route planners, mais une requête donnée a un coordinateur et un epoch uniques.

### 3.3 Plan de données

Il transporte poids et activations :

- iroh-blobs pour les fichiers/shards de poids adressés par BLAKE3 ;
- RPC/streams Iroh versionnés pour le prefill, le decode, l'abort et les heartbeats de session ;
- MLX, vLLM ou SGLang derrière un contrat d'exécution commun.

### 3.4 Plan économique et de confiance

Il agrège des reçus signés de travail utile, applique la réciprocité, limite les abus et gère le
pairing de machines. Il ne reçoit jamais les prompts ou les activations.

## 4. Un swarm par contrat de modèle, pas seulement par nom

Un `ModelSwarmId` est le hash canonique de :

```text
model_id + immutable_revision
architecture_graph_hash
tokenizer_hash
weight_manifest_hash
weight_format + quantization + dtype
rope_and_context_contract
attention_and_kv_contract
prefill_and_chunking_contract
wire_protocol_version
```

`Qwen/foo@main` n'est jamais une identité suffisante. Deux quantifications ou deux tokenizers
différents forment deux swarms distincts, même si l'IDE les regroupe visuellement comme variantes
du même modèle.

Le catalogue global publie pour chaque variante : licence, taille, contexte théorique, santé,
nombre de routes prêtes, régions, débit observé et exigences minimales. Un manifeste est signé
par les mainteneurs autorisés et toutes ses pièces de poids sont hashées.

## 5. Tout ordinateur contribue, mais pas forcément au même rôle

Il n'existe pas de seuil commercial arbitraire du type « moins de 8 Gio = inutile ». Il existe
cependant des minima physiques : un exécuteur doit contenir au moins une unité indivisible du
graphe, son workspace et un KV minimal. Fabi ne mentira pas sur cette contrainte.

Un worker annonce un ou plusieurs rôles :

1. **Executor** : héberge et exécute un ou plusieurs spans de couches.
2. **Frontend/head** : embeddings, tokenizer ou tête de sortie si le contrat le permet.
3. **Weight seeder** : distribue des blobs de poids déjà présents sur disque.
4. **Relay contributor** : fournit de la bande passante Iroh dans une région.
5. **Warm replica** : conserve un span prêt pour le burst ou le failover.
6. **Verifier/auditor** : rejoue ponctuellement des calculs de contrôle.

Une petite machine peut donc :

- exécuter une couche d'une variante quantifiée si elle tient réellement ;
- rejoindre un modèle plus petit ;
- servir les poids sans les charger ;
- contribuer du réseau ou une réplique froide.

Les crédits reflètent le travail utile et son coût. Un seeder ou relay n'obtient pas
automatiquement le même tarif qu'un shard de decode saturé, mais il n'est pas considéré comme
« non contributeur ».

## 6. Mesure locale de capacité

Le worker mesure avant toute annonce, puis surveille sans modifier un contrat en cours de
requête.

### 6.1 Enveloppe hôte

L'enveloppe mémoire utilisable est dérivée de métriques natives par OS et backend : mémoire
réellement disponible, pression, swap/pagefile, mémoire GPU/unifiée, allocations du runtime et
réserve adaptative Fabi. La mémoire physique totale n'est jamais annoncée comme disponible.

```text
usable_now = min(os_available_after_reserve,
                 backend_allocatable,
                 user_limit)

stable_envelope = hysteresis(rolling_low_quantile(usable_now))
```

Une baisse brève de mémoire bloque de nouvelles admissions. Elle ne redécoupe pas les poids
pendant une génération. Une pression durable déclenche successivement `ADMISSION_REDUCED`,
`DRAINING`, puis seulement une nouvelle offre de capacité.

### 6.2 Capacité d'un span

Pour chaque candidat `[start, end)` :

```text
required = exact_weight_bytes(start, end)
         + backend_workspace_bytes(start, end)
         + endpoint_bytes_if_needed
         + rounded_kv_bytes(start, end, requested_tokens, block_geometry)
```

Le calcul utilise les index réels du checkpoint et la géométrie KV mesurée par l'exécuteur. Une
estimation ne peut servir qu'à prévisualiser un téléchargement ; elle n'admet jamais une route.

Le worker publie des octets et la géométrie de bloc. Les `kv_tokens` affichés sont dérivés pour
un contrat de modèle précis, jamais copiés entre modèles.

## 7. Enregistrements du protocole

Tous les enregistrements sont encodés canoniquement, bornés en taille et signés par l'identité
Ed25519 du worker ou du service émetteur.

### 7.1 `ModelManifest`

```text
swarm_id, protocol_version, graph, layer_boundaries
tokenizer_hash, weight_collection_hash, piece_hashes
supported_backends, quantization, context_contract
publisher_id, issued_at, expires_at, signature
```

### 7.2 `WorkerOffer`

```text
worker_id, account_attestation, endpoint_id
os, architecture, backend, runtime_version
stable_memory_envelope, execution_granularity
supported_roles, local_policy, region_hint
offer_seq, expires_at, signature
```

Il ne contient pas une allocation de couches. Il décrit ce que la machine est capable et
disposée à fournir.

### 7.3 `SpanLease`

```text
swarm_id, worker_id
hosted_span, state = BUILDING | WARMING | READY | DRAINING
weight_hashes, measured_compute, kv_geometry
available_kv_bytes_snapshot, max_sessions
reachable_successors_summary, expires_at
lease_seq, signature
```

Le DHT peut servir à trouver ce lease. Le compteur `available_kv_bytes_snapshot` aide le routing
mais ne constitue jamais une réservation.

### 7.4 `RoutePlan`

```text
request_id, route_id, epoch, swarm_id
prompt_tokens, reserved_output_tokens, rounded_context_by_stage
ordered stages(worker_id, hosted_span, effective_span, next_endpoint)
prefill_contract, sampling_contract, recovery_level
reservation_deadline, plan_expiry, coordinator_id, signature
```

### 7.5 `ReservationLease`

```text
reservation_id, request_id, epoch
worker_id, effective_span, exact_kv_bytes
state = PREPARED | COMMITTED | RELEASED | EXPIRED
expires_at, worker_signature
```

### 7.6 `ContributionReceipt`

```text
receipt_id, account_id, worker_id, swarm_id
route_id, epoch, role, work_units
started_at, completed_at, peer_acknowledgements
result_digest, issuer_signature
```

Les reçus sont idempotents et ne contiennent aucune donnée utilisateur.

## 8. Arrivée d'un worker : placement Petals amélioré

Le chemin normal n'est plus « rejoindre le scheduler et attendre ses ordres ».

1. L'utilisateur choisit un modèle ou autorise Fabi à choisir le swarm le plus utile parmi ses
   modèles acceptés.
2. Le worker vérifie le manifeste et calcule son enveloppe exacte.
3. Il récupère un snapshot des `SpanLease` du modèle et de sa région réseau.
4. Il détermine tous les spans contigus qu'il peut réellement héberger.
5. Il classe les candidats par déficit de capacité utile, comme Petals, puis par nombre de
   nouvelles routes complètes, débit, proximité, coût de téléchargement et stabilité.
6. Il ajoute un jitter déterministe lié à son identité afin que cent nouveaux workers ne
   choisissent pas simultanément le même trou.
7. Il publie un lease `BUILDING`, récupère les blobs depuis plusieurs seeders, vérifie leurs
   hashes, charge le backend et mesure le span.
8. Il ne publie `READY` qu'après un RPC d'exécution, une mesure KV et au moins un lien de sortie
   utilisable vers une continuation potentielle.

### 8.1 Invariant de couverture

Un worker `READY` ne quitte jamais le dernier exemplaire d'une plage sans :

- passer d'abord en `DRAINING` ;
- attendre la fin de ses réservations ;
- observer un autre lease `READY` compatible ;
- ou accepter que le swarm devienne explicitement dégradé après une panne non coopérative.

Le code Petals qui refuse un déplacement rendant le swarm disjoint est repris comme invariant,
pas copié aveuglément comme unique score.

### 8.2 Pas de réallocation permanente

Le placement ne change que si toutes les conditions sont vraies :

- gain minimal durable sur une fenêtre glissante ;
- couverture préservée ;
- cooldown expiré ;
- coût de reload amortissable ;
- aucune requête active, sauf migration explicitement qualifiée.

L'optimiseur Parallax publie un `CapacityDemandMap` par modèle/région : déficit de débit, de KV et
de réplication par intervalle. C'est un conseil calculé depuis le catalogue, pas une commande.
Les workers convergent vers ces besoins avec la politique Petals et l'hystérésis Fabi.

## 9. Sélection d'une route par génération

Il n'existe plus de contexte global 16k ou 32k pour tout le swarm. Chaque requête demande :

```text
required_tokens = prompt_token_count + reserved_output_tokens
```

Le route planner procède en deux étages.

### 9.1 Filtre de faisabilité

Il élimine tout span qui ne respecte pas :

- le même `ModelSwarmId` et le même contrat wire ;
- une lease `READY` non expirée ;
- la capacité KV exacte requise après arrondi local ;
- les limites de batch/prefill du backend ;
- un chemin Iroh joignable vers les continuations ;
- la politique de confidentialité et les droits de la requête ;
- le niveau de reprise demandé.

Si une couverture complète `[0, L)` n'existe pas, la requête est refusée immédiatement avec le
motif précis : contexte trop grand, capacité occupée, couche manquante, lien impossible ou contrat
incompatible.

### 9.2 Optimisation Parallax sur le graphe restant

Le planner construit un DAG de spans contigus. Une arête existe seulement si la frontière est
exécutable et le lien qualifié. Le coût utilise des mesures séparées :

- TTFT estimé du prefill ;
- inter-token latency estimée du decode ;
- nombre de frontières ;
- bande passante et RTT par lien ;
- coût direct/relay ;
- charge et KV restants ;
- risque de panne et redondance disponible ;
- affinité de prefix cache ;
- fairness entre workers utiles.

Les contraintes dures sont appliquées avant le score. Une latence faible ne peut jamais compenser
un KV insuffisant ou une frontière non joignable. Le DP de Parallax est réutilisé sur les spans,
avec des labels Pareto bornés lorsque TTFT et decode ne peuvent pas être réduits à un seul coût
additif fiable.

La sortie est toujours une route complète. Le planner ne réserve jamais des workers isolés en
espérant compléter la chaîne plus tard.

## 10. Admission sans réservation centrale : prepare/commit

La DHT est éventuellement cohérente ; elle ne peut donc pas empêcher deux planners de voir les
mêmes octets KV libres. L'autorité est chaque worker.

1. Le planner envoie `PREPARE(route, exact_kv_bytes, ttl)` en parallèle à tous les stages.
2. Chaque worker sérialise localement l'admission et répond par un `ReservationLease` signé.
3. Si tous répondent `PREPARED`, le planner envoie `COMMIT` à tous.
4. Si un stage refuse ou expire, le planner envoie `RELEASE` aux autres et recalcule une route.
5. Un worker ne lance aucun prefill avant le `COMMIT` de la même route et du même epoch.
6. Les leases expirent automatiquement si le coordinateur meurt.

Ce n'est pas une transaction distribuée générale : aucune donnée durable n'est modifiée. Les
opérations sont idempotentes et les ressources provisoires ont un TTL borné. Le protocole évite
donc un consensus global sur chaque token tout en empêchant la surallocation locale.

## 11. Hosted span et effective span

Petals peut utiliser seulement une sous-partie d'un span hébergé dans une route. Fabi adopte le
même contrat :

- `hosted_span` : poids présents et chauds sur le worker ;
- `effective_span` : sous-plage réellement exécutée pour cette requête.

Exemple : un Mac conserve `[0, 28)` pour une route de secours mais exécute `[0, 4)` dans une route
Mac -> RTX `[4, 28)`. Cela évite de recharger le Mac lorsque le RTX arrive.

Cette capacité doit être implémentée et testée séparément dans MLX, vLLM et SGLang. Tant qu'un
backend ne sait pas s'arrêter proprement à une frontière interne, il annonce
`effective_span_mode=fixed` et le planner ne lui invente aucune sous-plage théorique.

## 12. Chemin d'une génération OpenCode

1. L'IDE choisit une variante de modèle et affiche la santé réelle de son swarm.
2. Le client envoie le prompt au gateway Fabi avec la sortie maximale réservée.
3. Le gateway vérifie le droit de consommation et tokenise selon le manifeste immuable.
4. Un route planner construit puis réserve la route.
5. Le premier stage reçoit les ids de tokens et le `RoutePlan` signé.
6. Les activations passent stage par stage sur des streams Iroh authentifiés.
7. Le head/tail commit chaque token dans le journal avant son émission SSE.
8. Heartbeats de session, métriques et annulation utilisent des streams séparés ; une longue
   génération ne bloque jamais la liveness.
9. À la fin ou à l'abort, tous les stages libèrent leur KV et émettent leurs reçus de travail.

Le gateway peut rester le point d'entrée HTTP/OpenAI sans devenir le chemin des activations.

## 13. Pannes et churn

### 13.1 Avant admission

Une lease expirée ou un RPC de préparation refusé provoque simplement un nouveau calcul. Aucun
plan incomplet n'est rendu visible.

### 13.2 Pendant une génération

Le contrat de `SWARM-FAILOVER-DESIGN.md` reste applicable :

- CAS vers un nouvel epoch ;
- fencing des sorties tardives ;
- recherche d'une couverture compatible ;
- replay froid depuis les ids de tokens comme premier niveau correct ;
- journal d'activations puis réplique chaude comme optimisations ;
- erreur explicite si aucune route n'existe.

Le comportement Petals de reconstruction des caches est la référence algorithmique. Fabi ajoute
le commit-before-SSE, les epochs et les réservations explicites nécessaires à un service agentique.

### 13.3 Perte du route planner

Les réservations non commitées expirent. Pour une requête active, le journal répliqué permet à
une autre instance de reprendre le rôle de coordinateur avec un nouvel epoch. Tant que ce journal
n'est pas implémenté, la garantie honnête reste : génération terminée en erreur et KV libéré.

## 14. Distribution P2P des poids

Les poids ne doivent pas être retéléchargés uniquement depuis Hugging Face par chaque worker.

- Le manifeste découpe les fichiers en collections/blobs adressés par BLAKE3.
- Les fournisseurs publient des `BlobProviderLease` dans le catalogue du modèle.
- iroh-blobs fournit le streaming vérifié, les ranges et la reprise de téléchargement.
- Le downloader peut interroger plusieurs fournisseurs, mesurer leur débit et changer de source.
- Hugging Face ou un miroir Fabi reste une source d'origine, jamais l'unique chemin requis une
  fois les pièces présentes dans le swarm.
- Un blob n'est exposé au backend qu'après vérification complète de son hash et du manifeste.

On reprend ici les principes Bitswap — contenu adressé, `want/have`, fournisseurs — sans
réimplémenter son protocole de transfert : iroh-blobs fournit déjà le transfert vérifié adapté à
notre transport. Le catalogue fournit la découverte de fournisseurs qui manque volontairement à
iroh-blobs seul.

## 15. NAT, direct et relay

Chaque peer est identifié par sa clé Iroh, jamais par une IP stable.

- Direct QUIC est préféré lorsque le hole punching réussit.
- Le relay chiffré reste une route valide et mesurée lorsque le direct est impossible.
- Le score sépare RTT, bande passante, perte et type de chemin.
- Les gros transferts de prefill évitent un relay lent si une autre route complète existe.
- Les petits messages de decode peuvent accepter un relay si le SLO et la redondance restent
  meilleurs.
- Plusieurs relays régionaux, quotas, métriques et failover sont obligatoires avant production.

Le résultat négatif Lattica/DCUtR du laboratoire n'est donc plus un cas impossible : Iroh a déjà
qualifié le fallback relay entre ces NAT. La génération modèle complète sur ce transport reste un
gate séparé du handoff.

## 16. Contribution pour consommer

Le droit de consommation n'est plus un simple booléen « process worker connecté ».

Les unités créditables comprennent :

- couche-token exécutée, pondérée par le coût mesuré ;
- octet d'activation ou de poids utilement servi ;
- seconde de réplique chaude réellement nécessaire ;
- disponibilité d'un span qui ferme une route complète ;
- relay utile avec débit et disponibilité ;
- succès, stabilité et qualité des résultats.

Un worker orphelin qui ne complète aucune route peut recevoir un petit crédit de bootstrap borné,
pas un crédit illimité. À l'inverse, le seul petit worker qui ferme une couche manquante peut être
plus utile qu'un gros replica redondant.

La politique s'inspire de BitTorrent : priorité à la réciprocité récente, fenêtre glissante et
`optimistic unchoking` pour permettre aux nouveaux pairs de prouver leur valeur. Elle n'utilise
pas un token blockchain ni une preuve de calcul inventée tant que le modèle de menace ne l'exige
pas.

## 17. Sécurité et confidentialité

- Identités Ed25519 persistantes et pairing explicite avec un compte.
- Manifestes, leases, plans et reçus signés avec protection anti-replay.
- Hashes de poids vérifiés avant chargement.
- Protocoles Iroh séparés par ALPN et versions strictes ; tailles bornées avant allocation.
- Aucun `pickle` ou objet Python arbitraire sur le wire.
- Rate limits par identité, compte, modèle et relay.
- Quarantaine après résultats incohérents, échecs répétés ou annonces impossibles.
- Audits probabilistes et duplication ponctuelle pour détecter les workers malveillants ; la
  vérification complète de chaque token doublerait le coût et n'est pas promise.
- Le chiffrement protège le transport, pas le calcul chez le worker. Le premier stage peut voir
  les tokens et les autres voient des activations. Cette limite doit être visible dans l'IDE ; les
  swarms privés restent nécessaires pour les secrets.

## 18. Passage à des milliers de workers

Une DHT contenant une entrée par couche et par worker devient trop bavarde. Fabi publie un lease
par span et des index compacts par modèle/région. Les heartbeats renouvellent un numéro de lease,
pas une copie complète de toutes les métadonnées.

Le réseau est partitionné logiquement :

```text
global model registry
  -> swarm id
       -> region/cell summaries
            -> span leases and blob providers
```

- Les route planners interrogent d'abord les résumés puis les cellules pertinentes.
- Les heartbeats bruts ne remontent pas mondialement.
- Une route reste en général dans une région ; le cross-region est un fallback ou une solution
  pour modèle très rare.
- Les plans sont calculés à partir de snapshots immuables et validés par `PREPARE`.
- Le churn d'un petit worker ne provoque aucune réallocation mondiale.

Le passage à l'échelle doit être démontré par simulation à 1, 10, 100, 1 000 et 10 000 workers,
puis par chaos réel. Le papier Parallax mesure le coût du scheduler jusqu'à 256 GPU, pas un réseau
public réel de cette taille ; le papier Petals démontre un vrai swarm plus petit. Aucun des deux
ne suffit seul comme preuve produit.

## 19. Ce que nous reprenons, adaptons ou remplaçons

| Brique | Décision |
|---|---|
| Petals `choose_best_blocks` | Adapter au déficit de routes/KV/région, conserver l'idée de placement autonome |
| Petals DHT + TTL | Reprendre les leases/TTL/validateurs ; implémenter le catalogue avec rust-libp2p Kademlia derrière `DiscoveryStore` |
| Petals route min-latency | Remplacer le score simple par le DAG et la télémétrie Parallax/Fabi |
| Petals cache admission | Reprendre l'allocation exacte, ajouter `PREPARE/COMMIT` et blocs KV backend |
| Petals replay après panne | Reprendre l'algorithme, ajouter journal, epochs et commit-before-SSE |
| Petals PyTorch runtime | Ne pas reprendre |
| Parallax MLX/vLLM/SGLang | Conserver et isoler derrière `ExecutionBackend` |
| Parallax DP/water-filling | Réutiliser pour hints de placement et route planning, pas comme autorité globale |
| Parallax scheduler monolithique | Décomposer puis retirer du chemin permanent |
| Lattica RPC/Bitswap | Remplacer par Iroh RPC + iroh-blobs après qualification |
| Fabi memory envelope | Conserver, rendre la capacité par span et par backend |
| Fabi contribution gate | Conserver l'intention, remplacer le booléen par reçus de travail |

### 19.1 Choix du DHT après audit des implémentations

L'audit du 23 juillet 2026 a invalidé l'idée d'utiliser directement Hivemind dans tous les
workers. Son packaging courant embarque `p2pd` pour Darwin et Linux en amd64/arm64, mais son
sélecteur de plateforme rejette Windows. Cela contredit l'exigence fondamentale de Fabi : un PC
Windows RTX doit être un pair natif de première classe. Les algorithmes Petals/Hivemind restent
la référence pour les TTL, sous-clés, validateurs et annonces périodiques, pas la dépendance
runtime universelle.

Lattica confirme que rust-libp2p Kademlia, les provider records et les bindings Python sont une
voie multiplateforme réaliste. Il ne faut cependant pas copier sa branche courante aveuglément :
son `LatticaBehaviour` actif construit un `MemoryStore`, tandis que son `MultiStore` persistant
n'est pas branché à ce comportement et mélange actuellement une expiration encodée en
nanosecondes avec une reconstruction en secondes. Importer Lattica entier réintroduirait aussi
RPC, relay, DCUtR, Gossipsub et Bitswap en concurrence avec Iroh.

La décision est donc :

1. un port métier `DiscoveryStore` indépendant du réseau ;
2. une implémentation de référence mémoire pour tests, simulation et shadow mode uniquement ;
3. un adaptateur natif rust-libp2p Kademlia minimal dans `fabi-network`, avec TTL, réplication,
   quorum, limites de taille et validation de signatures explicitement configurés. L'identité
   libp2p est persistante ; les capacités restent volontairement en mémoire et sont restaurées
   par réplication/heartbeat, afin qu'un disque ne ressuscite jamais une vieille capacité ;
4. Iroh reste l'unique plan de données pour RPC, activations, relay et contenu ;
5. aucune capacité publiée dans le DHT n'est une réservation : `PREPARE/COMMIT` local reste
   autoritaire.

Avant activation réseau, l'identité applicative Fabi doit signer les envelopes et lier
explicitement le `worker_id`, l'EndpointId Iroh et le PeerId libp2p. Les secrets de deux
protocoles ne seront pas réutilisés implicitement. Une rotation de clé et une révocation de
device doivent pouvoir invalider ce lien sans changer le hash d'un modèle.

## 20. Interfaces internes cibles

```text
DiscoveryStore
  publish_manifest(record)
  publish_offer(record)
  publish_span_lease(record)
  publish_link(record)
  snapshot(swarm_id, instant)
  query_blob_providers(content_hash)

PlacementPolicy
  feasible_spans(worker_offer, model_manifest)
  choose_span(snapshot, demand_map, local_policy)
  should_move(current, candidate, stability_window)

RoutePlanner
  plan(request_contract, discovery_snapshot)
  reserve(route_plan)
  replan(failure, journal, next_epoch)

ExecutionBackend
  measure_envelope(model_contract)
  load(hosted_span)
  prepare(reservation, effective_span)
  prefill(session, token_ids)
  decode(session, committed_token)
  abort(session)

ContentStore
  import_and_hash(path)
  provide(hash)
  fetch(hash, providers, ranges)
```

Ces interfaces empêchent de recoller du code Petals Python directement dans les backends ou de
faire dépendre Iroh d'une décision de scheduling.

## 21. Migration depuis le produit actuel

### Phase A — figer les contrats et préserver le laboratoire

- Conserver la pipeline Lattica qualifiée comme rollback.
- Finir la qualification modèle complète Iroh sur Mac mini + RTX.
- Transformer les structures actuelles `Node` en schémas versionnés sans changer le routing.
- Terminer ou isoler le patch de contexte global en cours : il ne doit pas devenir la cible v3.

Gate : mêmes générations, SSE, abort, heartbeats et mémoire que le runtime qualifié.

### Phase B — route par requête et admission distribuée sur registre central

- Introduire `RoutePlan`, `ReservationLease`, epochs et prepare/commit.
- Calculer le contexte exact par route.
- Conserver temporairement le registre central actuel pour réduire le nombre de variables.

Gate : concurrence, refus KV, expiration, retry et aucune surallocation sous chaos.

### Phase C — catalogue Petals/rust-libp2p en shadow mode

- Publier `WorkerOffer` et `SpanLease` signés en parallèle du scheduler actuel.
- Comparer systématiquement snapshot central et snapshot DHT.
- Ne router aucun trafic depuis la DHT avant convergence mesurée.

Gate : churn, expiration, partition et 1 000 workers simulés sans fuite de lease.

### Phase D — placement autonome

- Implémenter la politique Petals étendue et les `CapacityDemandMap`.
- Construire les nouveaux spans hors trafic.
- Drainer les anciens spans avec hystérésis et invariant de couverture.

Gate : tous les ordres d'arrivée, zéro oscillation, zéro trou volontaire de couverture.

### Phase E — effective spans et routes décentralisées

- Ajouter les frontières dynamiques backend par backend.
- Faire calculer les routes par plusieurs planners interchangeables.
- Retirer l'autorité d'allocation permanente du scheduler historique.

Gate : route identique à snapshot identique, réservations sûres sous planners concurrents.

### Phase F — poids P2P et multi-modèles

- Ajouter iroh-blobs, manifestes et leases fournisseurs.
- Démarrer deux puis vingt swarms avec budgets disque/mémoire.
- Qualifier changement de modèle, éviction, reprise de téléchargement et source malveillante.

### Phase G — failover et économie

- Replay froid, journaux, fencing puis accélérations KV.
- Reçus de contribution et réciprocité progressive.
- Audits, réputation et pairing multi-machine.

## 22. Tests de définition de « produit prêt »

### Propriétés déterministes

- Une route couvre chaque couche exactement une fois dans l'ordre.
- Aucun stage n'accepte plus de KV que son enveloppe locale.
- Une lease DHT périmée ne peut pas créer une réservation.
- Une vieille epoch ne peut ni émettre un token ni gagner un crédit.
- Le départ d'un pair n'entraîne pas de reload non lié.
- Aucun déplacement volontaire ne supprime la dernière couverture prête.
- Un worker de faible capacité n'est jamais rejeté avant évaluation de tous ses rôles.

### Simulation

- 20 modèles et variantes ;
- 10 000 workers hétérogènes ;
- distributions réelles de RAM, VRAM, débit, RTT, NAT et disponibilité ;
- arrivées en rafale, churn, partitions DHT et planners concurrents ;
- demandes de 1 token jusqu'à la limite réelle de chaque route ;
- mesure du nombre de reloads, de la convergence, de la fairness et du control traffic.

### Chaos réel

- Mac, Windows et Linux sur plusieurs NAT ;
- direct, relay, perte du relay et changement de chemin en session ;
- kill head/milieu/tail pendant download, warmup, prepare, prefill et decode ;
- crash du planner entre `PREPARE` et `COMMIT` ;
- DHT inaccessible avec sessions existantes ;
- blobs corrompus, manifeste révoqué et worker menteur ;
- changement de modèle OpenCode, outils, permissions, SSE et abort.

## 23. Limites honnêtes

- Ajouter des workers augmente la couverture, les répliques et le débit global ; une requête
  reste une pipeline séquentielle et ne devient pas infiniment rapide.
- Trop de petits stages sur Internet peuvent être plus lents qu'un nombre réduit de gros stages.
- Un worker qui ne tient aucune unité calculable d'un modèle ne peut pas exécuter ce modèle, mais
  peut contribuer autrement.
- Le relay rend le réseau universellement joignable, pas gratuitement rapide.
- Le replay d'un long contexte après panne peut coûter plusieurs secondes ou minutes.
- Les workers d'un swarm public traitent des données intermédiaires ; le chiffrement de transport
  n'est pas du calcul confidentiel.
- Ni Petals ni Parallax n'a démontré un produit public fiable à des milliers de workers. Cette
  preuve appartient à Fabi.

## 24. Sources primaires relues

- [Petals — dépôt officiel](https://github.com/bigscience-workshop/petals)
- [Petals — placement autonome des blocs](https://github.com/bigscience-workshop/petals/blob/22afba627a7eb4fcfe9418c49472c6a51334b8ac/src/petals/server/block_selection.py)
- [Petals — catalogue DHT et leases](https://github.com/bigscience-workshop/petals/blob/22afba627a7eb4fcfe9418c49472c6a51334b8ac/src/petals/utils/dht.py)
- [Petals — construction de routes](https://github.com/bigscience-workshop/petals/blob/22afba627a7eb4fcfe9418c49472c6a51334b8ac/src/petals/client/routing/sequence_manager.py)
- [Petals — reprise de session](https://github.com/bigscience-workshop/petals/blob/22afba627a7eb4fcfe9418c49472c6a51334b8ac/src/petals/client/inference_session.py)
- [Petals — cache mémoire autoritaire](https://github.com/bigscience-workshop/petals/blob/22afba627a7eb4fcfe9418c49472c6a51334b8ac/src/petals/server/memory_cache.py)
- [Petals — papier système](https://arxiv.org/abs/2209.01188)
- [Petals — papier tolérance aux pannes et load balancing](https://arxiv.org/abs/2312.08361)
- [Hivemind — DHT pour volontaires](https://github.com/learning-at-home/hivemind)
- [rust-libp2p — implémentation Kademlia](https://docs.rs/libp2p/latest/libp2p/kad/index.html)
- [libp2p — spécification Kademlia](https://github.com/libp2p/specs/blob/master/kad-dht/README.md)
- [Lattica — dépôt officiel MIT](https://github.com/GradientHQ/lattica)
- [Parallax — dépôt officiel](https://github.com/GradientHQ/parallax)
- [Parallax — scheduler deux phases](https://arxiv.org/abs/2509.26182)
- [Iroh — connexions, NAT et relays](https://docs.iroh.computer/about/faq)
- [iroh-blobs — contenu adressé et streaming vérifié](https://docs.iroh.computer/protocols/blobs)
- [IPFS Bitswap — want/have et découverte des fournisseurs](https://docs.ipfs.tech/concepts/bitswap/)
- [BitTorrent BEP 3 — pièces, annonces et choking](https://www.bittorrent.org/beps/bep_0003.html)
