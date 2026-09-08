import * as React from '@theia/core/shared/react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { Widget } from '@theia/core/shared/@lumino/widgets';
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
                    .filter(widget => widget.id.startsWith('terminal-') && !(widget as Widget & { exitStatus?: unknown }).exitStatus);
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
                ['agents', 'comment-discussion', 'Agents', active === 'chat-view-widget' || active.startsWith('fabi-chat-instance:')]
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
        if (!(handler instanceof FabiSidePanelHandler)) { return; }
        const dock = new DockTools(this.shell, this.commands, this.messages);
        dock.id = 'fabi-workbench-dock';
        // Independent overlay: no extra row is allocated in the Lumino shell.
        Widget.attach(dock, this.shell.node);
        const reveal = document.createElement('button');
        reveal.className = 'fabi-sidebar-reveal';
        reveal.title = 'Afficher les fichiers';
        reveal.setAttribute('aria-label', 'Afficher les fichiers');
        const glyph = document.createElement('span');
        glyph.className = 'fabi-symbol ph-files';
        glyph.setAttribute('aria-hidden', 'true');
        reveal.append(glyph);
        reveal.onclick = () => this.shell.expandPanel('left');
        this.shell.node.append(reveal);
        const editor = this.shell.mainPanel.node;
        const position = () => {
            const r = editor.getBoundingClientRect();
            dock.node.style.left = Math.round(r.left + r.width / 2) + 'px';
            dock.node.style.bottom = Math.max(12, window.innerHeight - r.bottom + 14) + 'px';
        };
        const observer = new ResizeObserver(position);
        observer.observe(editor);
        observer.observe(this.shell.node);
        window.addEventListener('resize', position);
        position();
        const rest = (event: PointerEvent) => { if (!dock.node.contains(event.target as Node)) { dock.node.classList.add('fabi-dock-resting'); } };
        let collapseTimer: number | undefined;
        const show = () => { window.clearTimeout(collapseTimer); dock.node.classList.remove('fabi-dock-resting'); };
        const settle = () => {
            window.clearTimeout(collapseTimer);
            collapseTimer = window.setTimeout(() => {
                if (!dock.node.contains(document.activeElement) && !dock.node.matches(':hover')) {
                    dock.node.classList.add('fabi-dock-resting');
                }
            }, 320);
        };
        this.shell.node.addEventListener('pointerdown', rest);
        dock.node.addEventListener('pointerenter', show);
        dock.node.addEventListener('focusin', show);
        dock.node.addEventListener('pointerleave', settle);
        dock.node.addEventListener('focusout', settle);
        this.shell.disposed.connect(() => dock.dispose());
        dock.disposed.connect(() => { window.clearTimeout(collapseTimer); reveal.remove(); observer.disconnect(); window.removeEventListener('resize', position); this.shell.node.removeEventListener('pointerdown', rest); });
        document.body.classList.add('fabi-dock-enabled');
        document.body.classList.toggle('fabi-native-spaces', window.location.protocol === 'file:');
        handler.enableDockNavigation();
    }
}
