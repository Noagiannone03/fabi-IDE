import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { initializeTerminalEnvironment } from '../common/fabi-terminal-environment';

/** The backend can be launched by an automation runner or a remote bootstrap,
 * bypassing tools/start-electron.mjs. Its output policy must not become the
 * policy of every interactive PTY. Apply defaults before terminal RPC requests;
 * terminal profiles, extension environments and shell rc files still override
 * them through Theia's normal environment merge. */

@injectable()
export class FabiTerminalEnvironmentContribution implements BackendApplicationContribution {
    initialize(): void { initializeTerminalEnvironment(process.env); }
}
