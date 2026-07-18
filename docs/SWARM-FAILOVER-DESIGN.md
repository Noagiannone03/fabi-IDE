# Fabi Swarm — conception de la reprise exacte en generation

Etat : decision d'architecture du 18 juillet 2026. Ce document decrit le contrat a
implementer apres l'admission statique de contexte (`swarm-engine` `76c7dd6`). Il ne declare
pas encore la reprise qualifiee.

## Objectif et garantie

Lorsqu'un worker quitte une pipeline pendant le prefill ou le decode, Fabi doit conserver
tous les tokens deja valides, choisir une couverture de couches compatible, reconstruire le
KV necessaire et reprendre sans dupliquer ni perdre de token dans le flux SSE.

La garantie est volontairement stricte :

- une route n'est `recoverable` que si une couverture de secours existe pour chaque plage ;
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

Fabi reutilise ce principe, mais son scheduler HTTP n'est pas dans le chemin des activations.
Faire transiter toutes les activations par lui augmenterait inutilement la bande passante et
creerait un point chaud. Le journal d'activations doit donc etre distribue chez le predecessor
de chaque frontiere ; le scheduler conserve le journal de tokens et l'etat de controle.

References primaires :

- [papier Petals fault-tolerant](https://arxiv.org/abs/2312.08361) ;
- [implementation Petals](https://github.com/bigscience-workshop/petals/blob/main/src/petals/client/inference_session.py) ;
- [Parallax issue 411](https://github.com/GradientHQ/parallax/issues/411) : fonctionnalite
  equivalente encore ouverte ;
- [Parallax issue 342](https://github.com/GradientHQ/parallax/issues/342) : reservation KV
  encore ouverte.

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

Le scheduler maintient une entree bornee par requete :

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
primary_route + replacement_routes
reserved_context_tokens
```

Le texte SSE n'est pas une source de reprise : le re-tokeniser peut produire une sequence
differente. Le head doit envoyer au controleur un evenement `PREFILL_COMMITTED` avec les ids
et leur checksum, puis un evenement `TOKEN_COMMITTED(position, token_id, epoch)` avant que le
token soit emis au client.

## Machine d'etats et fencing

1. `PREFILLING(e)` reserve une route et construit son KV.
2. Le prefill valide devient `DECODING(e)` apres verification du checksum de tokens.
3. Chaque token est atomique : calcul, commit du token id, puis emission SSE.
4. Une erreur de transport ou un heartbeat expire effectue un CAS vers `RECOVERING(e+1)`.
5. Toute sortie marquee `e` est desormais tardive et rejetee.
6. Le scheduler reserve une route compatible et lui transmet le journal jusqu'a la derniere
   position commise.
7. La nouvelle route reconstruit le KV, confirme le meme checksum et reprend le decode a la
   position suivante avec le meme etat d'echantillonnage.
8. Le flux SSE reste ouvert pendant une fenetre bornee. Si la reprise echoue ou depasse son
   delai, il emet une erreur terminale et libere toutes les reservations.

Le RNG fait partie du contrat. En greedy, le journal de tokens suffit. En sampling, chaque
position doit etre reproductible avec `seed + rng_position` ou un etat de generateur
serialise ; sinon le systeme ne peut promettre qu'une continuation valide, pas une reprise
deterministe.

## Trois niveaux de reprise

### Niveau 1 — replay froid depuis les tokens

Conserver les ids du prompt et des tokens valides, puis rejouer toute la sequence sur une
nouvelle route. C'est le chemin le plus simple a rendre exact et la premiere implementation.
Il economise la RAM du journal d'activations, mais repaie le prefill et le transfert des
frontieres. Une seule panne est toleree uniquement si une couverture complete de secours est
deja chargee.

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

1. Ajouter le journal de controle et les epochs sans modifier encore le chemin de donnees.
2. Faire remonter ids/checksums et commits de tokens du head au scheduler.
3. Implementer le replay froid non streame avec une route complete de secours.
4. Ajouter le flux SSE commit-before-emit et verifier zero duplication.
5. Ajouter le journal BF16 par frontiere avec quotas et observabilite.
6. Ajouter la replique chaude comme politique optionnelle.
7. Qualifier head/milieu/tail, prefill/decode, kill dur/perte reseau/retour tardif.

Les premiers tests doivent utiliser trois workers. Avec seulement le Mac `[0,2)` et le PC
Windows `[2,28)`, aucune plage n'a de secours : une panne doit donc rester une erreur propre,
pas etre presentee comme une reprise possible.
