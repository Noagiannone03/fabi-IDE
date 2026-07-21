# Fabi Swarm — passage a grande echelle inspire de Petals

Etat : decision d'architecture du 21 juillet 2026. Ce document decrit la cible pour des
milliers de workers repartis entre plusieurs modeles. Il ne declare pas ces mecanismes
implementes ni qualifies.

Documents lies :

- [`HANDOFF-SWARM-2026-07-17.md`](./HANDOFF-SWARM-2026-07-17.md) pour l'etat reel du produit ;
- [`SWARM-FAILOVER-DESIGN.md`](./SWARM-FAILOVER-DESIGN.md) pour le journal de requete, les
  epochs et la reprise exacte en cours de generation ;
- [`ARCHITECTURE-swarm-runtime.md`](./ARCHITECTURE-swarm-runtime.md) pour la distribution du
  runtime Fabi.

## Decision executive

Fabi conserve Parallax comme plan de donnees et moteur d'execution : MLX sur Apple Silicon,
vLLM/SGLang sur GPU, KV pagine, continuous batching et transfert direct des activations.

Fabi doit en revanche construire son propre plan de controle elastique en reutilisant les
principes prouves de Petals : catalogue distribue des spans, placement qui preserve toujours
une couverture complete, stabilite des affectations, choix de route par requete, replicas et
reprise apres disparition d'un serveur.

La cible n'est donc ni « Parallax pur » ni un port de Petals :

```text
                         Fabi control plane
     identite, contribution, catalogue, placement, epochs, routage, reprise
                                  |
                    plans versionnes par modele
                                  |
             +--------------------+--------------------+
             |                                         |
       workers MLX                               workers vLLM/SGLang
   Apple Silicon / memoire                     NVIDIA/AMD / KV page
             |                                         |
             +--------- activations P2P directes ------+
                         plan de donnees Parallax
```

## Pourquoi ne pas remplacer Parallax par Petals

Petals est une meilleure reference pour un reseau Internet tres volatil, mais son objectif
historique est l'inference et le fine-tuning collaboratifs de tres grands modeles via
PyTorch/Transformers et Hivemind. Fabi est un IDE agentique : il lui faut un service moderne,
concurrent, streame, compatible avec des contextes longs, des outils et des backends locaux
heterogenes.

Parallax fournit deja les briques les plus couteuses a reconstruire :

- execution MLX sur Mac et vLLM/SGLang sur GPU ;
- pipeline parallelism entre machines heterogenes ;
- KV cache pagine et continuous batching ;
- scheduler d'allocation et de routage par requete ;
- transport P2P Lattica ;
- modeles modernes, dont Qwen, DeepSeek, Kimi et gpt-oss.

Un fork de Petals aurait simplifie certaines questions d'elasticite, mais il aurait impose de
reconstruire et qualifier ces chemins d'execution, notamment MLX, vLLM Windows natif, les
contrats KV et l'integration OpenCode. La base Parallax reste donc rationnelle ; son plan de
controle doit etre renforce plutot que remplace.

## Hypotheses produit a grande echelle

Le design doit supporter les situations suivantes sans reconfiguration globale :

- des milliers de workers connectes au service Fabi ;
- plusieurs modeles et revisions servis en parallele ;
- plusieurs classes de quantification ou backend pour un meme modele ;
- des workers domestiques qui apparaissent, dorment, changent de reseau ou disparaissent ;
- plusieurs pipelines completes et plusieurs replicas d'une meme plage ;
- des consommateurs geographiquement eloignes ;
- des contextes et reservations KV tres differents ;
- une contribution mesuree reellement, sans confondre worker connecte et worker utile ;
- des schedulers eux-memes repartis, sans point chaud mondial unique.

Un `model swarm` est identifie au minimum par :

```text
model_id
model_revision
tokenizer_fingerprint
weight_format + quantization
dtype
backend_wire_contract
context/RoPE contract
prefill contract
```

Deux workers qui divergent sur un de ces champs ne doivent jamais etre assembles dans la
meme pipeline, meme si le nom Hugging Face affiche est identique.

## Principes repris de Petals

### 1. Separer couverture possedee et plage executee

Le probleme actuel de Parallax vient du fait qu'un worker charge pour `[0, 28)` execute aussi
necessairement `[0, 28)`. Un worker tardif `[4, 28)` ne peut donc pas recevoir les activations
apres la couche 4 tant que le premier worker n'est pas recharge en `[0, 4)`.

La cible Petals-like separe :

```text
hosted_span     = couches dont les poids sont presents et prets
effective_span  = sous-plage executee pour une route/epoch donnee
```

Un Mac pourrait conserver les poids `[0, 28)` mais executer `[0, 4)` pour une requete routee
vers le RTX, tout en executant `[0, 28)` pour une requete locale de secours. Cette evolution
elimine une grande partie des rechargements, mais exige un contrat runtime par requete ; elle
ne peut pas etre obtenue par un simple changement du routeur.

Le plan de route devra transporter :

```text
route_id + epoch
node_id
hosted_span
effective_start + effective_end
next_peer_id
model_contract_hash
kv_contract
```

MLX, vLLM et SGLang devront prouver qu'ils peuvent produire l'activation a
`effective_end` sans executer le suffixe charge. A defaut, le worker conserve le mode shard
fixe actuel et necessite une reconfiguration drainee.

### 2. Catalogue vivant des spans

Petals publie dans une DHT les blocs servis, leur etat et leur debit. Fabi doit reprendre le
principe, sans mettre la DHT sur le chemin des activations :

- chaque worker signe une lease courte de capacite ;
- la lease annonce modele, hosted span, memoire/KV mesurees, backend, disponibilite et region ;
- les heartbeats renouvellent la lease ;
- une lease expiree disparait du catalogue, mais une panne n'efface jamais un journal de
  requete encore recuperable ;
- les activations continuent a circuler directement de worker a worker.

Le catalogue est un ensemble d'observations, pas l'autorite d'une requete. L'autorite reste le
plan de route versionne emis par le scheduler qui a admis la requete.

### 3. Placement qui preserve la couverture

Petals refuse un deplacement de span qui rendrait le swarm disjoint. Fabi doit maintenir le
meme invariant : aucune optimisation ne peut retirer le dernier exemplaire routable d'une
plage necessaire a `[0, L)`.

Avant toute mutation, le scheduler calcule hors ligne :

- la couverture avant/apres ;
- les pipelines completes conservees ;
- les contextes supportes par leur shard le plus faible ;
- la connectivite directe de chaque frontiere ;
- le cout de reload et la capacite perdue pendant la transition ;
- les routes de secours encore disponibles.

La nouvelle allocation n'est publiee que si ces invariants sont satisfaits. Sinon le worker
reste `STANDBY` ou rejoint une pipeline en construction.

### 4. Stabilite et hysteresis

Petals compare le gain de debit attendu avant de remplacer des blocs. Fabi doit eviter toute
oscillation :

- aucune reallocation sur une simple variation instantanee de RAM ou de latence ;
- enveloppe memoire d'un shard immuable pendant une generation ;
- seuil minimal de gain avant de deplacer une pipeline active ;
- cooldown apres une reconfiguration ;
- fenetres glissantes et valeurs lissees pour debit, RTT et disponibilite ;
- un seul plan en transition par pipeline ;
- drain obligatoire des requetes, sauf protocole de migration KV explicitement qualifie ;
- retour au plan precedent si la nouvelle generation ne devient pas `READY` avant le delai.

La pression memoire peut mettre un worker en admission reduite, puis en drain/standby. Elle ne
doit pas provoquer des changements repetes de frontieres de couches.

### 5. Route calculee pour chaque requete

Comme Petals, Fabi choisit une couverture complete au moment de la requete, mais ajoute les
contraintes d'un service agentique :

- contexte demande et sortie reservee ;
- KV restant sur chaque shard ;
- compatibilite du contrat de prefill ;
- liens directs qualifies et bande passante ;
- TTFT estime, debit decode et charge courante ;
- affinite de prefix cache ;
- niveau de reprise (`none`, `restartable`, `recoverable`) ;
- compte contributeur et politique de reciprocite ;
- region et politique de confidentialite.

Le routeur ne selectionne jamais des morceaux individuellement sans construire d'abord une
route cyclique complete et executable. Toute frontiere doit exister dans le contrat runtime,
pas seulement dans un graphe theorique.

### 6. Reprise apres panne

Le travail est specifie dans `SWARM-FAILOVER-DESIGN.md` et reprend directement l'algorithme de
Petals : journal de tokens, historique d'activations optionnel, nouvelle couverture et replay
du KV. Les deux documents partagent les invariants suivants :

- route et sorties marquees par epoch ;
- commit d'un token avant emission SSE ;
- rejet de toute sortie tardive d'une ancienne epoch ;
- replay froid comme premier niveau fiable ;
- journal d'activations et replique chaude comme optimisations ;
- erreur explicite si aucune couverture compatible n'existe.

## Etats d'un worker

Un booleen `active` ne suffit pas a grande echelle. Le control plane doit exposer :

```text
DISCOVERED       identite vue, aucun contrat valide
QUALIFYING       capacite, modele et liens en cours de mesure
STANDBY          compatible mais absent d'une route servable
BUILDING         telechargement/chargement d'un hosted span
WARMING          poids charges, KV/latence/liens en qualification
READY            membre d'au moins une pipeline servable
DRAINING         aucune nouvelle admission, requetes existantes terminees
RECONFIGURING    changement de hosted/effective span versionne
DEGRADED         vivant mais contrat ou lien incomplet
QUARANTINED      echecs repetes, identite ou resultats suspects
OFFLINE          lease expiree
```

La contribution donnant droit a consommer exige `READY` et du travail reel ou une reserve
utile. `DISCOVERED`, `BUILDING` et un shard orphelin ne doivent pas suffire.

## Pools et pipelines stables

Pour ne pas redemarrer le swarm a chaque arrivee, chaque model swarm maintient quatre pools :

1. **Serving pipelines** : routes stables recevant le trafic.
2. **Warm replicas** : couvertures completes chargees, pretes au failover ou au burst.
3. **Pipeline builders** : groupes de nouveaux workers assembles hors trafic jusqu'a couverture
   complete et qualification reseau.
4. **Standby pool** : capacite compatible mais pas encore utile.

Politique d'arrivee d'un worker :

1. verifier identite, contrat modele et enveloppe memoire ;
2. mesurer les liens sans bloquer les heartbeats ;
3. tenter de combler une frontiere manquante d'un builder ;
4. sinon tenter de construire une nouvelle pipeline/replica avec le standby ;
5. sinon conserver le worker en standby ;
6. ne retailler une serving pipeline que si le gain depasse le seuil, que le drain est termine
   et qu'aucune construction non disruptive n'est possible.

Avec beaucoup de workers, le chemin normal devient donc l'ajout de nouvelles pipelines. Le
retaillage Mac `[0,28)` vers Mac `[0,4)` + RTX `[4,28)` reste necessaire dans un laboratoire a
deux machines, mais ne doit pas devenir le comportement mondial par defaut.

## Hierarchie du control plane

Un scheduler VPS unique ne peut pas gerer tous les modeles et tous les heartbeats. La cible est
hierarchique :

```text
Global registry
  modele/revision -> scheduler cells disponibles
                          |
                Model scheduler cell
          catalogue, placement, admission, epochs
              /            |             \
       region Europe   region America   region Asia
            |                |              |
      pipelines + replicas, trafic P2P direct
```

- Le registre global ne voit pas chaque token ni chaque activation.
- Une cellule possede un sous-ensemble de workers et de pipelines d'un modele.
- Une requete est epinglee a une cellule et une epoch jusqu'a sa terminaison.
- Les cellules partagent des resumes de capacite, pas les heartbeats bruts.
- Une election/lease empeche deux cellules de commander simultanement le meme worker.
- Le compte Fabi reste global, mais les credits de contribution sont agreges depuis des preuves
  signees et idempotentes.

Le premier produit peut garder un scheduler central par modele. Les identifiants, leases et
epochs doivent cependant etre concus des maintenant pour permettre ce partitionnement futur.

## Contribution et economie a grande echelle

La contribution ne doit pas etre mesuree uniquement en temps de connexion. Les compteurs
autoritaires sont :

- secondes `READY` dans une couverture utile ;
- tokens/couches reellement executes ;
- octets d'activations transportes ;
- reservations de replica chaude effectivement maintenues ;
- disponibilite et taux de succes ;
- penalites pour deconnexions en cours de requete ou resultats invalides.

Les preuves sont liees a `account_id`, `worker_id`, `route_id`, `epoch` et au contrat modele.
Elles sont bornees, rejouables de maniere idempotente et ne contiennent ni prompt ni activation.

Une politique de reciprocite peut ensuite utiliser des slots bornes inspires de BitTorrent :
priorite aux comptes qui contribuent utilement, reserve minimale pour le bootstrap et mecanisme
d'optimistic unchoking afin qu'un nouveau contributeur puisse prouver sa capacite.

## Securite, confidentialite et NAT

- Une identite de worker est une cle stable, pas une adresse IP.
- Les plans sont signes et limites a une epoch.
- Les workers n'acceptent que les modeles et routes autorises par leur politique locale.
- Les prompts traversent les workers de la route : l'interface doit l'indiquer clairement.
- Les swarms prives utilisent une liste de comptes/peers autorises.
- Les activations ne passent pas par le scheduler.
- Le trafic produit tente direct LAN/public/NAT traversal, puis relay selon une politique de
  performance explicite ; Tailscale reste un outil d'administration du laboratoire.
- Un relay-only lent ne doit pas etre presente comme lien direct qualifie.

## Ce qu'il ne faut pas copier aveuglement de Petals

- Ne pas remplacer vLLM/MLX/SGLang par un backend PyTorch maison.
- Ne pas mettre une DHT eventual-consistent comme autorite des reservations KV.
- Ne pas laisser chaque client choisir une route qui ignore l'admission globale.
- Ne pas router couche par couche : cela multiplierait le graphe, les RPC et les frontieres.
- Ne pas promettre le failover tant que tokenizer, RNG, KV et epochs ne sont pas compatibles.
- Ne pas supposer que les performances publiees sur des modeles 70B/176B s'appliquent a un petit
  modele de code : pour les petits modeles, le cout reseau domine plus vite.

## Plan d'integration progressif

### Phase 0 — rendre Parallax exact et observable

- refuser les shards actifs qui n'appartiennent a aucune route exacte ;
- tester tous les ordres d'arrivee ;
- exposer hosted span, effective span actuel, pipeline ids et motif standby ;
- qualifier le NAT naturel et les longues generations ;
- conserver une allocation immuable pendant une requete.

### Phase 1 — pools stables sans protocole de sous-span

- introduire les etats de worker ci-dessus ;
- construire de nouvelles pipelines depuis le standby ;
- ajouter hysteresis, cooldown et plan/rollback ;
- versionner chaque generation d'allocation ;
- drainer avant tout reload d'un shard fixe.

### Phase 2 — replicas et failover froid

- maintenir au moins une couverture de secours lorsque la capacite le permet ;
- journaliser tokens et commits ;
- kill tests head/middle/tail en prefill et decode ;
- rejouer sur une nouvelle route avec epoch/fencing.

### Phase 3 — catalogue distribue

- leases signees de hosted spans et capacites ;
- sharding des schedulers par modele/region ;
- resume de capacite global ;
- reconciliation apres partition du control plane.

### Phase 4 — effective spans par requete

- prototype MLX capable de s'arreter a une frontiere interne ;
- prototype equivalent vLLM/SGLang ;
- KV indexe par route/epoch/effective span ;
- route contenant ses turning points ;
- conservation des poids lors d'un changement de route ;
- fallback au shard fixe si un backend ne supporte pas le contrat.

### Phase 5 — reprise acceleree

- journal d'activations distribue borne ;
- migration/replay partiel du KV ;
- replicas chaudes optionnelles ;
- politiques par cout, contexte et niveau de service.

## Tests obligatoires avant annonce « grande echelle »

### Simulation deterministe

- 1, 10, 100, 1 000 et 10 000 workers ;
- plusieurs distributions de memoire, latence et churn ;
- au moins 20 model swarms concurrents ;
- aucun trou de couverture pendant une reconfiguration ;
- bornes sur nombre de reloads et volume de heartbeats ;
- absence d'oscillation apres bruit de RAM/RTT ;
- fairness et absence de starvation des petits workers.

### Chaos reel

- arrivees dans tous les ordres ;
- kill pendant download, load, prefill et decode ;
- perte d'un scheduler, partition entre cellules et retour tardif ;
- double heartbeat et vieille allocation rejouee ;
- deux vrais NAT sans Tailscale ;
- relay degrade, changement Wi-Fi/ethernet et adresse IP renouvelee ;
- corruption de token/activation detectee, jamais masquee.

### Charge produit

- prompts OpenCode reels, outils et permissions ;
- melange petits/gros contextes ;
- streaming, abort et changement de modele ;
- TTFT, inter-token latency, tokens/s, taux de reprise ;
- RAM/VRAM/KV, octets P2P et cout de control plane ;
- contribution creditee uniquement aux workers utiles.

## Observabilite minimale

Par modele, cellule, pipeline et worker :

- couverture et facteur de replication par couche ;
- hosted/effective spans et allocation epoch ;
- nombre de pipelines `READY`, `BUILDING`, `DEGRADED` ;
- contexte/KV disponible par route complete ;
- TTFT et debit par backend/frontiere ;
- liens directs/relay, RTT et bande passante ;
- taux de reconfiguration et raisons ;
- temps passe en drain/reload/warmup ;
- echecs, recoveries et sorties tardives fencees ;
- credits de contribution emis.

Une interface operateur doit expliquer pourquoi un worker est standby et ce qui manque pour le
rendre utile. Une interface utilisateur ne doit jamais afficher « contribution active » pour un
worker charge mais absent de toute couverture servable.

## Questions encore ouvertes

- Le premier catalogue distribue doit-il reutiliser la DHT Lattica/libp2p ou un magasin de
  leases separe ?
- Quel backend permet le plus proprement un `effective_end` dynamique sans dupliquer le modele ?
- Quelle granularite de span minimise les reloads sans multiplier les frontieres reseau ?
- Quel seuil de gain justifie de drainer une pipeline active ?
- Comment repartir les comptes et credits entre cellules sans double comptage ?
- Quel niveau de chiffrement/confidentialite peut etre garanti face aux workers qui voient les
  activations ou le prompt initial ?

Ces points exigent prototypes et mesures ; ils ne doivent pas etre tranches par intuition.

## Sources primaires

- [Petals — depot officiel](https://github.com/bigscience-workshop/petals) ;
- [Petals — placement des blocs](https://github.com/bigscience-workshop/petals/blob/main/src/petals/server/block_selection.py) ;
- [Petals — construction des routes](https://github.com/bigscience-workshop/petals/blob/main/src/petals/client/routing/sequence_manager.py) ;
- [Petals — session et reprise](https://github.com/bigscience-workshop/petals/blob/main/src/petals/client/inference_session.py) ;
- [Petals — papier inference/fine-tuning sur Internet](https://arxiv.org/abs/2312.08361) ;
- [Parallax — depot officiel](https://github.com/GradientHQ/parallax) ;
- [Parallax — papier du scheduler deux phases](https://arxiv.org/abs/2509.26182) ;
- [Parallax issue 411 — continuation apres panne](https://github.com/GradientHQ/parallax/issues/411) ;
- [Parallax issue 342 — reservation KV](https://github.com/GradientHQ/parallax/issues/342).

