/** Default capabilities of Fabi’s interactive xterm terminals. */
export function initializeTerminalEnvironment(env: NodeJS.ProcessEnv): void {
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    delete env.NO_COLOR;
    delete env.FORCE_COLOR;
}

