import { learningOpportunity } from '../../common/fabi-learning-opportunity';
import * as React from '@theia/core/shared/react';
import { MarkdownRenderer } from '@theia/core/lib/browser/markdown-rendering/markdown-renderer';
import { AssistModel } from './assist-model';
import { Markdown, ReplyContent, Exercise } from './assist-reply';
export { Markdown } from './assist-reply';

export function AssistView({ model, markdown, close, peek }: {
    model: AssistModel; markdown: MarkdownRenderer; compact?: boolean; expand?: () => void; close?: () => void; peek?: (active: boolean) => void;
}): React.ReactElement {
    const [, redraw] = React.useReducer(value => value + 1, 0);
    const [dismissed, setDismissed] = React.useState<string>();
    const [eligible, setEligible] = React.useState(false);
    React.useEffect(() => {
        setEligible(false);
        if (model.agent?.state !== 'working') return;
        const timer = setTimeout(() => setEligible(true), 12000);
        return () => clearTimeout(timer);
    }, [model.agent?.key, model.agent?.state]);
    const [destination, setDestination] = React.useState<'fabi' | 'cli'>('fabi');
    const [panel, setPanel] = React.useState<'threads' | 'learning' | 'context' | undefined>();
    const end = React.useRef<HTMLDivElement>(null);
    const input = React.useRef<HTMLTextAreaElement>(null);
    React.useLayoutEffect(() => {
        if (!input.current) return;
        input.current.style.height = 'auto';
        input.current.style.height = `${Math.min(112, input.current.scrollHeight)}px`;
    }, [model.draft, model.proposal]);
    React.useEffect(() => { const listener = model.onChange(() => redraw()); return () => listener.dispose(); }, [model]);
    const turns = model.turns;
    React.useEffect(() => { if (!turns.length && !model.busy) return; end.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'end' }); }, [turns.length, model.busy, model.thread.id]);
    const ask = (question: string) => void model.ask(question, model.thread.kind === 'terminal' ? 'assist' : 'explore', undefined);
    const agent = model.agent;
    const pending = model.pendingMessage?.threadId === model.thread.id ? model.pendingMessage : undefined;
    const knowledge = model.root ? model.knowledge.get(model.root.toString()) : undefined;
    const opportunity = eligible && !model.busy ? learningOpportunity(knowledge, model.book, Date.now(), agent?.observations) : undefined;
    const ide = panel === 'context' ? model.ideContext : undefined;
    const send = () => { if (destination === 'cli') model.prepareDispatch(); else ask(model.draft); };
    const submit = (event: React.FormEvent) => { event.preventDefault(); send(); };
    return <section className='fabi-assist fabi-assist-lesson-view' data-phase={model.busy ? 'thinking' : turns.length ? 'answer' : 'ready'}>
        <header className='fabi-assist-topline'>
            <div className='fabi-companion-identity'><i className='fabi-assist-fox'/><span>Fabi</span></div>
            <div className='fabi-terminal-tether'>
                {peek && <button className='fabi-terminal-peek' aria-label='Maintenir pour voir le terminal' title='Maintenir pour jeter un œil au terminal'
                    onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); peek(true); }}
                    onPointerUp={() => peek(false)} onPointerCancel={() => peek(false)} onLostPointerCapture={() => peek(false)} onBlur={() => peek(false)}
                    onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); peek(true); } }}
                    onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); peek(false); } }}>
                    <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/></svg>
                </button>}
                <button className='fabi-terminal-return' onClick={close} title='Revenir au terminal · Échap'><i data-working={agent?.state === 'working'}/><span>{agent?.kind ?? 'Terminal'}</span><small>{agent ? model.cliStatus : 'Toujours ouvert'}</small><span aria-hidden='true'>↗</span></button>
            </div>
            <button className='fabi-top-icon' title='Discussions' aria-label='Discussions' onClick={() => setPanel(panel === 'threads' ? undefined : 'threads')}><svg viewBox='0 0 24 24'><path d='M4 5h16v12H9l-5 4V5Z'/><path d='M8 9h8m-8 4h5'/></svg></button>
            <button className='fabi-top-icon' title='Nouvelle discussion' aria-label='Nouvelle discussion' disabled={!!model.busy} onClick={() => model.newThread()}><svg viewBox='0 0 24 24'><path d='M12 5v14M5 12h14'/></svg></button>
            <details className='fabi-assist-options' onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); event.stopPropagation(); } }}>
                <summary className='fabi-top-icon' data-offline={!model.account.connected || undefined} aria-label={model.account.connected ? 'Options de Fabi' : 'Options de Fabi — assistant indisponible'} title={model.account.connected ? 'Notions, contexte et options' : 'Assistant indisponible · options de connexion'}><i className='codicon codicon-ellipsis' aria-hidden='true'/></summary>
                <div className='fabi-assist-options-list'>
                    <button onClick={event => { setPanel('learning'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><i className='codicon codicon-book' aria-hidden='true'/>Mes notions <small>{model.book?.concepts.length ?? 0}</small></button>
                    <button onClick={event => { setPanel('context'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><i className='codicon codicon-folder-opened' aria-hidden='true'/>Contexte du projet</button>
                    {!model.account.connected && <div className='fabi-options-connection'><span title={model.account.detail}>Assistant indisponible</span><button onClick={() => void model.refreshProvider()}><i className='codicon codicon-debug-restart' aria-hidden='true'/>Reconnecter</button></div>}
                </div>
            </details>
        </header>
        {panel && <aside className='fabi-assist-drawer'>
            <header><h3>{panel === 'threads' ? 'Tes discussions' : panel === 'context' ? 'Ce que Fabi voit' : 'Tes notions'}</h3><button aria-label='Fermer le panneau' onClick={() => setPanel(undefined)}>×</button></header>
            {panel === 'context' ? <div className='fabi-context-inspector'><p>Un aperçu du projet, actualisé à chaque question.</p>{knowledge && <><h4>Découverte du projet</h4>{knowledge.understanding && <p>{knowledge.understanding.phase === 'exploring' ? 'Exploration des responsabilités' : 'Premiers repères disponibles'}<small>{knowledge.understanding.completed}/{knowledge.understanding.total} modules · {knowledge.understanding.reviewedFiles} lectures de fichiers · {knowledge.understanding.failed} modules à reprendre</small></p>}<p>{knowledge.indexed} / {knowledge.total} fichiers indexés · {knowledge.symbols} symboles<small>{knowledge.partial ? 'Couverture partielle' : 'Inventaire terminé'} · {knowledge.excluded} entrées exclues · {knowledge.total - knowledge.indexed - knowledge.unreadable} binaires ou volumineux · {knowledge.unreadable} illisibles</small></p><p>{knowledge.relations ?? 0} imports locaux reliés · {knowledge.unresolved ?? 0} imports externes ou non résolus.</p><h4>Modules repérés</h4>{knowledge.modules?.slice(0, 12).map(module => <p key={module.path}>{module.path}<small>{module.files} fichiers · {module.symbols} symboles</small>{module.entryPoints.slice(0, 2).map(path => <button key={path} onClick={() => void model.openSource(path)}>{path} ↗</button>)}</p>)}<h4>Dépendances déclarées</h4><p>{knowledge.technologies.slice(0, 16).join(' · ') || 'Aucun manifeste npm identifié'}</p></>}<ProjectMemory model={model}/><h4>Fichiers ouverts</h4>{ide?.openFiles.map(file => <button key={file.path} onClick={() => void model.openSource(file.path)}>{file.path}<small>{file.dirty ? 'Non enregistré' : file.path === ide.activeFile ? 'Actif' : 'Ouvert'}</small></button>)}<h4>Changements · {ide?.changes.length ?? 0}</h4>{ide?.changes.slice(0, 12).map((file, i) => <p key={i}>{file.path}<small>{file.status}</small></p>)}<h4>Activité récente</h4>{ide?.events.slice(-12).reverse().map((event, i) => <p key={i}>{event.detail}<small>{({ opened: 'Consulté', closed: 'Fermé', created: 'Créé', modified: 'Modifié', deleted: 'Supprimé', agent: 'Agent', 'edited-in-editor': 'En cours d’édition' } as Record<string, string>)[event.kind] ?? 'Activité'} · {new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></p>)}<p>Historique observé dans Fabi. L’auteur d’une modification n’est pas déduit.</p></div> : panel === 'threads' ? <>
                {model.threads.map(thread => <button key={thread.id} className='fabi-thread-row' aria-current={thread.id === model.thread.id ? 'true' : undefined} disabled={!!model.busy} onClick={() => { model.selectThread(thread); setPanel(undefined); }}><small>{thread.kind === 'terminal' ? 'Avec le CLI' : 'Dans le code'}</small><span>{thread.title}</span></button>)}
                {!model.threads.length && <p>Chaque question contextuelle et chaque session CLI a son propre fil.</p>}
            </> : <LearningMemory model={model}/>}
        </aside>}
        <div className='fabi-assist-reading-space'>
            {opportunity && opportunity.id !== dismissed && <section className='fabi-cli-progress'><small>Changement observé dans le projet</small><p>{opportunity.title}</p><div className='fabi-cli-progress-actions'><button onClick={() => { setDismissed(opportunity.id); void model.ask(opportunity.question, 'learn'); }}>Explorer ce mécanisme →</button><button onClick={() => setDismissed(opportunity.id)}>Plus tard</button></div></section>}
            {(agent?.state === 'permission' || model.completed) && <div className='fabi-session-notice' role='status'><span>{agent?.state === 'permission' ? 'Ton agent attend une réponse.' : 'Le tour de ton agent est terminé.'}</span>{model.completed && agent?.state !== 'permission' && <button disabled={!!model.busy} onClick={() => model.reviewCompletedRun()}>Comprendre le résultat</button>}<button onClick={close}>Revenir au résultat ↗</button></div>}
            {!turns.length && !model.busy && !model.proposal && <div className='fabi-assist-invitation'>
                <i className='fabi-assist-welcome-mark fabi-assist-fox' aria-hidden='true'/><span className='fabi-assist-eyebrow'>{model.root?.path.base ?? 'Ton projet'} · avec Fabi</span><h2>Garde le fil.</h2><p>{agent?.state === 'working' ? `${agent.kind} avance. Prenons un moment pour comprendre ce qui se construit.` : knowledge?.understanding?.introduction ?? 'Un morceau de code, une décision, un chemin à suivre. On regarde ensemble.'}</p>
            </div>}
            {turns.map(turn => <article className='fabi-conversation-turn' key={turn.id}>
                {turn.origin === 'cli-review' || (!turn.origin && turn.mode === 'review') ? <div className='fabi-turn-event'><span>Retour du CLI</span></div> : turn.origin === 'rewrite' ? <div className='fabi-turn-event'><span>Reformulation du message</span></div> : <UserMessage text={turn.question}/>} 
                <div className='fabi-assist-response'>{model.sourceChanged(turn) && <p className='fabi-verification'>Une source a changé depuis cette explication. <button disabled={!!model.busy} onClick={() => void model.refreshExplanation(turn)}>Actualiser</button></p>}<span className='fabi-answer-author'><i className='fabi-assist-fox'/>Fabi <small>{turn.mode === 'review' ? 'Le point sur ta demande' : turn.mode === 'learn' ? 'Pour comprendre' : ''}</small></span><h2>{turn.reply.title}</h2><ReplyContent reply={turn.reply} model={model} markdown={markdown}/>
                    {turn.reply.assessment && <div className='fabi-assist-feedback' data-result={turn.reply.assessment.result}><strong>{turn.reply.assessment.result === 'understood' ? 'Tu as compris l’idée.' : 'On précise ensemble.'}</strong><Markdown text={turn.reply.assessment.feedback} renderer={markdown}/></div>}
                    <Exercise reply={turn.reply} model={model} markdown={markdown}/>
                    {turn.reply.developerPrompt && <details className='fabi-assist-proposal'><summary>Préparer la suite avec le CLI</summary><Markdown text={turn.reply.developerPrompt} renderer={markdown}/><button disabled={!!model.busy || model.dispatching} onClick={() => model.prepareDispatch(turn.reply.developerPrompt!, turn.reply.intent === 'develop')}>Préparer l’envoi →</button></details>}
                </div>
            </article>)}
            {pending && <div className='fabi-conversation-turn fabi-pending-turn'>
                {pending.origin === 'user' ? <UserMessage text={pending.question}/> : <div className='fabi-turn-event'><span>{pending.origin === 'cli-review' ? 'Fabi prépare le retour du CLI' : 'Reformulation du message'}</span></div>}
                {pending.failed && <button className='fabi-retry-message' disabled={!!model.busy} onClick={() => void model.ask(pending.question, pending.mode, pending.answerTo, pending.origin)}>Réessayer cette demande ↗</button>}
            </div>}
            {model.busy && <AssistActivity model={model}/>}
            {model.error && <p className='fabi-assist-error' role='alert'>{model.error}</p>}

            <div ref={end}/>
        </div>
        <footer className='fabi-assist-compose-dock'>
            {model.proposal && <section className='fabi-dispatch-review' aria-label='Confirmer l’envoi au CLI'>
                <header><strong>Envoyer à {model.proposal.source}</strong><button disabled={model.dispatching} aria-label='Annuler l’envoi' onClick={() => { model.proposal = undefined; redraw(); }}>×</button></header>
                <textarea aria-label='Prompt à envoyer au CLI' value={model.proposal.text} maxLength={16000} disabled={model.dispatching} onChange={event => { if (model.proposal) model.proposal.text = event.target.value; redraw(); }}/>
                <div><button disabled={!!model.busy || model.dispatching} onClick={() => void model.ask(model.proposal!.text, 'brief', undefined, 'rewrite')}>Reformuler avec Fabi</button><button className='fabi-dispatch-confirm' disabled={!!model.busy || model.dispatching || !model.proposal.text.trim()} onClick={() => void model.dispatch()}>{model.dispatching ? 'Vérification…' : 'Confirmer et envoyer →'}</button></div>
                <small>Envoi dans cette session. Vérifie que le champ du CLI est vide.</small>
            </section>}
            {!model.proposal && <form className='fabi-assist-composer' onSubmit={submit}>
            <textarea ref={input} aria-label='Ta question' rows={1} placeholder={destination === 'cli' ? `Une demande pour ${agent?.kind ?? 'le CLI'}…` : 'Que veux-tu comprendre dans ton projet ?'} value={model.draft} maxLength={16000} onChange={event => { model.draft = event.target.value; redraw(); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }}/>
            <div className='fabi-composer-toolbar'>
                <div className='fabi-composer-destination' role='group' aria-label='Destinataire'>
                    <button type='button' aria-pressed={destination === 'fabi'} onClick={() => setDestination('fabi')} title='Discuter avec Fabi'><i className='fabi-assist-fox'/>Fabi</button>
                    <button type='button' aria-pressed={destination === 'cli'} disabled={!agent?.widgetId} onClick={() => setDestination('cli')} title='Préparer un message pour cette session'><svg viewBox='0 0 24 24' aria-hidden='true'><path d='m5 7 5 5-5 5m8 0h6'/></svg>{agent?.kind ?? 'CLI'}</button>
                </div>
                <span className='fabi-composer-keyhint'>{destination === 'cli' ? 'Aperçu avant envoi' : '⇧ ↵ nouvelle ligne'}</span>
                <button className='fabi-composer-send' type='submit' aria-label={destination === 'cli' ? 'Préparer le message au CLI' : 'Envoyer à Fabi'} disabled={!!model.busy || model.dispatching || !model.draft.trim() || (destination === 'cli' && !agent?.widgetId)}><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M12 19V5m-6 6 6-6 6 6'/></svg></button>
            </div>
        </form>}</footer>
    </section>;
}

function UserMessage({ text }: { text: string }): React.ReactElement {
    return <div className='fabi-user-message'><span>Vous</span><p className='fabi-user-question'>{text}</p></div>;
}

function AssistActivity({ model }: { model: AssistModel }): React.ReactElement {
    const [seconds, setSeconds] = React.useState(0);
    React.useEffect(() => {
        const start = Date.now(); setSeconds(0);
        const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
        return () => clearInterval(timer);
    }, [model.busy]);
    const phase = model.progressDetail?.phase ?? 'thinking';
    const paths = {
        connecting: 'M8 12h8M9 8H7a4 4 0 0 0 0 8h2m6-8h2a4 4 0 0 1 0 8h-2',
        thinking: 'M8 16h8M9 20h6M8 13a6 6 0 1 1 8 0v3H8z',
        tool: 'M14 3H5v18h14V8zm0 0v5h5M8 12h8m-8 4h5',
        writing: 'm5 16-1 4 4-1L20 7l-3-3zm9-9 3 3'
    };
    return <div className='fabi-activity' data-phase={phase}>
        <div className='fabi-activity-emblem' aria-hidden='true'><i className='fabi-assist-fox'/><svg viewBox='0 0 48 48'><circle cx='24' cy='24' r='22'/></svg></div>
        <div className='fabi-activity-copy'><strong>Fabi <span>{seconds}s</span></strong>
            <div className='fabi-activity-stage' key={phase + model.progress} role='status' aria-live='polite'><svg viewBox='0 0 24 24' aria-hidden='true'><path d={paths[phase]}/></svg><span>{model.progress}</span></div>
        </div>
        <button className='fabi-activity-stop' onClick={() => void model.cancel()} aria-label='Arrêter la réponse de Fabi' title='Arrêter la réponse'><svg viewBox='0 0 24 24' aria-hidden='true'><rect x='7' y='7' width='10' height='10' rx='2'/></svg></button>
    </div>;
}

function LearningMemory({ model }: { model: AssistModel }): React.ReactElement {
    const [goal, setGoal] = React.useState('');
    const preferences = model.book?.preferences ?? { depth: 'guided' as const, minutes: 5 as const, invitations: true };
    return <div className='fabi-context-inspector'>
        <label>Profondeur <select disabled={!!model.busy} value={preferences.depth} onChange={event => void model.updateLearning({ kind: 'preferences', value: { ...preferences, depth: event.target.value as typeof preferences.depth } })}><option value='guided'>Guidée</option><option value='concise'>Concise</option><option value='advanced'>Approfondie</option></select></label>
        <label>Temps disponible <select disabled={!!model.busy} value={preferences.minutes} onChange={event => void model.updateLearning({ kind: 'preferences', value: { ...preferences, minutes: Number(event.target.value) as 2 | 5 | 10 } })}><option value={2}>2 minutes</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option></select></label>
        <label><input type='checkbox' checked={preferences.invitations} disabled={!!model.busy} onChange={event => void model.updateLearning({ kind: 'preferences', value: { ...preferences, invitations: event.target.checked } })}/> Invitations pendant le travail des agents</label>
        <h4>Un objectif à explorer</h4><form onSubmit={event => { event.preventDefault(); if (goal.trim()) { void model.ask(goal, 'learn'); setGoal(''); } }}><input aria-label='Objectif d’apprentissage' placeholder='Comprendre mon API, découvrir le mobile…' value={goal} maxLength={1000} onChange={event => setGoal(event.target.value)}/><button disabled={!!model.busy || !goal.trim()}>Construire mon parcours ↗</button></form>
        {model.book?.journeys?.map(journey => <section key={journey.id}><h4>{journey.title}</h4><p>{journey.cursor + 1} / {journey.steps.length} · {journey.steps[journey.cursor]?.title}</p><div className='fabi-cli-progress-actions'><button disabled={!!model.busy} onClick={() => void model.updateLearning({ kind: 'journey', id: journey.id, action: journey.paused ? 'resume' : 'pause' })}>{journey.paused ? 'Reprendre' : 'Mettre en pause'}</button><button disabled={!!model.busy || journey.cursor === 0} onClick={() => void model.updateLearning({ kind: 'journey', id: journey.id, action: 'previous' })}>Précédent</button><button disabled={!!model.busy || journey.cursor >= journey.steps.length - 1} onClick={() => void model.updateLearning({ kind: 'journey', id: journey.id, action: 'next' })}>Suivant</button></div><button disabled={!!model.busy} onClick={() => void model.ask(`Reprenons le parcours « ${journey.title} », étape ${journey.cursor + 1} : ${journey.steps[journey.cursor]?.title}. Appuie-toi sur les sources et mon carnet.`, 'learn')}>Explorer cette étape ↗</button></section>)}
        <h4>Notions rencontrées</h4>{model.book?.concepts.map(concept => <div className='fabi-concept-row' key={concept.id}><span>○</span><div><strong>{concept.title}</strong><small>{concept.stage ? ({ discovered: 'Découverte', explained: 'Expliquée', partial: 'Vérifiée sur un exemple', applied: 'Appliquée dans un exercice', reinforce: 'À renforcer' })[concept.stage] : 'À explorer'}</small>{concept.evidence && <p>{concept.evidence}</p>}<button disabled={!!model.busy} onClick={() => void model.reviewConcept(concept.id)}>À revoir</button><button disabled={!!model.busy} onClick={() => void model.updateLearning({ kind: 'reset-concept', id: concept.id })}>Réinitialiser le niveau</button></div></div>)}
        {!model.book?.concepts.length && <p>Les notions abordées apparaîtront ici. Une explication lue ne signifie pas une notion acquise.</p>}
    </div>;
}

function ProjectMemory({ model }: { model: AssistModel }): React.ReactElement {
    const [notes, setNotes] = React.useState<import('../../common/fabi-assist-protocol').AssistUnderstanding[]>();
    const [error, setError] = React.useState('');
    const project = model.root?.path.fsPath();
    const load = () => { if (project) void model.service.understandings(project).then(setNotes).catch(() => setError('La mémoire ne peut pas être chargée.')); };
    return <><button onClick={load}>Voir ce que Fabi a retenu ↗</button>{error && <p role='alert'>{error}</p>}{notes?.map(note => <details key={note.path}><summary>{note.title}{note.stale ? ' · À actualiser' : ''}</summary><p>{note.explanation}</p>{note.claims?.map((claim, index) => <p key={index}><small>{({ code: 'Observé dans le code', documentation: 'Documenté', hypothesis: 'Hypothèse', 'historical-decision': 'Décision documentée' })[claim.kind]}</small>{claim.text}</p>)}{note.uncertainties?.map((text, index) => <p key={index}><small>À vérifier</small>{text}</p>)}<small>Interprétation fondée sur {note.readFiles.length} fichiers consultés / {note.totalFiles} inventoriés dans ce module.</small><div>{note.sources.map(source => <button key={source.path + source.line} onClick={() => void model.openSource(source.path, source.line)}>{source.path}:{source.line} ↗</button>)}</div><label>Ta correction <textarea aria-label={`Corriger la mémoire de ${note.path}`} defaultValue={note.correction ?? ''} maxLength={2000} onBlur={event => { if (project && event.target.value !== (note.correction ?? '')) void model.service.correctUnderstanding(project, note.path, event.target.value).then(load).catch(() => setError('La correction n’a pas pu être enregistrée.')); }}/></label><small>Enregistrée à la sortie du champ. Une note utilisateur reste distincte des preuves du code.</small></details>)}</>;
}
