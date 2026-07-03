# Fabi Swarm Runpod Validation - 2026-07-01

Objectif: valider le chemin "un utilisateur branche une machine Runpod au swarm" sur le gros swarm `qwen3-coder-30b`, avec reseau public explicite, allocation DP, SGLang, et test OpenAI compatible.

## Verdict court

Le test n'est pas encore valide end-to-end pour une generation 30B.

Mise a jour 2026-07-01 12:48 UTC:

- Tous les pods Runpod lances pour le test sont arretes (`desiredStatus=EXITED`).
- Le test "plusieurs contributeurs reels" doit utiliser des pods avec IP publiques distinctes. Le test precedent avec 3 L40 derriere la meme IP Runpod et ports differents n'est pas un bon proxy P2P: il a expose exactement le probleme `Only relayed connection available`.
- Avec des machines dispersees (A6000 Secure US, L40S Secure NL, 3090 Community FR), le chemin reseau direct vers le scheduler fonctionne quand on force `--initial-peers /ip4/37.59.98.16/tcp/18120/p2p/<scheduler_peer_id>`.
- Le scheduler DP a reussi une vraie allocation Qwen 30B sur 3 nodes a sequence 4k avec memoire annoncee plus agressive: A6000 `[0,20)`, L40S `[20,40)`, 3090 `[40,48)`.
- La generation n'a pas abouti: le 3090 a charge ses poids puis SGLang/FlashInfer a plante pendant la phase CUDA graph/JIT parce que `ninja` n'etait pas installe sur ce pod.
- Donc le blocage de cette deuxieme passe n'est plus le NAT relaye au moment de l'allocation; c'est maintenant l'image worker/preflight et le modele de capacite trop limite.

Ce qui marche:

- Scheduler `qwen3-coder-30b` en DP confirme: `PARALLAX_STRATEGY=dp` et `PARALLAX_ROUTING_STRATEGY=dp`.
- Runpod avec ports TCP publics fonctionne au niveau TCP brut.
- DP alloue correctement `Qwen/Qwen3-Coder-30B-A3B-Instruct` sur 4 pods: 3x L40 + 1x RTX 3090.
- Avec reserve memoire L40 a 30 GB et `--kv-cache-memory-fraction 0.50`, les shards chargent sans OOM.
- Un pipeline complet est arrive a `pipeline_ready=true` / `routing_ready=true` une fois.

Ce qui bloque le produit:

- La premiere requete `/v1/chat/completions` a echoue en `504 GatewayTimeoutError`.
- Le dernier shard a calcule et tente de boucler vers le premier shard, mais Lattica a refuse: `Only relayed connection available`.
- Les workers n'avaient pas de peer ID stable; le scheduler utilise `with_key_path(".")`, les workers non. Correction locale ajoutee dans `swarm-engine/src/parallax/p2p/server.py`.
- Apres relance avec key path stable, un worker a recu son allocation puis le heartbeat suivant a recu `{}` et l'a remis en `joining`; le scheduler a perdu les couches du node.
- Les rebalances/leaves sont trop destructifs: tuer ou relancer un worker peut faire perdre une allocation globale saine.
- `ninja` n'est pas garanti dans l'image/runtime; SGLang peut planter apres chargement des poids.

Conclusion: le coeur DP/capacite est proche, mais le produit n'est pas assez robuste pour public swarm tant que la stabilite peer-id, le join/heartbeat, le routage direct et le rebalance transactionnel ne sont pas corriges.

## Passe Secure/unique-IP du 2026-07-01

But: simuler mieux "plusieurs personnes rejoignent le swarm" en evitant le cas artificiel plusieurs pods derriere la meme IP publique Runpod.

Pods utilises:

| Pod | Type | Region | IP publique | P2P public | Prix | Statut final |
| --- | --- | --- | --- | ---: | ---: | --- |
| `nbt0svl29qk5mf` | RTX 3090 Community | FR | `213.144.200.243` | `10250` | `$0.22/h` | `EXITED` |
| `lbg5cuytnhxf70` | RTX A6000 Secure | US-TX-1 | `38.147.83.30` | `26320` | `$0.49/h` | `EXITED` |
| `8uuyp42bg405fr` | L40S Secure | EU-NL-1 | `91.199.227.82` | `31418` | `$0.99/h` | `EXITED` |
| `l6lsj5pb3q9q9t` | RTX 4090 Secure | EU-RO-1 | `213.173.108.43` apres restart | `12477` | `$0.69/h` | `EXITED`, install incomplet |

Notes Runpod:

- Les ports TCP publics sont des mappings `public_ip:external_port -> container_port`; ils changent apres reset/restart du pod.
- Les IP publiques Community peuvent changer si le pod est migre ou redemarre. Les Secure Cloud sont le meilleur choix Runpod pour un test P2P stable.
- Runpod Global Networking peut servir a tester du pod-to-pod prive dans le meme compte, mais ce n'est pas equivalent au produit public ou chaque contributeur arrive depuis son propre reseau.

Configuration reseau qui a marche pour joindre apres redemarrage scheduler:

```bash
/workspace/parallax-venv/bin/parallax join \
  -u \
  -s 12D3KooWRFj2e4MgiVKqJWqhSxs4HFoge8idTfZHxPTzeHrXPV4Q \
  -r \
  --tcp-port 4001 \
  --announce-maddrs /ip4/<runpod_public_ip>/tcp/<mapped_4001_port> \
  --initial-peers /ip4/37.59.98.16/tcp/18120/p2p/12D3KooWRFj2e4MgiVKqJWqhSxs4HFoge8idTfZHxPTzeHrXPV4Q \
  --enable-prefix-cache \
  --kv-cache-memory-fraction 0.50
```

Conclusion reseau:

- `--announce-maddrs` est necessaire pour que les autres peers voient le port public Runpod, pas le port interne `4001`.
- `--initial-peers` direct vers le scheduler est necessaire en pratique apres restart scheduler. Le DHT/relay seul a laisse les workers boucler sur `No peers found or scheduler peer id not found`.
- Tant qu'on depend d'une route relayee pour le forward pipeline, Lattica peut refuser avec `Only relayed connection available`. Pour le produit, il faut privilegier direct TCP, verifier les dialbacks, et exposer dans le status si un lien critique est direct ou relaye.

## Capacite observee sur Qwen 30B

Model: `Qwen/Qwen3-Coder-30B-A3B-Instruct`, 48 layers.

| Profil | Resultat scheduler |
| --- | --- |
| 3090 17 GB + A6000 30 GB + L40S 30 GB, seq 16k | `failed_capacity`, capacite totale insuffisante |
| 3090 17 GB + A6000 37 GB + L40S 37 GB, seq 16k | encore insuffisant; les 48 GB ne donnent pas 37 GB utiles pour les layers |
| 3090 17 GB + A6000 37 GB + L40S 37 GB, seq 4k | `total_cap=49`, mais allocation globale impossible; le check de capacite est trop optimiste |
| 3090 17 GB + A6000 40 GB + L40S 40 GB, seq 4k | allocation DP reussie |

Allocation DP reussie:

| GPU | Peer | Couches |
| --- | --- | --- |
| A6000 | `12D3KooWQH...` | `[0,20)` |
| L40S | `12D3KooWP...` | `[20,40)` |
| RTX 3090 | `12D3KooWQm5v...` | `[40,48)` |

Interpretation:

- Le `total_cap >= layers` n'est pas suffisant: les shards d'extremite paient aussi l'overhead `input_embed` / `lm_head`, et le scheduler doit le logguer clairement.
- 3 machines peuvent allouer le 30B seulement avec sequence 4k et annonce memoire agressive sur les 48 GB. C'est un profil fragile.
- Pour un test public propre, viser 4 machines ou des cartes 48/80 GB plus confortables. Le 3090 peut aider, mais il ne doit pas etre un shard critique sans preflight strict.

## Incident SGLang/FlashInfer

Sur le 3090, apres allocation `[40,48)`, SGLang a:

- telecharge/charge les poids du shard;
- alloue le KV cache;
- commence la capture CUDA graph;
- plante sur:

```text
FileNotFoundError: [Errno 2] No such file or directory: 'ninja'
```

Cause: l'image/runtime du pod 3090 n'avait pas le binaire systeme `ninja`. Les pods frais A6000/L40S avaient ete bootstrappes avec `apt-get install ninja-build`, mais le 3090 etait un pod reutilise.

Fix produit:

- Preflight bloquant avant `join`: `nvidia-smi`, `python -c 'import torch; torch.cuda.init()'`, import `sglang`, import `lattica`, `which ninja`, test mini CUDA tensor.
- Image Runpod prebuild recommandee: repo clone, venv, SGLang, FlashInfer, `ninja-build`, `nvidia-cusparselt-cu12==0.7.1`, `hf_transfer`.
- Un worker ne doit pas rejoindre le scheduler tant que le runtime local ne peut pas au moins compiler un petit kernel/JIT ou passer un check SGLang minimal.

## Ghost workers et cleanup

Apres plusieurs relances, tuer seulement `parallax join` ou `launch.py` peut laisser des sous-processus Python/SGLang orphelins avec PPID 1. Ils peuvent continuer a heartbeater une ancienne config et polluer le scheduler avec des capacites obsoletes.

Commande de nettoyage utilisee pendant le test:

```bash
pgrep -f "[/]workspace/parallax-venv/bin/python" | xargs -r kill -9
```

Fix produit:

- Lancer le worker dans son propre process group/session.
- A l'arret, tuer tout le process group, pas seulement le parent.
- Cote scheduler, rejeter ou quarantiner un heartbeat dont `run_id`/`worker_session_id` ne correspond plus a la derniere session join valide du peer.
- Ajouter une expiration claire des allocations et des routes quand un worker quitte ou redemarre.

## Infrastructure testee

Scheduler:

- URL status: `https://server.undefinedstudio.fr/fabi-scheduler/qwen3-coder-30b/cluster/status_json`
- OpenAI endpoint: `https://server.undefinedstudio.fr/fabi-scheduler/qwen3-coder-30b/v1/chat/completions`
- Scheduler peer id: `12D3KooWRFj2e4MgiVKqJWqhSxs4HFoge8idTfZHxPTzeHrXPV4Q`
- Container: `parallax-scheduler-qwen3-coder-30b`
- Mode: DP allocation + DP routing.

Pods Runpod utilises:

| Pod | GPU | Prix | Port SSH | Port P2P |
| --- | --- | ---: | ---: | ---: |
| `nbt0svl29qk5mf` | RTX 3090 24 GB | `$0.22/h` | `10292` | `10293` |
| `dycgff9hu812dm` | L40 48 GB | `$0.69/h` | `52210` | `52211` |
| `gc0yxg462hbmgz` | L40 48 GB | `$0.69/h` | `52212` | `52213` |
| `vzm740nnblwdoe` | L40 48 GB | `$0.69/h` | `52215` | `52216` |

Les ports changent apres `stop/start`; ne jamais les hardcoder dans l'app.

## Configuration worker qui tient en memoire

Base:

```bash
export HF_HOME=/workspace/hf
export TRANSFORMERS_CACHE=/workspace/hf
export HF_HUB_ENABLE_HF_TRANSFER=1
export CUDA_VISIBLE_DEVICES=0
export PYTORCH_ALLOC_CONF=expandable_segments:True
export PARALLAX_MAX_NUM_TOKENS_PER_BATCH=8192
export PARALLAX_MAX_SEQUENCE_LENGTH=16384
export PARALLAX_MAX_BATCH_SIZE=4
export PARALLAX_KEY_PATH=/workspace/lattica-key
```

Pour les L40:

```bash
export PARALLAX_WORKER_MEMORY_GB=30
```

Join:

```bash
/workspace/parallax-venv/bin/parallax join \
  -u \
  -s 12D3KooWRFj2e4MgiVKqJWqhSxs4HFoge8idTfZHxPTzeHrXPV4Q \
  -r \
  --tcp-port 4001 \
  --announce-maddrs /ip4/<runpod_public_ip>/tcp/<mapped_4001_port> \
  --enable-prefix-cache \
  --kv-cache-memory-fraction 0.50
```

`--announce-maddrs` est obligatoire pour Runpod: Runpod mappe `4001/tcp` vers un port public aleatoire.

## Allocation DP observee

Bonne allocation stable:

| GPU | Couches |
| --- | --- |
| L40 | `[0,13)` |
| L40 | `[13,26)` |
| L40 | `[26,39)` |
| RTX 3090 | `[39,48)` |

Avec L40 annoncees a leur capacite brute (~36.4 GB utiles), une allocation precedente a donne des shards 16 couches et a OOM. Avec `PARALLAX_WORKER_MEMORY_GB=30`, DP produit un split plus conservateur et charge les shards.

## Test generation

Commande:

```bash
curl -k -sS --max-time 240 \
  https://server.undefinedstudio.fr/fabi-scheduler/qwen3-coder-30b/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"Qwen/Qwen3-Coder-30B-A3B-Instruct","messages":[{"role":"user","content":"Reponds uniquement: OK-SWARM"}],"max_tokens":8,"temperature":0,"stream":false}'
```

Resultat:

```json
{"object":"error","message":"Request stalled (no progress); a pipeline node may be unavailable","type":"GatewayTimeoutError","param":null,"code":504}
```

Log cle cote dernier shard:

```text
RPC call failed: Only relayed connection available for peer <first-shard-peer-id>
```

Interpretation: calcul inter-shards commence, mais le bouclage decode dernier shard -> premier shard n'obtient pas une route directe Lattica acceptable.

## Correctif code applique localement

Fichier: `/Users/noagiannone/Documents/swarm-engine/src/parallax/p2p/server.py`

But: rendre le peer ID worker stable comme le scheduler.

```python
key_path = os.environ.get("PARALLAX_KEY_PATH", "").strip() or "."
os.makedirs(key_path, exist_ok=True)
self.lattica = (
    Lattica.builder()
    .with_listen_addrs(self.host_maddrs)
    .with_key_path(key_path)
)
```

Sans ca, les peer IDs changent a chaque lancement worker, ce qui rend impossible toute table directe fiable et complique la suppression des ghosts.

## Bugs a corriger avant produit public

1. **Worker peer ID instable**: corrige localement via `PARALLAX_KEY_PATH`, a merger et tester.
2. **Routage direct Lattica**: TCP public joignable, mais Lattica choisit/voit parfois seulement une route relayee et refuse le forward pipeline.
3. **Join/heartbeat incoherent**: un worker peut recevoir `Join scheduler response`, puis le heartbeat suivant recoit `{}` et remet le node en `joining`.
4. **Rebalance destructif**: un `Leave scheduler` ou un worker qui OOM peut vider/recalculer les allocations et faire perdre un pipeline partiellement sain.
5. **Capacity model trop optimiste**: L40 brute a 36.4 GB peut OOM; il faut une reserve runtime ou une calibration SGLang.
6. **Dependency preflight manquant**: `ninja-build` doit etre dans l'image ou installe au bootstrap.
7. **CUDA preflight obligatoire**: `nvidia-smi` ne suffit pas; tester `torch.cuda` et un tensor CUDA avant join.
8. **Runpod restart**: ports publics et parfois peer IDs changent si la cle n'est pas persistante; la CLI doit relire les mappings.
9. **Process cleanup**: tuer seulement le parent laisse des sous-processus Python/SGLang. Il faut tuer le process group.
10. **Status UX**: exposer `routing_ready`, couches manquantes, raison standby, et phase exacte download/load/graph.

## Prochaine passe recommandee

1. Merger `PARALLAX_KEY_PATH` worker.
2. Ajouter `ninja-build` au bootstrap/image.
3. Fixer rebalance: ne jamais supprimer l'allocation courante tant que la nouvelle n'est pas valide.
4. Fixer node_update: si un node actif a une allocation, le heartbeat doit toujours la renvoyer.
5. Ajouter un mode Runpod public: detecter `RUNPOD_PUBLIC_IP` + `RUNPOD_TCP_PORT_4001`.
6. Refaire le test avec 4 pods propres, puis tester generation.
7. Ensuite seulement tester un churn volontaire: kill d'un worker, restart, rejoin, verification absence de ghosts.

## References externes utilisees

- Runpod expose des ports TCP via `publicIp` + `portMappings`; les mappings externes sont aleatoires et changent au reset/restart: https://docs.runpod.io/pods/configuration/expose-ports
- L'API Runpod expose aussi `portMappings`, par exemple `{ "22": 10341 }` signifie `<public_ip>:10341 -> :22`: https://docs.runpod.io/api-reference/pods/GET/pods
- Runpod indique que les IP publiques Community peuvent changer apres migration/restart, alors que Secure Cloud est le profil le plus stable pour ce test: https://docs.runpod.io/pods/configuration/expose-ports
- Runpod Global Networking cree un reseau prive pod-to-pod dans un compte Runpod; utile pour debug infra, mais pas representatif du produit public multi-contributeurs: https://docs.runpod.io/pods/networking
- libp2p documente le hole punching/relay comme mecanisme NAT traversal, pas comme garantie de connexion directe. Pour un pipeline tensoriel, il faut traiter "direct vs relayed" comme un signal de sante critique: https://libp2p.io/docs/hole-punching/
- Le test libp2p recommande de simuler explicitement des topologies NAT/relay/direct pour valider le comportement P2P: https://libp2p.io/docs/write-a-hole-punch-test-app/
