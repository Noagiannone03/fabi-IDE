# Fabi Adaptive Speculative Decoding

Statut : design candidat, non implémenté et non qualifié.

Ce document définit l'accélération spéculative de Fabi V3. Elle ne doit pas
modifier la distribution produite par le modèle cible, publier un token avant
sa validation, exiger un second modèle sur tous les workers, ni ralentir une
route sur laquelle la spéculation n'apporte pas de gain réel.

## Objectif produit

Sur une pipeline découpée entre plusieurs réseaux, le coût dominant du decode
est souvent la synchronisation par token. Fabi doit remplacer plusieurs tours
réseau successifs par la vérification d'une fenêtre de candidats en un tour,
puis committer le plus long préfixe accepté. Le bénéfice attendu est une baisse
de l'inter-token latency et une hausse du débit E2E, surtout pour le code qui
répète des fragments du prompt, de l'historique ou des sorties d'outils.

Le débit des kernels seuls n'est pas le critère de succès. La mesure autoritaire
est le temps entre tokens **committés et publiés** au client, avec la mémoire,
les octets WAN et le travail périmé inclus.

## Ce que Fabi réutilise

Le runtime Mesh/Skippy piné expose déjà :

- `verify_tokens_frame_sampled`, qui vérifie plusieurs tokens dans une seule
  passe et renvoie les prédictions du modèle cible ;
- `VerifySpan`, `PredictedTokens` et les identifiants de fenêtre ;
- le rewind positionnel des sessions et la purge du travail pipeliné périmé ;
- MTP natif lorsque le package signé du modèle le déclare ;
- un cache N-gram llama.cpp et un proposer longest-suffix request-local ;
- les métriques de fenêtre, acceptation, attente, compute et stale execution.

Fabi ne réécrit donc ni le sampler, ni la vérification, ni les kernels. Il étend
son bridge Rust/Python et son protocole V3 pour transporter ces primitives sous
les contrats d'epoch, fencing, abort et commit déjà utilisés par le produit.

Références primaires :

- Gradient, *Turning Latency into Throughput: Speculative Decoding for the
  Decentralized Inference* :
  <https://gradient.network/blog/turning-latency-into-throughput-speculative-decoding-for-the-decentralized-inference>
- documentation et code vLLM maintenus :
  <https://github.com/vllm-project/vllm/blob/main/docs/features/speculative_decoding/README.md>
- code Mesh/Skippy exact piné par Fabi : commit `e60b2fe…`, notamment
  `crates/skippy-runtime/src/activation.rs` et
  `crates/skippy-server/src/frontend/embedded_generation.rs`.

Les gains Gradient publiés sur A800 et InfiniBand ne constituent pas une
promesse pour le WAN communautaire. Ils doivent être remesurés sur chaque
topologie Fabi.

Gradient décrit aussi une vérification adaptative qui peut relâcher le contrôle
de tokens jugés peu importants. Fabi ne reprend pas cette approximation dans
le chemin produit : en programmation, une ponctuation, un opérateur ou un nom
court peut changer totalement le résultat. Seul le *batch settlement* exact,
où le modèle cible vérifie chaque candidat et décide du préfixe committé, est
éligible. Une expérimentation approximative éventuelle resterait un protocole
de recherche séparé et explicitement non lossless.

## Stratégies négociées par requête

L'ordre d'éligibilité est :

1. `target-only`, baseline toujours disponible ;
2. `ngram-suffix`, sans poids supplémentaires et isolé dans la requête ;
3. `native-mtp`, uniquement si tous les spans de la route annoncent l'ABI et
   si le manifeste signé certifie la tête MTP ;
4. `native-mtp+suffix`, seulement après qualification indépendante des deux
   modes et de leur composition ;
5. `draft-model`, uniquement pour un couple cible/draft signé, tokenizer et
   sampler compatibles, avec une capacité draft indépendante de la route
   cible.

Le catalogue publie les capacités, jamais l'activation forcée. Le Request Agent
choisit une stratégie après réservation de la route exacte et peut revenir à
`target-only` au milieu d'une génération à une frontière de commit.

## Contrat de fenêtre V3

Chaque fenêtre porte au minimum :

- `request_id`, `route_id`, `epoch` et `fence_token` ;
- `window_id` strictement croissant et `base_committed_position` ;
- les tokens candidats, les paramètres de sampling cibles et la borne de
  contexte réservée ;
- l'identité de la stratégie/proposer et sa version ;
- un budget d'octets et de tokens borné par le manifeste et la réservation.

La réponse contient les prédictions du modèle cible, le préfixe accepté, la
position résultante et les métriques de chaque span. Une réponse d'un ancien
epoch, d'une ancienne route ou d'une fenêtre déjà terminée est rejetée sans
publier de token.

Le journal suit l'ordre suivant :

1. vérifier la réponse cible et calculer le préfixe acceptable ;
2. persister le commit logique des tokens et la position ;
3. confirmer l'avancement aux spans ;
4. seulement ensuite publier les événements SSE correspondants ;
5. marquer toutes les fenêtres dépendant d'une divergence comme périmées et
   drainer leurs réponses sans les rendre visibles.

Cette règle `commit-before-publish` garantit qu'un retry, un abort ou un
`replan_cold` ne duplique jamais un fragment déjà envoyé au client.

## Contrôleur adaptatif

Le contrôleur est request-local et route-aware. Il observe en continu :

- RTT par lien, jitter, débit d'activation et temps d'attente downstream ;
- temps de proposition, de vérification et de commit ;
- candidats proposés, acceptés, rejetés et exécutés après invalidation ;
- mémoire et KV réellement disponibles sur chaque span ;
- tokens committés par seconde et inter-token latency E2E ;
- sampling, famille du modèle, longueur de contexte et répétitivité locale.

Il compare des fenêtres d'observation `target-only` et spéculatives sur la même
route. La longueur proposée augmente uniquement si le gain E2E observé reste
positif après le coût du draft, de la vérification et du stale work. Elle baisse
dès que les rejets ou la pression mémoire progressent. Une hystérésis et un
cooldown en nombre de **commits**, pas un délai mural arbitraire, empêchent les
oscillations. Les bornes absolues viennent de l'ABI et du manifeste signé.

Le score n'est pas un seuil magique de taux d'acceptation. Pour chaque
stratégie et taille de fenêtre, Fabi maintient une moyenne mobile et une
incertitude sur le coût E2E par token committé :

`(draft + vérification + réseau + commit + stale drain) / tokens committés`.

La baseline mesure le même coût en `target-only`. Une variante n'est préférée
que lorsque sa borne prudente reste meilleure que la baseline sur assez de
commits; à défaut elle reste en observation. Ce modèle explique aussi deux cas
que le seul taux d'acceptation rate : une fenêtre très acceptée mais coûteuse à
proposer, et une petite fenêtre moyennement acceptée qui économise beaucoup de
tours WAN. Les statistiques sont bornées en mémoire et séparées par famille de
route, classe de RTT, stratégie de sampling et tranche de contexte.

L'exploration est bornée : une petite fraction des frontières de commit peut
tester une fenêtre voisine, jamais plusieurs variantes concurrentes non bornées.
Le contrôleur se réinitialise après changement de route, d'epoch, de modèle ou
de paramètres de sampling, car les anciennes mesures ne décrivent plus le coût
courant.

## Panne, abort et replan

- Un abort fence immédiatement les nouvelles fenêtres, annule le proposer et
  libère les états natifs après drainage borné des réponses en vol.
- La panne d'un span invalide toutes les fenêtres non committées de cette route.
- Un replan repart du dernier token committé durable. Le replay froid réinjecte
  le prompt et les tokens committés; un transfert KV n'est utilisé que si son
  format, ses spans, son epoch et ses digests sont compatibles.
- Une fenêtre vérifiée mais non committée avant la panne n'est jamais présumée
  réussie.
- Si le mode spéculatif échoue seul, la génération continue en `target-only`
  sur la même route quand l'état cible est encore cohérent.

## Sécurité et isolation

- Le suffix proposer est request-local par défaut : aucun prompt d'un compte
  ne nourrit les propositions d'un autre.
- Toute capacité MTP/draft vient d'un manifeste TUF signé et d'un hash de
  package exact.
- Les tailles de fenêtre, vecteurs de tokens et frames sont bornées avant toute
  allocation.
- Les métriques publiées n'incluent ni prompt, ni token brut, ni sortie.
- Le mode draft séparé ne peut pas emprunter silencieusement la mémoire réservée
  au KV cible.

## Critères de promotion

La fonctionnalité reste désactivée par défaut tant que les matrices suivantes
ne sont pas vertes :

- égalité token par token en greedy entre `target-only` et spéculatif ;
- validation statistique du sampling non greedy avec mêmes seeds et paramètres ;
- code répété, code inédit, édition au milieu d'un fichier, sorties d'outils,
  stop tokens, contexte à la limite et Unicode ;
- deux requêtes concurrentes sans fuite de suffixe ou de session ;
- abort à chaque frontière, changement d'epoch et réponses tardives ;
- kill head/middle/tail pendant proposition, vérification et commit ;
- replay froid et, lorsqu'il est compatible, restauration KV ;
- topologies locales et WAN à RTT/jitter/pertes contrôlés, puis Mac mini + RTX
  et une seconde route indépendante ;
- mémoire stable et aucun recul E2E significatif lorsque le contrôleur choisit
  automatiquement `target-only`.

Le dashboard et l'IDE affichent seulement un statut compréhensible
(`accélération adaptative`, gain mesuré, fallback normal), tandis que les
métriques détaillées restent opérateur. Aucun chiffre marketing n'est publié
avant une campagne reproductible sur les topologies produit.

## Ordre d'implémentation

1. exposer `verify_tokens_frame_sampled` et le résultat multi-token dans
   `fabi-skippy-runtime`, PyO3 et les tests ABI tri-OS ;
2. ajouter la fenêtre V3 fenced et ses limites de sérialisation ;
3. intégrer `ngram-suffix` request-local, d'abord en shadow puis en opt-in ;
4. implémenter journal commit-before-publish, stale drain et abort ;
5. ajouter télémétrie et contrôleur adaptatif avec baseline intercalée ;
6. qualifier exactement output, panne et coût E2E ;
7. activer progressivement le suffixe pour les modèles certifiés ;
8. ajouter MTP puis draft signé seulement après leurs matrices dédiées.
