/** OpenCode primary agents exposed through Theia's native chat-mode contract. */
export type FabiCodeMode = 'build' | 'plan' | 'goal';
export type FabiOpenCodeAgent = 'build' | 'plan';

export const FABI_CODE_MODES: Array<{
    id: FabiCodeMode;
    name: string;
    isDefault?: boolean;
}> = [
    { id: 'build', name: 'Agent', isDefault: true },
    { id: 'plan', name: 'Ask' },
    { id: 'goal', name: 'Goal' }
];

/** Never forward an arbitrary UI value as an OpenCode agent identifier. */
export function normalizeFabiCodeMode(mode: string | undefined): FabiCodeMode {
    return mode === 'plan' || mode === 'goal' ? mode : 'build';
}

/** Goal is an execution policy layered on top of OpenCode's build agent. */
export function openCodeAgentForFabiMode(mode: FabiCodeMode): FabiOpenCodeAgent {
    return mode === 'plan' ? 'plan' : 'build';
}

/** Trusted marker consumed only by Fabi's internal Goal plugin. */
export function openCodeVariantForFabiMode(mode: FabiCodeMode): string | undefined {
    return mode === 'goal' ? 'fabi-goal' : undefined;
}
