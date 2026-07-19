import { FabiCodePart } from '../common/fabi-code-protocol';

export interface FabiCodePartDelta {
    sessionId: string;
    messageId: string;
    partId: string;
    field: string;
    delta: string;
}

/**
 * OpenCode 1.15 envoie une photo `message.part.updated`, puis des
 * `message.part.delta`, puis une photo finale. Le frontend Theia consomme des
 * photos cumulatives afin de dédupliquer ses rendus : cet accumulateur adapte
 * le protocole sans perdre le streaming token par token.
 */
export class FabiCodePartAccumulator {
    private readonly parts = new Map<string, FabiCodePart>();

    remember(part: FabiCodePart): FabiCodePart {
        this.parts.set(this.key(part.sessionId, part.messageId, part.partId), part);
        return part;
    }

    append(delta: FabiCodePartDelta): FabiCodePart | undefined {
        if (delta.field !== 'text' || !delta.partId || !delta.messageId) {
            return undefined;
        }
        const key = this.key(delta.sessionId, delta.messageId, delta.partId);
        const previous = this.parts.get(key) ?? {
            sessionId: delta.sessionId,
            messageId: delta.messageId,
            partId: delta.partId,
            type: 'text'
        };
        const next: FabiCodePart = {
            ...previous,
            text: `${previous.text ?? ''}${delta.delta}`
        };
        this.parts.set(key, next);
        return next;
    }

    clearSession(sessionId: string): void {
        const prefix = `${sessionId}\u0000`;
        for (const key of this.parts.keys()) {
            if (key.startsWith(prefix)) {
                this.parts.delete(key);
            }
        }
    }

    clear(): void {
        this.parts.clear();
    }

    private key(sessionId: string, messageId: string, partId: string): string {
        return `${sessionId}\u0000${messageId}\u0000${partId}`;
    }
}
