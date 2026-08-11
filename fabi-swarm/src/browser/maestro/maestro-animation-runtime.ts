/**
 * Horloge d'animation partagée par toutes les mascottes Maestro.
 *
 * Une liste Maestro peut garder plusieurs widgets montés alors qu'ils sont hors
 * écran. Chaque canvas ne doit donc jamais posséder sa propre boucle rAF : une
 * seule horloge cadence les scènes réellement visibles, à la fréquence utile
 * au pixel art, et s'endort complètement quand il n'y a rien à dessiner.
 */

export interface MaestroAnimationDriver {
    now(): number;
    setTimer(callback: () => void, delayMs: number): number;
    clearTimer(id: number): void;
    requestFrame(callback: (timestamp: number) => void): number;
    cancelFrame(id: number): void;
}

export interface MaestroAnimationSubscription {
    setActive(active: boolean): void;
    setFrameRate(framesPerSecond: number): void;
    renderNow(): void;
    dispose(): void;
}

interface ClockEntry {
    active: boolean;
    framesPerSecond: number;
    nextFrameAt: number;
    render: (timestamp: number) => void;
}

const clampFrameRate = (value: number): number => Math.max(1, Math.min(60, Math.round(value)));

/** Partie pure et testable de l'ordonnanceur. */
export class MaestroAnimationClock {
    protected readonly entries = new Map<number, ClockEntry>();
    protected nextId = 1;
    protected timer: number | undefined;
    protected frame: number | undefined;
    protected paused = false;

    constructor(protected readonly driver: MaestroAnimationDriver) { }

    subscribe(render: (timestamp: number) => void, framesPerSecond: number): MaestroAnimationSubscription {
        const id = this.nextId++;
        const entry: ClockEntry = {
            active: false,
            framesPerSecond: clampFrameRate(framesPerSecond),
            nextFrameAt: this.driver.now(),
            render
        };
        this.entries.set(id, entry);
        let disposed = false;
        return {
            setActive: active => {
                if (disposed || entry.active === active) {
                    return;
                }
                entry.active = active;
                if (active) {
                    entry.nextFrameAt = this.driver.now();
                }
                this.replan();
            },
            setFrameRate: framesPerSecond => {
                if (disposed) {
                    return;
                }
                const next = clampFrameRate(framesPerSecond);
                if (entry.framesPerSecond !== next) {
                    entry.framesPerSecond = next;
                    entry.nextFrameAt = this.driver.now();
                    this.replan();
                }
            },
            renderNow: () => {
                if (!disposed) {
                    entry.render(this.driver.now());
                }
            },
            dispose: () => {
                if (disposed) {
                    return;
                }
                disposed = true;
                this.entries.delete(id);
                this.replan();
            }
        };
    }

    setPaused(paused: boolean): void {
        if (this.paused === paused) {
            return;
        }
        this.paused = paused;
        if (!paused) {
            const now = this.driver.now();
            for (const entry of this.entries.values()) {
                if (entry.active) {
                    entry.nextFrameAt = now;
                }
            }
        }
        this.replan();
    }

    dispose(): void {
        this.entries.clear();
        this.cancelPending();
    }

    protected replan(): void {
        this.cancelPending();
        this.scheduleNext();
    }

    protected cancelPending(): void {
        if (this.timer !== undefined) {
            this.driver.clearTimer(this.timer);
            this.timer = undefined;
        }
        if (this.frame !== undefined) {
            this.driver.cancelFrame(this.frame);
            this.frame = undefined;
        }
    }

    protected scheduleNext(): void {
        if (this.paused) {
            return;
        }
        let next = Number.POSITIVE_INFINITY;
        for (const entry of this.entries.values()) {
            if (entry.active) {
                next = Math.min(next, entry.nextFrameAt);
            }
        }
        if (!Number.isFinite(next)) {
            return;
        }
        const delay = Math.max(0, next - this.driver.now());
        if (delay < 1) {
            this.requestNextFrame();
        } else {
            this.timer = this.driver.setTimer(() => {
                this.timer = undefined;
                this.requestNextFrame();
            }, delay);
        }
    }

    protected requestNextFrame(): void {
        if (this.paused || this.frame !== undefined) {
            return;
        }
        this.frame = this.driver.requestFrame(timestamp => {
            this.frame = undefined;
            this.tick(timestamp);
        });
    }

    protected tick(timestamp: number): void {
        if (this.paused) {
            return;
        }
        for (const entry of this.entries.values()) {
            if (!entry.active || timestamp + 0.5 < entry.nextFrameAt) {
                continue;
            }
            entry.render(timestamp);
            entry.nextFrameAt = timestamp + 1000 / entry.framesPerSecond;
        }
        this.scheduleNext();
    }
}

interface RuntimeEntry {
    intersecting: boolean;
    subscription: MaestroAnimationSubscription;
}

export interface MaestroCanvasAnimation {
    dispose(): void;
}

/**
 * Politique DOM commune : un seul IntersectionObserver, un seul listener de
 * visibilité et une seule horloge pour toutes les mascottes de la fenêtre.
 */
export class MaestroAnimationRuntime {
    protected readonly clock: MaestroAnimationClock;
    protected readonly entries = new Map<Element, RuntimeEntry>();
    protected observer: IntersectionObserver | undefined;
    protected media: MediaQueryList | undefined;
    protected documentVisible = true;
    protected reducedMotion = false;
    protected listening = false;

    constructor() {
        this.clock = new MaestroAnimationClock({
            now: () => performance.now(),
            setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
            clearTimer: id => window.clearTimeout(id),
            requestFrame: callback => window.requestAnimationFrame(callback),
            cancelFrame: id => window.cancelAnimationFrame(id)
        });
    }

    attach(element: Element, render: (timestamp: number) => void, framesPerSecond: number): MaestroCanvasAnimation {
        this.startListening();
        const subscription = this.clock.subscribe(render, framesPerSecond);
        const entry: RuntimeEntry = { intersecting: false, subscription };
        this.entries.set(element, entry);
        subscription.renderNow();
        if (this.observer) {
            this.observer.observe(element);
        } else {
            entry.intersecting = true;
            this.updateEntry(entry);
        }
        let disposed = false;
        return {
            dispose: () => {
                if (disposed) {
                    return;
                }
                disposed = true;
                this.observer?.unobserve(element);
                this.entries.delete(element);
                subscription.dispose();
                if (this.entries.size === 0) {
                    this.stopListening();
                }
            }
        };
    }

    protected startListening(): void {
        if (this.listening) {
            return;
        }
        this.listening = true;
        this.documentVisible = !document.hidden;
        this.media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        this.reducedMotion = this.media?.matches ?? false;
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        this.media?.addEventListener('change', this.onMotionPreferenceChange);
        if (typeof IntersectionObserver !== 'undefined') {
            this.observer = new IntersectionObserver(changes => {
                for (const change of changes) {
                    const entry = this.entries.get(change.target);
                    if (entry) {
                        entry.intersecting = change.isIntersecting && change.intersectionRatio > 0;
                        this.updateEntry(entry);
                    }
                }
            }, { rootMargin: '64px', threshold: 0.01 });
        }
    }

    protected stopListening(): void {
        if (!this.listening) {
            return;
        }
        this.listening = false;
        this.observer?.disconnect();
        this.observer = undefined;
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        this.media?.removeEventListener('change', this.onMotionPreferenceChange);
        this.media = undefined;
        this.clock.setPaused(false);
    }

    protected readonly onVisibilityChange = (): void => {
        this.documentVisible = !document.hidden;
        this.updateAll();
    };

    protected readonly onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
        this.reducedMotion = event.matches;
        if (this.reducedMotion) {
            for (const entry of this.entries.values()) {
                entry.subscription.renderNow();
            }
        }
        this.updateAll();
    };

    protected updateAll(): void {
        for (const entry of this.entries.values()) {
            this.updateEntry(entry);
        }
    }

    protected updateEntry(entry: RuntimeEntry): void {
        entry.subscription.setActive(entry.intersecting && this.documentVisible && !this.reducedMotion);
    }
}

let sharedRuntime: MaestroAnimationRuntime | undefined;

export function animateMaestroCanvas(
    element: Element,
    render: (timestamp: number) => void,
    framesPerSecond: number
): MaestroCanvasAnimation {
    sharedRuntime ??= new MaestroAnimationRuntime();
    return sharedRuntime.attach(element, render, framesPerSecond);
}
