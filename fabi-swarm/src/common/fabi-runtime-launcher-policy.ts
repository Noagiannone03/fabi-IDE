export interface RuntimeLauncherPolicyInput {
    packaged: boolean;
    forcedInDevelopment: boolean;
    disabledInDevelopment: boolean;
    runtimeQualified: boolean;
    acceleratorSupported: boolean;
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
