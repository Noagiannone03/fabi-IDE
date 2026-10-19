import * as React from '@theia/core/shared/react';
import { MarkdownRenderer } from '@theia/core/lib/browser/markdown-rendering/markdown-renderer';
import { AssistModel } from './assist-model';
import { ReplyContent } from './assist-reply';

/** A selection affordance expands into actions; a reading surface appears only on demand. */
export function AssistLens({ model, markdown, close, expand, onLayout }: {
    model: AssistModel; markdown: MarkdownRenderer; close: () => void; expand: () => void; onLayout?: () => void;
}): React.ReactElement {
    React.useLayoutEffect(() => { onLayout?.(); });
    const [, redraw] = React.useReducer(value => value + 1, 0);
    const [view, setView] = React.useState<'orbit' | 'question' | 'response'>(model.busy ? 'response' : 'orbit');
    const [openedAt] = React.useState(model.replySerial);
    const input = React.useRef<HTMLTextAreaElement>(null);
    React.useEffect(() => { const listener = model.onChange(() => redraw()); return () => listener.dispose(); }, [model]);
    React.useEffect(() => { if (view === 'question') { input.current?.focus(); } }, [view]);
    React.useEffect(() => { if (model.replySerial > openedAt) { setView('response'); } }, [model.replySerial, openedAt]);
    const reply = model.replySerial > openedAt ? model.turns[model.turns.length - 1]?.reply : undefined;
    const file = model.context.terminal?.title ?? model.context.path?.split(/[\\/]/).pop() ?? 'Ta sélection';
    const ask = (question: string) => { setView('response'); void model.ask(question, 'explore', undefined); };
    const orbit = view === 'orbit' && !model.busy;
    return <section className={`fabi-assist fabi-assist-lens ${orbit ? 'fabi-assist-orbital' : 'fabi-assist-petal'}`} data-phase={orbit ? 'orbit' : model.busy ? 'thinking' : view === 'question' ? 'question' : 'answer'}>
        {orbit ? <>
            <svg className='fabi-fan-material' viewBox='0 0 290 190' aria-hidden='true'>
                <path className='fabi-fan-surface' d='M54 89 C77 82 76 13 119 13 H239 C252 13 261 22 261 35 C261 48 252 57 239 57 H121 C95 57 94 72 82 82 C76 87 80 89 87 86 C102 77 113 74 128 74 H249 C262 74 271 83 271 96 C271 109 262 118 249 118 H128 C113 118 102 115 87 106 C80 103 76 105 82 110 C94 120 95 135 121 135 H239 C252 135 261 144 261 157 C261 170 252 179 239 179 H119 C76 179 77 110 54 103 C46 101 46 91 54 89 Z'/>
            </svg>
            <button className='fabi-fan-origin' aria-label='Fermer Fabi Assist' onClick={close}><i className='fabi-assist-fox'/></button>
            <button className='fabi-orbit-action fabi-orbit-explain' onClick={() => ask('Explique simplement ce passage et son rôle dans le projet. Lis le contexte nécessaire.')}><span>Explique-moi</span><small>↗</small></button>
            <button className='fabi-orbit-action fabi-orbit-role' onClick={() => ask('Montre comment cet élément est relié au reste du projet, avec un petit schéma si utile.')}><span>Voir les liens</span><small>↗</small></button>
            <button className='fabi-orbit-action fabi-orbit-question fabi-assist-question-action' onClick={() => setView('question')}><span>Ma question</span><small>↵</small></button>
            <span className='fabi-fan-context' title={file}>{file}</span>
        </> : <>
            <header className='fabi-petal-header'>
                <button className='fabi-petal-core' aria-label='Revenir aux actions' disabled={!!model.busy} onClick={() => setView('orbit')}><i className='fabi-assist-fox' /></button>
                <span>{file}<small>{model.busy ? 'Je regarde avec toi' : 'On regarde ce passage'}</small></span>
                <button className='fabi-petal-close' aria-label='Fermer' onClick={close}>×</button>
            </header>
            {model.busy ? <div className='fabi-petal-thinking' role='status'><span className='fabi-petal-dots'><i /><i /><i /></span><p>{model.progress}</p><button onClick={() => void model.cancel()}>Arrêter</button></div>
            : <>
                {reply && view !== 'question' && <div className='fabi-petal-thread' aria-label='Notre discussion'>{model.turns.map(turn => <article className='fabi-petal-answer' key={turn.id}><p className='fabi-petal-user'>{turn.question}</p>{model.sourceChanged(turn) && <p className='fabi-verification'>Une source a changé. <button disabled={!!model.busy} onClick={() => void model.refreshExplanation(turn)}>Actualiser l’explication</button></p>}<ReplyContent reply={turn.reply} model={model} markdown={markdown} /></article>)}</div>}
                {model.error && <div className='fabi-petal-error' role='alert'>{model.error}{!model.account.connected && <button onClick={() => void model.refreshProvider()}>Vérifier le GPU ↗</button>}</div>}
                {<form className='fabi-petal-compose' onSubmit={event => { event.preventDefault(); if (model.draft.trim()) { ask(model.draft); } }}>
                    <textarea ref={input} rows={2} aria-label='Ta question' placeholder={reply ? 'Qu’aimerais-tu approfondir ?' : 'Qu’est-ce que tu aimerais comprendre ?'} value={model.draft} maxLength={16000}
                        onChange={event => { model.draft = event.target.value; redraw(); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (model.draft.trim()) { ask(model.draft); } } }} />
                    <button aria-label='Envoyer' disabled={!model.draft.trim()}><span className='codicon codicon-arrow-up' /></button>
                    <span>{reply ? 'On continue dans ce même fil.' : 'Le contexte est déjà joint.'}</span>
                </form>}
                {reply && view !== 'question' && <footer className='fabi-petal-footer'><button className='fabi-assist-question-action' onClick={() => input.current?.focus()}>Approfondir</button><button onClick={expand}>Agrandir ↗</button></footer>}
            </>}
        </>}
    </section>;
}
