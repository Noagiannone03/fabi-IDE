import { homedir } from 'os';
import { posix as posixPath, win32 as windowsPath } from 'path';

/** Resolve the worker log directory according to each platform's state layout. */
export function workerLogDirectory(
    platform: NodeJS.Platform = process.platform,
    environment: NodeJS.ProcessEnv = process.env,
    home: string = homedir()
): string {
    if (platform === 'darwin') {
        return posixPath.join(home, 'Library', 'Logs', 'Fabi');
    }
    if (platform === 'win32') {
        return windowsPath.join(
            environment.LOCALAPPDATA || windowsPath.join(home, 'AppData', 'Local'),
            'Fabi',
            'logs'
        );
    }
    return posixPath.join(
        environment.XDG_STATE_HOME || posixPath.join(home, '.local', 'state'),
        'fabi',
        'logs'
    );
}
