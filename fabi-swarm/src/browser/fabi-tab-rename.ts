import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { ApplicationShell, QuickInputService, Widget } from '@theia/core/lib/browser';
import { SHELL_TABBAR_CONTEXT_MENU } from '@theia/core/lib/browser/shell/tab-bars';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';

/**
 * Renommage des onglets Fabi (terminaux + chats IA) au clic droit.
 *
 * On s'appuie sur le mécanisme natif du menu contextuel d'onglet de Theia : il
 * passe l'événement souris en argument, dont `shell.findTargetedWidget(event)`
 * déduit l'onglet visé. Un `QuickInput` (la même UI que VS Code) demande le nom.
 *
 *   - Terminal : `setTitle()` pose le titre, fige l'auto-mise-à-jour
 *     (`hasUserTitle`) ET persiste (storeState) → renommage durable.
 *   - Chat : on fixe `title.label` / `title.caption`.
 */
const RENAME_TAB = Command.toLocalizedCommand({ id: 'fabi.tab.rename', label: 'Renommer l’onglet' });

const FABI_TABBAR_RENAME_GROUP = [...SHELL_TABBAR_CONTEXT_MENU, '2_fabi_rename'];

@injectable()
export class FabiTabRenameContribution implements CommandContribution, MenuContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(QuickInputService)
    protected readonly quickInput: QuickInputService;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(RENAME_TAB, {
            isVisible: arg => !!this.targetWidget(arg),
            isEnabled: arg => !!this.targetWidget(arg),
            execute: arg => this.rename(this.targetWidget(arg))
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(FABI_TABBAR_RENAME_GROUP, {
            commandId: RENAME_TAB.id,
            label: 'Renommer',
            order: '0'
        });
    }

    /** Widget de l'onglet visé : depuis l'event (clic droit) ou, à défaut, l'onglet courant. */
    protected targetWidget(arg: unknown): TerminalWidget | ChatViewWidget | undefined {
        const fromEvent = arg instanceof Event ? this.shell.findTargetedWidget(arg) : undefined;
        const widget: Widget | undefined = fromEvent ?? this.shell.currentWidget;
        return widget instanceof TerminalWidget || widget instanceof ChatViewWidget ? widget : undefined;
    }

    protected async rename(widget: TerminalWidget | ChatViewWidget | undefined): Promise<void> {
        if (!widget) {
            return;
        }
        const current = widget.title.label;
        const next = await this.quickInput.input({
            value: current,
            placeHolder: current,
            prompt: 'Nouveau nom de l’onglet'
        });
        const name = next?.trim();
        if (!name || name === current) {
            return;
        }
        if (widget instanceof TerminalWidget) {
            widget.setTitle(name);
        } else {
            widget.title.label = name;
            widget.title.caption = name;
        }
    }
}
