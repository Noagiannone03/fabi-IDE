import { Emitter } from '@theia/core/lib/common';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { TerminalWidgetImpl } from '@theia/terminal/lib/browser/terminal-widget-impl';
import { TerminalExitReason } from '@theia/terminal/lib/common/base-terminal-protocol';

/** Keep failed interactive shells inspectable; explicit close and task terminals stay native. */
@injectable()
export class FabiTerminalWidget extends TerminalWidgetImpl {
    protected failureRetained = false;
    private readonly receivedOutput = new Emitter<string>();
    /** PTY delivery must remain observable even before xterm is opened/visible. */
    readonly onDidReceiveOutput = this.receivedOutput.event;

    override write(data: string): void {
        super.write(data);
        this.receivedOutput?.fire(data);
    }

    @postConstruct()
    protected override init(): void {
        super.init();
        this.toDispose.push(this.receivedOutput);
        let frame = 0;
        const fit = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => this.doResizeTerminal());
        };
        const observer = new ResizeObserver(fit);
        const observe = () => {
            observer.disconnect(); observer.observe(this.node);
            const viewport = this.term.element?.parentElement;
            if (viewport && viewport !== this.node) observer.observe(viewport);
            fit();
        };
        // Recheck geometry when the terminal host changes its child layout.
        const mutation = new MutationObserver(observe);
        mutation.observe(this.node, { childList: true });
        document.fonts.addEventListener('loadingdone', fit);
        void document.fonts.ready.then(() => { if (!this.isDisposed) fit(); });
        observe();
        this.toDispose.push({ dispose: () => {
            cancelAnimationFrame(frame); observer.disconnect(); mutation.disconnect();
            document.fonts.removeEventListener('loadingdone', fit);
        } });
    }

    protected override onAfterShow(message: Message): void {
        this.needsResize = true;
        super.onAfterShow(message);
    }

    protected override doResizeTerminal(): void {
        const viewport = this.term.element?.parentElement;
        if (this.isDisposed || !viewport?.isConnected || !viewport.getClientRects().length
            || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return;
        const dimensions = this.fitAddon.proposeDimensions();
        if (!dimensions || !Number.isFinite(dimensions.cols) || !Number.isFinite(dimensions.rows)) return;
        // FitAddon clears/reflows the renderer. Send exactly that grid to the native PTY.
        this.fitAddon.fit();
        this.resizeTerminalProcess();
    }

    override dispose(): void {
        const exit = this.exitStatus;
        if (!this.failureRetained && this.closeOnDispose && this.kind === 'user'
            && exit?.reason === TerminalExitReason.Process && exit.code !== 0) {
            this.failureRetained = true;
            this.title.label = `${this.title.label} — terminé`;
            this.write(`\r\n\x1b[31mLe processus du terminal s’est arrêté${exit.code === undefined ? ' de façon inattendue' : ` (code ${exit.code})`}.\x1b[0m\r\nLa sortie est conservée. Ouvrez un nouveau terminal pour reprendre.\r\n`);
            return;
        }
        super.dispose();
    }
}
