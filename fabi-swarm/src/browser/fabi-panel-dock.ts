import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget, TerminalLocation } from '@theia/terminal/lib/browser/base/terminal-widget';

/**
 * Actions d'onglet des TERMINAUX. On épure ce que Theia met d'origine sur l'onglet
 * d'un terminal (un « + », un « split », un « ouvrir dans une fenêtre ») au profit
 * d'un seul geste clair : basculer le terminal entre la zone d'édition (onglet) et
 * le panneau bas (mode classique), via `shell.addWidget({ area })` — le reparentage
 * natif de Theia.
 *
 *   - terminal en zone d'édition → bouton « Afficher en bas ».
 *   - terminal dans le panneau bas → bouton « + Nouveau terminal » + bouton
 *     « Afficher dans la barre d'onglets ».
 *
 * (Le « + Terminal » global de la zone d'édition reste fourni par le chip de
 * FabiEditorActionsContribution ; le « ouvrir dans une fenêtre » est neutralisé en
 * passant `isExtractable = false` sur les terminaux — cf. FabiEditorActions.)
 */

const TERM_TO_BOTTOM = Command.toLocalizedCommand({
    id: 'fabi.terminal.toBottom',
    label: 'Afficher le terminal en bas',
    iconClass: 'codicon codicon-layout-panel'
});
const TERM_TO_EDITOR = Command.toLocalizedCommand({
    id: 'fabi.terminal.toEditor',
    label: 'Afficher le terminal dans la barre d’onglets',
    iconClass: 'codicon codicon-layout-centered'
});
const TERM_NEW_BOTTOM = Command.toLocalizedCommand({
    id: 'fabi.terminal.newInBottom',
    label: 'Nouveau terminal',
    iconClass: 'codicon codicon-add'
});

@injectable()
export class FabiPanelDockContribution implements CommandContribution, TabBarToolbarContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(TerminalService)
    protected readonly terminalService: TerminalService;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(TERM_TO_BOTTOM, {
            isEnabled: w => this.isTerminal(w),
            isVisible: w => this.isTerminal(w) && this.shell.getAreaFor(w as Widget) === 'main',
            execute: w => this.move(this.asTerminal(w), 'bottom')
        });
        commands.registerCommand(TERM_TO_EDITOR, {
            isEnabled: w => this.isTerminal(w),
            isVisible: w => this.isTerminal(w) && this.shell.getAreaFor(w as Widget) !== 'main',
            execute: w => this.move(this.asTerminal(w), 'main')
        });
        commands.registerCommand(TERM_NEW_BOTTOM, {
            execute: () => this.newTerminalInBottom()
        });
    }

    registerToolbarItems(registry: TabBarToolbarRegistry): void {
        // On retire les actions d'onglet de terminal d'origine (laides / redondantes).
        registry.unregisterItem('terminal:new');
        registry.unregisterItem('terminal:split');

        // Terminal en zone d'édition → l'envoyer en bas.
        registry.registerItem({
            id: TERM_TO_BOTTOM.id,
            command: TERM_TO_BOTTOM.id,
            icon: 'codicon codicon-layout-panel',
            tooltip: 'Afficher en bas (mode classique)',
            group: 'navigation',
            priority: 0,
            isVisible: w => this.isTerminal(w) && this.shell.getAreaFor(w!) === 'main'
        });
        // Terminal dans le panneau bas → nouveau terminal + le remonter en onglet.
        registry.registerItem({
            id: TERM_NEW_BOTTOM.id,
            command: TERM_NEW_BOTTOM.id,
            icon: 'codicon codicon-add',
            tooltip: 'Nouveau terminal',
            group: 'navigation',
            priority: 0,
            isVisible: w => this.isTerminal(w) && this.shell.getAreaFor(w!) === 'bottom'
        });
        registry.registerItem({
            id: TERM_TO_EDITOR.id,
            command: TERM_TO_EDITOR.id,
            icon: 'codicon codicon-layout-centered',
            tooltip: 'Afficher dans la barre d’onglets',
            group: 'navigation',
            priority: 1,
            isVisible: w => this.isTerminal(w) && this.shell.getAreaFor(w!) !== 'main'
        });
    }

    protected async move(widget: TerminalWidget | undefined, area: 'main' | 'bottom'): Promise<void> {
        if (!widget) {
            return;
        }
        await this.shell.addWidget(widget, { area });
        if (area === 'bottom') {
            this.shell.expandPanel('bottom');
        }
        await this.shell.activateWidget(widget.id);
    }

    protected async newTerminalInBottom(): Promise<void> {
        // `location: Panel` → `open()` route vers le panneau bas (cf. TerminalFrontend).
        const terminal = await this.terminalService.newTerminal({ location: TerminalLocation.Panel });
        await terminal.start();
        this.terminalService.open(terminal, { widgetOptions: { area: 'bottom' } });
        this.shell.expandPanel('bottom');
    }

    protected isTerminal(widget?: Widget): widget is TerminalWidget {
        return widget instanceof TerminalWidget;
    }

    protected asTerminal(arg: unknown): TerminalWidget | undefined {
        if (arg instanceof TerminalWidget) {
            return arg;
        }
        const active = this.shell.activeWidget;
        return active instanceof TerminalWidget ? active : undefined;
    }
}
