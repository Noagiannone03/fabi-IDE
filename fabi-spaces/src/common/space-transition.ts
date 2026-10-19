/** Cosmetic only: called after the native selection has committed.
 * Never decode screenshots, hide content, or wait for frontend readiness here.
 * Self-contained because Electron serializes this function into the renderer.
 */
export function playSpaceTransition(direction: number): void {
    const host = window as Window & { fabiSpaceMotion?: { cancel(): void } };
    host.fabiSpaceMotion?.cancel();
    if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) { return; }
    const surface = document.getElementById('theia-app-shell');
    if (!surface || document.querySelector('.theia-preload:not(.theia-hidden)')) { return; }
    const motion = surface.animate([
        { transform: `translate3d(0, ${direction * 6}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' }
    ], { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    const cancel = () => {
        clearTimeout(deadline);
        document.removeEventListener('visibilitychange', cancel);
        motion.cancel();
        if (host.fabiSpaceMotion?.cancel === cancel) { delete host.fabiSpaceMotion; }
    };
    // A suspended compositor must not leave a transform behind on return.
    const deadline = setTimeout(cancel, 400);
    host.fabiSpaceMotion = { cancel };
    document.addEventListener('visibilitychange', cancel);
    void motion.finished.then(cancel, cancel);
}
