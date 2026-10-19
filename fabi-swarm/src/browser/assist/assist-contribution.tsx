import { learningOpportunity } from '../../common/fabi-learning-opportunity';
import * as React from '@theia/core/shared/react';
import { createRoot, Root } from '@theia/core/shared/react-dom/client';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry, SelectionService } from '@theia/core';
import { UriSelection } from '@theia/core/lib/common/selection';
import URI from '@theia/core/lib/common/uri';
import { ApplicationShell, FrontendApplicationContribution, KeybindingContribution, KeybindingRegistry, ReactWidget, Widget } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { MarkdownRenderer } from '@theia/core/lib/browser/markdown-rendering/markdown-renderer';
import { EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser/editor-menu';
import { FileNavigatorWidget } from '@theia/navigator/lib/browser/navigator-widget';
import { FileStatNode } from '@theia/filesystem/lib/browser/file-tree/file-tree';
import { NAVIGATOR_CONTEXT_MENU } from '@theia/navigator/lib/browser/navigator-contribution';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { DisposableCollection } from '@theia/core';
import { AssistModel, ContextAssistModel } from './assist-model';
import { AssistView } from './assist-view';
import { AssistLens } from './assist-lens';
import { assistPlacement, assistOrbitPlacement } from '../../common/fabi-assist-placement';

export const ASSIST_WIDGET = 'fabi-assist';
const OPEN = { id: 'fabi.assist.open', label: 'Fabi Assist : apprendre dans ce projet' };
const ASK = { id: 'fabi.assist.ask', label: 'Comprendre avec Fabi Assist' };

@injectable()
export class AssistWidget extends ReactWidget {
    @inject(AssistModel) protected readonly model: AssistModel;
    @inject(MarkdownRenderer) protected readonly markdown: MarkdownRenderer;
    @postConstruct()
    protected init(): void {
        this.id = ASSIST_WIDGET;
        this.title.label = 'Fabi Assist';
        this.title.caption = 'Comprendre et apprendre dans ton projet';
        this.title.iconClass = 'codicon codicon-lightbulb';
        this.title.closable = true;
        this.addClass('fabi-assist-widget');
        this.update();
    }
    protected render(): React.ReactNode { return <AssistView model={this.model} markdown={this.markdown} />; }
}

@injectable()
export class AssistContribution implements CommandContribution, MenuContribution, KeybindingContribution,
    TabBarToolbarContribution, FrontendApplicationContribution {
    @inject(ContextAssistModel) protected readonly contextModel: AssistModel;
    @inject(AssistModel) protected readonly model: AssistModel;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(SelectionService) protected readonly selection: SelectionService;
    @inject(MarkdownRenderer) protected readonly markdown: MarkdownRenderer;
    private bubble?: HTMLDivElement;
    private previousFocus?: HTMLElement;
    private pointer = { x: 200, y: 160 };
    private generation = 0;
    private anchor = { x: 200, y: 160 };
    private observer?: ResizeObserver;
    private bubbleRoot?: Root;
    private surface?: { host: HTMLElement; root: Root; widget: Widget };
    private readonly listeners = new DisposableCollection();
    private readonly discoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly discovering = new Set<string>();
    private stopped = false;
    private presenceWakeup?: ReturnType<typeof setTimeout>;
    private presenceTimer?: ReturnType<typeof setInterval>;
    private readonly presenceDiagnostics = new Map<string, { reason: string; at: number }>();
    private readonly workingSince = new Map<string, number>();
    private readonly deepTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly deepRuns = new Set<string>();
    private readonly notebooks = new Map<string, import('../../common/fabi-assist-protocol').AssistNotebook>();
    private invitationCooldown = 0;
    private readonly invitationsSeen = new Set<string>();
    private readonly launchers = new Map<string, HTMLElement>();
    private hold?: { x: number; y: number; target: Element; timer: ReturnType<typeof setTimeout>; reveal: ReturnType<typeof setTimeout>; ring: HTMLElement };
    private held = false;
    private cue?: HTMLButtonElement;
    private optionPressed = 0;
    private readonly editorSelection = new DisposableCollection();

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(OPEN, { execute: () => this.open() });
        commands.registerCommand(ASK, { execute: (uri?: URI) => this.ask(uri instanceof URI ? uri : this.shell.currentWidget instanceof TerminalWidget ? undefined : UriSelection.getUri(this.selection.selection)) });
    }
    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction([...EDITOR_CONTEXT_MENU, 'navigation'], { commandId: ASK.id, order: '9' });
        menus.registerMenuAction([...NAVIGATOR_CONTEXT_MENU, 'navigation'], { commandId: ASK.id, order: '9' });
    }
    registerKeybindings(keys: KeybindingRegistry): void {
        keys.registerKeybinding({ command: ASK.id, keybinding: 'ctrlcmd+alt+i' });
    }
    registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
        toolbar.registerItem({ id: 'fabi.assist.button', priority: 99, group: 'navigation',
            isVisible: widget => !!widget && !(widget instanceof TerminalWidget) && this.shell.getAreaFor(widget) === 'main',
            render: () => <button className='fabi-editor-action' title='Fabi Assist · Comprendre et apprendre' onMouseDown={e => e.preventDefault()} onClick={() => void this.open()}>
                <span className='codicon codicon-lightbulb fabi-editor-action-icon' /><span className='fabi-editor-action-label'>Assist</span>
            </button>
        });
    }
    onStart(): void {
        this.presenceTimer = setInterval(() => this.updatePresence(), 5000);
        this.listeners.push(this.model.agents.onDidChange(() => this.updatePresence()));
        void this.model.workspace.ready.then(() => {
            if (!this.stopped) this.model.workspace.tryGetRoots().forEach(root => this.scheduleDiscovery(root.resource));
        });
        this.listeners.push(this.model.workspace.onWorkspaceChanged(roots => roots.forEach(root => this.scheduleDiscovery(root.resource))));
        this.listeners.push(this.model.observer.onDiskChange(root => {
            this.scheduleDiscovery(root, false);
            clearTimeout(this.deepTimers.get(root.toString()));
            this.deepTimers.set(root.toString(), setTimeout(() => { this.deepTimers.delete(root.toString()); if (!this.stopped) void this.discover(root, true); }, 30000));
        }));

        const watchSelection = () => {
            this.editorSelection.dispose(); this.clearCue();
            const editor = this.model.editors.currentEditor?.editor;
            if (editor) { this.editorSelection.push(editor.onSelectionChanged(() => requestAnimationFrame(() => this.showSelectionCue()))); }
            requestAnimationFrame(() => this.showSelectionCue());
        };
        this.listeners.push(this.model.editors.onCurrentEditorChanged(watchSelection));
        watchSelection();
        this.model.terminals.all.forEach(terminal => this.attachTerminal(terminal));
        this.listeners.push(this.model.terminals.onDidCreateTerminal(terminal => this.attachTerminal(terminal)));
        document.addEventListener('pointerdown', this.press);
        document.addEventListener('pointercancel', this.cancelHold);
        document.addEventListener('click', this.consumeHold, true);
        document.addEventListener('pointermove', this.move, { passive: true });
        document.addEventListener('pointerup', this.gesture);
        document.addEventListener('pointerdown', this.outside, true);
        document.addEventListener('keydown', this.keyboard, true);
        document.addEventListener('keyup', this.optionUp, true);
        document.addEventListener('scroll', this.clearCue, true);
        window.addEventListener('resize', this.resize);
    }
    onStop(): void {
        this.stopped = true; clearInterval(this.presenceTimer); clearTimeout(this.presenceWakeup);
        this.deepTimers.forEach(timer => clearTimeout(timer)); this.deepTimers.clear();
        this.discoveryTimers.forEach(timer => clearTimeout(timer)); this.discoveryTimers.clear();
        this.clearCue(); this.editorSelection.dispose();
        document.removeEventListener('keyup', this.optionUp, true);
        document.removeEventListener('scroll', this.clearCue, true);
        this.cancelHold(); this.closeSurface(); this.listeners.dispose();
        this.launchers.forEach(button => button.remove()); this.launchers.clear();
        document.removeEventListener('pointerdown', this.press);
        document.removeEventListener('pointercancel', this.cancelHold);
        document.removeEventListener('click', this.consumeHold, true);
        this.hide(false);
        document.removeEventListener('pointermove', this.move);
        document.removeEventListener('pointerup', this.gesture);
        document.removeEventListener('pointerdown', this.outside, true);
        document.removeEventListener('keydown', this.keyboard, true);
        window.removeEventListener('resize', this.resize);
    }
    private presenceReason(key: string, reason: string): void {
        if (this.presenceDiagnostics.get(key)?.reason === reason) return;
        this.presenceDiagnostics.set(key, { reason, at: Date.now() });
        if (this.presenceDiagnostics.size > 100) this.presenceDiagnostics.delete(this.presenceDiagnostics.keys().next().value!);
        console.debug('[fabi-assist] invitation', key, reason);
    }
    private updatePresence(): void {
        clearTimeout(this.presenceWakeup);
        let wakeIn = Infinity;
        let invited = false;
        for (const { resource: root } of this.model.workspace.tryGetRoots()) {
            for (const row of this.model.agents.rowsFor(root)) {
                const button = row.widgetId ? this.launchers.get(row.widgetId) : undefined;
                if (!button) { this.presenceReason(row.key, 'no-terminal'); continue; }
                if (!button.getClientRects().length) { this.presenceReason(row.key, 'terminal-hidden'); delete button.dataset.invited; continue; }
                if (row.state !== 'working') {
                    this.workingSince.delete(row.key);
                    const remaining = 25000 - (Date.now() - Number(button.dataset.shownAt));
                    if (button.dataset.invited && remaining > 0 && !this.surface && !invited) {
                        invited = true; wakeIn = Math.min(wakeIn, remaining);
                        this.presenceReason(row.key, 'available-after-completion'); continue;
                    }
                    if (button.dataset.invited) {
                        this.invitationsSeen.add(button.dataset.invited); this.invitationCooldown = Date.now() + 5 * 60000;
                    }
                    this.presenceReason(row.key, `agent-${row.state}`); delete button.dataset.invited; continue;
                }
                const now = Date.now();
                const nativeStart = row.turnStartedAt && Number.isFinite(row.turnStartedAt) && row.turnStartedAt <= now ? row.turnStartedAt : undefined;
                const since = nativeStart ?? this.workingSince.get(row.key) ?? now;
                this.workingSince.set(row.key, since);
                const book = this.model.root?.isEqual(root) ? this.model.book : this.notebooks.get(root.toString());
                const opportunity = learningOpportunity(this.model.knowledge.get(root.toString()), book, Date.now(), row.observations);
                if (!opportunity || book?.preferences?.invitations === false || book?.invitations?.some(item => Date.now() - item.at < 5 * 60000)) { this.presenceReason(row.key, !opportunity ? 'no-subject' : book?.preferences?.invitations === false ? 'disabled' : 'recent-feedback'); delete button.dataset.invited; continue; }
                const key = `${row.key}:${since}`;
                if (now - since < 6000) wakeIn = Math.min(wakeIn, 6000 - (now - since));
                if (button.dataset.invited === key && Date.now() - Number(button.dataset.shownAt) >= 25000) {
                    this.invitationsSeen.add(key); this.invitationCooldown = Date.now() + 5 * 60000;
                }
                if (invited || this.surface || Date.now() < this.invitationCooldown || Date.now() - since < 6000 || this.invitationsSeen.has(key)) { this.presenceReason(row.key, invited ? 'another-invitation' : this.surface ? 'lesson-open' : Date.now() < this.invitationCooldown ? 'cooldown' : Date.now() - since < 6000 ? 'waiting-six-seconds' : 'already-shown'); delete button.dataset.invited; continue; }
                this.presenceReason(row.key, 'shown');
                invited = true;
                if (button.dataset.invited !== key) button.dataset.shownAt = String(Date.now());
                wakeIn = Math.min(wakeIn, 25000 - (Date.now() - Number(button.dataset.shownAt)));
                button.dataset.invited = key;
                button.dataset.project = root.path.fsPath();
                button.dataset.opportunity = opportunity?.id ?? `session:${row.sessionId ?? row.key}:${since}`;
                button.dataset.question = opportunity?.question ?? 'Pendant que l’agent travaille, aide-moi à comprendre sa tâche observée et les parties concernées de mon projet. Vérifie les fichiers disponibles. Si la tâche n’est pas connue, propose un point d’entrée concret du projet sans inventer son activité.';
                button.querySelector('strong')!.textContent = opportunity?.title ?? 'Pendant qu’il travaille, on explore ?';
                button.querySelector('.fabi-presence-description')!.textContent = opportunity ? 'Je t’aide à comprendre son rôle dans ton projet.' : 'Un moment pour comprendre ton projet, à ton rythme.';
            }
        }
        if (Number.isFinite(wakeIn) && !this.stopped) this.presenceWakeup = setTimeout(() => this.updatePresence(), Math.max(1, wakeIn));
    }
    private scheduleDiscovery(root: URI, deep = true): void {
        const key = root.toString();
        clearTimeout(this.discoveryTimers.get(key));
        this.discoveryTimers.set(key, setTimeout(() => {
            this.discoveryTimers.delete(key);
            if (this.discovering.has(key)) { this.scheduleDiscovery(root, deep); return; }
            void this.discover(root, deep);
        }, 1500));
    }
    private async discover(root: URI, deep = false): Promise<void> {
        const key = root.toString(); this.discovering.add(key);
        void this.model.service.notebook(root.path.fsPath()).then(book => this.notebooks.set(key, book)).catch(() => {});
        const update = async () => {
            const state = await this.model.service.knowledge(root.path.fsPath());
            if (!state || this.stopped) return;
            for (const model of [this.model, this.contextModel]) { model.knowledge.set(key, state); model.changed.fire(); }
            this.updatePresence();
            for (const [id, button] of this.launchers) {
                const cwd = this.model.terminals.getById(id)?.lastCwd;
                if (cwd && !root.isEqualOrParent(cwd)) continue;
                const cue = button.querySelector<HTMLElement>('.fabi-discovery-status');
                if (cue) cue.textContent = state.understanding?.phase === 'exploring' ? `Je découvre ${state.understanding.current ?? 'les modules'} · ${state.understanding.completed}/${state.understanding.total}` : state.phase === 'ready' ? `${state.indexed} fichiers indexés` : `Découverte · ${state.processed}/${state.total || '…'}`;
            }
        };
        const timer = setInterval(() => void update().catch(() => {}), 800);
        try {
            await this.model.service.refreshKnowledge(root.path.fsPath()); await update();
            if (deep && !this.deepRuns.has(key)) {
                this.deepRuns.add(key);
                const revision = this.model.knowledge.get(key)?.revision;
                const progress = setInterval(() => void update().catch(() => {}), 1500);
                this.listeners.push({ dispose: () => clearInterval(progress) });
                void this.model.service.refreshKnowledge(root.path.fsPath(), true).then(update).catch(() => {}).finally(() => { clearInterval(progress); this.deepRuns.delete(key); if (!this.stopped && revision !== this.model.knowledge.get(key)?.revision) this.scheduleDiscovery(root, true); });
            }
        }
        catch { /* Discovery failure must never interrupt a coding terminal. */ }
        finally { clearInterval(timer); this.discovering.delete(key); }
    }
    private readonly move = (event: PointerEvent) => {
        this.pointer = { x: event.clientX, y: event.clientY };
        if (this.hold && Math.hypot(event.clientX - this.hold.x, event.clientY - this.hold.y) > 7) { this.cancelHold(); }
    };
    private readonly press = (event: PointerEvent) => {
        this.cancelHold(); this.held = false;
        const target = event.target instanceof Element ? event.target : undefined;
        if (event.button !== 0 || !target?.closest('.monaco-editor, #files, .terminal-container') || target.closest('.fabi-assist, button, input, a')) { return; }
        this.pointer = { x: event.clientX, y: event.clientY };
        const ring = document.createElement('span'); ring.className = 'fabi-assist-hold';
        ring.innerHTML = '<svg viewBox="0 0 80 80" aria-hidden="true"><circle class="fabi-hold-track" cx="40" cy="40" r="27"/><circle class="fabi-hold-progress" cx="40" cy="40" r="27" pathLength="1"/></svg><i class="fabi-assist-fox"></i><span class="fabi-hold-wave"></span>';
        Object.assign(ring.style, { left: `${event.clientX}px`, top: `${event.clientY}px` });
        // Ignore ordinary clicks: display feedback only after an intentional hold.
        const reveal = setTimeout(() => {
            document.body.append(ring); document.body.classList.add('fabi-assist-cursor');
        }, 180);
        const timer = setTimeout(() => {
            this.held = true; this.cancelHold();
            const row = target.closest('#files .theia-TreeNode');
            const id = row?.querySelector('.theia-TreeNodeSegmentGrow[id]')?.id;
            const navigator = this.shell.widgets.find(widget => widget.id === 'files');
            const node = id && navigator instanceof FileNavigatorWidget ? navigator.model.getNode(id) : undefined;
            void this.ask(FileStatNode.is(node) ? node.uri : target.closest('#files') ? UriSelection.getUri(this.selection.selection) : undefined,
                this.model.terminals.all.find(terminal => terminal.node.contains(target)));
        }, 560);
        this.hold = { x: event.clientX, y: event.clientY, target, timer, reveal, ring };
    };
    private readonly cancelHold = () => {
        if (this.hold) { clearTimeout(this.hold.timer); clearTimeout(this.hold.reveal); this.hold.ring.remove(); this.hold = undefined; }
        document.body.classList.remove('fabi-assist-cursor');
    };
    private readonly consumeHold = (event: MouseEvent) => {
        if (this.held) { event.preventDefault(); event.stopPropagation(); this.held = false; }
    };
    private readonly gesture = (event: PointerEvent) => {
        this.cancelHold();
        if (this.held) { return; }
        if (event.target instanceof Element && event.target.closest('.monaco-editor')) {
            requestAnimationFrame(() => this.showSelectionCue());
        }
        const terminal = this.model.terminals.all.find(item => event.target instanceof Node && item.node.contains(event.target));
        if (terminal && !this.bubble && !this.surface) {
            requestAnimationFrame(() => {
                if (terminal.getSelection().trim()) { this.createCue(event.clientX, event.clientY, () => void this.ask(undefined, terminal)); }
                else { this.clearCue(); }
            });
        }
        if (!event.altKey || !(event.metaKey || event.ctrlKey) || event.button !== 0) { return; }
        const target = event.target instanceof Element ? event.target : undefined;
        if (target?.closest('.monaco-editor, #files')) {
            // Let Monaco/Theia finish setting the selection before capturing it.
            setTimeout(() => void this.ask(target.closest('.monaco-editor') ? undefined : UriSelection.getUri(this.selection.selection)), 0);
        }
    };
    private readonly outside = (event: PointerEvent) => {
        if (this.bubble?.querySelector('.fabi-assist-orbital') && event.target instanceof Node && !this.bubble.contains(event.target)) { this.hide(false); }
    };
    private readonly keyboard = (event: KeyboardEvent) => {
        if (event.key === 'Alt' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.shiftKey && this.cue &&
            !(event.target instanceof Element && event.target.closest('input, textarea:not(.inputarea):not(.xterm-helper-textarea), [contenteditable=true]'))) {
            this.optionPressed = performance.now(); event.preventDefault();
        } else { this.optionPressed = 0; }
        if (event.key === 'Escape') { this.cancelHold(); }
        if (event.key === 'Escape') { this.clearCue(); }
        if (this.bubble && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.hide(); }
    };
    private readonly optionUp = (event: KeyboardEvent) => {
        if (event.key === 'Alt' && this.optionPressed && performance.now() - this.optionPressed < 600 && this.cue) {
            event.preventDefault(); this.cue.click();
        }
        this.optionPressed = 0;
    };
    private readonly clearCue = () => { this.cue?.remove(); this.cue = undefined; };
    private showSelectionCue(): void {
        if (this.bubble || this.surface) { this.clearCue(); return; }
        const widget = this.model.editors.currentEditor;
        const editor = widget?.editor;
        if (!editor || !editor.document.getText(editor.selection).trim()) { this.clearCue(); return; }
        const selected = Array.from(widget!.node.querySelectorAll('.selected-text')).map(node => node.getBoundingClientRect())
            .filter(rect => rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight);
        const rect = selected[selected.length - 1] ?? widget!.node.querySelector('.cursor')?.getBoundingClientRect();
        if (!rect || !rect.width || rect.bottom < 0 || rect.top > innerHeight) { this.clearCue(); return; }
        this.createCue(rect.right, rect.bottom, () => void this.ask(editor.uri));
    }
    private createCue(x: number, y: number, open: () => void): void {
        this.clearCue();
        const cue = document.createElement('button'); this.cue = cue;
        cue.className = 'fabi-assist-selection-cue'; cue.type = 'button';
        cue.innerHTML = '<i class="fabi-assist-fox"></i><span>⌥</span>';
        cue.title = 'Comprendre cette sélection · clic ou ⌥ Option';
        cue.setAttribute('aria-label', 'Fabi Assist : comprendre la sélection');
        const point = { x: Math.max(24, Math.min(x + 28, innerWidth - 32)), y: Math.max(24, Math.min(y + 18, innerHeight - 32)) };
        Object.assign(cue.style, { left: `${point.x}px`, top: `${point.y}px` });
        cue.addEventListener('pointerdown', event => event.preventDefault());
        cue.addEventListener('click', () => { this.pointer = point; open(); });
        document.body.append(cue);
    }
    private readonly resize = () => { if (this.bubble) { this.place(); } };
    private place(): void {
        if (!this.bubble) { return; }
        const orbital = !this.bubble.firstElementChild || !!this.bubble.querySelector('[data-phase=orbit]');
        this.bubble.dataset.orbital = String(orbital);
        const bounds = orbital ? assistOrbitPlacement(this.anchor.x, this.anchor.y, innerWidth, innerHeight)
            : assistPlacement(this.anchor.x - 42, this.anchor.y - 50, innerWidth, innerHeight, this.bubble.querySelector('.fabi-petal-thread') ? 520 : this.bubble.firstElementChild?.scrollHeight || 180, this.bubble.classList.contains('fabi-assist-expanded') ? 620 : 380);
        Object.assign(this.bubble.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, maxHeight: `${bounds.maxHeight}px` });
    }
    private attachTerminal(terminal: TerminalWidget): void {
        if (this.launchers.has(terminal.id)) { return; }
        const button = document.createElement('div');
        button.className = 'fabi-terminal-assist';
        button.innerHTML = '<button type="button" class="fabi-presence-trigger" aria-label="Ouvrir Fabi Assist"><i class="fabi-assist-fox" aria-hidden="true"></i><span>Fabi</span><i class="codicon codicon-chevron-down" aria-hidden="true"></i></button><div class="fabi-presence-hint"><header class="fabi-presence-heading"><span class="fabi-presence-avatar"><i class="fabi-assist-fox" aria-hidden="true"></i></span><span><span class="fabi-presence-name">Avec Fabi</span><span class="fabi-presence-eyebrow">Une pause pour comprendre</span></span><i class="codicon codicon-book" aria-hidden="true"></i></header><strong>Comprendre ce projet</strong><span class="fabi-presence-description">Une question, un mécanisme, une idée. Explorons ton projet ensemble.</span><span class="fabi-discovery-status"></span><div class="fabi-presence-actions"><button type="button" data-action="learn">Explorer ensemble <i class="codicon codicon-arrow-right" aria-hidden="true"></i></button><button type="button" data-action="later">Plus tard</button></div></div>';
        const acknowledge = (outcome: 'accepted' | 'dismissed') => {
            let saving: Promise<unknown> = Promise.resolve();
            if (button.dataset.project && button.dataset.opportunity) saving = this.model.service.updateLearning(button.dataset.project, { kind: 'invitation', id: button.dataset.opportunity, outcome }).then(book => {
                this.notebooks.set(new URI(button.dataset.project!).withScheme('file').toString(), book);
                if (this.model.root?.path.fsPath() === button.dataset.project) { this.model.book = book; this.model.changed.fire(); }
            }).catch(() => {});
            if (button.dataset.invited) { this.invitationsSeen.add(button.dataset.invited); if (this.invitationsSeen.size > 128) this.invitationsSeen.delete(this.invitationsSeen.values().next().value!); }
            this.invitationCooldown = Date.now() + 5 * 60000;
            delete button.dataset.invited;
            return saving;
        };
        button.addEventListener('click', event => {
            event.stopPropagation();
            const target = (event.target as HTMLElement).closest('button');
            if (!target) return;
            const question = button.dataset.question;
            const saving = acknowledge(target.dataset.action === 'later' ? 'dismissed' : 'accepted');
            if (target.dataset.action === 'later') { button.dataset.dismissed = 'true'; terminal.activate(); return; }
            delete button.dataset.dismissed;
            if (!terminal.isDisposed) void this.open(false, terminal, target.dataset.action === 'learn' ? question : undefined, saving);
        });
        button.addEventListener('pointerleave', () => delete button.dataset.dismissed);
        terminal.node.classList.add('fabi-assist-host'); terminal.node.append(button);
        this.launchers.set(terminal.id, button);
        terminal.onDidDispose(() => {
            this.launchers.delete(terminal.id);
            if (this.surface?.widget === terminal) { this.closeSurface(); }
        });
    }
    private closeSurface(): void {
        const surface = this.surface;
        if (!surface) { return; }
        this.surface = undefined;
        surface.root.unmount(); surface.host.remove(); surface.widget.node.classList.remove('fabi-assist-open');
        surface.widget.node.querySelectorAll<HTMLElement>('.xterm').forEach(node => { node.inert = false; });
        surface.widget.activate();
    }
    async open(preserve = false, target?: Widget, question?: string, feedback?: Promise<unknown>): Promise<void> {
        this.hide(false);
        const widget = target ?? (this.shell.currentWidget instanceof TerminalWidget ? this.shell.currentWidget : this.model.terminals.currentTerminal ?? this.model.terminals.lastUsedTerminal ?? this.shell.currentWidget);
        if (!widget) { return; }
        if (this.surface?.widget === widget) { return; }
        this.closeSurface();
        // Navigation must not wait for disk/RPC/provider checks. Preparation updates the mounted view.
        const prepare = () => this.model.prepare(undefined, widget instanceof TerminalWidget ? widget : undefined, 'terminal');
        const preparing = !preserve ? (feedback ? feedback.then(prepare) : prepare()).catch(error => this.model.fail(error)) : Promise.resolve();
        const agent = this.model.rows.find(row => row.widgetId === widget.id);
        if (agent) { this.model.follow(agent.key); }
        const host = document.createElement('div'); host.className = 'fabi-assist-surface';
        host.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); this.closeSurface(); } });
        widget.node.classList.add('fabi-assist-host', 'fabi-assist-open');
        widget.node.querySelectorAll<HTMLElement>('.xterm').forEach(node => { node.inert = true; });
        widget.node.append(host);
        const root = createRoot(host); this.surface = { host, root, widget };
        root.render(<AssistView model={this.model} markdown={this.markdown} close={() => this.closeSurface()} peek={active => host.classList.toggle('fabi-assist-peeking', active)} />);
        widget.disposed.connect(() => { if (this.surface?.widget === widget) { this.closeSurface(); } });
        await this.shell.activateWidget(widget.id);
        requestAnimationFrame(() => { if (this.surface?.host === host) host.querySelector<HTMLElement>('textarea')?.focus(); });
        if (question) { await preparing; if (this.surface?.host === host) await this.model.ask(question, 'explore'); }
    }
    async ask(uri?: URI, terminal?: TerminalWidget): Promise<void> {
        const resume = !!this.contextModel.busy;
        this.clearCue();
        this.hide(false);
        const generation = ++this.generation;
        this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        const preparing = resume ? Promise.resolve() : this.contextModel.prepare(uri, terminal);
        if (generation !== this.generation || !this.contextModel.root) { return; }
        this.contextModel.mode = 'explore';
        const bubble = document.createElement('div');
        bubble.className = 'fabi-assist-popover';
        bubble.setAttribute('role', 'dialog');
        bubble.setAttribute('aria-label', 'Comprendre avec Fabi Assist');
        this.bubble = bubble;
        this.anchor = { ...this.pointer };
        this.place();
        document.body.append(bubble);
        this.bubbleRoot = createRoot(bubble);
        void preparing.catch(error => this.contextModel.fail(error));
        this.bubbleRoot.render(<AssistLens model={this.contextModel} markdown={this.markdown} onLayout={() => this.place()} expand={() => { bubble.classList.toggle('fabi-assist-expanded'); this.place(); }} close={() => this.hide()} />);
        this.observer = new ResizeObserver(() => this.place());
        requestAnimationFrame(() => {
            if (this.bubble !== bubble) { return; }
            if (bubble.firstElementChild) { this.observer?.observe(bubble.firstElementChild); }
            (bubble.querySelector<HTMLElement>('.fabi-orbit-explain') ?? bubble.querySelector<HTMLElement>('textarea, button'))?.focus();
        });
    }
    private hide(restore = true): void {
        this.generation++;
        if (!this.bubble) { return; }
        this.observer?.disconnect(); this.observer = undefined;
        this.bubbleRoot?.unmount(); this.bubbleRoot = undefined;
        this.bubble.remove(); this.bubble = undefined;
        if (restore && this.previousFocus?.isConnected) { this.previousFocus.focus(); }
    }
}
