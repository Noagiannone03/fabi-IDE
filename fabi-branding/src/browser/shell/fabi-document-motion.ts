import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { TabBar, Widget } from '@theia/core/shared/@lumino/widgets';

/** Follow visible tab selection, including previews that deliberately preserve tree focus. */
@injectable()
export class FabiDocumentMotion implements FrontendApplicationContribution {
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    onDidInitializeLayout(): void {
        let animation: Animation | undefined;
        const bars = new Set<TabBar<Widget>>();
        const changed = (_sender: TabBar<Widget>, args: TabBar.ICurrentChangedArgs<Widget>) => {
            animation?.cancel();
            const widget = args.currentTitle?.owner;
            if (!widget || args.currentTitle === args.previousTitle
                || matchMedia('(prefers-reduced-motion: reduce)').matches
                || document.querySelector('.theia-preload:not(.theia-hidden)')) { return; }
            animation = widget.node.animate([
                { opacity: .76, transform: 'translateY(10px)' },
                { opacity: 1, transform: 'translateY(0)' }
            ], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
        };
        const sync = () => {
            const current = new Set(this.shell.mainPanel.tabBars());
            for (const bar of bars) {
                if (!current.has(bar)) { bar.currentChanged.disconnect(changed); bars.delete(bar); }
            }
            for (const bar of current) {
                if (!bars.has(bar)) { bar.currentChanged.connect(changed); bars.add(bar); }
            }
        };
        sync();
        this.shell.mainPanel.layoutModified.connect(sync);
        this.shell.disposed.connect(() => {
            this.shell.mainPanel.layoutModified.disconnect(sync);
            for (const bar of bars) { bar.currentChanged.disconnect(changed); }
            animation?.cancel();
        });
    }
}
