/** OpenCode primary agents exposed through Theia's native chat-mode contract. */
export type FabiCodeMode = 'build' | 'plan';

export const FABI_CODE_MODES: Array<{
    id: FabiCodeMode;
    name: string;
    isDefault?: boolean;
}> = [
    { id: 'build', name: 'Agent', isDefault: true },
    { id: 'plan', name: 'Ask' }
];

/** Never forward an arbitrary UI value as an OpenCode agent identifier. */
export function normalizeFabiCodeMode(mode: string | undefined): FabiCodeMode {
    return mode === 'plan' ? 'plan' : 'build';
}
