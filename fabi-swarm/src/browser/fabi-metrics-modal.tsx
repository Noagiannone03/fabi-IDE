import * as React from '@theia/core/shared/react';
import { DisposableCollection } from '@theia/core';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { FabiMetrics, FabiMetricSample, FabiProcInfo } from '../common/fabi-swarm-protocol';

/**
 * Modale « Moniteur Fabi » : où part la conso de la machine, et surtout la PART
 * de notre worker vs le reste (barres segmentées worker/autres/libre, à la
 * Activity Monitor) + le top des process qui consomment. Données poussées par le
 * backend (systeminformation) ; visu SVG/CSS inline, DA îlot Fabi neutre.
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
    normal: 'Tout va bien',
    elevated: 'Charge élevée',
    critical: 'Charge critique'
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
    const total = sys.memTotalGb || 1;

    // Découpage CPU (en %) et RAM (en Go) : worker / autres apps / libre.
    const wCpu = w?.cpu ?? 0;
    const cpuSeg = [
        { label: 'Ton worker', val: wCpu, cls: 'worker', text: `${fmt(wCpu)} %` },
        { label: 'Autres apps', val: Math.max(0, sys.cpu - wCpu), cls: 'other', text: `${fmt(Math.max(0, sys.cpu - wCpu))} %` },
        { label: 'Libre', val: Math.max(0, 100 - sys.cpu), cls: 'free', text: `${fmt(Math.max(0, 100 - sys.cpu))} %` }
    ];
    const wMem = w?.memGb ?? 0;
    const otherMem = Math.max(0, sys.memUsedGb - wMem);
    const freeMem = Math.max(0, total - sys.memUsedGb);
    const memSeg = [
        { label: 'Ton worker', val: wMem, cls: 'worker', text: `${fmt2(wMem)} Go` },
        { label: 'Autres apps', val: otherMem, cls: 'other', text: `${fmt2(otherMem)} Go` },
        { label: 'Libre', val: freeMem, cls: 'free', text: `${fmt2(freeMem)} Go` }
    ];
    const maxProc = m.topProcs[0]?.memGb || 1;

    return (
        <div className="fabi-mon">
            <div className="fabi-mon-head">
                <span className="fabi-mon-title">Ta machine</span>
                <span className={`fabi-mon-badge p-${m.pressure}`}>{PRESSURE_LABEL[m.pressure]}</span>
            </div>
            <div className="fabi-mon-lead">
                Où part la puissance de ton PC — et surtout combien <b>ton worker Fabi</b> consomme
                par rapport au reste. En vert = ta contribution, en gris = les autres apps.
            </div>

            <SegmentBar title="Processeur" caption={`${fmt(sys.cpu)} % utilisés · ${sys.cpuCores} cœurs`}
                segments={cpuSeg} total={100} />
            <SegmentBar title="Mémoire" caption={`${fmt2(sys.memUsedGb)} / ${fmt2(total)} Go utilisés`}
                segments={memSeg} total={total} />
            {sys.gpu && sys.gpu.usage !== undefined && (
                <SegmentBar title={`GPU — ${sys.gpu.name}`} caption={`${fmt(sys.gpu.usage)} % utilisés`}
                    segments={[
                        { label: 'Utilisé', val: sys.gpu.usage, cls: 'other', text: `${fmt(sys.gpu.usage)} %` },
                        { label: 'Libre', val: 100 - sys.gpu.usage, cls: 'free', text: `${fmt(100 - sys.gpu.usage)} %` }
                    ]} total={100} />
            )}

            {/* ---- Qui consomme le plus (RAM) ---- */}
            <div className="fabi-mon-section">
                <div className="fabi-mon-section-head">Qui consomme le plus <span>RAM</span></div>
                <div className="fabi-mon-proclist">
                    {m.topProcs.length === 0 && <div className="fabi-mon-empty">Lecture des process…</div>}
                    {m.topProcs.map((p, i) => <ProcRow key={i} p={p} max={maxProc} />)}
                </div>
            </div>

            {/* ---- Worker : résumé en une phrase ---- */}
            <div className="fabi-mon-worker">
                <div className="fabi-mon-worker-head">
                    <span className={`fabi-mon-dot ${w?.running ? 'on' : 'off'}`} />
                    <span className="fabi-mon-worker-title">Ton worker Fabi</span>
                    <span className="fabi-mon-worker-state">{w?.running ? 'actif — tu contribues' : 'inactif'}</span>
                </div>
                {w && w.running ? (
                    <div className="fabi-mon-worker-line">
                        Il occupe <b>{fmt2(w.memGb)} Go</b> de RAM et <b>{fmt(w.cpu)} %</b> de CPU
                        sur {w.procCount} process — pics de la session : {fmt2(m.peaks.workerMemGb)} Go / {fmt(m.peaks.workerCpu)} %.
                    </div>
                ) : (
                    <div className="fabi-mon-empty">Lance un modèle pour contribuer — sa conso apparaîtra ici.</div>
                )}
            </div>

            {/* ---- Tendance (sparklines) ---- */}
            <div className="fabi-mon-spark-row">
                <Spark label="CPU" history={m.history} pick={s => s.cpu} />
                <Spark label="RAM" history={m.history} pick={s => s.mem} />
                {w && w.running && <Spark label="Worker" history={m.history} pick={s => s.worker} />}
            </div>
        </div>
    );
};

type Seg = { label: string; val: number; cls: string; text: string };

const SegmentBar: React.FC<{ title: string; caption: string; segments: Seg[]; total: number }>
    = ({ title, caption, segments, total }) => (
        <div className="fabi-mon-seg">
            <div className="fabi-mon-seg-top">
                <span className="fabi-mon-seg-title">{title}</span>
                <span className="fabi-mon-seg-cap">{caption}</span>
            </div>
            <div className="fabi-mon-seg-bar">
                {segments.map((s, i) => (
                    <div key={i} className={`fabi-mon-seg-fill ${s.cls}`}
                        style={{ width: `${pct(s.val, total)}%` }}
                        title={`${s.label} : ${s.text}`} />
                ))}
            </div>
            <div className="fabi-mon-seg-legend">
                {segments.map((s, i) => (
                    <span key={i} className="fabi-mon-leg">
                        <i className={`fabi-mon-leg-dot ${s.cls}`} />{s.label} <b>{s.text}</b>
                    </span>
                ))}
            </div>
        </div>
    );

const ProcRow: React.FC<{ p: FabiProcInfo; max: number }> = ({ p, max }) => (
    <div className={`fabi-mon-proc ${p.isWorker ? 'worker' : ''}`}>
        <span className="fabi-mon-proc-name" title={p.name}>{p.name}</span>
        <div className="fabi-mon-proc-bar">
            <div className={`fabi-mon-proc-fill ${p.isWorker ? 'worker' : ''}`} style={{ width: `${pct(p.memGb, max)}%` }} />
        </div>
        <span className="fabi-mon-proc-val">{fmt2(p.memGb)} Go</span>
    </div>
);

const Spark: React.FC<{ label: string; history: FabiMetricSample[]; pick: (s: FabiMetricSample) => number }>
    = ({ label, history, pick }) => {
        const W = 120, H = 28;
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
                <div className="fabi-mon-spark-head"><span>{label}</span><span className="fabi-mon-spark-val">{fmt(last)} %</span></div>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="fabi-mon-spark-svg">
                    {pts && <polyline points={`0,${H} ${pts} ${W},${H}`} className="fabi-mon-spark-fill" />}
                    {pts && <polyline points={pts} className="fabi-mon-spark-line" />}
                </svg>
            </div>
        );
    };

function pct(v: number, total: number): number {
    if (!(total > 0)) {
        return 0;
    }
    return Math.max(0, Math.min(100, (v / total) * 100));
}
function fmt(n: number): string { return (Math.round(n * 10) / 10).toString(); }
function fmt2(n: number): string { return (Math.round(n * 100) / 100).toString(); }
