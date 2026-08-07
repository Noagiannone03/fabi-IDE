export interface RuntimeLauncherPolicyInput {
    packaged: boolean;
    forcedInDevelopment: boolean;
    disabledInDevelopment: boolean;
    runtimeQualified: boolean;
    acceleratorSupported: boolean;
}

/**
 * Maintient la fenêtre du launcher en vie pendant la création de la surface
 * IDE. Theia arrête son backend dès que `window-all-closed` est émis : fermer
 * le launcher avant d'avoir créé la fenêtre suivante ferait donc quitter une
 * installation pourtant réussie.
 */
export class LauncherSurfaceHandoff {
    protected releaseHeldWindow: (() => void) | undefined;

    get active(): boolean {
        return this.releaseHeldWindow !== undefined;
    }

    hold(release: () => void): void {
        if (this.releaseHeldWindow) {
            throw new Error('launcher surface handoff already active');
        }
        this.releaseHeldWindow = release;
    }

    release(): boolean {
        const release = this.releaseHeldWindow;
        if (!release) {
            return false;
        }
        this.releaseHeldWindow = undefined;
        release();
        return true;
    }
}

/**
 * The runtime gate is a product invariant in a packaged build. Development
 * flags remain useful locally, but they must never let a distributed app boot
 * with an incompatible engine contract.
 */
export function shouldGateRuntime(input: RuntimeLauncherPolicyInput): boolean {
    if (!input.packaged && input.disabledInDevelopment) {
        return false;
    }
    if (!input.packaged && !input.forcedInDevelopment) {
        return false;
    }
    return !input.runtimeQualified && input.acceleratorSupported;
}
