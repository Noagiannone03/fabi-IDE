/** Small POSIX probes around Theia's installer; no alternate SSH transport. */
export function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const DISCOVER_REMOTE = `printf '__FABI_SYSTEM__\\t%s\\t%s\\t%s\\n' "$(uname -s)" "$(uname -m)" "$HOME"`;

export function parseRemoteSystem(stdout: string): { os: 'linux' | 'darwin'; arch: string; home: string } | undefined {
    const line = stdout.split(/\r?\n/).find(value => value.startsWith('__FABI_SYSTEM__\t'));
    const [, kernel, machine, home] = line?.split('\t') ?? [];
    if (!home?.startsWith('/') || !['Linux', 'Darwin'].includes(kernel)) { return undefined; }
    const arch = machine === 'x86_64' ? 'x64' : machine === 'aarch64' ? 'arm64' : machine;
    if (!/^(x64|arm64|armv7l)$/.test(arch)) { return undefined; }
    return { os: kernel === 'Linux' ? 'linux' : 'darwin', arch, home };
}

/** Prefer this release's existing runtime, then a versioned shared runtime.
 * An older Fabi release can supply identical Node bits without another transfer.
 * Copy rather than move: an open session on the older release remains valid. */
export function prepareRemoteInstall(home: string, appName: string, release: string, nodeName: string): string {
    const app = `${home}/.${release}`;
    const runtime = `${home}/.${appName}-runtimes/${nodeName}`;
    const q = shellQuote;
    return `/bin/sh -c ${q(`set -e
fabi_app=${q(app)}
fabi_runtime=${q(runtime)}
mkdir -p "$fabi_app" ${q(`${home}/.${appName}-runtimes`)}
if [ -x "$fabi_app/${nodeName}/bin/node" ]; then
    fabi_node="$fabi_app/${nodeName}"
else
    if [ ! -x "$fabi_runtime/bin/node" ]; then
        for fabi_old in ${q(`${home}/.${appName}-`)}*-remote/${q(nodeName)}; do
            if [ -x "$fabi_old/bin/node" ]; then
                fabi_stage="$fabi_runtime.copy-$$"
                trap 'rm -rf "$fabi_stage"' EXIT HUP INT TERM
                cp -R "$fabi_old" "$fabi_stage"
                if [ ! -d "$fabi_runtime" ]; then mv "$fabi_stage" "$fabi_runtime"; fi
                rm -rf "$fabi_stage"
                trap - EXIT HUP INT TERM
                break
            fi
        done
    fi
    fabi_node="$fabi_runtime"
fi
if [ -x "$fabi_node/bin/node" ]; then printf '__FABI_NODE__\\t%s\\n' "$fabi_node"; fi
if [ -f "$fabi_app/lib/backend/main.js" ] && [ ! -f "$fabi_app/.fabi-installing" ]; then
    printf '__FABI_BACKEND_READY__\\n'
fi`)}`;
}
