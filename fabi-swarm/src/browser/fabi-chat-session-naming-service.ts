import { injectable } from '@theia/core/shared/inversify';
import { ChatSession } from '@theia/ai-chat/lib/common/chat-service';
import { ChatSessionNamingService } from '@theia/ai-chat/lib/common/chat-session-naming-service';

/**
 * Fabi deliberately has no Theia LanguageModel registration: every inference
 * must go through OpenCode and the contribution gate. Keep Theia's initial
 * request-based title instead of starting an unroutable background inference.
 */
@injectable()
export class FabiChatSessionNamingService extends ChatSessionNamingService {
    override async generateChatSessionName(_session: ChatSession, _otherNames: string[]): Promise<undefined> {
        return undefined;
    }
}
