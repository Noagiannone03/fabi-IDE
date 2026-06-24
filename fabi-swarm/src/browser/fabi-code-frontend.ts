import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import { RemoteConnectionProvider, ServiceConnectionProvider } from '@theia/core/lib/browser';
import {
    FabiCodeService, FabiCodeClient, FABI_CODE_SERVICE_PATH,
    FabiCodeServerInfo, FabiCodePart, FabiCodePermission, FabiCodeEvent
} from '../common/fabi-code-protocol';

/**
 * Façade frontend du moteur fabi-code : détient le proxy RPC vers le service
 * backend ET implémente FabiCodeClient (le backend appelle ces méthodes pour
 * pousser parts / fin de tour / état serveur). Ré-expose en Events Theia →
 * le ChatAgent relais et l'UI s'y abonnent, zéro polling.
 */
@injectable()
export class FabiCodeFrontend implements FabiCodeClient {

    readonly service: FabiCodeService;

    protected readonly serverEmitter = new Emitter<FabiCodeServerInfo>();
    protected readonly partEmitter = new Emitter<FabiCodePart>();
    protected readonly turnDoneEmitter = new Emitter<{ sessionId: string; error?: string }>();
    protected readonly fileEditedEmitter = new Emitter<{ sessionId: string; path: string }>();
    protected readonly permissionEmitter = new Emitter<FabiCodePermission>();
    protected readonly userMessageEmitter = new Emitter<{ sessionId: string; messageId: string }>();
    protected readonly engineEventEmitter = new Emitter<FabiCodeEvent>();

    /** Dernier état serveur (rendu immédiat à l'attache). */
    server: FabiCodeServerInfo = { status: 'starting' };

    readonly onServerStatusEvent: Event<FabiCodeServerInfo> = this.serverEmitter.event;
    readonly onPartEvent: Event<FabiCodePart> = this.partEmitter.event;
    readonly onTurnDoneEvent: Event<{ sessionId: string; error?: string }> = this.turnDoneEmitter.event;
    readonly onFileEditedEvent: Event<{ sessionId: string; path: string }> = this.fileEditedEmitter.event;
    readonly onPermissionAskedEvent: Event<FabiCodePermission> = this.permissionEmitter.event;
    readonly onUserMessageEvent: Event<{ sessionId: string; messageId: string }> = this.userMessageEmitter.event;
    readonly onEngineEventEvent: Event<FabiCodeEvent> = this.engineEventEmitter.event;

    constructor(
        @inject(RemoteConnectionProvider) connectionProvider: ServiceConnectionProvider
    ) {
        this.service = connectionProvider.createProxy<FabiCodeService>(FABI_CODE_SERVICE_PATH, this);
    }

    // ----- FabiCodeClient (poussé par le backend) -----
    onServerStatus(info: FabiCodeServerInfo): void {
        this.server = info;
        this.serverEmitter.fire(info);
    }
    onPart(part: FabiCodePart): void {
        this.partEmitter.fire(part);
    }
    onTurnDone(sessionId: string, error?: string): void {
        this.turnDoneEmitter.fire({ sessionId, error });
    }
    onFileEdited(sessionId: string, path: string): void {
        this.fileEditedEmitter.fire({ sessionId, path });
    }
    onPermissionAsked(permission: FabiCodePermission): void {
        this.permissionEmitter.fire(permission);
    }
    onUserMessage(sessionId: string, messageId: string): void {
        this.userMessageEmitter.fire({ sessionId, messageId });
    }
    onEngineEvent(event: FabiCodeEvent): void {
        this.engineEventEmitter.fire(event);
    }
}
