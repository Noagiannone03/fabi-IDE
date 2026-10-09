# Transformer un modèle préentraîné pour l'inférence sur Internet

28 septembre 2026. Recherche documentaire et proposition d'architecture. Aucune conversion ni mesure GPU nouvelle dans cette étude. Complément à `radical-execution-2026-09-28.md`.

## Avis

Concevoir ensemble modèle, protocole et apprentissage est une voie de recherche particulièrement cohérente si l'objectif est une capacité proche des modèles frontière sur des petites machines éloignées. Ce n'est ni une nécessité démontrée, ni la meilleure solution prouvée. Cela change le contrat : on cherche un modèle dérivé aussi compétent sur des tâches définies, pas une exécution identique du checkpoint original.

La conversion de Kimi K3 avec conservation de ses capacités agentiques et performance comparable à un datacenter n'est établie par aucune source examinée ici. Réentraîner quelques interfaces pourrait suffire pour une transformation modeste ; une réorganisation radicale pourrait exiger une grande campagne d'apprentissage. Le coût ne peut être chiffré sérieusement sans expérience de mise à l'échelle.

## Ce que la littérature établit

| Travail | Élément pertinent | Limite pour Fabi |
|---|---|---|
| DiPaCo | Architecture modulaire et routage de chemins ; résultats de perplexité comparés à un modèle dense 1B | Ni conversion de Kimi ni preuve de latence agentique sur Internet ; choix de chemins distinct de génération parallèle |
| Federation of Experts | Organisation de l'attention et des experts qui réduit les communications | Modèles 1B et 7B entraînés depuis zéro ; serveurs H100 et InfiniBand ; conserve une synchronisation entre groupes par couche |
| MOHAWK | Transfert progressif d'un Transformer vers une architecture SSM, avec alignement intermédiaire puis des prédictions | Échelle et transformation différentes ; ne supprime pas automatiquement les dépendances entre machines |
| Mamba in the Llama | Réutilisation de poids et distillation vers une architecture hybride, évaluée notamment depuis Llama3-8B | Comparabilité sur les évaluations rapportées, pas identité générale ni conservation de toutes les compétences |
| LLaDA2.0 | Conversion de modèles autoregressifs vers la diffusion, jusqu'à 100B de paramètres totaux | La génération par blocs ne supprime pas à elle seule les échanges à chaque couche ; chaque raffinement peut encore traverser le modèle |

Sources primaires : [DiPaCo](https://arxiv.org/html/2403.10616v1), [FoE](https://arxiv.org/html/2605.06206v1), [MOHAWK](https://arxiv.org/abs/2408.10189), [Mamba in the Llama](https://arxiv.org/abs/2408.15237), [LLaDA2.0](https://arxiv.org/html/2512.15745v1).

FoE précise explicitement que les checkpoints MoE ordinaires ne sont pas directement utilisables dans son architecture. DiPaCo fournit un précédent de modularité, pas une recette d'assemblage de petits modèles indépendants en modèle frontière. La distillation interarchitectures fournit un précédent de transfert, pas une garantie de conservation de compétence à n'importe quelle échelle.

## Hypothèse Fabi : apprendre l'autonomie de calcul entre communications

La ressource architecturale à limiter serait le **nombre de dépendances réseau successives par portion de réponse utile**, avec des plafonds de mémoire et de trafic. Une simple pénalité sur les octets ne suffit pas : cent messages minuscules qui s'attendent peuvent rester lents.

Le modèle dérivé posséderait un grand ensemble de modules profonds, chacun assez petit pour un budget de machine donné, et des interfaces apprises entre eux. Chaque module exécuterait plusieurs opérations localement. À une frontière de communication, il fournirait une représentation permettant aux modules suivants de travailler longtemps avant la frontière suivante.

Schéma hypothétique d'un bloc de génération :

1. Le préfixe validé et les observations d'outils déterminent l'état initial.
2. Un mécanisme appris sélectionne quelques modules et prépare leurs entrées.
3. Ces modules effectuent en parallèle un calcul local profond, avec leurs propres poids et états.
4. Une fusion apprise combine leurs contributions ; des consultations supplémentaires peuvent être nécessaires.
5. Le modèle génère un bloc ou affine un bloc proposé. Toutes les consultations et étapes de raffinement comptent dans le budget réel.

Un schéma de branches parallèles ne prouve pas que les fonctions actuelles de Kimi puissent être réorganisées ainsi. C'est précisément ce qu'il faut apprendre et mesurer. Les experts actuels, imbriqués entre les couches d'attention, ne deviennent pas des modules autonomes par simple déplacement de leurs poids.

La capacité totale pourrait rester élevée et répartie sur beaucoup de machines, avec peu de modules activés pour une requête. Cette capacité stockée n'implique pas qu'elle soit effectivement accessible avec assez peu d'échanges : le routage, les interfaces et la composition des compétences déterminent le résultat.

## Comment partir d'un modèle existant

### 1. Mesurer et choisir les transformations

Identifier les dépendances transversales, l'état de contexte et les sous-calculs qui peuvent rester locaux. Conserver les poids compatibles quand cela a un sens ; prévoir des interfaces apprises là où les dimensions ou les fonctions changent. Un expert sélectionné en couche 40 n'est pas interchangeable avec celui de la couche 10.

### 2. Apprendre les interfaces avant de tout modifier

Le modèle original sert de professeur. Les modules dérivés apprennent à reproduire des fonctions ou représentations pertinentes, puis leurs prédictions finales. Des têtes de projection peuvent aligner des espaces différents ; exiger une égalité arbitraire de tous les états internes pourrait empêcher la nouvelle organisation de fonctionner.

Geler d'abord les poids réutilisés permet de mesurer ce que les interfaces seules récupèrent. Si elles ne suffisent pas, dégeler progressivement les sous-ensembles concernés. Un adaptateur ne supprime pas, à lui seul, les dépendances d'un graphe resté inchangé.

### 3. Augmenter progressivement l'autonomie

Réduire le nombre de frontières et augmenter la quantité de travail effectuée entre elles. Utiliser plusieurs budgets, par exemple des blocs de 8, 16 et 32 tokens, sans supposer que la taille du bloc égale le nombre de tokens finalement produits par un seul échange. Autoriser une consultation supplémentaire sur les cas difficiles et mesurer sa fréquence réelle.

### 4. Entraîner sur la tâche finale et les contraintes du matériel

Combiner l'apprentissage de la réponse, le transfert du professeur et les résultats vérifiables de tâches de code avec une estimation du coût critique réseau. Imposer les budgets mémoire et de communication. Une fonction indicative serait :

```text
perte = erreur sur les tâches + fidélité au professeur
        + pénalité de temps critique réseau
        + pénalité de trafic et de calcul inutile
```

Les coefficients expriment un compromis mesuré ; ils ne permettent pas de garantir gratuitement la qualité. Une pénalité trop forte peut apprendre au modèle à se priver de capacités nécessaires.

### 5. Retirer le professeur du service final

L'objectif est que le modèle converti réponde seul grâce aux pairs. S'il faut consulter le Kimi original à chaque réponse pour récupérer sa qualité, la transformation n'a pas résolu le problème. Une comparaison avec le professeur pendant les évaluations ne crée pas cette dépendance en production.

## Le contexte doit faire partie de la nouvelle architecture

Les modules devraient garder des états persistants de session et recevoir les nouveaux éléments pertinents. Leur préparation initiale, leur réplication et leur restauration ont un coût. Une représentation latente compacte ne garantit pas la conservation exacte de tous les détails d'un dépôt.

Pour le code, les identifiants, les chaînes littérales, les interfaces, les contraintes et les résultats de tests doivent rester accessibles. Une voie d'accès aux données exactes peut compléter une représentation latente ; chaque récupération doit être comptabilisée. Si les récupérations deviennent fréquentes et séquentielles, elles reconstituent le problème réseau.

Il faut tester des contextes longs, des dépendances entre fichiers, les changements de fichiers en cours de session et la reprise après outils. Les outils produisent des informations inconnues à l'avance : l'architecture doit permettre d'interrompre un bloc et de reprendre avec ces observations.

## Peut-on se rapprocher d'un datacenter ?

Le budget réseau simplifié par token est `R × RTT / B`, si R tours complets de cette durée suffisent pour B tokens utiles. Exemple purement illustratif : deux tours à 80 ms pour 16 tokens représentent 10 ms par token, amortis. Le premier bloc attend néanmoins au moins 160 ms de réseau dans cet exemple.

Le modèle complet doit ajouter calcul, transferts de données, fan-out, fusion, files, préfill, états, échecs et éventuelles itérations supplémentaires. Chaque tour peut avoir une durée supérieure à un seul RTT. L'exemple ne prédit aucun débit Fabi.

Même si le réseau cesse de dominer, les petits PC ne gagnent pas la bande passante mémoire ni la puissance de calcul d'un GPU de datacenter. On peut viser une expérience interactive satisfaisante sur certains profils, mais pas annoncer une parité générale de latence, qualité, débit concurrent et contexte long.

## Expérience qui départagera cette voie

Utiliser d'abord un modèle accessible pour comparer, à matériel et données maîtrisés : modèle original distribué, conversion limitée aux communications, conversion limitée à la génération par blocs, et combinaison des deux. Ajouter une référence qui bénéficie d'un budget d'adaptation similaire pour isoler l'effet de l'architecture.

La question n'est pas seulement de réussir quelques prompts. Mesurer la frontière qualité/latence en fonction des tours autorisés, des octets, de la mémoire et du contexte. Utiliser des tâches de code inédites avec outils, plusieurs langues et des changements de domaine, avec incertitude statistique. Évaluer le débit concurrent, les pauses p95 et les reprises après déconnexion.

Poursuivre vers de plus grands modèles seulement si l'autonomie augmente sans effondrement des compétences et si le gain survit à un vrai WAN. Rejeter la solution si elle exige finalement beaucoup de consultations, perd les détails du contexte, déplace tout le travail sur un gros coordinateur ou dépend du professeur en production.

Le niveau « proche de Kimi » doit désigner un ensemble d'évaluations et une marge de qualité explicitement fixée. La préservation de toutes ses capacités serait une affirmation beaucoup plus forte. Aucun résultat à petite échelle ne la démontre.

## Conclusion de travail

La piste à privilégier pour cette nouvelle ambition est une conversion progressive qui apprend des interfaces et une autonomie de calcul adaptées au WAN. Elle a des précédents partiels crédibles, mais la combinaison, son coût et sa qualité à l'échelle frontière restent ouverts. Il s'agit d'un programme de recherche sur le modèle et son moteur, pas d'une option de déploiement de Kimi déjà disponible.
