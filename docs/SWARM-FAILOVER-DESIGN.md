# Fabi Swarm — conception de la reprise exacte en generation

Etat : décision d'architecture du 18 juillet 2026, remplacée le 29 juillet 2026 par le chemin
Request Agent V3 de `swarm-engine` `853a3db411e3c76f8e71ae227fba53760302a3fe`. Le replay froid
exact, le journal durable et la replanification depuis la DHT sont validés localement. La
qualification sur de vraies machines avec une couverture de remplacement reste à faire ; ce
document ne déclare donc pas encore la reprise qualifiée au laboratoire.

## Objectif et garantie

Lorsqu'un worker quitte une pipeline pendant le prefill ou le decode, Fabi doit conserver
tous les tokens deja valides, choisir une couverture de couches compatible, reconstruire le
KV necessaire et reprendre sans dupliquer ni perdre de token dans le flux SSE.

La garantie est volontairement stricte :

- `recoverable` décrit la capacité de rejouer exactement une requête déterministe, pas la
  disponibilité garantie d'une route de remplacement au moment de la panne ;
- aucune route de secours n'est pré-réservée : après une panne, le Request Agent cherche une
  nouvelle couverture complète dans un snapshot DHT frais ;
- modele, revision, tokenizer, dtype, taille de bloc et contrat de prefill doivent coincider ;
- un token n'est visible au client qu'apres son commit dans le journal de requete ;
- toute sortie d'une ancienne epoch est ignoree ;
- sans remplacement compatible, la requete se termine par une erreur explicite ;
- aucune continuation n'est fabriquee depuis un KV partiel ou un texte re-tokenise.

## Reference reutilisee

Petals ne se contente pas de relancer une requete HTTP. Son client conserve, pour chaque
span distant, l'historique complet des hidden states d'entree. Lorsqu'un serveur echoue, il
selectionne une nouvelle couverture, transfere cet historique au premier span de remplacement
et regenere les caches d'attention. L'implementation relue se trouve dans
`petals/client/inference_session.py` au commit `22afba6` du depot officiel. Le papier NeurIPS
decrit l'algorithme a doubles caches et montre qu'il reste utilisable quand les serveurs sont
instables.

Fabi reutilise ce principe de reconstruction de chemin, mais son socle portable journalise les
IDs de tokens plutôt que les activations. Ce choix permet de reprendre entre backends
hétérogènes — vLLM/CUDA, MLX et demain SGLang — sans supposer un format KV ou un tenseur de
frontière compatible. Le Request Agent local, et non le VPS, conserve le journal de tokens et
l'état de contrôle. Le VPS reste seulement l'autorité de contribution et de capability.

Petals garde les hidden states d'entrée de chaque span côté client et les renvoie au span de
remplacement. Il ne copie pas directement le KV privé d'un serveur mort. Fabi ajoutera cette
technique comme chemin rapide négocié lorsque modèle, révision, plage de couches, dtype, layout
KV et backend sont compatibles. Le replay de tokens reste toujours le fallback de correction.

References primaires :

- [papier Petals fault-tolerant](https://arxiv.org/abs/2312.08361) ;
- [implementation Petals](https://github.com/bigscience-workshop/petals/blob/main/src/petals/client/inference_session.py) ;
- [Parallax issue 411](https://github.com/GradientHQ/parallax/issues/411) : fonctionnalite
  equivalente encore ouverte ;
- [Parallax issue 342](https://github.com/GradientHQ/parallax/issues/342) : reservation KV
  encore ouverte ;
- [interface KV Connector V1 de vLLM](https://github.com/vllm-project/vllm/blob/main/vllm/distributed/kv_transfer/kv_connector/v1/base.py) :
  base d'un futur chemin rapide homogène, pas une preuve de compatibilité vLLM/MLX.

## Cout mesure pour Qwen3-1.7B

Configuration canonique locale : hidden size 2 048, 28 couches, 8 tetes KV, head dim 128,
BF16. La limite declaree par `max_position_embeddings` est 40 960 ; 64k ne doit etre active
qu'avec un contrat RoPE/YaRN commun et qualifie.

Formules pour batch 1 :

```text
activation_frontiere/token = hidden_size * 2 octets = 4 096 octets
KV/couche/token = 2 * kv_heads * head_dim * 2 octets = 4 096 octets
```

| Tokens | Historique par frontiere | KV `[0,2)` | KV `[2,28)` | KV total 28 couches |
|---:|---:|---:|---:|---:|
| 14 991 | 58,56 MiB | 117,12 MiB | 1,49 GiB | 1,60 GiB |
| 32 768 | 128 MiB | 256 MiB | 3,25 GiB | 3,50 GiB |
| 40 960 | 160 MiB | 320 MiB | 4,06 GiB | 4,38 GiB |
| 65 536 | 256 MiB | 512 MiB | 6,50 GiB | 7,00 GiB |

Le transfert brut d'une frontiere 64k prend au minimum environ 21,5 s a 100 Mbit/s et
2,15 s a 1 Gbit/s, sans compter le recalcul du shard. A 32k, ces minima sont 10,7 s et
1,07 s. Dupliquer une pipeline chaude double en plus le calcul et le KV des plages protegees.

Conclusion : la replique chaude ne peut pas etre le mode obligatoire. Le premier produit
doit reprendre exactement par replay froid, puis employer les activations et les repliques
chaudes comme accelerations lorsque la RAM, le reseau et la redondance le permettent.

## Journal de requete autoritatif

Le Request Agent local maintient une entree bornee et durable par requete :

```text
request_id
state = PREFILLING | DECODING | RECOVERING | COMPLETED | FAILED | ABORTED
epoch
model_id + model_revision + tokenizer_fingerprint
prefill_contract + block_size + dtype
rendered_prompt_token_ids + prompt_checksum
sampling_params + seed + rng_position
committed_output_token_ids
last_committed_position
active_route + excluded_failed_workers
reserved_context_tokens
```

Le texte SSE n'est pas une source de reprise : le re-tokeniser peut produire une sequence
differente. Le head doit envoyer au controleur un evenement `PREFILL_COMMITTED` avec les ids
et leur checksum, puis un evenement `TOKEN_COMMITTED(position, token_id, epoch)` avant que le
token soit emis au client. L'implémentation produit utilise SQLite en WAL avec
`synchronous=FULL`, une transaction d'écriture explicite et des checksums. Le commit des IDs
précède donc toujours leur publication SSE.

## Machine d'etats et fencing

1. `PREFILLING(e)` reserve une route et construit son KV.
2. Le prefill valide devient `DECODING(e)` apres verification du checksum de tokens.
3. Chaque token est atomique : calcul, commit du token id, puis emission SSE.
4. Une erreur explicite du data plane ou l'invalidation d'une lease confirmée effectue un CAS
   vers `RECOVERING(e+1)`. L'absence de token n'est jamais un détecteur de panne.
5. Toute sortie marquee `e` est desormais tardive et rejetee.
6. Le Request Agent bannit tous les workers de la route morte pour cette requête, lit un snapshot
   DHT frais, choisit une nouvelle couverture complète, renouvelle le même permit puis réserve la
   route sous le nouvel epoch.
7. Le Request Agent transmet à la nouvelle tête les IDs du prompt et des tokens commis jusqu'à la
   dernière position durable.
8. La nouvelle route reconstruit le KV, confirme le meme checksum et reprend le decode a la
   position suivante avec le meme etat d'echantillonnage.
9. Le flux SSE reste ouvert pendant une fenetre bornee. Si la reprise échoue faute de couverture
   compatible, il émet une erreur terminale et libère les réservations.

Le RNG fait partie du contrat. En greedy, le journal de tokens suffit. En sampling, chaque
position doit etre reproductible avec `seed + rng_position` ou un etat de generateur
serialise ; sinon le systeme ne peut promettre qu'une continuation valide, pas une reprise
deterministe.

## Trois niveaux de reprise

### Niveau 1 — replay froid depuis les tokens

Conserver les IDs du prompt et des tokens valides, puis rejouer toute la séquence sur une
nouvelle route. C'est le chemin universel maintenant implémenté. Il économise la RAM du journal
d'activations, mais repaie le prefill et les transferts de frontières. Il n'exige pas une
couverture pré-réservée : tout ensemble de workers READY capable de former une route complète au
moment du replan peut être utilisé. Plusieurs pannes successives peuvent être reprises tant
qu'une nouvelle couverture existe ; les workers déjà défaillants restent exclus pour cette
requête.

### Niveau 2 — journal d'activations distribue

Chaque predecessor conserve ses activations BF16 de sortie jusqu'au commit final, sous une
limite memoire reservee. Si le shard suivant disparait, le predecessor rejoue directement la
frontiere vers son remplacement sans recalculer les couches precedentes. Le head reste
recuperable depuis les tokens. Une eviction du journal abaisse explicitement la route de
`recoverable` a `restartable` ; elle ne doit jamais rester annoncee comme recuperable.

### Niveau 3 — replique chaude

Le predecessor duplique les activations vers un shard secondaire qui maintient un KV miroir.
Le basculement devient rapide, mais le cout de calcul, reseau et KV est proche de 2x pour la
plage protegee. Ce mode est reserve aux swarms disposant d'une redondance et d'un budget
annonces suffisants.

## Ordre d'implementation

1. ~~Ajouter journal durable, checksums, epochs et commit-before-publish.~~
2. ~~Replanifier depuis un snapshot DHT frais, sans backup pré-réservé.~~
3. ~~Rejouer prompt et tokens commis sur une nouvelle route, sans re-tokeniser le texte.~~
4. ~~Exposer les phases `planning`, `reserving`, `prefilling`, `recovering`, `replaying` et leurs
   erreurs dans l'IDE.~~
5. Publier le runtime et qualifier head/milieu/tail, prefill/decode, kill dur, perte réseau et
   retour tardif sur au moins trois workers.
6. Concevoir et qualifier le chemin rapide d'activations par frontière avec quotas,
   compatibilité négociée et observabilité.
7. Ajouter les connecteurs KV natifs et la réplique chaude comme accélérations optionnelles pour
   des backends homogènes.

Les premiers tests doivent utiliser trois workers. Avec seulement le Mac `[0,2)` et le PC
Windows `[2,28)`, aucune plage n'a de secours : une panne doit donc rester une erreur propre,
pas etre presentee comme une reprise possible.

## État d'implémentation du replay froid au 29 juillet 2026

Le chemin local Request Agent/OpenAI réel contient désormais :

- un journal SQLite borné des IDs du prompt et des tokens de sortie, checksum en chaîne, machine
  d'états, reprise après réouverture et rejet des anciennes epochs ;
- `BEGIN IMMEDIATE`, WAL et `synchronous=FULL` ; chaque lot de tokens est durable avant son
  exposition SSE ;
- capture du prompt depuis le RPC de tokenisation authentifié de la vraie tête avant l'inférence,
  ce qui rend une mort pendant le prefill récupérable ;
- `replan_cold` : ancienne route libérée/fencée en best effort, snapshot TUF/DHT frais, exclusion
  cumulative des workers morts, même permit maintenu, nouvel epoch et nouvelle route complète ;
- reconstruction du KV sur `prompt original || sortie déjà commise`, sans re-tokeniser le texte ;
- patch qualifié contre le commit vLLM `ee0da84ab9e04ac7610e28580af62c365e898389` : le renderer
  vérifie les IDs du prompt, l'engine préfill le préfixe complet et le décodeur officiel restaure
  l'état reasoning/tool calls ;
- suppression du préfixe rejoué seulement après comparaison exacte des IDs, puis continuation du
  même flux client sans doublon ; les compteurs d'usage sont recalculés pour la requête originale ;
- reprise de pannes successives tant qu'une nouvelle couverture complète existe ; sinon erreur
  terminale propre et libération.

La garantie exacte est limitée pour l'instant au greedy (`temperature=0` ou `top_k=1`). Les
requêtes échantillonnées restent `RESTARTABLE` tant qu'un état RNG portable n'existe pas entre
MLX, vLLM et SGLang. Les options dont la sémantique change quand le préfixe devient prompt
(pénalités non neutres, stop strings, guided decoding, logprobs, thinking budget, beam search)
ne sont jamais annoncées comme recoverable.

Preuves locales au commit `853a3db411e3c76f8e71ae227fba53760302a3fe` :

- `788 passed, 7 skipped` sur toute la suite Python ;
- `232 passed` sur le sous-ensemble exact du workflow natif ;
- Ruff ciblé et `git diff --check` verts ;
- persistance après réouverture, détection de corruption, bornes de capacité et reprises
  successives couvertes ;
- scénario E2E local : A émet un token puis coupe, B rejoue et continue sans doublon ;
- scénario E2E prefill : A n'émet aucun token puis coupe, B reconstruit et termine ;
- scénario sans couverture de remplacement : erreur typée, pas de fausse continuation.

Non validé : workflow multi-OS final encore en cours au moment de cette mise à jour,
build/install du frontend sur les machines du labo, kill réel pendant prefill/decode et reprise
matérielle. Le Mac mini + RTX actuels forment ensemble une seule pipeline ; ils ne suffisent pas
à prouver la reprise. Il faut un troisième worker ou une autre couverture complète, par exemple
un pod RunPod borné en coût, puis tester NAT, churn et retours tardifs.
