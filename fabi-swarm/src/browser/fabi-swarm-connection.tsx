import * as React from '@theia/core/shared/react';
import { SwarmEntry, ConnectionInfo, ConnectionReason, WorkerState } from '../common/fabi-swarm-protocol';
import { FabiSwarmLink, FabiLinkState } from './fabi-swarm-link';

/**
 * Vue de connexion au swarm — sobre et centrée. L'animation « machine ↔ swarm »
 * est le point focal, au milieu. Sous elle : le modèle, un statut court, et UNE
 * seule ligne « live » (la plus pertinente) — pas de pavé de logs. Une jauge fine
 * apparaît seulement quand elle apporte de l'info (poids / pairs). Présentationnel.
 */

type Phase = 'connecting' | 'waiting' | 'loading' | 'ready' | 'error';

const PHASE_OF: Record<ConnectionReason, Phase> = {
    'ready': 'ready',
    'loading-model': 'loading',
    'connecting': 'connecting',
    'worker-starting': 'connecting',
    'pick-model': 'waiting',
    'need-more-peers': 'waiting',
    'insufficient-capacity': 'waiting',
    'alloc-timeout': 'error',
    'scheduler-unreachable': 'error',
    'worker-crashed': 'error',
    'worker-missing-binary': 'error'
};

export interface FabiConnectionViewProps {
    active: SwarmEntry;
    connection: ConnectionInfo | undefined;
    worker: WorkerState;
    onChangeModel: () => void;
    onDisconnect: () => void;
    busy?: boolean;
}

export const FabiConnectionView: React.FC<FabiConnectionViewProps> = (
    { active, connection, worker, onChangeModel, onDisconnect, busy }
) => {
    const reason: ConnectionReason = connection?.reason ?? 'connecting';
    const phase = PHASE_OF[reason];
    const modelName = active.model.split('/').pop() ?? active.model;

    const glyphState: FabiLinkState = phase === 'ready' ? 'flow'
        : phase === 'error' ? 'error'
            : phase === 'waiting' ? 'waiting'
                : 'connecting';

    const statusLabel = connection?.ready ? 'Connecté'
        : phase === 'error' ? 'Problème'
            : phase === 'waiting' ? 'En attente'
                : phase === 'loading' ? 'Chargement'
                    : 'Connexion';

    // UNE seule ligne « live » : la plus parlante de l'état réel, et seulement si
    // elle ajoute vraiment quelque chose au statut (pas un doublon, pas de pavé).
    const detail = [connection?.activity, connection?.headline, connection?.detail, worker.message]
        .find(l => !!l && l.trim().length > 0 && l.trim().toLowerCase() !== statusLabel.toLowerCase());

    // Jauge contextuelle sobre : poids si en chargement, sinon pairs.
    const weightsDone = connection?.weightsDone ?? worker.weightsFilesDone;
    const weightsTotal = connection?.weightsTotal ?? worker.weightsFilesTotal;
    const hasWeights = !!weightsTotal && weightsTotal > 0;
    const weightPct = hasWeights ? Math.round(((weightsDone ?? 0) / weightsTotal!) * 100) : 0;

    const peersActive = connection?.peersActive ?? active.nodesActive ?? active.peers ?? 0;
    const peersTotal = connection?.peersTotal ?? active.peers ?? peersActive;

    return (
        <div className={`fabi-cx phase-${phase}`}>
            {/* L'animation, au milieu : point focal sobre de la vue. */}
            <div className="fabi-cx-stage"><FabiSwarmLink state={glyphState} size="md" /></div>

            <div className="fabi-cx-info">
                <span className="fabi-cx-model">{modelName}</span>
                <span className="fabi-cx-status">{statusLabel}</span>
                {detail && <span className="fabi-cx-detail">{detail}</span>}
            </div>

            {!connection?.ready && hasWeights && (
                <div className="fabi-cx-progress">
                    <div className="fabi-cx-bar"><div className="fabi-cx-bar-fill" style={{ width: `${weightPct}%` }} /></div>
                    <span className="fabi-cx-progress-label">Poids · {weightsDone ?? 0}/{weightsTotal}</span>
                </div>
            )}
            {!connection?.ready && !hasWeights && peersTotal > 0 && (
                <div className="fabi-cx-progress">
                    <span className="fabi-cx-progress-label">{peersActive}/{peersTotal} nœud{peersTotal > 1 ? 's' : ''} actif{peersActive > 1 ? 's' : ''}</span>
                </div>
            )}

            <div className="fabi-cx-actions">
                <button className="fabi-cx-link" onClick={onChangeModel} disabled={busy}>Changer de modèle</button>
                {connection?.ready && (
                    <button className="fabi-cx-link muted" onClick={onDisconnect} disabled={busy}>Se déconnecter</button>
                )}
            </div>
        </div>
    );
};
