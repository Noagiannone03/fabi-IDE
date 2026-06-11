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

    // ----- étape live du worker -----
    switch (worker.stage) {
        case 'alloc-timeout':
            return { reason: 'alloc-timeout', ready: false, headline: 'Allocation expirée',
                activity: 'le scheduler n\'a attribué aucune couche',
                detail: 'aucune couche allouée en 300 s — le worker redémarre ; vérifie que des peers rejoignent', ...base };
        case 'handshake':
            return { reason: 'connecting', ready: false, headline: 'Connexion au swarm',
                activity: 'établissement de la liaison pair-à-pair', ...base };
        case 'joining':
            return { reason: 'connecting', ready: false, headline: 'Connexion au swarm',
                activity: 'demande d\'allocation des couches au scheduler', ...base };
        case 'loading-weights': {
            let activity = 'chargement des poids du modèle en mémoire';
            if (worker.weightsCurrentFile) {
                activity = `chargement de ${worker.weightsCurrentFile}`;
            } else if (worker.weightsFilesTotal) {
                activity = `chargement des poids ${worker.weightsFilesDone ?? 0}/${worker.weightsFilesTotal}`;
            }
            return { reason: 'loading-model', ready: false, headline: 'Chargement du modèle', activity, ...base };
        }
    }

    // ----- worker prêt (ou running sans étape) : l'état swarm (registry) décide -----
    // active.status = atteignabilité du scheduler vue par le registry.
    if (active.status === 'offline') {
        return { reason: 'scheduler-unreachable', ready: false, headline: 'Connexion au swarm',
            activity: 'le scheduler ne répond pas', ...base };
    }
    if (active.status === 'unknown' || active.schedulerStatus == null) {
        return { reason: 'connecting', ready: false, headline: 'Connexion au swarm',
            activity: 'contact du scheduler…', ...base };
    }

    const total = peersTotal ?? 0;
    const activeNodes = peersActive ?? 0;

    if (active.schedulerStatus === 'available') {
        if (activeNodes > 0 && worker.stage === 'ready') {
            return { reason: 'ready', ready: true, headline: 'Connecté',
                activity: 'prêt — tu contribues 🦦', ...base };
        }
        const initing = peersInitializing ?? 0;
        return { reason: 'loading-model', ready: false, headline: 'Chargement du modèle',
            activity: initing > 1 ? `en attente que ${initing} peers finissent de charger` : 'en attente qu\'un peer finisse de charger le modèle', ...base };
    }

    // schedulerStatus === 'waiting'
    if (total === 0) {
        return { reason: 'connecting', ready: false, headline: 'Connexion au swarm',
            activity: 'découverte du scheduler via le DHT…', ...base };
    }
    if (active.lastBootstrapResult === 'failed_capacity') {
        return { reason: 'insufficient-capacity', ready: false, headline: 'Capacité insuffisante',
            activity: `${total} nœud(s) connecté(s), mais pas assez pour un pipeline complet`,
            detail: 'il manque de la VRAM cumulée pour couvrir toutes les couches du modèle', ...base };
    }
    if (active.lastBootstrapResult === 'deferred_not_enough_nodes' || active.needMoreNodes
        || (active.initNodesNum !== undefined && total < active.initNodesNum)) {
        const need = active.initNodesNum;
        return { reason: 'need-more-peers', ready: false, headline: 'En attente de peers',
            activity: need ? `${total}/${need} nœuds — en attente de plus de contributeurs` : `${total} nœud(s) — en attente de plus de contributeurs`, ...base };
    }
    return { reason: 'connecting', ready: false, headline: 'Connexion au swarm',
        activity: 'bootstrap du pipeline…', ...base };
}
