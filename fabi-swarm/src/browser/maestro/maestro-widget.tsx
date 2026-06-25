import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { UnsafeWidgetUtilities } from '@theia/core/lib/browser/widgets/widget';
import { DisposableCollection } from '@theia/core';
import { Widget } from '@theia/core/shared/@lumino/widgets';
import { MessageLoop } from '@theia/core/shared/@lumino/messaging';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { FabiMaestroFrontend } from './fabi-maestro-frontend';
import { MaestroMascot } from './maestro-mascot';
import { MaestroAgent, MaestroMessage, MaestroSnapshot } from '../../common/fabi-maestro-protocol';

const GLYPHS: Record<string, string[]> = {
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.']
};

/**
 * Maestro — UN SEUL widget plein écran (aucun chrome Theia autour). À gauche : la
 * liste live des agents (mascottes animées). À droite, la SCÈNE qui montre la
 * surface réelle de l'agent sélectionné :
 *   - Claude/Codex → le VRAI terminal, rattaché au même PTY et embarqué ici via
 *     UnsafeWidgetUtilities.attach (pas un iframe, pas un re-render) ;
 *   - Fabi AI → la conversation (session OpenCode partagée) avec composer.
 * On maîtrise 100% de la mise en page et des fonds.
 */
@injectable()
export class MaestroWidget extends ReactWidget {

    static readonly ID = 'fabi-maestro-widget';
    static readonly LABEL = 'Maestro';

    @inject(FabiMaestroFrontend) protected readonly maestro: FabiMaestroFrontend;
    @inject(TerminalService) protected readonly terminals: TerminalService;

    protected snapshot: MaestroSnapshot = { engine: 'starting', agents: [] };
    protected selectedKey: string | undefined;
    protected messages: MaestroMessage[] | undefined;
    protected loadingMessages = false;
    protected sending = false;

    /** Terminal embarqué courant (rattaché à un PTY existant). */
    protected terminal: TerminalWidget | undefined;
    protected terminalKey: string | undefined;
    protected resizeObserver: ResizeObserver | undefined;

    protected readonly toDispose = new DisposableCollection();
    protected detailRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    protected composerRef = React.createRef<HTMLTextAreaElement>();
    protected termHostRef = React.createRef<HTMLDivElement>();

    @postConstruct()
    protected init(): void {
        this.id = MaestroWidget.ID;
        this.title.label = MaestroWidget.LABEL;
        this.title.caption = MaestroWidget.LABEL;
        this.title.iconClass = 'codicon codicon-pulse';
        this.title.closable = false;
        this.addClass('fabi-maestro');

        this.snapshot = this.maestro.last;
        this.toDispose.push(this.maestro.onSnapshotEvent(s => this.onSnapshot(s)));
        this.maestro.service.start().then(s => this.onSnapshot(s)).catch(() => undefined);
        this.update();
    }

    override dispose(): void {
        this.toDispose.dispose();
        this.resizeObserver?.disconnect();
        this.detachTerminal();
        if (this.detailRefreshTimer) {
            clearTimeout(this.detailRefreshTimer);
        }
        super.dispose();
    }

    protected override onResize(msg: Widget.ResizeMessage): void {
        super.onResize(msg);
        this.resizeTerminal();
    }

    protected onSnapshot(snapshot: MaestroSnapshot): void {
        this.snapshot = snapshot;
        if (this.selectedKey && !snapshot.agents.some(a => a.key === this.selectedKey)) {
            this.selectedKey = undefined;
            this.messages = undefined;
        }
        if (!this.selectedKey && snapshot.agents.length > 0) {
            void this.select(snapshot.agents[0]);
            return;
        }
        const agent = this.selectedAgent();
        if (agent && agent.source === 'fabi' && (agent.status === 'generating' || agent.status === 'waiting')) {
            this.scheduleDetailRefresh();
        }
        this.update();
    }

    protected selectedAgent(): MaestroAgent | undefined {
        return this.snapshot.agents.find(a => a.key === this.selectedKey);
    }

    // ----------------------------------------------------------- sélection

    protected async select(agent: MaestroAgent): Promise<void> {
        this.selectedKey = agent.key;
        const isTerminal = agent.surface?.kind === 'terminal' && typeof agent.surface.terminalId === 'number';
        if (isTerminal) {
            this.messages = undefined;
            this.update();
            await this.ensureTerminal(agent);
        } else {
            // Fabi AI : on cache le terminal et on charge la conversation.
            this.messages = undefined;
            if (this.composerRef.current) {
                this.composerRef.current.value = '';
            }
            this.update();
            if (agent.source === 'fabi') {
                void this.loadMessages(agent.key);
            }
        }
    }

    // ----------------------------------------------------------- terminal

    protected async ensureTerminal(agent: MaestroAgent): Promise<void> {
        const terminalId = agent.surface?.terminalId;
        if (typeof terminalId !== 'number') {
            return;
        }
        if (this.terminalKey === agent.key && this.terminal) {
            this.resizeTerminal();
            return;
        }
        this.detachTerminal();
        try {
            const term = await this.terminals.newTerminal({
                title: agent.title,
                destroyTermOnClose: false,
                useServerTitle: false
            });
            await term.start(terminalId);
            const host = this.termHostRef.current;
            if (!host) {
                term.dispose();
                return;
            }
            this.terminal = term;
            this.terminalKey = agent.key;
            UnsafeWidgetUtilities.attach(term, host);
            this.ensureResizeObserver(host);
            this.update();
            window.requestAnimationFrame(() => {
                this.resizeTerminal();
                term.activate();
            });
        } catch {
            /* terminal indisponible : la liste reste utilisable */
        }
    }

    protected detachTerminal(): void {
        if (this.terminal) {
            try {
                if (this.terminal.isAttached) {
                    UnsafeWidgetUtilities.detach(this.terminal);
                }
                this.terminal.dispose(); // destroyTermOnClose:false → ne tue PAS le PTY
            } catch {
                /* déjà détaché */
            }
            this.terminal = undefined;
            this.terminalKey = undefined;
        }
    }

    protected ensureResizeObserver(host: HTMLElement): void {
        if (this.resizeObserver) {
            return;
        }
        this.resizeObserver = new ResizeObserver(() => this.resizeTerminal());
        this.resizeObserver.observe(host);
    }

    protected resizeTerminal(): void {
        if (this.terminal && this.terminal.isAttached) {
            MessageLoop.sendMessage(this.terminal, Widget.ResizeMessage.UnknownSize);
        }
    }

    // ----------------------------------------------------------- conversation Fabi

    protected async loadMessages(key: string): Promise<void> {
        this.loadingMessages = true;
        this.update();
        try {
            const messages = await this.maestro.service.getConversation(key);
            if (this.selectedKey === key) {
                this.messages = messages;
            }
        } catch {
            if (this.selectedKey === key) {
                this.messages = [];
            }
        } finally {
            this.loadingMessages = false;
            this.update();
            this.scrollToBottom();
        }
    }

    protected scheduleDetailRefresh(): void {
        if (this.detailRefreshTimer) {
            return;
        }
        this.detailRefreshTimer = setTimeout(() => {
            this.detailRefreshTimer = undefined;
            const agent = this.selectedAgent();
            if (agent && agent.source === 'fabi' && !this.loadingMessages) {
                void this.loadMessages(agent.key);
            }
        }, 1600);
    }

    protected scrollToBottom(): void {
        window.requestAnimationFrame(() => {
            const el = this.node.querySelector('.fabi-maestro-thread');
            if (el) {
                el.scrollTop = el.scrollHeight;
            }
        });
    }

    protected async sendReply(): Promise<void> {
        const agent = this.selectedAgent();
        const input = this.composerRef.current;
        if (!agent || !input || this.sending || !agent.key.startsWith('fabi:')) {
            return;
        }
        const text = input.value.trim();
        if (!text) {
            return;
        }
        input.value = '';
        this.sending = true;
        this.update();
        try {
            await this.maestro.service.send(agent.key, text);
            await this.loadMessages(agent.key);
        } finally {
            this.sending = false;
            this.update();
        }
    }

    protected onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void this.sendReply();
        }
    }

    protected async abort(agent: MaestroAgent): Promise<void> {
        await this.maestro.service.abort(agent.key).catch(() => undefined);
    }

    // ----------------------------------------------------------- rendu

    protected render(): React.ReactNode {
        const agent = this.selectedAgent();
        const isTerminal = !!agent && agent.surface?.kind === 'terminal' && typeof agent.surface.terminalId === 'number';
        const isFabi = !!agent && agent.source === 'fabi';
        return (
            <div className="fabi-maestro-shell">
                <aside className="fabi-maestro-side">
                    <div className="fabi-maestro-id">{this.renderWordmark()}</div>
                    <div className="fabi-maestro-list">{this.renderList()}</div>
                </aside>
                <div className="fabi-maestro-stage">
                    {!agent && (
                        <div className="fabi-maestro-stage-empty">
                            <p>Sélectionnez un agent à gauche.</p>
                        </div>
                    )}
                    {isFabi && this.renderConversation(agent!)}
                    {/* hôte du terminal embarqué : TOUJOURS dans le DOM (ref stable),
                        Lumino y attache le terminal ; visible seulement pour Claude/Codex. */}
                    <div
                        className="fabi-maestro-term-host"
                        ref={this.termHostRef}
                        style={{ display: isTerminal ? 'block' : 'none' }}
                    />
                </div>
            </div>
        );
    }

    protected renderWordmark(): React.ReactNode {
        const word = 'MAESTRO';
        const letterW = 5, gap = 1;
        const rects: React.ReactNode[] = [];
        let ox = 0;
        for (const ch of word) {
            const glyph = GLYPHS[ch];
            if (glyph) {
                for (let y = 0; y < glyph.length; y++) {
                    for (let x = 0; x < letterW; x++) {
                        if (glyph[y][x] === '#') {
                            rects.push(<rect key={`${ox}-${x}-${y}`} x={ox + x} y={y} width="1.04" height="1.04" />);
                        }
                    }
                }
            }
            ox += letterW + gap;
        }
        return (
            <svg className="fabi-maestro-wordmark" viewBox={`0 0 ${ox - gap} 7`} shapeRendering="crispEdges" role="img" aria-label="Maestro">
                {rects}
            </svg>
        );
    }

    protected renderList(): React.ReactNode {
        const agents = this.snapshot.agents;
        if (agents.length === 0) {
            return (
                <div className="fabi-maestro-empty">
                    <span>Aucun agent ouvert.</span>
                    <small>Ouvrez un chat Fabi ou lancez Claude/Codex dans un terminal.</small>
                </div>
            );
        }
        const groups = new Map<string, MaestroAgent[]>();
        for (const agent of agents) {
            const name = agent.workspaceName || 'Sans workspace';
            const list = groups.get(name) || [];
            list.push(agent);
            groups.set(name, list);
        }
        return [...groups.entries()].map(([name, list]) => (
            <section className="fabi-maestro-group" key={name}>
                <header className="fabi-maestro-group-head"><span>{name}</span><span>{list.length}</span></header>
                {list.map(agent => this.renderRow(agent))}
            </section>
        ));
    }

    protected renderRow(agent: MaestroAgent): React.ReactNode {
        const selected = agent.key === this.selectedKey;
        return (
            <button
                key={agent.key}
                className={`fabi-maestro-row ${selected ? 'selected' : ''}`}
                onClick={() => void this.select(agent)}
            >
                <span className="fabi-maestro-mascot" title={this.agentStatusLabel(agent)}>
                    <MaestroMascot agent={agent} size={30} />
                </span>
                <span className="fabi-maestro-row-body">
                    <span className="fabi-maestro-row-top">
                        <span className={`fabi-maestro-src ${agent.source}`}>{this.sourceMonogram(agent)}</span>
                        <span className="fabi-maestro-row-title">{agent.title}</span>
                        <time>{this.relTime(agent.updatedAt)}</time>
                    </span>
                    <span className="fabi-maestro-row-sub">
                        {agent.status === 'waiting' && agent.pendingPermission
                            ? <span className="perm">⚠ {agent.pendingPermission}</span>
                            : (agent.preview || this.agentStatusLabel(agent))}
                    </span>
                </span>
            </button>
        );
    }

    protected renderConversation(agent: MaestroAgent): React.ReactNode {
        const canReply = agent.key.startsWith('fabi:');
        return (
            <div className="fabi-maestro-conv">
                <header className="fabi-maestro-conv-head">
                    <div className="who">
                        <span className={`fabi-maestro-state ${agent.status}`} />
                        <div>
                            <h2>{agent.title}</h2>
                            <span className="meta">
                                Fabi AI{agent.workspaceName ? ` · ${agent.workspaceName}` : ''}{agent.model ? ` · ${agent.model}` : ''}
                            </span>
                        </div>
                    </div>
                    {agent.status === 'generating' && (
                        <button className="ghost" onClick={() => void this.abort(agent)} title="Arrêter">
                            <span className="codicon codicon-debug-stop" /> Stop
                        </button>
                    )}
                </header>
                {this.renderThread(agent)}
                {canReply && (
                    <div className="fabi-maestro-composer">
                        <textarea ref={this.composerRef} rows={1} placeholder="Répondre à Fabi…" onKeyDown={e => this.onComposerKeyDown(e)} />
                        <button disabled={this.sending} onClick={() => void this.sendReply()} title="Envoyer (Entrée)">
                            <span className={`codicon ${this.sending ? 'codicon-loading codicon-modifier-spin' : 'codicon-send'}`} />
                        </button>
                    </div>
                )}
            </div>
        );
    }

    protected renderThread(agent: MaestroAgent): React.ReactNode {
        if (this.loadingMessages && !this.messages) {
            return <div className="fabi-maestro-thread loading"><span className="codicon codicon-loading codicon-modifier-spin" /></div>;
        }
        const messages = this.messages ?? [];
        if (messages.length === 0) {
            return <div className="fabi-maestro-thread empty"><p>{agent.preview || 'Conversation vide pour le moment.'}</p></div>;
        }
        return (
            <div className="fabi-maestro-thread">
                {messages.map((m, i) => (
                    <div className={`fabi-maestro-msg ${m.role}`} key={m.id || i}>
                        <span className="role">{m.role === 'user' ? 'Vous' : 'Fabi'}</span>
                        <div className="bubble">
                            {m.text && <div className="text">{m.text}</div>}
                            {m.tools && m.tools.length > 0 && (
                                <div className="tools">
                                    {m.tools.map((t, j) => (
                                        <span className={`tool ${t.state || ''}`} key={j} title={t.title || t.name}>
                                            <span className="codicon codicon-tools" /> {t.name}{t.title ? `: ${t.title}` : ''}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    // ----------------------------------------------------------- helpers

    protected sourceMonogram(agent: MaestroAgent): string {
        return agent.source === 'claude' ? 'C' : agent.source === 'codex' ? 'X' : 'F';
    }

    protected agentStatusLabel(agent: MaestroAgent): string {
        switch (agent.status) {
            case 'generating': return 'Génère…';
            case 'waiting': return agent.waitingKind === 'input' ? 'Attend votre réponse' : 'Attend votre validation';
            case 'error': return 'Erreur';
            default: return 'Au repos';
        }
    }

    protected relTime(timestamp: number): string {
        const diff = Math.max(0, Date.now() - timestamp);
        if (diff < 60_000) {
            return 'maintenant';
        }
        const minutes = Math.floor(diff / 60_000);
        if (minutes < 60) {
            return `${minutes} min`;
        }
        const hours = Math.floor(minutes / 60);
        return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} j`;
    }
}
