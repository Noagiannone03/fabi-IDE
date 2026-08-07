# Modèle de menace confidentialité du data plane P2P Fabi

État audité : moteur `42e47b5bf9b3c808ff2fe3763c774a8f81d4d278`, 7 août 2026.

Ce document sépare trois propriétés souvent confondues : le chiffrement du transport, la
confidentialité vis-à-vis du relay et la confidentialité vis-à-vis des workers qui exécutent le
modèle. Le système actuel garantit les deux premières. Il ne garantit pas la troisième et ne doit
pas être présenté comme s'il la garantissait.

## Frontières de confiance actuelles

Le client OpenCode envoie la requête OpenAI au Request Agent. Le Request Agent choisit et réserve
une route signée, puis transmet au worker de tête le JSON de chat complet pour la tokenisation
exacte et la génération. Ce worker voit donc les messages et les outils en clair dans son
processus. La boucle Parallax transforme ensuite le prompt en `input_ids` et activations.

Le message protobuf inter-worker transporte actuellement, à chaque saut :

- l'identité de requête, la route et son epoch de fencing ;
- les paramètres d'échantillonnage ;
- la liste complète des `input_ids` ;
- les activations intermédiaires nécessaires au stage suivant.

Le transport natif Iroh authentifie les Endpoint IDs et chiffre les flux de bout en bout avec
QUIC/TLS 1.3. Un relay Iroh ne peut donc pas lire le prompt, les tokens ou les activations. Il peut
cependant observer des métadonnées de connexion, notamment les adresses, le moment et le volume
des échanges. Ces limites sont celles documentées officiellement par Iroh :
<https://docs.iroh.computer/about/faq> et
<https://docs.iroh.computer/deployment/security-privacy>.

## Adversaires couverts

Le système protège contre :

- un observateur réseau passif entre deux pairs ;
- un relay honnête-curieux qui achemine les paquets ;
- un pair non autorisé qui tente de détourner une réservation, grâce à l'identité Iroh, aux routes
  signées, aux epochs et au fencing ;
- la désérialisation de code arbitraire : le data plane utilise protobuf/msgpack, pas `pickle`.

Le système ne protège pas encore contre :

- le worker de tête qui reçoit le JSON du chat ;
- un worker de pipeline qui journalise ou analyse les token IDs actuellement recopiés à chaque
  saut ;
- un worker qui tente d'inverser les activations qu'il reçoit ;
- un opérateur local compromis qui lit la mémoire de son propre worker ;
- la collusion de plusieurs workers d'une même route.

Les activations ne sont pas une anonymisation. Les travaux sur l'inversion de représentations en
split computing montrent que des entrées peuvent être reconstruites depuis des features
intermédiaires, parfois même après de nombreuses couches. Voir notamment
<https://arxiv.org/abs/2107.06304> et <https://eprint.iacr.org/2021/1074.pdf>.

## Amélioration retenue, sans fausse promesse

La trajectoire de moindre privilège est de rapprocher Fabi du découpage client de Petals :

1. exécuter localement le tokenizer, les embeddings d'entrée, la tête LM et le sampling quand le
   backend du modèle le permet ;
2. envoyer aux workers distants uniquement les activations et les métadonnées strictement
   nécessaires à leur span ;
3. remplacer dans le protocole inter-worker la copie générale des `input_ids` par une longueur de
   prompt explicite et une information de cache minimale ;
4. transporter l'historique requis par les pénalités de sampling dans un canal privé entre le
   frontend local et la tête LM locale, pas via chaque worker ;
5. rendre les logs sans contenu par défaut et tester l'absence de prompt/tokens dans les erreurs ;
6. versionner le wire protocol et refuser les mélanges de capacités pendant la migration.

Cette évolution réduit fortement l'exposition du texte et des tokens, mais les workers distants
voient toujours des activations potentiellement inversibles. Elle doit donc être décrite comme une
défense en profondeur, jamais comme une confidentialité cryptographique du prompt.

## Modes de confiance produit

Fabi doit exposer clairement le mode réellement obtenu :

- **swarm privé** : workers contrôlés ou explicitement approuvés ; adapté au code confidentiel ;
- **swarm communautaire** : transport chiffré, mais workers non fiables ; aucune promesse de secret
  contre ces workers ;
- **worker attesté** : future option pour du matériel TEE qualifié avec attestation vérifiée ;
- **calcul cryptographique** : MPC/FHE reste une piste de recherche et non un backend interactif
  qualifié sur les laptops communautaires actuels.

Une installation ne doit jamais sélectionner silencieusement un niveau de confiance plus faible.
L'IDE devra montrer le mode, l'identité des endpoints de la route et la différence entre chemin
direct et relay, sans exposer les secrets d'identité.

## Barrières avant modification du wire protocol

Le retrait des `input_ids` ne peut pas être un patch isolé : le calcul de `current_position`, le
prefix cache MLX, le chunked prefill, les pénalités de sampling, le replay exact et les backends
ONNX/vLLM en dépendent aujourd'hui. L'implémentation devra fournir ensemble :

- un protobuf versionné avec `prompt_length` et des champs de cache explicites ;
- une politique de visibilité par rôle (frontend, decoder intermédiaire, head) ;
- une migration fail-closed entre versions ;
- des tests unitaires vérifiant qu'un pair intermédiaire ne reçoit plus le texte ni les tokens ;
- un E2E avec préfill chunké, prefix cache, sampling avec pénalités, abort et `replan_cold` ;
- un test d'observabilité garantissant que logs, traces et erreurs ne contiennent pas le contenu.

Tant que ces barrières ne sont pas franchies, la priorité est l'honnêteté de l'interface et
l'utilisation d'un swarm privé pour le code sensible.
