// Dérivation de l'état de connexion — port de la logique `deriveReasons` du CLI,
// MAIS sans poll : l'état du swarm (peers, capacité, prêt) vient de l'entrée
// registry poussée par SSE (fan-out, un seul scan serveur), et l'état local du
// worker vient de ses events `[FABI]` (push stdout). Deux flux push, zéro poll.
//
// Combine en UN état présentable : titre + activité réelle + détail + compteurs.
// Priorité (comme le CLI) : binaire manquant → crash → démarrage → étape worker
// (alloc-timeout / handshake / join / chargement poids) → état swarm (registry :
// injoignable / available+actif=prêt / waiting → besoin de peers / capacité).

import { ConnectionInfo, SwarmEntry, WorkerState } from '../common/fabi-swarm-protocol';

export function deriveConnection(
    active: SwarmEntry | undefined,
    worker: WorkerState
): ConnectionInfo {
    const peersTotal = active?.peers;
    const peersActive = active?.nodesActive;
    const peersInitializing = active?.nodesInitializing;
    const pipelineReady = active?.pipelineReady;
    const pipelineCount = active?.pipelineCount;
    const pipelineReadyCount = active?.pipelineReadyCount;
    const layersAssigned = worker.startLayer !== undefined && worker.endLayer !== undefined
        ? worker.endLayer - worker.startLayer : undefined;
    const base = {
        peersActive, peersTotal, peersInitializing, layersAssigned,
        weightsDone: worker.weightsFilesDone, weightsTotal: worker.weightsFilesTotal
    };

    if (!active) {
        return { reason: 'pick-model', ready: false, headline: 'Choisis un modèle',
            activity: 'sélectionne un swarm à rejoindre dans la liste', ...base };
    }

    // ----- niveau worker (events stdout) -----
    if (worker.kind === 'missing-binary') {
        return { reason: 'worker-missing-binary', ready: false, headline: 'Moteur non installé',
            activity: 'installe le moteur Fabi pour rejoindre le swarm', detail: worker.message, ...base };
    }
    if (worker.kind === 'error' || worker.kind === 'stopped') {
        return { reason: 'worker-crashed', ready: false, headline: 'Redémarrage du worker',
            activity: worker.message ?? 'le worker s\'est arrêté',
            detail: 'le worker a planté — redémarrage automatique dans 30 s', ...base };
    }
    if (worker.kind === 'starting') {
        return { reason: 'worker-starting', ready: false, headline: 'Démarrage du worker',
            activity: 'lancement du process Parallax', ...base };
    }

    // ----- états worker DÉFINITIFS (priment sur le scheduler) -----
    // Timeout d'allocation : échec local définitif.
    if (worker.stage === 'alloc-timeout') {
        return { reason: 'alloc-timeout', ready: false, headline: 'Allocation expirée',
            activity: 'le scheduler n\'a attribué aucune couche',
            detail: 'aucune couche allouée en 300 s — le worker redémarre ; vérifie que des peers rejoignent', ...base };
    }
    // On charge réellement nos poids → progrès local définitif.
    if (worker.stage === 'loading-weights') {
        let activity = 'chargement des poids du modèle en mémoire';
        if (worker.weightsCurrentFile) {
            activity = `chargement de ${worker.weightsCurrentFile}`;
        } else if (worker.weightsFilesTotal) {
            activity = `chargement des poids ${worker.weightsFilesDone ?? 0}/${worker.weightsFilesTotal}`;
        }
        return { reason: 'loading-model', ready: false, headline: 'Chargement du modèle', activity, ...base };
    }

    // ----- sinon (handshake / joining / ready) : le VERDICT DU SCHEDULER prime -----
    // Le worker en « joining » dit juste « j'ai demandé, j'attends » ; mais si le
    // scheduler a déjà répondu (failed_capacity, pas assez de peers…), c'est ÇA la
    // vérité actionnable — on ne masque pas avec un « connexion… » optimiste.
    if (active.status === 'offline') {
        return { reason: 'scheduler-unreachable', ready: false, headline: 'Scheduler injoignable',
            activity: 'le scheduler ne répond pas', ...base };
    }
    if (active.status === 'unknown' || active.schedulerStatus == null) {
        return { reason: 'connecting', ready: false, headline: 'Connexion au swarm',
            activity: 'contact du scheduler…', ...base };
    }

    const total = peersTotal ?? 0;

    // Pipeline complet côté scheduler. Nouveau signal préféré :
    // `pipelineReady=true` veut dire "au moins une route peut servir une requête
    // maintenant". Fallback pour anciens registries : si `nodesActive` existe, il
    // doit être > 0 ; sinon on conserve l'ancien comportement.
    if (active.schedulerStatus === 'available') {
        const hasServingPipeline = pipelineReady ?? (peersActive === undefined || peersActive > 0);
        if (!hasServingPipeline) {
            return { reason: 'loading-model', ready: false, headline: 'Pipeline en préparation',
                activity: peersInitializing && peersInitializing > 0
                    ? `${peersInitializing} nœud(s) chargent les poids du modèle`
                    : pipelineCount && pipelineCount > 0
                        ? `${pipelineReadyCount ?? 0}/${pipelineCount} pipeline(s) prête(s)`
                        : 'allocation créée — attente que le pipeline soit prêt',
                ...base };
        }
        if (worker.kind === 'running') {
            return { reason: 'ready', ready: true, headline: 'Connecté',
                activity: 'prêt — tu contribues', ...base };
        }
        return { reason: 'loading-model', ready: false, headline: 'Préparation',
            activity: 'le swarm est prêt — démarrage de ton worker…', ...base };
    }

    // schedulerStatus === 'waiting' : le pipeline n'est pas (encore) complet.
    // Verdict capacité/peers AVANT l'étape worker (sinon « joining » masquerait la vérité).
    if (pipelineCount && pipelineCount > 0 && pipelineReady === false) {
        return { reason: 'loading-model', ready: false, headline: 'Pipeline en préparation',
            activity: peersInitializing && peersInitializing > 0
                ? `${peersInitializing} nœud(s) chargent les poids du modèle`
                : `${pipelineReadyCount ?? 0}/${pipelineCount} pipeline(s) prête(s)`,
            ...base };
    }
    if (active.lastBootstrapResult === 'failed_capacity') {
        return { reason: 'insufficient-capacity', ready: false, headline: 'Pas assez de contributeurs',
            activity: `${total} nœud(s) — ce modèle ne tient pas sur les nœuds connectés, il faut un contributeur de plus`,
            detail: 'le swarm ne peut pas couvrir toutes les couches du modèle avec les nœuds actuels', ...base };
    }
    if (active.lastBootstrapResult === 'deferred_not_enough_nodes'
        || (active.initNodesNum !== undefined && total < active.initNodesNum)) {
        const need = active.initNodesNum;
        return { reason: 'need-more-peers', ready: false, headline: 'En attente de peers',
            activity: need ? `${total}/${need} nœuds — en attente d'un contributeur de plus` : `${total} nœud(s) — en attente d'un contributeur de plus`, ...base };
    }
    if (total === 0) {
        return { reason: 'connecting', ready: false, headline: 'Connexion au swarm',
            activity: 'découverte du scheduler via le DHT…', ...base };
    }
    // Bootstrap en cours (pending/null) : on reflète l'étape réelle du worker.
    if (worker.stage === 'handshake') {
        return { reason: 'connecting', ready: false, headline: 'Connexion au swarm',
            activity: 'établissement de la liaison pair-à-pair', ...base };
    }
    if (worker.stage === 'joining') {
        return { reason: 'connecting', ready: false, headline: 'Connexion au swarm',
            activity: 'demande d\'allocation des couches au scheduler', ...base };
    }
    return { reason: 'connecting', ready: false, headline: 'Connexion au swarm',
        activity: 'bootstrap du pipeline…', ...base };
}
