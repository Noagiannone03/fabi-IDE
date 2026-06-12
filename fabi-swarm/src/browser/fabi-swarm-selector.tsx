import * as React from '@theia/core/shared/react';
import * as ReactDOM from '@theia/core/shared/react-dom';
import { Disposable, DisposableCollection } from '@theia/core';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { SwarmEntry, WorkerState, RuntimeStatus, ConnectionInfo } from '../common/fabi-swarm-protocol';

/**
 * Sélecteur de swarm intégré à l'input du chat IA (pas de panneau séparé).
 * Affiche une « pill » avec le modèle actif + son état ; au clic, ouvre une box
 * au-dessus de l'input (portail vers document.body, façon SelectComponent de
 * Theia) listant les swarms dispos (peers, modèle), permettant d'installer le
 * moteur et de se connecter. Branché sur FabiSwarmFrontend (push SSE + events).
 */
export const FabiSwarmSelector: React.FC<{ frontend: FabiSwarmFrontend }> = ({ frontend }) => {
    const [swarms, setSwarms] = React.useState<SwarmEntry[]>(frontend.swarms);
    const [active, setActive] = React.useState<SwarmEntry | undefined>(frontend.active);
    const [connection, setConnection] = React.useState<ConnectionInfo | undefined>(frontend.connection);
    const [runtime, setRuntime] = React.useState<RuntimeStatus | undefined>(frontend.runtime);
    const [, setWorker] = React.useState<WorkerState>(frontend.worker);
    const [open, setOpen] = React.useState(false);
    const [busyId, setBusyId] = React.useState<string | undefined>(undefined);
    const [installing, setInstalling] = React.useState(false);

    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const popoverRef = React.useRef<HTMLDivElement | null>(null);

    // Abonnements live (push) — zéro polling côté UI.
    React.useEffect(() => {
        const d = new DisposableCollection();
        d.push(frontend.onSwarmsChangedEvent(s => setSwarms(s)));
        d.push(frontend.onActiveChangedEvent(a => setActive(a)));
        d.push(frontend.onConnectionChangedEvent(c => setConnection(c)));
        d.push(frontend.onRuntimeChangedEvent(r => setRuntime(r)));
        d.push(frontend.onWorkerChangedEvent(w => setWorker(w)));
        // Premier état (si le backend a déjà poussé avant le montage).
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
            const t = e.target as Node;
            if (popoverRef.current?.contains(t) || triggerRef.current?.contains(t)) {
                return;
            }
            setOpen(false);
        };
        document.addEventListener('mousedown', onDown, true);
        const dispose = Disposable.create(() => document.removeEventListener('mousedown', onDown, true));
        return () => dispose.dispose();
    }, [open]);

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
        } finally {
            setBusyId(undefined);
        }
    };

    // ----- pill (déclencheur) -----
    const ready = !!connection && connection.ready;
    const connecting = !!active && !!connection && !connection.ready
        && connection.reason !== 'pick-model' && connection.reason !== 'worker-missing-binary';
    const pillLabel = active ? (active.model.split('/').pop() ?? active.model) : 'Choisir un modèle';
    const dotClass = ready ? 'ready' : connecting ? 'connecting' : 'idle';

    // ----- popover (portail au-dessus de l'input) -----
    const renderPopover = () => {
        const trig = triggerRef.current;
        if (!trig) {
            return null;
        }
        const r = trig.getBoundingClientRect();
        const width = Math.max(300, Math.min(380, r.width * 2));
        const left = Math.min(r.left, window.innerWidth - width - 12);
        const style: React.CSSProperties = {
            position: 'fixed',
            left: Math.max(8, left),
            bottom: window.innerHeight - r.top + 8,
            width
        };

        const installed = runtime?.installed ?? false;
        const sorted = [...swarms].sort((a, b) => {
            const rank = (s: SwarmEntry) => (s.status === 'online' ? 0 : 1);
            return rank(a) - rank(b) || b.peers - a.peers || a.model.localeCompare(b.model);
        });

        return ReactDOM.createPortal(
            <div className='fabi-sel-popover' style={style} ref={popoverRef}>
                <div className='fabi-sel-title'>Swarm Fabi — choisis un modèle</div>

                {/* Moteur (si pas installé et machine GPU) */}
                {runtime && !installed && runtime.accel !== 'cpu' && (
                    <div className='fabi-sel-engine'>
                        <button className='theia-button main' disabled={installing} onClick={install}>
                            {installing
                                ? (runtime.downloading ? `Installation… ${runtime.progress ?? 0}%` : 'Installation…')
                                : 'Installer le moteur'}
                        </button>
                        {runtime.downloading && (
                            <div className='fabi-sel-bar'><div className='fabi-sel-bar-fill' style={{ width: `${runtime.progress ?? 0}%` }} /></div>
                        )}
                        <span className='fabi-sel-hint'>{runtime.platform} · une fois, téléchargé par l’app</span>
                    </div>
                )}
                {runtime && runtime.accel === 'cpu' && (
                    <div className='fabi-sel-hint'>Pas de GPU supporté — cette machine ne peut pas rejoindre le swarm.</div>
                )}

                {/* Liste des modèles */}
                <div className='fabi-sel-list'>
                    {sorted.length === 0 && <div className='fabi-sel-hint'>Aucun swarm annoncé (registry injoignable ?)</div>}
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
                                <div className='fabi-sel-row-main'>
                                    <span className='fabi-sel-row-name'>{s.model.split('/').pop() ?? s.model}</span>
                                    <span className={`fabi-sel-badge st-${s.status}`}>{s.status}</span>
                                </div>
                                <div className='fabi-sel-row-meta'>
                                    <span>{s.peers} nœud{s.peers > 1 ? 's' : ''}</span>
                                    {s.totalVramGb > 0 && <span>· {s.totalVramGb} Go</span>}
                                    {isActive && connection && <span className='fabi-sel-row-state'>· {connection.activity}</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {active && ready && (
                    <button className='theia-button secondary fabi-sel-disconnect' onClick={disconnect}>Se déconnecter</button>
                )}
            </div>,
            document.body
        );
    };

    return (
        <div className='fabi-sel'>
            <button
                ref={triggerRef}
                className={`fabi-sel-pill ${open ? 'open' : ''}`}
                title='Modèle du swarm Fabi'
                onClick={() => setOpen(o => !o)}
            >
                <span className={`fabi-sel-dot ${dotClass}`} />
                <span className='fabi-sel-pill-label'>{pillLabel}</span>
                {connecting && connection && <span className='fabi-sel-pill-sub'>{connection.headline}</span>}
                <span className='codicon codicon-chevron-up fabi-sel-caret' />
            </button>
            {open && renderPopover()}
        </div>
    );
};
