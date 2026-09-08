import { injectable } from '@theia/core/shared/inversify';
import { TerminalWidgetImpl } from '@theia/terminal/lib/browser/terminal-widget-impl';
import { TerminalExitReason } from '@theia/terminal/lib/common/base-terminal-protocol';

/** Keep failed interactive shells inspectable; explicit close and task terminals stay native. */
@injectable()
export class FabiTerminalWidget extends TerminalWidgetImpl {
    protected failureRetained = false;

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
