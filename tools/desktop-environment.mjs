/** A desktop terminal must not inherit the automation runner's output policy.
 * Explicit terminal profile preferences still apply inside Theia afterwards.
 */
export function desktopEnvironment(source) {
    const env = { ...source, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete env.NO_COLOR;
    delete env.FORCE_COLOR;
    return env;
}
