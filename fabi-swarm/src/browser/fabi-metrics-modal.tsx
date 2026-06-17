import * as React from '@theia/core/shared/react';
import { DisposableCollection } from '@theia/core';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { FabiMetrics, FabiMetricSample } from '../common/fabi-swarm-protocol';

/**
 * Modale « Moniteur Fabi » : état live de la machine + conso du worker.
 * Données poussées par le backend (systeminformation) via onMetricsChanged ; la
 * visu (jauges + sparklines) est en SVG inline — léger, zéro lib de charts qui
 * se battrait avec le React de Theia. Le composant s'abonne lui-même aux pushs.
 */
export class FabiMetricsDialog extends ReactDialog<void> {
    constructor(protected readonly frontend: FabiSwarmFrontend) {
        super({ title: 'Moniteur Fabi' } as DialogProps);
        this.node.classList.add('fabi-mon-dialog');
        this.appendCloseButton('Fermer');
    }
    protected render(): React.ReactNode {
        return <FabiMetricsView frontend={this.frontend} />;
    }
    get value(): void {
        return undefined;
    }
}

const PRESSURE_LABEL: Record<FabiMetrics['pressure'], string> = {
    normal: 'Normal',
    elevated: 'Élevé',
    critical: 'Critique'
};

export const FabiMetricsView: React.FC<{ frontend: FabiSwarmFrontend }> = ({ frontend }) => {
    const [m, setM] = React.useState<FabiMetrics | undefined>(frontend.metrics);
    React.useEffect(() => {
        const d = new DisposableCollection();
        d.push(frontend.onMetricsChangedEvent(next => setM(next)));
        void frontend.service.getMetrics().then(x => x && setM(x)).catch(() => { /* */ });
        return () => d.dispose();
    }, [frontend]);

    if (!m) {
        return <div className="fabi-mon"><div className="fabi-mon-empty">Mesure en cours…</div></div>;
    }

    const sys = m.system;
    const w = m.worker;
    return (
        <div className="fabi-mon">
            <div className="fabi-mon-head">
                <span className="fabi-mon-title">Ta machine</span>
                <span className={`fabi-mon-badge p-${m.pressure}`}>{PRESSURE_LABEL[m.pressure]}</span>
            </div>

            {/* ---- Système ---- */}
            <div className="fabi-mon-grid">
                <Gauge label="CPU" value={sys.cpu} text={`${fmt(sys.cpu)} %`}
                    sub={`${sys.cpuCores} cœurs`} peak={m.peaks.cpu} />
                <Gauge label="Mémoire" value={sys.memPct} text={`${fmt(sys.memPct)} %`}
                    sub={`${fmt2(sys.memUsedGb)} / ${fmt2(sys.memTotalGb)} Go`} peak={m.peaks.memPct} />
                {sys.gpu && (
                    <Gauge label="GPU" value={sys.gpu.usage ?? 0}
                        text={sys.gpu.usage !== undefined ? `${fmt(sys.gpu.usage)} %` : '—'}
                        sub={sys.gpu.name} peak={undefined} dim={sys.gpu.usage === undefined} />
                )}
            </div>

            {/* ---- Sparklines ---- */}
            <div className="fabi-mon-spark-row">
                <Spark label="CPU" color="#6ea8fe" history={m.history} pick={s => s.cpu} />
                <Spark label="RAM" color="#9d7bff" history={m.history} pick={s => s.mem} />
                {w && <Spark label="Worker" color="#f0883e" history={m.history} pick={s => s.worker} />}
            </div>

            {/* ---- Worker ---- */}
            <div className="fabi-mon-worker">
                <div className="fabi-mon-worker-head">
                    <span className="fabi-mon-worker-title">Ton worker Fabi</span>
                    <span className={`fabi-mon-dot ${w?.running ? 'on' : 'off'}`} />
                    <span className="fabi-mon-worker-state">{w?.running ? 'actif — tu contribues' : 'inactif'}</span>
                </div>
                {w && w.running ? (
                    <div className="fabi-mon-worker-stats">
                        <Stat k="CPU" v={`${fmt(w.cpu)} %`} hint={`${fmt(w.cpuRaw)} % brut`} />
                        <Stat k="Mémoire" v={`${fmt2(w.memGb)} Go`} />
                        <Stat k="Process" v={`${w.procCount}`} />
                        <Stat k="Pic CPU" v={`${fmt(m.peaks.workerCpu)} %`} />
                        <Stat k="Pic RAM" v={`${fmt2(m.peaks.workerMemGb)} Go`} />
                    </div>
                ) : (
                    <div className="fabi-mon-empty">Lance un modèle pour contribuer — la conso du worker s’affichera ici.</div>
                )}
            </div>
        </div>
    );
};

const Gauge: React.FC<{ label: string; value: number; text: string; sub?: string; peak?: number; dim?: boolean }>
    = ({ label, value, text, sub, peak, dim }) => {
        const pct = Math.max(0, Math.min(100, value));
        const tone = pct >= 90 ? 'crit' : pct >= 75 ? 'warn' : 'ok';
        return (
            <div className={`fabi-mon-gauge ${dim ? 'dim' : ''}`}>
                <div className="fabi-mon-gauge-top">
                    <span className="fabi-mon-gauge-label">{label}</span>
                    <span className="fabi-mon-gauge-val">{text}</span>
                </div>
                <div className="fabi-mon-bar">
                    <div className={`fabi-mon-bar-fill ${tone}`} style={{ width: `${pct}%` }} />
                    {peak !== undefined && peak > 0 && (
                        <div className="fabi-mon-bar-peak" style={{ left: `${Math.min(100, peak)}%` }} title={`pic ${fmt(peak)} %`} />
                    )}
                </div>
                {sub && <div className="fabi-mon-gauge-sub">{sub}</div>}
            </div>
        );
    };

const Stat: React.FC<{ k: string; v: string; hint?: string }> = ({ k, v, hint }) => (
    <div className="fabi-mon-stat">
        <span className="fabi-mon-stat-k">{k}</span>
        <span className="fabi-mon-stat-v">{v}</span>
        {hint && <span className="fabi-mon-stat-hint">{hint}</span>}
    </div>
);

const Spark: React.FC<{ label: string; color: string; history: FabiMetricSample[]; pick: (s: FabiMetricSample) => number }>
    = ({ label, color, history, pick }) => {
        const W = 120, H = 30;
        const pts = history.length > 1
            ? history.map((s, i) => {
                const x = (i / (history.length - 1)) * W;
                const y = H - (Math.max(0, Math.min(100, pick(s))) / 100) * H;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ')
            : '';
        const last = history.length ? pick(history[history.length - 1]) : 0;
        return (
            <div className="fabi-mon-spark">
                <div className="fabi-mon-spark-head">
                    <span>{label}</span><span className="fabi-mon-spark-val">{fmt(last)} %</span>
                </div>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="fabi-mon-spark-svg">
                    {pts && <polyline points={`0,${H} ${pts} ${W},${H}`} fill={color} fillOpacity={0.12} stroke="none" />}
                    {pts && <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />}
                </svg>
            </div>
        );
    };

function fmt(n: number): string { return (Math.round(n * 10) / 10).toString(); }
function fmt2(n: number): string { return (Math.round(n * 100) / 100).toString(); }
