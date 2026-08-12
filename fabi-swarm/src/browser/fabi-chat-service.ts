import { injectable } from '@theia/core/shared/inversify';
import { FrontendChatServiceImpl } from '@theia/ai-chat/lib/browser/frontend-chat-service';

/**
 * Product chat semantics for Fabi.
 *
 * Theia's default is "latest request wins": sendRequest() cancels every
 * incomplete response before invoking the next agent. Fabi/OpenCode instead
 * expose a conversational FIFO, owned by FabiCodeAgent. Keeping the requests
 * alive here is what lets the second user bubble remain visibly queued without
 * aborting the generation already in progress.
 */
@injectable()
export class FabiChatService extends FrontendChatServiceImpl {
    protected override cancelIncompleteRequests(): void {
        // Intentionally empty. FabiCodeAgent serializes requests per chat and
        // each request still retains its own explicit cancellation token.
    }
}
