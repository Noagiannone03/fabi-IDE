import * as React from '@theia/core/shared/react';
import { Disposable, DisposableCollection } from '@theia/core';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { SwarmEntry, WorkerState, RuntimeStatus, ConnectionInfo } from '../common/fabi-swarm-protocol';
import { FabiConnectionView } from './fabi-swarm-connection';

/**
 * Sélecteur de swarm = sommet de l'input du chat. Rendu comme frère adjacent de
 * `.theia-ChatInput` (cf. FabiChatInputWidget) et fondu avec lui en CSS : barre +
 * zone d'expansion + cadre de l'input forment UNE surface continue.
 *
 * À l'ouverture, la zone d'expansion s'ajoute EN FLUX (pas de portail, pas
 * d'overlay) : l'input grandit vers le haut, comme s'il se dépliait. Deux vues :
 * liste (choisir un modèle) / connexion (statut texte sobre + « Changer de
 * modèle »). Branché live sur FabiSwarmFrontend.
 */
export const FabiSwarmSelector: React.FC<{ frontend: FabiSwarmFrontend; locked?: boolean }> = ({ frontend, locked }) => {
    const [swarms, setSwarms] = React.useState<SwarmEntry[]>(frontend.swarms);
    const [active, setActive] = React.useState<SwarmEntry | undefined>(frontend.active);
    const [connection, setConnection] = React.useState<ConnectionInfo | undefined>(frontend.connection);
    const [runtime, setRuntime] = React.useState<RuntimeStatus | undefined>(frontend.runtime);
    const [worker, setWorker] = React.useState<WorkerState>(frontend.worker);
    const [open, setOpen] = React.useState(false);
    const [view, setView] = React.useState<'list' | 'connection'>('list');
    const [busyId, setBusyId] = React.useState<string | undefined>(undefined);
    const [installing, setInstalling] = React.useState(false);

    const rootRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        const d = new DisposableCollection();
        d.push(frontend.onSwarmsChangedEvent(s => setSwarms(s)));
        d.push(frontend.onActiveChangedEvent(a => setActive(a)));
        d.push(frontend.onConnectionChangedEvent(c => setConnection(c)));
        d.push(frontend.onRuntimeChangedEvent(r => setRuntime(r)));
        d.push(frontend.onWorkerChangedEvent(w => setWorker(w)));
        void frontend.service.listSwarms().then(setSwarms).catch(() => { /* */ });
        void frontend.service.getRuntimeStatus().then(setRuntime).catch(() => { /* */ });
        return () => d.dispose();
    }, [frontend]);

    // Fermer au clic extérieur.
    React.useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onDown = (e: MouseEvent) => {
            if (rootRef.current?.contains(e.target as Node)) {
                return;
            }
            setOpen(false);
        };
        document.addEventListener('mousedown', onDown, true);
        const dispose = Disposable.create(() => document.removeEventListener('mousedown', onDown, true));
        return () => dispose.dispose();
    }, [open]);

    // En mode verrouillé (swarm pas prêt), le composant est toujours « ouvert » :
    // on cale la vue sur l'état réel — connexion si un modèle est choisi (on suit
    // son chargement / capacité), liste sinon (il faut en choisir un). On clé sur
    // l'id pour ne pas réinitialiser la vue à chaque push registry du même swarm.
    React.useEffect(() => {
        if (locked) {
            setView(active ? 'connection' : 'list');
        }
    }, [locked, active?.id]);

    const openPanel = () => {
        setView(active ? 'connection' : 'list');
        setOpen(true);
    };
    const toggle = () => (open ? setOpen(false) : openPanel());

    const install = async () => {
        setInstalling(true);
        try {
            await frontend.service.installRuntime();
        } finally {
            setInstalling(false);
        }
    };

    const connect = async (swarm: SwarmEntry) => {
        setBusyId(swarm.id);
        setView('connection');
        try {
            await frontend.service.connectSwarm(swarm.id);
        } finally {
            setBusyId(undefined);
        }
    };

    const disconnect = async () => {
        setBusyId(active?.id);
        try {
            await frontend.service.disconnect();
            setView('list');
        } finally {
            setBusyId(undefined);
        }
    };

    const connecting = !!active && !!connection && !connection.ready
        && connection.reason !== 'pick-model' && connection.reason !== 'worker-missing-binary';
    const barLabel = active ? (active.model.split('/').pop() ?? active.model) : 'Choisir un modèle';

    const renderList = () => {
        const installed = runtime?.installed ?? false;
        const sorted = [...swarms].sort((a, b) => {
            const rank = (s: SwarmEntry) => (s.status === 'online' ? 0 : 1);
            return rank(a) - rank(b) || b.peers - a.peers || a.model.localeCompare(b.model);
        });
        return (
            <div className="fabi-sel-list-view">
                {runtime && !installed && runtime.accel !== 'cpu' && (
                    <div className="fabi-sel-engine">
                        <button className="theia-button main" disabled={installing} onClick={install}>
                            {installing
                                ? (runtime.downloading ? `Installation… ${runtime.progress ?? 0}%` : 'Installation…')
                                : 'Installer le moteur'}
                        </button>
                        {runtime.downloading && (
                            <div className="fabi-sel-bar-track"><div className="fabi-sel-bar-fill" style={{ width: `${runtime.progress ?? 0}%` }} /></div>
                        )}
                        <span className="fabi-sel-hint">{runtime.platform} · une fois, téléchargé par l’app</span>
                    </div>
                )}
                {runtime && runtime.accel === 'cpu' && (
                    <div className="fabi-sel-hint">Pas de GPU supporté — cette machine ne peut pas rejoindre le swarm.</div>
                )}

                <div className="fabi-sel-list">
                    {sorted.length === 0 && <div className="fabi-sel-hint">Aucun swarm annoncé (registry injoignable ?)</div>}
                    {sorted.map(s => {
                        const isActive = active?.id === s.id;
                        const busy = busyId === s.id;
                        const offline = s.status !== 'online';
                        return (
                            <div
                                key={s.id}
                                className={`fabi-sel-row ${isActive ? 'active' : ''} ${offline ? 'offline' : ''}`}
                                onClick={() => !offline && !busy && connect(s)}
                            >
                                <div className="fabi-sel-row-main">
                                    <span className="fabi-sel-row-name">{s.model.split('/').pop() ?? s.model}</span>
                                </div>
                                <div className="fabi-sel-row-meta">
                                    <span>{s.peers} nœud{s.peers > 1 ? 's' : ''}</span>
                                    {s.totalVramGb > 0 && <span>· {s.totalVramGb} Go</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // Contenu de la zone dépliée, partagé entre le dropdown (mode normal) et la
    // carte plein-espace (mode verrouillé).
    const body = view === 'connection' && active
        ? <FabiConnectionView
            active={active}
            connection={connection}
            worker={worker}
            busy={busyId !== undefined}
            onChangeModel={() => setView('list')}
            onDisconnect={disconnect}
        />
        : renderList();

    // --- Mode VERROUILLÉ : le swarm ne peut pas (encore) servir → le sélecteur
    // prend toute la place de l'input (gros composant d'état/choix), et il n'y a
    // pas d'input du tout (cf. FabiChatInputWidget.render). Dès que le swarm est
    // prêt, l'IDE rebascule sur le rendu normal (barre compacte + input dessous).
    if (locked) {
        return (
            <div className="fabi-sel fabi-sel-locked" ref={rootRef}>
                <div className="fabi-sel-locked-card">
                    <div className="fabi-sel-locked-head">
                        <span className="fabi-sel-locked-title">{barLabel}</span>
                        {connection && connection.reason !== 'pick-model' && (
                            <span className="fabi-sel-locked-state">{connection.headline}</span>
                        )}
                    </div>
                    <div className="fabi-sel-locked-body">{body}</div>
                </div>
            </div>
        );
    }

    return (
        <div className={`fabi-sel ${open ? 'open' : ''}`} ref={rootRef}>
            {open && (
                <div className="fabi-sel-expand">
                    <div className="fabi-sel-expand-head">
                        <span className="fabi-sel-expand-title">
                            {view === 'connection' ? 'Connexion au swarm' : 'Choisis un modèle'}
                        </span>
                    </div>
                    <div className="fabi-sel-expand-body">{body}</div>
                </div>
            )}

            <button className="fabi-sel-bar" title="Modèle du swarm Fabi" onClick={toggle}>
                <span className="fabi-sel-bar-label">{barLabel}</span>
                {connecting && connection && <span className="fabi-sel-bar-sub">{connection.headline}</span>}
                <span className={`codicon ${open ? 'codicon-chevron-down' : 'codicon-chevron-up'} fabi-sel-caret`} />
            </button>
        </div>
    );
};
