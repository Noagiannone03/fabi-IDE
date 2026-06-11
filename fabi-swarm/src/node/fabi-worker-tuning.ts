// Tuning du worker — port FIDÈLE de fabi-cli/packages/opencode/src/swarm/worker.ts.
// Détecte le matériel, calcule des limites sûres (anti-OOM) et construit l'env +
// l'argv passés à `parallax join`. Mêmes valeurs que le CLI → comportement
// identique entre l'IDE et la ligne de commande.

import { spawnSync } from 'child_process';
import { totalmem } from 'os';
import { getAccountToken } from './fabi-account-token';

export type Accelerator = 'apple-silicon' | 'cuda' | 'generic';

export interface HardwareProfile {
    accelerator: Accelerator;
    ramGb: number;
    vramGb?: number;
}

export interface WorkerLimits {
    maxBatchSize: string;
    maxSequenceLength: string;
    maxNumTokensPerBatch: string;
    kvBlockSize: string;
}

let cachedHw: HardwareProfile | undefined;

function detectCudaVramGb(): number | undefined {
    const r = spawnSync('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], {
        encoding: 'utf8', timeout: 5000
    });
    if (r.status !== 0 || !r.stdout) {
        return undefined;
    }
    const mib = r.stdout.split(/\r?\n/).map(l => parseInt(l.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
    if (mib.length === 0) {
        return undefined;
    }
    return Math.min(...mib) / 1024; // MiB → GiB
}

export function getHardware(): HardwareProfile {
    if (cachedHw) {
        return cachedHw;
    }
    const ramGb = Math.round(totalmem() / 2 ** 30);
    if (process.platform === 'darwin' && process.arch === 'arm64') {
        cachedHw = { accelerator: 'apple-silicon', ramGb };
        return cachedHw;
    }
    const vramGb = detectCudaVramGb();
    cachedHw = vramGb !== undefined ? { accelerator: 'cuda', ramGb, vramGb } : { accelerator: 'generic', ramGb };
    return cachedHw;
}

/** Limites batch/séquence/KV par palier matériel (anti-OOM). */
export function resolveWorkerLimits(hw: HardwareProfile): WorkerLimits {
    if (hw.accelerator === 'apple-silicon' && hw.ramGb < 64) {
        if (hw.ramGb <= 24) {
            return { maxBatchSize: '1', maxSequenceLength: '16384', maxNumTokensPerBatch: '8192', kvBlockSize: '32' };
        }
        return { maxBatchSize: '2', maxSequenceLength: '32768', maxNumTokensPerBatch: '16384', kvBlockSize: '32' };
    }
    if (hw.accelerator === 'cuda' && hw.vramGb !== undefined) {
        const vram = Math.round(hw.vramGb);
        if (vram <= 8) {
            return { maxBatchSize: '1', maxSequenceLength: '8192', maxNumTokensPerBatch: '4096', kvBlockSize: '16' };
        }
        if (vram <= 12) {
            return { maxBatchSize: '1', maxSequenceLength: '16384', maxNumTokensPerBatch: '8192', kvBlockSize: '32' };
        }
        if (vram <= 16) {
            return { maxBatchSize: '2', maxSequenceLength: '16384', maxNumTokensPerBatch: '8192', kvBlockSize: '32' };
        }
        if (vram < 24) {
            return { maxBatchSize: '2', maxSequenceLength: '32768', maxNumTokensPerBatch: '16384', kvBlockSize: '32' };
        }
    }
    return { maxBatchSize: '8', maxSequenceLength: '32768', maxNumTokensPerBatch: '16384', kvBlockSize: '32' };
}

export function prefixCacheEnabled(): boolean {
    const raw = process.env.FABI_PREFIX_CACHE?.trim().toLowerCase();
    if (raw === undefined || raw === '') {
        return true;
    }
    return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
}

/** Env du worker : jeton de compte + réserves mémoire selon le matériel. */
export function buildWorkerEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    const hw = getHardware();
    const setIfUnset = (key: string, value: string) => {
        if (!env[key]?.trim()) {
            env[key] = value;
        }
    };
    setIfUnset('FABI_ACCOUNT_TOKEN', getAccountToken());
    if (hw.accelerator === 'apple-silicon' && hw.ramGb < 64) {
        setIfUnset('PARALLAX_SYSTEM_RESERVE_GB', hw.ramGb <= 24 ? '4' : '6');
        return env;
    }
    if (hw.accelerator === 'cuda' && hw.vramGb !== undefined && Math.round(hw.vramGb) < 24) {
        setIfUnset('PARALLAX_CUDA_SYSTEM_RESERVE_GB', Math.round(hw.vramGb) <= 12 ? '2' : '1.5');
    }
    return env;
}

/** Argv complet de `parallax join` (mêmes flags que le CLI). */
export function buildJoinArgs(schedulerPeer: string): string[] {
    const limits = resolveWorkerLimits(getHardware());
    const args = [
        'join',
        '-s', schedulerPeer,
        '-r',
        '--max-batch-size', limits.maxBatchSize,
        '--max-sequence-length', limits.maxSequenceLength,
        '--max-num-tokens-per-batch', limits.maxNumTokensPerBatch,
        '--kv-block-size', limits.kvBlockSize
    ];
    if (prefixCacheEnabled()) {
        args.push('--enable-prefix-cache');
    }
    // Windows : backend vLLM explicite (le défaut sglang est Linux-only).
    if (process.platform === 'win32') {
        args.push('--gpu-backend', 'vllm');
    }
    return args;
}

/** Tue les workers parallax orphelins (évite la double-allocation). Unix only. */
export function killOrphanedWorkers(currentPid: number): void {
    if (process.platform === 'win32') {
        return;
    }
    const r = spawnSync('pgrep', ['-f', 'parallax/launch.py'], { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout) {
        return;
    }
    const pids = r.stdout.split(/\s+/).map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n) && n !== currentPid && n !== process.pid);
    if (pids.length === 0) {
        return;
    }
    for (const orphan of pids) {
        try {
            process.kill(-orphan, 'SIGTERM');
        } catch {
            try { process.kill(orphan, 'SIGTERM'); } catch { /* déjà mort */ }
        }
    }
    spawnSync('sh', ['-c', 'sleep 2']);
    for (const orphan of pids) {
        try { process.kill(-orphan, 'SIGKILL'); } catch { /* déjà mort */ }
    }
}
