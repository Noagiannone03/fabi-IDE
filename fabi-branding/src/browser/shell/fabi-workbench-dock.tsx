import * as React from '@theia/core/shared/react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { BoxLayout, BoxPanel } from '@theia/core/shared/@lumino/widgets';
import { ApplicationShell, FrontendApplicationContribution, ReactWidget } from '@theia/core/lib/browser';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { FabiSidePanelHandler } from './fabi-side-panel-handler';
import { FabiSymbol } from './fabi-symbol';

/** A launcher, never a second owner of terminals or agent sessions. */
class DockTools extends ReactWidget {
    protected busy = false;

    constructor(
        protected readonly shell: ApplicationShell,
        protected readonly commands: CommandService,
        protected readonly messages: MessageService
    ) {
        super();
        this.id = 'fabi-dock-tools';
        this.toDispose.push(shell.onDidChangeActiveWidget(() => this.update()));
        this.toDispose.push(shell.onDidChangeCurrentWidget(() => this.update()));
        this.update();
    }

    protected async run(action: string): Promise<void> {
        if (this.busy) { return; }
        this.busy = true;
        this.update();
        try {
            if (action === 'terminal') {
                const terminals = [...this.shell.getWidgets('bottom'), ...this.shell.getWidgets('main')]
                    .filter(widget => widget.id.startsWith('terminal-'));
                const terminal = terminals.find(widget => widget === this.shell.currentWidget) ?? terminals[0];
                if (!terminal) {
                    await this.commands.executeCommand('fabi.newTerminalTab');
                } else {
                    if (this.shell.getAreaFor(terminal) !== 'main') {
                        await this.shell.addWidget(terminal, { area: 'main' });
                    }
                    await this.shell.activateWidget(terminal.id);
                }
            } else if (action === 'agents') {
                const chats = [...this.shell.getWidgets('right'), ...this.shell.getWidgets('main')]
                    .filter(widget => widget.id === 'chat-view-widget' || widget.id.startsWith('fabi-chat-instance:'));
                const chat = chats.find(widget => widget === this.shell.currentWidget) ?? chats[0];
                if (chat) {
                    if (this.shell.getAreaFor(chat) !== 'main') {
                        await this.shell.addWidget(chat, { area: 'main' });
                    }
                    await this.shell.activateWidget(chat.id);
                }
                else { await this.commands.executeCommand('fabi.newChat'); }
            } else {
                await this.commands.executeCommand(action);
            }
        } catch (error) {
            void this.messages.error(`Impossible d’ouvrir cet outil : ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.busy = false;
            if (!this.isDisposed) { this.update(); }
        }
    }

    protected render(): React.ReactNode {
        const active = this.shell.currentWidget?.id ?? '';
        return <nav className="fabi-dock-tools" aria-label="Outils du Space" aria-busy={this.busy}>
            {[
                ['terminal', 'terminal', 'Terminal', active.startsWith('terminal-')],
                ['agents', 'comment-discussion', 'Agents', active === 'chat-view-widget' || active.startsWith('fabi-chat-instance:')],
                ['workbench.action.showCommands', 'search', 'Commandes', false],
                ['preferences:open', 'settings-gear', 'Réglages', false]
            ].map(([action, icon, label, selected]) => <button key={String(action)}
                className={'fabi-dock-tool' + (selected ? ' active' : '')}
                title={String(label)} aria-label={String(label)} disabled={this.busy}
                aria-pressed={Boolean(selected)}
                onClick={() => void this.run(String(action))}>
                <span className="fabi-dock-tile"><FabiSymbol name={action === 'terminal' || action === 'agents' ? String(action) : icon === 'search' ? 'search' : 'settings'} /></span>
                <span className="fabi-dock-label">{label}</span>
            </button>)}
        </nav>;
    }
}

@injectable()
export class FabiWorkbenchDockContribution implements FrontendApplicationContribution {
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(MessageService) protected readonly messages: MessageService;

    onDidInitializeLayout(): void {
        // Maestro has its own full-screen navigation and rejects ordinary shell tools.
        if (document.body.classList.contains('fabi-maestro-mode')) { return; }
        for (const widget of this.shell.getWidgets('right')) {
            if (widget.id === 'chat-view-widget' || widget.id.startsWith('fabi-chat-instance:')) {
                this.shell.addWidget(widget, { area: 'main' });
            }
        }
        const handler = this.shell.leftPanelHandler;
        const layout = this.shell.layout;
        if (!(handler instanceof FabiSidePanelHandler) || !(layout instanceof BoxLayout)) { return; }
        const activity = handler.activityBar;
        if (!activity) { return; }
        const dock = new BoxPanel({ direction: 'left-to-right', spacing: 0 });
        dock.id = 'fabi-workbench-dock';
        // Reparent the existing view launcher: plugin views and their order survive.
        BoxPanel.setStretch(activity, 1);
        dock.addWidget(activity);
        const tools = new DockTools(this.shell, this.commands, this.messages);
        BoxPanel.setStretch(tools, 0);
        dock.addWidget(tools);
        BoxPanel.setStretch(dock, 0);
        layout.insertWidget(Math.max(0, layout.widgets.length - 1), dock);
        // Lumino caches CSS size limits. Responsive padding / tool labels need a
        // fit pass when the viewport changes, not only a resize of the parent.
        const refit = () => { dock.fit(); this.shell.fit(); };
        window.addEventListener('resize', refit);
        dock.disposed.connect(() => window.removeEventListener('resize', refit));
        document.body.classList.add('fabi-dock-enabled');
        document.body.classList.toggle('fabi-native-spaces', window.location.protocol === 'file:');
        handler.enableDockNavigation();
    }
}
