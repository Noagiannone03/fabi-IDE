import { injectable } from '@theia/core/shared/inversify';
import { FrontendChatServiceImpl } from '@theia/ai-chat/lib/browser/frontend-chat-service';

/**
 * Product chat semantics for Fabi.
 *
 * Theia's default is "latest request wins": sendRequest() cancels every
 * incomplete response before invoking the next agent. Fabi/OpenCode instead
 * expose a conversational FIFO, owned authoritatively by the backend for the
 * whole installation. Keeping requests alive here lets every workspace retain
 * its user bubble and visible queue position without aborting the active turn.
 */
@injectable()
export class FabiChatService extends FrontendChatServiceImpl {
    protected override cancelIncompleteRequests(): void {
        // Intentionally empty. FabiCodeService serializes requests machine-wide
        // and each request still retains its own explicit cancellation token.
    }
}
