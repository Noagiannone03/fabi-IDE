import * as React from '@theia/core/shared/react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { DisposableCollection } from '@theia/core';
import { MessageService } from '@theia/core/lib/common';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { SwarmEntry, WorkerState, RuntimeStatus, ConnectionInfo } from '../common/fabi-swarm-protocol';

/**
 * Panneau « Fabi Swarm » : liste les modèles dispos (registry + SSE live),
 * installe le moteur si besoin, se connecte à un modèle (= join = contribuer son
 * GPU) et affiche l'écran de connexion fidèle au CLI (peers, allocation des
 * couches, chargement des poids, prêt). Le modèle actif sert dans le chat IA.
 */
@injectable()
export class FabiSwarmWidget extends ReactWidget {

    static readonly ID = 'fabi.swarm';
    static readonly LABEL = 'Fabi Swarm';

    @inject(FabiSwarmFrontend)
    protected readonly frontend: FabiSwarmFrontend;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    protected swarms: SwarmEntry[] = [];
    protected worker: WorkerState = { kind: 'stopped' };
    protected active: SwarmEntry | undefined;
    protected runtime: RuntimeStatus | undefined;
    protected connection: ConnectionInfo | undefined;
    protected busyId: string | undefined;
    protected installing = false;

    /** Suivi du temps de connexion (hints 3 min / 8 min, comme le CLI). */
    protected connectingSince: number | undefined;
    protected elapsedTimer?: ReturnType<typeof setInterval>;

    protected readonly toDispose = new DisposableCollection();

    @postConstruct()
    protected init(): void {
        this.id = FabiSwarmWidget.ID;
        this.title.label = FabiSwarmWidget.LABEL;
        this.title.caption = 'Fabi Swarm — inférence P2P';
        this.title.iconClass = 'codicon codicon-broadcast';
        this.title.closable = true;
        this.node.classList.add('fabi-swarm');

        this.swarms = this.frontend.swarms;
        this.worker = this.frontend.worker;
        this.active = this.frontend.active;
        this.runtime = this.frontend.runtime;
        this.connection = this.frontend.connection;

        this.toDispose.push(this.frontend.onSwarmsChangedEvent(s => { this.swarms = s; this.update(); }));
        this.toDispose.push(this.frontend.onWorkerChangedEvent(w => { this.worker = w; this.update(); }));
        this.toDispose.push(this.frontend.onActiveChangedEvent(a => { this.active = a; this.update(); }));
        this.toDispose.push(this.frontend.onRuntimeChangedEvent(r => { this.runtime = r; this.update(); }));
        this.toDispose.push(this.frontend.onConnectionChangedEvent(c => { this.onConnection(c); }));

        void this.frontend.service.listSwarms().then(s => { this.swarms = s; this.update(); }).catch(() => { /* */ });
        void this.frontend.service.getRuntimeStatus().then(r => { this.runtime = r; this.update(); }).catch(() => { /* */ });

        this.update();
    }

    override dispose(): void {
        this.toDispose.dispose();
        if (this.elapsedTimer) {
            clearInterval(this.elapsedTimer);
        }
        super.dispose();
    }

    /** Met à jour la connexion + gère le chrono « depuis quand on se connecte ». */
    protected onConnection(c: ConnectionInfo): void {
        this.connection = c;
        const connecting = !c.ready && c.reason !== 'pick-model' && c.reason !== 'worker-missing-binary';
        if (connecting && this.connectingSince === undefined) {
            this.connectingSince = Date.now();
            this.elapsedTimer = setInterval(() => this.update(), 1000);
        } else if (!connecting && this.connectingSince !== undefined) {
            this.connectingSince = undefined;
            if (this.elapsedTimer) {
                clearInterval(this.elapsedTimer);
                this.elapsedTimer = undefined;
            }
        }
        this.update();
    }

    protected async install(): Promise<void> {
        this.installing = true; this.update();
        try {
            const r = await this.frontend.service.installRuntime();
            if (r.installed) {
                this.messageService.info('Moteur Fabi installé ✓ — choisis un modèle pour te connecter.');
            } else {
                this.messageService.error(r.message ?? 'Installation du moteur échouée.');
            }
        } finally {
            this.installing = false;
            this.update();
        }
    }

    protected async connect(swarm: SwarmEntry): Promise<void> {
        this.busyId = swarm.id; this.update();
        try {
            const state = await this.frontend.service.connectSwarm(swarm.id);
            if (state.kind === 'missing-binary') {
                this.messageService.info(state.message ?? 'Installe d\'abord le moteur.');
            }
        } finally {
            this.busyId = undefined;
            this.update();
        }
    }

    protected async disconnect(): Promise<void> {
        this.busyId = this.active?.id; this.update();
        try {
            await this.frontend.service.disconnect();
        } finally {
            this.busyId = undefined;
            this.update();
        }
    }

    protected elapsedLabel(): string {
        if (this.connectingSince === undefined) {
            return '';
        }
        const s = Math.floor((Date.now() - this.connectingSince) / 1000);
        const mm = Math.floor(s / 60);
        const ss = s % 60;
        return `${mm}:${ss.toString().padStart(2, '0')}`;
    }

    protected hint(): string | undefined {
        if (this.connectingSince === undefined) {
            return undefined;
        }
        const s = (Date.now() - this.connectingSince) / 1000;
        if (s > 480) {
            return 'C\'est plus long que prévu. Vérifie ton réseau et que l\'ordi ne s\'est pas mis en veille. Si ça bloque, relance Fabi.';
        }
        if (s > 180) {
            return 'Le premier téléchargement des poids peut prendre quelques minutes sur une connexion lente.';
        }
        return undefined;
    }

    /** Écran de connexion (worker + scheduler) quand le swarm actif n'est pas prêt. */
    protected renderConnection(c: ConnectionInfo): React.ReactNode {
        const pct = c.weightsTotal ? Math.round(((c.weightsDone ?? 0) / c.weightsTotal) * 100) : undefined;
        const hint = this.hint();
        return (
            <div className='fabi-swarm-card fabi-swarm-connecting'>
                <div className='fabi-swarm-conn-head'>
                    <span className='codicon codicon-loading codicon-modifier-spin' />
                    <span className='fabi-swarm-conn-title'>{c.headline}</span>
                </div>
                <div className='fabi-swarm-conn-activity'>{c.activity}…</div>

                {pct !== undefined && (
                    <div className='fabi-swarm-progress'>
                        <div className='fabi-swarm-progress-bar' style={{ width: `${pct}%` }} />
                    </div>
                )}

                <div className='fabi-swarm-conn-meta'>
                    {typeof c.peersTotal === 'number' && (
                        <span>Peers {c.peersActive ?? 0}/{c.peersTotal}{c.peersInitializing ? ` · ${c.peersInitializing} en init` : ''}</span>
                    )}
                    {typeof c.layersAssigned === 'number' && <span>· {c.layersAssigned} couches</span>}
                    {pct !== undefined && <span>· {c.weightsDone ?? 0}/{c.weightsTotal} fichiers ({pct}%)</span>}
                    {this.connectingSince !== undefined && <span>· {this.elapsedLabel()}</span>}
                </div>

                {c.detail && <div className='fabi-swarm-sub fabi-swarm-conn-detail'>{c.detail}</div>}
                {hint && <div className='fabi-swarm-sub'>{hint}</div>}

                <div className='fabi-swarm-conn'>
                    <button className='theia-button secondary' disabled={this.busyId === this.active?.id} onClick={() => this.disconnect()}>
                        Annuler
                    </button>
                </div>
            </div>
        );
    }

    protected render(): React.ReactNode {
        const rt = this.runtime;
        const installed = rt?.installed ?? false;
        const c = this.connection;
        const showConnecting = !!this.active && !!c && !c.ready
            && c.reason !== 'pick-model' && c.reason !== 'worker-missing-binary';
        const sorted = [...this.swarms].sort((a, b) => {
            const rank = (s: SwarmEntry) => (s.status === 'online' ? 0 : 1);
            return rank(a) - rank(b) || b.peers - a.peers || a.model.localeCompare(b.model);
        });

        return (
            <div className='fabi-swarm-scroll'>
                <div className='fabi-swarm-hero'>
                    <span className='codicon codicon-broadcast fabi-swarm-hero-icon' />
                    <h2>Fabi Swarm</h2>
                    <p className='fabi-swarm-tagline'>Inférence LLM distribuée en P2P. Choisis un modèle → tu prêtes ton GPU → tu l’utilises dans le chat.</p>
                </div>

                {/* Moteur */}
                <div className='fabi-swarm-card'>
                    <div className='fabi-swarm-row'>
                        <span className='fabi-swarm-key'>Moteur</span>
                        <span className='fabi-swarm-val'>
                            {rt ? (installed ? `installé · ${rt.accel}` : (rt.accel === 'cpu' ? 'GPU requis' : 'non installé')) : '…'}
                        </span>
                    </div>
                    {rt && !installed && rt.accel !== 'cpu' && (
                        <div className='fabi-swarm-conn'>
                            <button className='theia-button main' disabled={this.installing} onClick={() => this.install()}>
                                {this.installing
                                    ? (rt.downloading ? `Installation… ${rt.progress ?? 0}%` : 'Installation…')
                                    : 'Installer le moteur'}
                            </button>
                            <span className='fabi-swarm-sub'>{rt.platform} · téléchargé par l’app, rien à installer à la main</span>
                            {rt.downloading && (
                                <div className='fabi-swarm-progress'>
                                    <div className='fabi-swarm-progress-bar' style={{ width: `${rt.progress ?? 0}%` }} />
                                </div>
                            )}
                        </div>
                    )}
                    {rt && rt.accel === 'cpu' && (
                        <span className='fabi-swarm-sub'>Pas de GPU supporté (Apple Silicon ou NVIDIA) — cette machine ne peut pas rejoindre le swarm.</span>
                    )}
                    {rt && rt.message && !installed && (
                        <span className='fabi-swarm-sub fabi-swarm-err'>{rt.message}</span>
                    )}
                </div>

                {/* Écran de connexion (swarm actif en cours d'init) */}
                {showConnecting && c && this.renderConnection(c)}

                {/* Liste des modèles */}
                <div className='fabi-swarm-list'>
                    {sorted.length === 0 && (
                        <p className='fabi-swarm-sub'>Aucun swarm annoncé pour l’instant — le registry est peut-être injoignable.</p>
                    )}
                    {sorted.map(swarm => {
                        const isActive = this.active?.id === swarm.id;
                        const ready = isActive && !!c && c.ready;
                        const busy = this.busyId === swarm.id;
                        const offline = swarm.status !== 'online';
                        return (
                            <div key={swarm.id} className={`fabi-swarm-model ${isActive ? 'active' : ''} ${offline ? 'offline' : ''}`}>
                                <div className='fabi-swarm-model-head'>
                                    <span className='fabi-swarm-model-name'>{swarm.model.split('/').pop() ?? swarm.model}</span>
                                    <span className={`fabi-swarm-badge st-${swarm.status}`}>{swarm.status}</span>
                                </div>
                                <div className='fabi-swarm-model-meta'>
                                    <span>{swarm.peers} nœud{swarm.peers > 1 ? 's' : ''}</span>
                                    {swarm.totalVramGb > 0 && <span>· {swarm.totalVramGb} Go VRAM</span>}
                                </div>
                                {ready && <div className='fabi-swarm-model-status'>● actif — tu contribues 🦦</div>}
                                <div className='fabi-swarm-model-actions'>
                                    {ready ? (
                                        <button className='theia-button secondary' disabled={busy} onClick={() => this.disconnect()}>
                                            Se déconnecter
                                        </button>
                                    ) : (
                                        <button className='theia-button main' disabled={busy || offline || (isActive && showConnecting)} onClick={() => this.connect(swarm)}>
                                            {busy ? 'Connexion…' : isActive && showConnecting ? 'Connexion en cours…' : 'Se connecter'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {this.active && c && c.ready && (
                    <p className='fabi-swarm-foot'>💬 Dans le chat IA, sélectionne le modèle <b>« {this.active.model} »</b> pour discuter via le swarm.</p>
                )}
            </div>
        );
    }
}
