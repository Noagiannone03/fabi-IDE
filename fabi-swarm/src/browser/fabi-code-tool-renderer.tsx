// Rendu des appels d'outils dans le chat, façon Cursor : une carte compacte
// (icône + titre lisible + sous-titre + statut) avec sortie dépliable et
// animation d'apparition. Prend le dessus sur le renderer Theia par défaut
// (canHandle = 100 > 10). Gère aussi l'approbation (Autoriser/Refuser).

import * as React from '@theia/core/shared/react';
import { injectable } from '@theia/core/shared/inversify';
import { ReactNode } from '@theia/core/shared/react';
import { ChatResponsePartRenderer } from '@theia/ai-chat-ui/lib/browser/chat-response-part-renderer';
import { ChatResponseContent, ToolCallChatResponseContent, ThinkingChatResponseContent } from '@theia/ai-chat/lib/common';

interface ToolMeta { label: string; icon: string; }
const TOOL_META: Record<string, ToolMeta> = {
    read: { label: 'Lecture', icon: 'codicon-file' },
    edit: { label: 'Édition', icon: 'codicon-edit' },
    write: { label: 'Création', icon: 'codicon-new-file' },
    apply_patch: { label: 'Patch', icon: 'codicon-diff' },
    patch: { label: 'Patch', icon: 'codicon-diff' },
    bash: { label: 'Commande', icon: 'codicon-terminal' },
    shell: { label: 'Commande', icon: 'codicon-terminal' },
    grep: { label: 'Recherche', icon: 'codicon-search' },
    glob: { label: 'Fichiers', icon: 'codicon-files' },
    list: { label: 'Exploration', icon: 'codicon-folder-opened' },
    webfetch: { label: 'Web', icon: 'codicon-globe' },
    websearch: { label: 'Recherche web', icon: 'codicon-globe' },
    todowrite: { label: 'Plan', icon: 'codicon-checklist' },
    todo: { label: 'Plan', icon: 'codicon-checklist' },
    task: { label: 'Sous-tâche', icon: 'codicon-list-tree' }
};

function metaFor(name?: string): ToolMeta {
    return (name && TOOL_META[name]) || { label: name || 'Outil', icon: 'codicon-tools' };
}

function basename(p: string): string {
    const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return s.slice(s.lastIndexOf('/') + 1) || s;
}

/** Sous-titre lisible dérivé des arguments de l'outil (chemin, commande…). */
function summarize(name: string | undefined, argsJson: string | undefined): string {
    if (!argsJson) {
        return '';
    }
    let a: Record<string, unknown>;
    try {
        a = JSON.parse(argsJson) as Record<string, unknown>;
    } catch {
        return '';
    }
    const str = (k: string): string | undefined => typeof a[k] === 'string' ? a[k] as string : undefined;
    const path = str('filePath') ?? str('path') ?? str('file');
    switch (name) {
        case 'read': case 'edit': case 'write': case 'apply_patch': case 'patch':
            return path ? basename(path) : '';
        case 'bash': case 'shell':
            return (str('command') ?? '').slice(0, 80);
        case 'grep': case 'glob':
            return str('pattern') ?? str('query') ?? '';
        case 'list':
            return path ? basename(path) : '';
        case 'webfetch': case 'websearch':
            return str('url') ?? str('query') ?? '';
        default:
            return path ? basename(path) : '';
    }
}

/** Texte de résultat affichable, quel que soit le type de ToolCallResult. */
function resultText(result: unknown): string {
    if (result === undefined || result === null) {
        return '';
    }
    if (typeof result === 'string') {
        return result;
    }
    const obj = result as { content?: Array<{ type?: string; text?: string }>; output?: string; text?: string };
    if (Array.isArray(obj.content)) {
        return obj.content.map(c => c.text ?? '').filter(Boolean).join('\n');
    }
    if (typeof obj.output === 'string') {
        return obj.output;
    }
    if (typeof obj.text === 'string') {
        return obj.text;
    }
    try {
        return JSON.stringify(result, undefined, 0);
    } catch {
        return String(result);
    }
}

const FabiToolCard: React.FC<{ content: ToolCallChatResponseContent }> = ({ content }) => {
    const [, force] = React.useReducer((x: number) => x + 1, 0);
    const [open, setOpen] = React.useState(false);
    const [confirming, setConfirming] = React.useState(false);

    React.useEffect(() => {
        const d = content.onDidChange(() => force());
        let alive = true;
        content.needsUserConfirmation?.then(() => { if (alive) { setConfirming(true); } }).catch(() => undefined);
        content.confirmed?.then(() => { if (alive) { setConfirming(false); } }).catch(() => undefined);
        return () => { alive = false; d.dispose(); };
    }, [content]);

    const meta = metaFor(content.name);
    const sub = summarize(content.name, content.arguments);
    const out = resultText(content.result);
    const isError = content.finished && typeof content.result === 'object'
        && !!(content.result as { isError?: boolean; denied?: boolean })?.isError;
    const status: 'confirm' | 'running' | 'error' | 'done' =
        confirming ? 'confirm' : !content.finished ? 'running' : isError ? 'error' : 'done';
    const statusIcon = {
        confirm: 'codicon-shield',
        running: 'codicon-loading codicon-modifier-spin',
        error: 'codicon-error',
        done: 'codicon-check'
    }[status];

    return (
        <div className={`fabi-tc fabi-tc-${status}`}>
            <div className='fabi-tc-head' onClick={() => out && setOpen(o => !o)}>
                <span className={`codicon ${meta.icon} fabi-tc-icon`} />
                <span className='fabi-tc-label'>{meta.label}</span>
                {sub && <span className='fabi-tc-sub'>{sub}</span>}
                <span className={`codicon ${statusIcon} fabi-tc-status`} />
                {out && <span className={`codicon codicon-chevron-${open ? 'down' : 'right'} fabi-tc-caret`} />}
            </div>
            {status === 'confirm' && (
                <div className='fabi-tc-confirm'>
                    <button className='fabi-tc-allow' onClick={() => content.confirm()}>Autoriser</button>
                    <button className='fabi-tc-deny' onClick={() => content.deny()}>Refuser</button>
                </div>
            )}
            {open && out && <pre className='fabi-tc-out'>{out.length > 6000 ? out.slice(0, 6000) + '\n…' : out}</pre>}
        </div>
    );
};

@injectable()
export class FabiToolPartRenderer implements ChatResponsePartRenderer<ToolCallChatResponseContent> {
    canHandle(response: ChatResponseContent): number {
        return ToolCallChatResponseContent.is(response) ? 100 : -1;
    }
    render(response: ToolCallChatResponseContent): ReactNode {
        return <FabiToolCard content={response} />;
    }
}

// ---- Bloc « Réflexion » (thinking) façon Cursor : repliable, atténué ----

const FabiThinkingBlock: React.FC<{ text: string }> = ({ text }) => {
    const [open, setOpen] = React.useState(false);
    const lines = text.trim().split('\n').filter(Boolean);
    const preview = lines.length ? lines[lines.length - 1] : '';
    return (
        <div className={`fabi-think${open ? ' open' : ''}`}>
            <div className='fabi-think-head' onClick={() => setOpen(o => !o)}>
                <span className='codicon codicon-lightbulb-sparkle fabi-think-icon' />
                <span className='fabi-think-title'>Réflexion</span>
                {!open && preview && <span className='fabi-think-preview'>{preview}</span>}
                <span className={`codicon codicon-chevron-${open ? 'down' : 'right'} fabi-think-caret`} />
            </div>
            {open && <div className='fabi-think-body'>{text}</div>}
        </div>
    );
};

@injectable()
export class FabiThinkingPartRenderer implements ChatResponsePartRenderer<ThinkingChatResponseContent> {
    canHandle(response: ChatResponseContent): number {
        return ThinkingChatResponseContent.is(response) ? 100 : -1;
    }
    render(response: ThinkingChatResponseContent): ReactNode {
        return <FabiThinkingBlock text={response.content} />;
    }
}
