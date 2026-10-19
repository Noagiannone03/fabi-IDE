import { RemoteSpace } from './space-types';

/** Accept an SSH config alias or hostname[:port], never shell commands or passwords. */
export function parseRemoteSpace(value: unknown): RemoteSpace | undefined {
    if (!value || typeof value !== 'object') { return; }
    const { host, user } = value as Record<string, unknown>;
    if (typeof host !== 'string' || typeof user !== 'string') { return; }
    const address = host.trim();
    const username = user.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?::[0-9]{1,5})?$/.test(address)
        || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*\$?$/.test(username)) { return; }
    const port = address.split(':')[1];
    if (port && (Number(port) < 1 || Number(port) > 65535)) { return; }
    return { host: address, user: username };
}
