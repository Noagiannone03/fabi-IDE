import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { DisposableCollection } from '@theia/core';
import { FabiMaestroFrontend } from './fabi-maestro-frontend';
import { MaestroAgent, MaestroMessage } from '../../common/fabi-maestro-protocol';

export const MAESTRO_CONVERSATION_FACTORY_ID = 'fabi-maestro-conversation';

/**
 * Vue native d'UNE conversation Fabi AI, affichée seule dans la zone principale
 * de Maestro (pas d'iframe, pas de chrome autour) — le pendant « Fabi » du vrai
 * terminal rattaché pour Claude/Codex. Lit la session OpenCode partagée (backend)
 * et permet de répondre.
 */
@injectable()
export class MaestroConversationWidget extends ReactWidget {

    static readonly ID = MAESTRO_CONVERSATION_FACTORY_ID;

    @inject(FabiMaestroFrontend) protected readonly maestro: FabiMaestroFrontend;

    protected agent: MaestroAgent | undefined;
    protected messages: MaestroMessage[] | undefined;
    protected loading = false;
    protected sending = false;
    protected readonly toDispose = new DisposableCollection();
    protected refreshTimer: ReturnType<typeof setTimeout> | undefined;
    protected composerRef = React.createRef<HTMLTextAreaElement>();

    @postConstruct()
    protected init(): void {
        this.id = MaestroConversationWidget.ID;
        this.title.closable = true;
        this.addClass('fabi-maestro');
        this.addClass('fabi-maestro-conv-widget');
        this.toDispose.push(this.maestro.onSnapshotEvent(() => this.onTick()));
    }

    setAgent(agent: MaestroAgent): void {
        this.agent = agent;
        this.title.label = agent.title;
        this.title.caption = agent.title;
        this.messages = undefined;
        void this.load();
        this.update();
    }

    protected onTick(): void {
        if (!this.agent) {
            return;
        }
        const fresh = this.maestro.last.agents.find(a => a.key === this.agent!.key);
        if (fresh) {
            this.agent = fresh;
            if (fresh.status === 'generating' || fresh.status === 'waiting') {
                this.scheduleRefresh();
            }
        }
        this.update();
    }

    protected scheduleRefresh(): void {
        if (this.refreshTimer) {
            return;
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            if (!this.loading) {
                void this.load();
            }
        }, 1600);
    }

    protected async load(): Promise<void> {
        const agent = this.agent;
        if (!agent) {
            return;
        }
        this.loading = true;
        this.update();
        try {
            const messages = await this.maestro.service.getConversation(agent.key);
            if (this.agent?.key === agent.key) {
                this.messages = messages;
            }
        } catch {
            if (this.agent?.key === agent.key) {
                this.messages = [];
            }
        } finally {
            this.loading = false;
            this.update();
            this.scrollToBottom();
        }
    }

    protected scrollToBottom(): void {
        window.requestAnimationFrame(() => {
            const el = this.node.querySelector('.fabi-maestro-thread');
            if (el) {
                el.scrollTop = el.scrollHeight;
            }
        });
    }

    protected async send(): Promise<void> {
        const agent = this.agent;
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
            await this.load();
        } finally {
            this.sending = false;
            this.update();
        }
    }

    protected async abort(): Promise<void> {
        if (this.agent) {
            await this.maestro.service.abort(this.agent.key).catch(() => undefined);
        }
    }

    protected onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void this.send();
        }
    }

    override dispose(): void {
        this.toDispose.dispose();
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        super.dispose();
    }

    protected render(): React.ReactNode {
        const agent = this.agent;
        if (!agent) {
            return <div className="fabi-maestro-conv empty"><p>Sélectionnez une conversation.</p></div>;
        }
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
                        <button className="ghost" onClick={() => void this.abort()} title="Arrêter">
                            <span className="codicon codicon-debug-stop" /> Stop
                        </button>
                    )}
                </header>
                {this.renderThread(agent)}
                {canReply && (
                    <div className="fabi-maestro-composer">
                        <textarea ref={this.composerRef} rows={1} placeholder="Répondre à Fabi…" onKeyDown={e => this.onKeyDown(e)} />
                        <button disabled={this.sending} onClick={() => void this.send()} title="Envoyer (Entrée)">
                            <span className={`codicon ${this.sending ? 'codicon-loading codicon-modifier-spin' : 'codicon-send'}`} />
                        </button>
                    </div>
                )}
            </div>
        );
    }

    protected renderThread(agent: MaestroAgent): React.ReactNode {
        if (this.loading && !this.messages) {
            return <div className="fabi-maestro-thread loading"><span className="codicon codicon-loading codicon-modifier-spin" /></div>;
        }
        const messages = this.messages ?? [];
        if (messages.length === 0) {
            return <div className="fabi-maestro-thread empty"><p>{agent.preview || 'Conversation vide pour le moment.'}</p></div>;
        }
        return (
            <div className="fabi-maestro-thread">
                {messages.map((message, index) => (
                    <div className={`fabi-maestro-msg ${message.role}`} key={message.id || index}>
                        <span className="role">{message.role === 'user' ? 'Vous' : 'Fabi'}</span>
                        <div className="bubble">
                            {message.text && <div className="text">{message.text}</div>}
                            {message.tools && message.tools.length > 0 && (
                                <div className="tools">
                                    {message.tools.map((tool, i) => (
                                        <span className={`tool ${tool.state || ''}`} key={i} title={tool.title || tool.name}>
                                            <span className="codicon codicon-tools" /> {tool.name}{tool.title ? `: ${tool.title}` : ''}
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
}
