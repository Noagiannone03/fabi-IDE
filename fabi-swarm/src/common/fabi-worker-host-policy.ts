export interface WorkerHostPolicyInput {
    electronBackend: boolean;
    browserWorkerExplicitlyEnabled: boolean;
}

/**
 * The desktop app owns the machine-local worker. A browser-app backend is used
 * for UI previews and must not silently start a second worker with the same
 * persisted identity, otherwise both supervisors fence and restart each other.
 */
export function shouldStartMachineWorker(input: WorkerHostPolicyInput): boolean {
    return input.electronBackend || input.browserWorkerExplicitlyEnabled;
}

