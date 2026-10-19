/** Product policy: local Swarm inference is suspended. Assist/RunPod is independent.
 * Deliberately build-time: saved settings and environment cannot restart it. */
export const SWARM_ENGINE_ENABLED: boolean = false;
export function requireSwarmEngine(): void {
    if (!SWARM_ENGINE_ENABLED) {
        throw new Error('Le moteur Swarm est désactivé dans cette version de Fabi. Utilisez Fabi Assist.');
    }
}
