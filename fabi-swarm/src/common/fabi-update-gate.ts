/**
 * Security policy shared by the Electron gate and its tests.
 *
 * Discovery failures do not invalidate the currently installed signed app, so
 * they fail open. Once a newer release is positively discovered, `block` owns
 * the process and must never expose a continuation path into the old IDE.
 */
export async function enforceMandatoryUpdate<T>(
    discover: () => Promise<T | undefined>,
    block: (update: T) => Promise<never>,
    onDiscoveryError?: (error: unknown) => void
): Promise<void> {
    let update: T | undefined;
    try {
        update = await discover();
    } catch (error) {
        onDiscoveryError?.(error);
        return;
    }
    if (update !== undefined) {
        await block(update);
    }
}
