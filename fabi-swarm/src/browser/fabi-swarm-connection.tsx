import * as React from '@theia/core/shared/react';
import { SwarmEntry, ConnectionInfo, ConnectionReason, WorkerState } from '../common/fabi-swarm-protocol';
import { FabiLinkGlyph, FabiLinkState } from './fabi-link-glyph';

/**
 * Vue de connexion au swarm — sobre, basée sur le TEXTE de statut (pas de gros
 * visuel). Elle dit clairement ce qui se passe : statut courant + lignes
 * « live » dérivées de l'état réel (worker + registry) : redémarrage, attente de
 * pairs, allocation, chargement des poids, prêt. Plus une jauge fine quand c'est
 * pertinent (poids / pairs). Composant présentationnel pur.
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

    // Lignes « ce qui se passe », dans l'ordre, dédupliquées, sans vide.
    const lines = [connection?.headline, connection?.activity, connection?.detail, worker.message]
        .filter((l): l is string => !!l && l.trim().length > 0)
        .filter((l, i, arr) => arr.indexOf(l) === i)
        .slice(0, 4);

    // Jauge contextuelle sobre : poids si en chargement, sinon pairs.
    const weightsDone = connection?.weightsDone ?? worker.weightsFilesDone;
    const weightsTotal = connection?.weightsTotal ?? worker.weightsFilesTotal;
    const hasWeights = !!weightsTotal && weightsTotal > 0;
    const weightPct = hasWeights ? Math.round(((weightsDone ?? 0) / weightsTotal!) * 100) : 0;

    const peersActive = connection?.peersActive ?? active.nodesActive ?? active.peers ?? 0;
    const peersTotal = connection?.peersTotal ?? active.peers ?? peersActive;

    return (
        <div className={`fabi-cx phase-${phase}`}>
            <div className="fabi-cx-glyph"><FabiLinkGlyph state={glyphState} size="sm" /></div>

            <div className="fabi-cx-head">
                <span className="fabi-cx-model">{modelName}</span>
                <span className="fabi-cx-status">{statusLabel}</span>
            </div>

            {lines.length > 0 && (
                <div className="fabi-cx-log">
                    {lines.map((l, i) => (
                        <div key={i} className={`fabi-cx-log-line ${i === 0 ? 'lead' : ''}`}>{l}</div>
                    ))}
                </div>
            )}

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
