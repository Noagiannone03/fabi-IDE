import * as React from '@theia/core/shared/react';
import { MarkdownRenderer } from '@theia/core/lib/browser/markdown-rendering/markdown-renderer';
import { readableAssistMarkdown } from '../../common/fabi-assist-markdown';
import { AssistReply, AssistTerm } from '../../common/fabi-assist-protocol';
import { AssistModel } from './assist-model';
import { renderAssistCodeBlock } from './assist-code-block';

const EMPTY_TERMS: AssistTerm[] = [];

/** Render through Theia's sanitizer, then annotate text nodes only. No model HTML runs. */
export function Markdown({ text, renderer, terms = EMPTY_TERMS }: { text: string; renderer: MarkdownRenderer; terms?: AssistTerm[] }): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        const rendered = renderer.render({ value: readableAssistMarkdown(text), isTrusted: false, supportHtml: false }, { codeBlockRenderer: renderAssistCodeBlock });
        const root = rendered.element;
        const dismiss = (except?: Element) => {
            root.querySelectorAll<HTMLElement>('.fabi-term').forEach(wrap => {
                if (wrap === except) { return; }
                wrap.dataset.open = 'false'; wrap.dataset.pinned = 'false'; wrap.dataset.dismissed = 'true';
                wrap.querySelector('button')?.setAttribute('aria-expanded', 'false');
            });
        };
        const outside = (event: PointerEvent) => {
            const term = event.target instanceof Element ? event.target.closest('.fabi-term') : undefined;
            dismiss(term ?? undefined);
        };
        document.addEventListener('pointerdown', outside, true);
        for (const [index, term] of terms.entries()) {
            if (!term.term.trim()) { continue; }
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const nodes: Text[] = [];
            while (walker.nextNode()) { nodes.push(walker.currentNode as Text); }
            for (const node of nodes) {
                if (node.parentElement?.closest('pre, a, button, .fabi-term')) { continue; }
                const value = node.textContent ?? '', at = value.toLocaleLowerCase().indexOf(term.term.toLocaleLowerCase());
                if (at < 0) { continue; }
                const fragment = document.createDocumentFragment();
                fragment.append(document.createTextNode(value.slice(0, at)));
                const wrap = document.createElement('span'); wrap.className = 'fabi-term';
                const button = document.createElement('button'); button.type = 'button'; button.textContent = value.slice(at, at + term.term.length);
                button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-label', `${term.term} : afficher la définition`);
                const definition = document.createElement('span'); definition.className = 'fabi-term-definition'; definition.role = 'tooltip';
                definition.textContent = term.definition + (term.example ? `\n\nExemple : ${term.example}` : '');
                const id = `fabi-term-${index}-${Math.random().toString(36).slice(2)}`; definition.id = id; button.setAttribute('aria-describedby', id);
                const position = () => {
                    dismiss(wrap);
                    wrap.dataset.dismissed = 'false'; wrap.dataset.open = 'true'; button.setAttribute('aria-expanded', 'true');
                    const rect = button.getBoundingClientRect();
                    const edge = ref.current?.getBoundingClientRect();
                    definition.style.left = `${Math.min(0, (edge?.right ?? innerWidth) - rect.left - 280)}px`;
                };
                wrap.addEventListener('mouseenter', position);
                wrap.addEventListener('mouseleave', () => { if (wrap.dataset.pinned !== 'true' && !wrap.contains(document.activeElement)) { dismiss(); } });
                button.addEventListener('focus', position);
                wrap.addEventListener('focusout', event => { if (!wrap.contains(event.relatedTarget as Node) && wrap.dataset.pinned !== 'true') { dismiss(); } });
                button.addEventListener('click', () => { const pin = wrap.dataset.pinned !== 'true'; if (pin) { position(); wrap.dataset.pinned = 'true'; } else { dismiss(); } });
                button.addEventListener('keydown', event => { if (event.key === 'Escape') { dismiss(); event.stopPropagation(); } });
                wrap.append(button, definition); fragment.append(wrap, document.createTextNode(value.slice(at + term.term.length))); node.replaceWith(fragment);
                break; // Explain the first mention, keeping paragraphs readable.
            }
        }
        ref.current?.replaceChildren(root);
        return () => { document.removeEventListener('pointerdown', outside, true); rendered.dispose(); };
    }, [text, renderer, terms]);
    return <div className='fabi-assist-markdown' ref={ref} />;
}

export function ReplyContent({ reply, model, markdown }: { reply: AssistReply; model: AssistModel; markdown: MarkdownRenderer }): React.ReactElement {
    const [selectedStep, setStep] = React.useState(0);
    const step = Math.min(selectedStep, Math.max(0, (reply.diagram?.steps.length ?? 1) - 1));
    React.useEffect(() => setStep(0), [reply]);
    const [quote, setQuote] = React.useState('');
    const [question, setQuestion] = React.useState('');
    const content = React.useRef<HTMLDivElement>(null);
    const capture = () => {
        const selection = window.getSelection();
        if (selection?.rangeCount && content.current?.contains(selection.anchorNode) && content.current?.contains(selection.focusNode)) {
            const value = selection.toString().trim(); if (value) { setQuote(value.slice(0, 4000)); }
        }
    };
    const send = (value: string) => { if (!model.busy) { void model.askAboutReply(reply.title, quote, value); setQuote(''); setQuestion(''); } };
    return <>
        <div ref={content} onMouseUp={capture} onKeyUp={event => { if (event.key.startsWith('Arrow') && event.shiftKey) { capture(); } }}>
            {reply.takeaway && <div className='fabi-reply-takeaway'><span>L’idée à retenir</span><Markdown text={reply.takeaway} renderer={markdown} terms={reply.terms} /></div>}
            {reply.diagram && <figure className='fabi-explanation-path'>
                <figcaption>{reply.diagram.caption}</figcaption>
                <ol aria-label='Parcours de l’explication'>{reply.diagram.steps.map((item, index) => <li key={index} data-active={index === step} data-visited={index < step}>
                    <button type='button' aria-current={index === step ? 'step' : undefined} onClick={() => setStep(index)}><span aria-hidden='true'>{index + 1}</span>{item.title}</button>
                </li>)}</ol>
                <section className='fabi-path-detail' aria-label={`Étape ${step + 1}`} aria-live='polite'>
                    <small>Étape {step + 1} sur {reply.diagram.steps.length}</small>
                    <h4>{reply.diagram.steps[step].title}</h4>
                    <Markdown text={reply.diagram.steps[step].detail} renderer={markdown} terms={reply.terms} />
                    {reply.diagram.steps[step].value && <code>{reply.diagram.steps[step].value}</code>}
                    {reply.diagram.steps[step].source && <button type='button' className='fabi-path-source' onClick={() => { const source = reply.diagram!.steps[step].source!; void model.openSource(source.path, source.line); }}>Voir dans le code ↗</button>}
                </section>
                <div className='fabi-cli-progress-actions'><button type='button' disabled={step === 0} onClick={() => setStep(step - 1)}>← Précédente</button><button type='button' disabled={step >= reply.diagram.steps.length - 1} onClick={() => setStep(step + 1)}>Étape suivante →</button></div>
            </figure>}
            {reply.takeaway && reply.diagram
                ? <details className='fabi-reply-depth' key={reply.explanation}><summary>Pourquoi ça fonctionne</summary><Markdown text={reply.explanation} renderer={markdown} terms={reply.terms} /></details>
                : <Markdown text={reply.explanation} renderer={markdown} terms={reply.terms} />}
        </div>
        {quote && <aside className='fabi-quote-question' aria-label='Question sur ce passage'><header><span>À propos de ce passage</span><button aria-label='Annuler la sélection' onClick={() => setQuote('')}>×</button></header><blockquote>{quote}</blockquote><form onSubmit={event => { event.preventDefault(); send(question || 'Explique plus simplement ce passage avec un exemple concret.'); }}><input aria-label='Question sur le passage' placeholder='Qu’aimerais-tu préciser ?' value={question} onChange={event => setQuestion(event.target.value)}/><button disabled={!!model.busy} aria-label='Envoyer la question sur le passage'>↗</button></form><button disabled={!!model.busy} onClick={() => send('Explique plus simplement ce passage avec un exemple concret.')}>Un exemple concret</button></aside>}

        <div className='fabi-assist-sources'>{reply.sources.map((source, i) => <button key={`${source.path}:${source.line}:${i}`} title={source.path} onClick={() => void model.openSource(source.path, source.line)}>{source.path.split(/[\\/]/).pop()}:{source.line} ↗</button>)}
            {reply.webSources?.map(source => <a key={source.url} href={source.url} target='_blank' rel='noopener noreferrer'>{source.title} ↗</a>)}
        </div>
        {reply.verification && <p className='fabi-verification'>{reply.verification}</p>}
    </>;
}

export function Exercise({ reply, model, markdown }: { reply: AssistReply; model: AssistModel; markdown: MarkdownRenderer }): React.ReactElement | null {
    const exercise = reply.exercise;
    const [hint, setHint] = React.useState(false);
    const [answer, setAnswer] = React.useState(exercise?.starterCode ?? '');
    const [sent, setSent] = React.useState(false);
    React.useEffect(() => { setAnswer(exercise?.starterCode ?? ''); setHint(false); setSent(false); }, [exercise?.id]);
    if (!exercise) { return null; }
    const assessed = model.turns.some(turn => turn.reply.assessment?.exerciseId === exercise.id);
    const send = (value: string) => { if (!value.trim() || model.busy || assessed) { return; } setSent(true); void model.ask(value, 'learn', exercise.id).finally(() => setSent(false)); };
    return <section className='fabi-assist-exercise' aria-label='Petit exercice'>
        <div className='fabi-exercise-heading'><span>À toi de jouer</span><small>{assessed ? 'Réponse reçue' : 'Une minute pour comprendre'}</small></div>
        <Markdown text={exercise.question} renderer={markdown} terms={reply.terms} />
        {exercise.kind === 'quiz' && exercise.choices?.length ? <div className='fabi-quiz-choices'>{exercise.choices.map((choice, i) => <button key={choice} disabled={!!model.busy || assessed} onClick={() => send(choice)}><span>{String.fromCharCode(65 + i)}</span>{choice}</button>)}</div>
        : <form onSubmit={event => { event.preventDefault(); send(answer); }}>
            <textarea aria-label={exercise.kind === 'code' ? 'Code à compléter' : 'Ta réponse à l’exercice'} className={exercise.kind === 'code' ? 'fabi-code-answer' : ''} rows={exercise.kind === 'code' ? 4 : 2} value={answer} disabled={assessed} onChange={event => setAnswer(event.target.value)} placeholder='Avec tes mots…' />
            <button className='fabi-small-action' disabled={!!model.busy || assessed || !answer.trim()}>{sent ? 'Vérification…' : 'Vérifier ma réponse'} <span>↗</span></button>
        </form>}
        {!assessed && <button className='fabi-hint-toggle' onClick={() => setHint(!hint)}>{hint ? 'Masquer l’indice' : 'Un petit indice'}</button>}
        {hint && <p className='fabi-hint'>{exercise.hint}</p>}
    </section>;
}
