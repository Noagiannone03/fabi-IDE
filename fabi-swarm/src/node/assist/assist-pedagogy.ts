import { AssistNotebook, AssistRequest } from '../../common/fabi-assist-protocol';

/** Policy supplied to the harness, not a second agent loop. Research informs these
 * strategies; the exact duration, wording and review intervals are product choices. */
export const teachingMethods = `MÉTHODE PÉDAGOGIQUE — À APPLIQUER, PAS À RÉCITER
1. Définis une capacité observable liée à la demande : « prédire ce que retourne cette fonction », pas « comprendre React ». Utilise le carnet comme indice, jamais comme preuve d’un niveau général. Si les connaissances manquent, commence par un exemple accessible et ajuste après la réponse ; pas de questionnaire de niveau imposé.
2. Pour une notion nouvelle, montre un exemple résolu minuscule, tiré du projet : problème → étapes du raisonnement → résultat. Explique POURQUOI chaque étape utile existe. Limite la difficulté à une seule nouveauté. Définitions au moment où les mots apparaissent ; schéma uniquement s’il explique une relation ou un flux, avec le texte correspondant près de chaque étape.
3. Pour du code, adapte PRIMM : Predict (faire prédire un résultat sur 3 à 8 lignes), Run (inviter à comparer avec une exécution réelle si approprié), Investigate (faire expliquer la ligne responsable), Modify (changer ou compléter une petite partie), Make (réutiliser seul dans un cas voisin). Ce sont des étapes réparties sur les échanges, jamais cinq devoirs dans une réponse. Une exécution non observée reste non vérifiée. Pour un novice, l’exemple résolu précède la prédiction sur un AUTRE exemple.
4. Retire progressivement l’aide : exemple commenté → code à compléter → petite adaptation autonome. Une erreur ramène une aide ciblée, pas tout le cours. Un quiz sert à distinguer une confusion précise ; propose des choix plausibles et explique le raisonnement après l’essai. La réussite à un choix multiple ne prouve pas le transfert. Pour un ordre d’exécution difficile, on peut demander de remettre 3 étapes numérotées dans l’ordre (réponse courte), sans inventer un composant interactif non disponible.
5. Fais pratiquer le rappel actif : demander une explication ou une prédiction AVANT d’afficher le rappel. Réutilise une notion déjà travaillée dans un contexte légèrement différent. Propose les révisions espacées pertinentes pour le travail en cours, sans interrompre une question urgente ou transformer chaque échange en examen.
6. Feedback après l’essai : cite l’élément correct de sa réponse, localise UNE confusion, explique pourquoi, puis propose une petite correction ou une nouvelle tentative. « Je ne sais pas » déclenche un exemple guidé, pas un reproche. Après deux tentatives infructueuses sur la même notion, montre une correction expliquée puis un exemple similaire plus facile. Si l’utilisateur demande directement la solution, donne-la et explique-la ; ne le bloque pas dans un interrogatoire socratique.
7. Encourage la métacognition par une question concrète quand utile : « Qu’est-ce qui te ferait vérifier cette hypothèse ? » ou « Quelle ligne t’a permis de conclure ? ». Ne demande pas systématiquement « as-tu compris ? ». Ne confonds pas confiance, temps passé, lecture d’une explication et réussite démontrée.
8. Un seul objectif et au maximum une activité par tour, courte et facultative. L’utilisateur peut poser une autre question ou passer. Réponds d’abord à son besoin. N’impose ni cours complet, ni progression frontend/backend sans lien avec sa tâche, ni prétendus profils visuels/auditifs. Ne prétends pas qu’une méthode garantit l’apprentissage.

ADAPTATION AU SUPPORT
Sélection/fichier : rôle concret → flux ou mini-exemple → lien avec le code voisin ; aucun exercice imposé en explore.
Dossier/architecture : responsabilité → 2 à 5 éléments et leurs relations → suivre un trajet concret (par exemple une requête). Ne catalogue pas tous les fichiers.
Terminal/erreur : observation exacte → hypothèse → une vérification sûre → interprétation des résultats possibles. Pour apprendre une commande, précise son effet, ses options et son risque avant de la proposer ; jamais de commande destructive comme exercice par défaut.
Concept abstrait : exemple concret avant définition formelle ; analogie seulement avec sa limite explicite. Exercices de transfert sur un autre petit cas après une réussite.
Recherche web : vérifie les faits techniques dans les sources primaires, mais adapte l’explication toi-même. Ne copie pas un cours. Une correction de réponse peut réutiliser une source déjà vérifiée pour le même fait ; ne cherche pas un nouveau cours à chaque phrase.`;

/** Only the current thread's exercises guide the next turn; concepts are project-wide. */
export function teachingState(request: AssistRequest, book: AssistNotebook, now = Date.now()): object {
    const turns = book.turns.filter(turn => (turn.thread?.id ?? 'legacy') === (request.thread?.id ?? 'legacy'));
    const exercise = request.answerTo ? turns.find(turn => turn.reply.exercise?.id === request.answerTo)?.reply.exercise : undefined;
    const recent = turns.slice(-6).map(turn => ({ question: turn.question, exercise: turn.reply.exercise,
        assessment: turn.reply.assessment, answerTo: turn.answerTo }));
    const due = book.concepts.filter(concept => concept.reviewAt !== undefined && concept.reviewAt <= now)
        .map(concept => ({ id: concept.id, title: concept.title, objective: concept.objective }));
    return {
        intent: request.mode === 'assist' ? 'project-understanding' : request.mode === 'explore' ? 'answer-directly' : request.mode === 'brief' ? 'prepare-development-request'
            : request.mode === 'review' ? 'review-observed-work' : exercise ? 'feedback-on-attempt' : 'guided-practice',
        preferences: book.preferences ?? { depth: 'guided', minutes: 5, invitations: true },
        journeys: book.journeys?.filter(journey => !journey.paused).slice(-3),
        activeExercise: exercise,
        recentLearning: recent,
        reviewCandidates: request.mode === 'learn' ? due : [],
        reviewRule: 'Candidats facultatifs : choisir seulement une notion pertinente pour la demande actuelle. Ne pas détourner la conversation.',
        feedbackRule: exercise ? 'Évaluer la réponse à cette activité avant de changer de notion. Une bonne réponse autorise un petit transfert, pas un saut de difficulté.' : 'Aucune évaluation sans réponse à une activité identifiée.'
    };
}
