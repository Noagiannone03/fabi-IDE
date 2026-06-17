// Collecteur de métriques perfs (machine + worker Parallax), poussé en live au
// frontend pour le moniteur (status bar + modale). On NE réinvente PAS la roue :
// `systeminformation` (standard Node multi-plateforme) fournit CPU/RAM/GPU et la
// liste des process. On en dérive : charge système, conso propre de l'arbre du
// worker (tous les process du venv parallax), pics glissants et état de pression.
//
// Best-effort : chaque sonde est protégée — une mesure qui échoue ne casse pas la
// boucle, et un champ absent (p.ex. usage GPU live sur Apple Silicon, non exposé
// sans privilèges) est simplement omis. Coût maîtrisé : `processes()` (le plus
// lourd) n'est appelé QUE si le worker tourne ; le GPU est sondé 1 fois sur 3.

import { cpus } from 'os';
import * as si from 'systeminformation';
import { FabiMetrics, FabiMetricSample, FabiProcInfo } from '../common/fabi-swarm-protocol';

/** Tout process dont la commande contient ça appartient à NOTRE worker. */
const WORKER_PROC_MATCH = 'parallax-venv';
/** Cadence d'échantillonnage. */
const SAMPLE_INTERVAL_MS = 2000;
/** Taille de l'historique glissant (≈ 2 min à 2 s). */
const HISTORY_LEN = 60;

export class FabiMetricsCollector {
    protected timer: ReturnType<typeof setInterval> | undefined;
    protected ticking = false;
    protected tickCount = 0;
    protected history: FabiMetricSample[] = [];
    protected peaks = { cpu: 0, memPct: 0, workerCpu: 0, workerMemGb: 0 };
    protected gpuCache: FabiMetrics['system']['gpu'] | undefined;
    protected latest: FabiMetrics | undefined;

    constructor(
        protected readonly onSample: (m: FabiMetrics) => void,
        protected readonly isWorkerRunning: () => boolean
    ) { }

    start(): void {
        if (this.timer) {
            return;
        }
        void this.tick();
        this.timer = setInterval(() => void this.tick(), SAMPLE_INTERVAL_MS);
        this.timer.unref?.();
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    getLatest(): FabiMetrics | undefined {
        return this.latest;
    }

    /** Réinitialise les pics (p.ex. à l'ouverture de la modale). */
    resetPeaks(): void {
        this.peaks = { cpu: 0, memPct: 0, workerCpu: 0, workerMemGb: 0 };
    }

    protected async tick(): Promise<void> {
        if (this.ticking) {
            return; // évite le chevauchement si une mesure traîne
        }
        this.ticking = true;
        try {
            const cores = cpus().length || 1;

            // --- Système : CPU + RAM (sondes légères) ---
            let cpu = 0;
            let memUsedGb = 0;
            let memTotalGb = 0;
            try {
                const load = await si.currentLoad();
                cpu = clampPct(load.currentLoad);
            } catch { /* best-effort */ }
            try {
                const mem = await si.mem();
                memTotalGb = mem.total / 1e9;
                // `active` = mémoire réellement utilisée hors cache/buffers (plus
                // représentatif que `used` qui inclut le cache sur Linux/mac).
                const usedBytes = mem.active || (mem.total - mem.available);
                memUsedGb = usedBytes / 1e9;
            } catch { /* best-effort */ }
            const memPct = memTotalGb > 0 ? clampPct((memUsedGb / memTotalGb) * 100) : 0;

            // --- GPU : 1 fois sur 3 (plus lourd, souvent statique) ---
            if (this.tickCount % 3 === 0) {
                this.gpuCache = await this.readGpu();
            }

            // --- Process : worker agrégé + top consommateurs (« qui bouffe ») ---
            const { worker, topProcs } = await this.readProcesses(cores, memTotalGb);

            // --- Pics ---
            this.peaks.cpu = Math.max(this.peaks.cpu, cpu);
            this.peaks.memPct = Math.max(this.peaks.memPct, memPct);
            if (worker) {
                this.peaks.workerCpu = Math.max(this.peaks.workerCpu, worker.cpu);
                this.peaks.workerMemGb = Math.max(this.peaks.workerMemGb, worker.memGb);
            }

            const t = Date.now();
            const sample: FabiMetricSample = { t, cpu, mem: memPct, worker: worker?.cpu ?? 0 };
            this.history.push(sample);
            if (this.history.length > HISTORY_LEN) {
                this.history.shift();
            }

            const metrics: FabiMetrics = {
                t,
                system: {
                    cpu, cpuCores: cores, memUsedGb, memTotalGb, memPct,
                    gpu: this.gpuCache
                },
                worker,
                peaks: { ...this.peaks },
                pressure: derivePressure(cpu, memPct),
                history: [...this.history],
                topProcs
            };
            this.latest = metrics;
            this.onSample(metrics);
        } finally {
            this.tickCount++;
            this.ticking = false;
        }
    }

    protected async readGpu(): Promise<FabiMetrics['system']['gpu'] | undefined> {
        try {
            const g = await si.graphics();
            const c = (g.controllers || []).find(x => x.model || x.vram) ?? g.controllers?.[0];
            if (!c) {
                return undefined;
            }
            const usage = typeof c.utilizationGpu === 'number' ? clampPct(c.utilizationGpu) : undefined;
            const memTotalMb = typeof c.vram === 'number' && c.vram > 0 ? c.vram : undefined;
            const memUsedMb = typeof c.memoryUsed === 'number' ? c.memoryUsed : undefined;
            return { name: c.model || c.vendor || 'GPU', usage, memUsedMb, memTotalMb };
        } catch {
            return this.gpuCache; // garde la dernière valeur connue
        }
    }

    protected async readProcesses(
        cores: number, memTotalGb: number
    ): Promise<{ worker: FabiMetrics['worker']; topProcs: FabiProcInfo[] }> {
        const running = this.isWorkerRunning();
        try {
            const list = (await si.processes()).list || [];
            // IMPORTANT : sur macOS, systeminformation tronque `name`/`command` à
            // « python » — le chemin complet (…/parallax-venv/bin/python) n'est que
            // dans `path`. On matche donc les TROIS champs, sinon le worker du Mac
            // n'est jamais reconnu (0 Go / 0 process affichés à tort).
            const isMine = (p: si.Systeminformation.ProcessesProcessData) =>
                (p.command || '').includes(WORKER_PROC_MATCH)
                || (p.name || '').includes(WORKER_PROC_MATCH)
                || ((p as { path?: string }).path || '').includes(WORKER_PROC_MATCH);
            const mine = list.filter(isMine);

            // --- Notre worker (somme de tous ses process) ---
            const wCpuRaw = mine.reduce((s, p) => s + (p.cpu || 0), 0);
            const wMemGb = (mine.reduce((s, p) => s + (p.mem || 0), 0) / 100) * memTotalGb;
            const worker: FabiMetrics['worker'] = (running || mine.length > 0)
                ? {
                    running: true,
                    cpuRaw: round1(wCpuRaw),
                    cpu: clampPct(wCpuRaw / cores),
                    memGb: round2(wMemGb),
                    procCount: mine.length
                }
                : null;

            // --- Top consommateurs : on GROUPE les autres process par nom (sinon
            // 12 « node »/« Chrome Helper » noient la liste, comme le moniteur
            // d'activité macOS), puis on prend les plus gros en RAM. Le worker est
            // une seule entrée à part (« Worker Fabi »). ---
            const byName = new Map<string, { cpu: number; mem: number }>();
            for (const p of list) {
                if (isMine(p)) {
                    continue;
                }
                const n = (p.name || 'process').trim() || 'process';
                const e = byName.get(n) || { cpu: 0, mem: 0 };
                e.cpu += p.cpu || 0;
                e.mem += p.mem || 0;
                byName.set(n, e);
            }
            const others: FabiProcInfo[] = [...byName.entries()]
                .map(([name, e]) => ({
                    name,
                    cpu: clampPct(e.cpu / cores),
                    memGb: round2((e.mem / 100) * memTotalGb),
                    isWorker: false
                }))
                .sort((a, b) => b.memGb - a.memGb)
                .slice(0, 5);

            const topProcs: FabiProcInfo[] = [];
            if (worker && (worker.memGb > 0 || worker.cpu > 0)) {
                topProcs.push({ name: 'Worker Fabi', cpu: worker.cpu, memGb: worker.memGb, isWorker: true });
            }
            topProcs.push(...others);
            topProcs.sort((a, b) => b.memGb - a.memGb);

            return { worker, topProcs: topProcs.slice(0, 6) };
        } catch {
            return {
                worker: running ? { running: true, cpu: 0, cpuRaw: 0, memGb: 0, procCount: 0 } : null,
                topProcs: []
            };
        }
    }
}

function clampPct(n: number): number {
    if (!Number.isFinite(n)) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}
function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

function derivePressure(cpu: number, memPct: number): FabiMetrics['pressure'] {
    // La RAM est le facteur critique pour l'inférence (OOM = crash). Le CPU
    // soutenu est « élevé » mais rarement critique seul.
    if (memPct >= 90 || cpu >= 97) {
        return 'critical';
    }
    if (memPct >= 75 || cpu >= 85) {
        return 'elevated';
    }
    return 'normal';
}
