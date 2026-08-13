import { homedir } from 'os';
import { join, win32 as windowsPath } from 'path';

/** Resolve the worker log directory according to each platform's state layout. */
export function workerLogDirectory(
    platform: NodeJS.Platform = process.platform,
    environment: NodeJS.ProcessEnv = process.env,
    home: string = homedir()
): string {
    if (platform === 'darwin') {
        return join(home, 'Library', 'Logs', 'Fabi');
    }
    if (platform === 'win32') {
        return windowsPath.join(
            environment.LOCALAPPDATA || windowsPath.join(home, 'AppData', 'Local'),
            'Fabi',
            'logs'
        );
    }
    return join(environment.XDG_STATE_HOME || join(home, '.local', 'state'), 'fabi', 'logs');
}
