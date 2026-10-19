import { AssistKnowledge, AssistNotebook } from './fabi-assist-protocol';
import { MaestroToolObservation } from './fabi-maestro-protocol';

export interface LearningOpportunity {
    id: string; path?: string; title: string; question: string; score: number;
    reason: 'dependency' | 'relationships' | 'source' | 'observation' | 'review' | 'journey';
}
/** Cheap candidate ranking precedes any inference. Evidence and learner history remain separate. */
export function learningOpportunities(knowledge: AssistKnowledge | undefined, book: AssistNotebook | undefined, now = Date.now(), observations: MaestroToolObservation[] = []): LearningOpportunity[] {
    if (book?.preferences?.invitations === false) return [];
    const candidates: LearningOpportunity[] = [];
    const explained = (file: string, since: number) => book?.turns.some(turn => turn.at >= since && (turn.context.path === file || turn.reply.sources.some(source => source.path === file)));
    if (knowledge?.phase === 'ready') for (const change of knowledge.changes) {
        if (change.kind === 'removed-from-inventory' || now - change.at > 30 * 60000 || explained(change.path, change.at)) continue;
        const added = change.dependenciesAdded ?? [], relationships = (change.importsAdded?.length ?? 0) + (change.importsRemoved?.length ?? 0);
        const reason = added.length ? 'dependency' : relationships ? 'relationships' : 'source';
        const symbol = change.symbolsChanged?.[0];
        const title = added.length ? `À quoi sert ${added[0]} ici ?` : relationships ? `Les liens de ${change.path.split('/').pop()} ont changé` : symbol ? `Que fait ${symbol} ici ?` : /(^|\/)package.json$/.test(change.path) ? 'Comprendre les dépendances de ce module' : `Comprendre ${change.path.split('/').pop()}`;
        candidates.push({ id: `${change.path}:${change.at}`, path: change.path, title, reason,
            score: added.length ? 90 : relationships ? 75 : symbol ? 70 : /(^|\/)package.json$/.test(change.path) ? 65 : /\.[cm]?[jt]sx?$/.test(change.path) ? 55 : 40,
            question: `Le fichier ${change.path} a changé sur disque.${symbol ? ` La déclaration ${symbol} a changé : lis son contenu actuel, ses paramètres, son résultat et les appels liés pour expliquer son rôle concret.` : ''}${added.length ? ` Dépendances ajoutées : ${added.join(', ')}.` : ''}${relationships ? ` Imports ajoutés : ${(change.importsAdded ?? []).join(', ')} ; retirés : ${(change.importsRemoved ?? []).join(', ')}.` : ''} Vérifie le contenu actuel et explique un mécanisme important avec ses liens vers le reste du projet. Distingue les faits, les hypothèses et les motivations non documentées ; n’attribue pas ce changement à un agent sans preuve.` });
    }
    for (const observation of observations.slice(-12)) {
        if (!observation.path || observation.phase === 'failed' || now - observation.at > 10 * 60000 || explained(observation.path, observation.at - 30 * 60000)) continue;
        candidates.push({ id: `source:${observation.path}`, path: observation.path, title: `On regarde ${observation.path.split('/').pop()} ?`, reason: 'observation', score: 70,
            question: `Un événement ${observation.tool} (${observation.phase}) de la session ${observation.sessionId} concerne ${observation.path}. Lis ce fichier et explique progressivement son rôle et ses liens dans mon projet. Cet événement ne prouve ni modification ni réussite de test.` });
    }
    for (const journey of book?.journeys ?? []) {
        if (journey.paused) continue;
        const step = journey.steps[journey.cursor];
        if (!step) continue;
        const concept = book?.concepts.find(item => item.id === step.conceptId);
        const prerequisite = concept?.prerequisites.map(id => book?.concepts.find(item => item.id === id)).find(item => item && item.status !== 'understood');
        candidates.push({ id: `journey:${journey.id}:${journey.cursor}`, path: step.source?.path, title: prerequisite ? `Avant la suite : ${prerequisite.title}` : step.title, reason: 'journey', score: 60,
            question: `Reprenons le parcours « ${journey.title} », étape ${journey.cursor + 1} : ${step.title}.${prerequisite ? ` Commence par le prérequis ${prerequisite.title}.` : ''} Appuie-toi sur mon carnet et ${step.source ? `le fichier ${step.source.path}` : 'les sources pertinentes'}. Un objectif à la fois.` });
    }
    for (const concept of book?.concepts ?? []) {
        if (!concept.reviewAt || concept.reviewAt > now) continue;
        const relevant = candidates.some(candidate => [concept.id, concept.title, ...concept.prerequisites].some(term => term.length >= 3 && `${candidate.title} ${candidate.path ?? ''}`.toLowerCase().includes(term.toLowerCase())));
        if (relevant) candidates.push({ id: `review:${concept.id}:${concept.reviewAt}`, title: `Reprendre ${concept.title}`, reason: 'review', score: concept.stage === 'reinforce' ? 100 : 80,
            question: `Aide-moi à réutiliser ${concept.title} dans le travail actuel. Objectif : ${concept.objective}. Pars de la difficulté observée dans mon carnet ; propose un rappel actif naturel, puis adapte l’explication à ma réponse.` });
    }
    if (!candidates.length && knowledge?.phase === 'ready') {
        const entries = knowledge.modules?.flatMap(module => module.entryPoints) ?? [];
        const entry = [...entries, ...(knowledge.learningFiles ?? [])].find(file => !explained(file, 0));
        if (entry) candidates.push({ id: `entry:${entry}`, path: entry, title: entries.includes(entry) ? `Par où commence ${entry.split('/').pop()} ?` : `On explore ${entry.split('/').pop()} ?`, reason: 'source', score: 20,
            question: `Explique le rôle du fichier ${entry} et ses relations réelles avec le projet. Vérifie les fichiers. Ne prétends pas que l’agent travaille dessus : c’est une découverte du projet pendant l’attente.` });
    }
    const recent = book?.invitations?.filter(item => now - item.at < 24 * 60 * 60000) ?? [];
    return candidates.filter(candidate => !recent.some(item => item.id === candidate.id))
        .map(candidate => ({ ...candidate, score: candidate.score + (observations.some(item => item.path === candidate.path) ? 15 : 0) - (book?.preferences?.minutes === 2 && candidate.reason === 'relationships' ? 20 : 0) }))
        .sort((a, b) => b.score - a.score).filter((candidate, index, items) => items.findIndex(item => item.id === candidate.id) === index).slice(0, 3);
}
export function learningOpportunity(knowledge: AssistKnowledge | undefined, book: AssistNotebook | undefined, now = Date.now(), observations: MaestroToolObservation[] = []): LearningOpportunity | undefined {
    return learningOpportunities(knowledge, book, now, observations)[0];
}
