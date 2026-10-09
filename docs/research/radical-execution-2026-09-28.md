# Repenser le principe d'exécution de Fabi

28 septembre 2026. Proposition de recherche, non implémentée et non validée sur un modèle frontière. Ce document répond à la demande de dépasser l'amélioration d'un pipeline existant. Aucun nouveau GPU n'a été lancé pour cette analyse.

## Question de départ

Le modèle est une fonction, et le pipeline couche après couche est une manière d'évaluer cette fonction. Peut-on conserver les poids du modèle et chercher sa sortie par un autre algorithme, plus adapté à des machines distantes ? Cette question est différente de celle du placement optimal des couches.

Trois libertés doivent être distinguées : changer le stockage des poids ; changer l'algorithme qui évalue la même fonction ; changer la fonction apprise. La deuxième correspond le mieux à l'objectif initial de faire tourner les modèles frontière existants. La troisième ouvre davantage de possibilités, mais produit un nouveau modèle dont le niveau frontière reste à démontrer.

## A. Résoudre collectivement les états internes du modèle

Pour un token et un préfixe validé fixés, écrivons schématiquement :

```text
h[0] = entrée connue
h[1] = F[1](h[0])
...
h[L] = F[L](h[L-1])
```

Chaque F contient le vrai calcul du modèle, avec ses vrais poids. On peut rechercher simultanément les inconnues h[1]...h[L] en annulant les résidus :

```text
r[i] = h[i] - F[i](h[i-1])
```

Les pairs évaluent leurs fonctions en parallèle sur un instantané d'états provisoires. Ils échangent les écarts et appliquent une correction collective. Ils recommencent jusqu'à atteindre un critère de validité. Le réseau transporte alors des corrections entre approximations de la solution, plutôt qu'une seule activation obligée de parcourir toute la chaîne avant que les derniers pairs puissent travailler.

### Ce qui existe déjà

Cette reformulation n'est pas une invention de Fabi. DeepPCR utilise des systèmes d'équations et une réduction parallèle pour des calculs neuronaux séquentiels, avec des compromis de mémoire et de calcul. Son intérêt est de montrer qu'ordre séquentiel apparent et algorithme d'évaluation ne sont pas toujours synonymes. Ses résultats ne constituent pas une démonstration sur Kimi distribué sur Internet. [DeepPCR, auteurs](https://machinelearning.apple.com/research/deeppcr).

SNLP explore des corrections structurées pour les couches de Transformers. Les auteurs rapportent des résultats sur des modèles relativement petits et soulignent que les modèles préentraînés ordinaires se prêtent moins bien à cette méthode. Quelques itérations approximatives ne constituent pas une évaluation exacte du modèle initial. [SNLP](https://arxiv.org/html/2605.17842v1).

### Hypothèse de contribution Fabi

Construire une résolution distribuée adaptée aux MoE, avec un coût de communication explicite et deux niveaux de précision :

1. **Guide peu coûteux.** Une approximation prédit les états d'entrée des sous-calculs. Elle n'a aucune autorité sur les tokens publiés. Elle peut utiliser le préfixe validé et un apprentissage auxiliaire ; il ne faut pas supposer que les états du token précédent suffisent.
2. **Calcul du vrai modèle en parallèle.** Les détenteurs des poids évaluent les vrais sous-calculs. Le routeur natif est réévalué sur les états courants. Les prédictions ne peuvent pas figer un choix d'experts incorrect.
3. **Correction hiérarchique.** Des approximations compactes de l'effet des erreurs propagent les corrections entre groupes, sans transmettre les matrices de dérivées complètes. Une projection ou une approximation diagonale sert au solveur ; elle ne remplace pas les poids du modèle cible.
4. **Correction fine.** Les résidus sont recalculés avec le vrai modèle après les corrections. Un résidu restant important invalide l'hypothèse d'une solution proche.
5. **Validation cohérente.** Toutes les vérifications portent sur le même instantané, le même préfixe et les mêmes états de cache. Le résultat n'est publié qu'après satisfaction du contrat choisi.

Le volet spécifiquement à éprouver est l'association entre corrections compactes, changements de routage MoE, topologie WAN et validation de l'état distribué. La recherche effectuée ne suffit pas à revendiquer sa nouveauté scientifique.

### Exactitude : le point qui ne doit pas être éludé

Pour un graphe acyclique déterministe, si chaque équation locale est satisfaite exactement sur le même instantané et si l'entrée est ancrée, l'ensemble constitue la trajectoire de référence. Cette propriété est vérifiable en parallèle ; elle ne garantit pas que le solveur trouve cette trajectoire rapidement.

Un petit résidu, une faible différence de logits ou plusieurs réponses semblables ne prouvent pas l'égalité du prochain token. Une marge entre logits ne suffit que si l'on dispose d'une borne valide sur l'erreur des logits. Les constantes nécessaires peuvent rendre cette borne inutilisable. Les calculs en précision finie demandent aussi une définition précise de la référence numérique et des kernels déterministes.

Le KV validé doit rester immuable pendant les essais ; les états du token candidat sont temporaires. KDA, AttnRes et autres dépendances exigent d'élargir les variables et le graphe aux états effectivement nécessaires. Le schéma à une seule variable par couche n'est pas directement une implémentation fidèle de tous les modèles.

### Pourquoi le gain pourrait exister, et pourquoi il pourrait disparaître

Dans un pipeline de S stages, la durée comprend une chaîne de calculs et de transferts. Le solveur coûterait approximativement :

```text
initialisation + R × (calcul du stage le plus lent
                     + communication des corrections
                     + résolution de la correction)
              + validation
```

R est le nombre de tours nécessaire au critère retenu. Cette expression est un modèle, pas une mesure. Chaque correction peut elle-même demander plusieurs vagues réseau. Le gain exige que ce coût soit inférieur au pipeline et que le travail supplémentaire reste soutenable lorsque plusieurs utilisateurs arrivent.

Une simple itération où chaque couche recalcule depuis l'état provisoire de sa voisine peut nécessiter S tours pour propager une information exacte jusqu'au bout. Ce serait le pipeline rendu plus coûteux. Une correction grossière en chaîne ne résout rien si elle réintroduit les mêmes attentes WAN.

Les difficultés principales sont donc : obtenir peu de tours, éviter les grosses dérivées, maîtriser les changements discontinus de top-k, préserver les états de contexte et limiter le surcroît de calcul. En cas d'échec, une reprise séquentielle reste possible mais doit être incluse dans la moyenne et les queues de latence.

La mémoire totale du modèle n'est pas supprimée. Les petits pairs détiennent toujours une fraction des poids. Si une fonction locale est répartie entre plusieurs machines, son coût interne doit être compté dans chaque tour. Tous les pairs ne deviennent pas instantanément indépendants par cette reformulation.

### Expérience qui déciderait réellement

Commencer par une implémentation de référence existante et des poids gelés, puis mesurer la convergence sur un modèle MoE réel. Comparer : initialisation naïve, guide appris, corrections structurées, puis correction distribuée. Conserver un ensemble de tâches de code inédites et des changements de domaine.

Mesurer le nombre de tours pour atteindre chaque contrat : erreur d'états, identité des tokens, et satisfaction stricte des équations sous la référence numérique. Comptabiliser évaluations supplémentaires, projections, tous les octets, taille des états et proportion de replis. Tester ensuite 4, 8 et 16 stages et plusieurs profils réseau.

Critère de poursuite : un gain de temps mesuré à fidélité comparable, qui survit aux changements de contexte et à la concurrence. Un faible nombre d'itérations sur une petite erreur moyenne ne suffit pas. Si le nombre de tours suit le nombre de stages, abandonner cette voie pour les checkpoints gelés.

## B. Un modèle dont la profondeur réseau est petite dès sa conception

Si l'on accepte de produire un nouveau modèle, le changement peut être plus profond : beaucoup de capacité stockée dans des modules autonomes, mais seulement quelques échanges globaux pour traiter un bloc. Chaque module effectue une computation profonde locale ; une communication transporte un état latent ou une proposition structurée suffisamment riche pour plusieurs calculs ultérieurs.

Les modules forment un seul modèle entraîné conjointement, avec des interfaces apprises. Cela ne revient pas à supposer qu'un vote entre petits chatbots possède automatiquement les capacités d'un modèle frontière. La profondeur de communication et les limites de mémoire doivent entrer dans l'objectif d'entraînement.

Une construction hypothétique serait : représentation du contexte et de l'état du bloc → consultation parallèle de modules → fusion apprise → éventuellement nouvelle consultation → génération du bloc. Fixer un budget de deux à quatre consultations serait une contrainte de recherche, pas un résultat acquis. Le routage peut changer entre blocs, mais le choix de quelques modules ne doit pas faire perdre les connaissances nécessaires.

DiPaCo étudie déjà des architectures modulaires avec composition de chemins ; ses résultats ne démontrent pas cette proposition à l'échelle frontière. [DiPaCo](https://arxiv.org/abs/2403.10616). Réduire la communication peut également être une propriété de l'architecture, comme l'étudie Federation of Experts, dont l'organisation et les conditions diffèrent d'un collectif résidentiel mondial. [FoE](https://arxiv.org/abs/2605.06206).

La contribution possible serait une architecture entraînée sous contrainte WAN, avec profondeur locale, interfaces de contexte, génération par blocs, tolérance aux modules absents et qualification de la capacité réellement utilisée. La disponibilité ne peut pas simplement changer les modules à l'inférence sans entraînement ou validation de ce comportement.

Une distillation depuis un grand modèle pourrait initialiser ce système. Elle ne garantit ni la conservation de ses capacités, ni celle de ses connaissances rares, ni son niveau en code long et outils. Ce serait un nouveau modèle Fabi, même si le professeur est Kimi. Il ne faut pas le vendre comme une autre manière exacte d'exécuter le checkpoint Kimi.

## Autres pistes examinées

| Piste | Rupture possible | Limite décisive |
|---|---|---|
| Base partagée entre experts et résidus distribués | Changer les objets stockés par les pairs | La compression n'enlève pas à elle seule les dépendances séquentielles ; exactitude et taille des résidus non garanties |
| Réponse locale approximative et corrections distantes sélectives | Ne demander que les détails susceptibles de changer la décision | Certifier les corrections inutiles pour toute la chaîne est difficile ; confiance heuristique insuffisante |
| Compositions de fonctions stockées chez les pairs | Traverser plusieurs couches avec un objet composé | Pour des fonctions non linéaires générales, la représentation compacte et peu coûteuse de la composition n'est pas acquise |
| Addition de RAM avec codage redondant | Disponibilité et résilience | Ne supprime pas les causalités du calcul ni les activations nécessaires |

Le partage de bases entre experts existe notamment dans MoBE et ResMoE ; le présenter seul comme une invention nouvelle serait trompeur. [MoBE](https://proceedings.iclr.cc/paper_files/paper/2026/hash/431d53d513461ff155d5bc8faa9a440c-Abstract-Conference.html), [ResMoE](https://arxiv.org/abs/2503.06881).

## Position de recherche

Pour respecter l'objectif des modèles frontière existants, privilégier A comme expérience de rupture : changer leur algorithme d'évaluation, avec poids gelés et critères de fidélité explicites. B reste une ambition distincte de conception de modèle natif P2P, avec un coût d'entraînement et un risque de perte de capacité importants.

Ni A ni B ne constitue aujourd'hui une solution démontrée de Fabi. La proposition utile est de définir le mécanisme, les conditions nécessaires à son succès et l'expérience qui permet de l'écarter, plutôt que de donner un nouveau nom à un pipeline ou de promettre une accélération sans preuve.
