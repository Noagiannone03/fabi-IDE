import { loadDiagramEngine } from './assist-mermaid-loader';
import * as monaco from '@theia/monaco-editor-core';

let diagramSerial = 0;
let mermaidReady: Promise<typeof import('mermaid')['default']> | undefined;

/** Code is displayed, never executed. Mermaid sanitizes its own SVG in strict mode. */
export async function renderAssistCodeBlock(language: string, value: string): Promise<HTMLElement> {
    const lang = (language || 'text').toLowerCase().split(/\s/)[0];
    const block = document.createElement('section');
    block.className = 'fabi-code-block';
    const header = document.createElement('header');
    const label = document.createElement('span');
    const icon = document.createElement('i');
    const terminal = ['sh', 'bash', 'shell', 'zsh', 'powershell', 'console'].includes(lang);
    icon.className = `codicon codicon-${lang === 'mermaid' ? 'type-hierarchy' : terminal ? 'terminal' : 'code'}`;
    icon.setAttribute('aria-hidden', 'true');
    label.append(icon, document.createTextNode(lang === 'mermaid' ? 'Schéma' : terminal ? `Commande · ${lang}` : lang));
    const copy = document.createElement('button');
    copy.type = 'button'; copy.textContent = 'Copier'; copy.setAttribute('aria-label', lang === 'mermaid' ? 'Copier le schéma Mermaid' : 'Copier le code');
    copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(value); copy.textContent = 'Copié'; }
        catch { copy.textContent = 'Copie impossible'; }
    });
    header.append(label, copy); block.append(header);
    const pre = document.createElement('pre');
    const code = document.createElement('code'); code.textContent = value; pre.append(code);
    if (lang === 'mermaid' && value.length <= 12000) {
        try {
            mermaidReady ??= loadDiagramEngine().then(mermaid => {
                mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'dark',
                    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', flowchart: { htmlLabels: false, curve: 'basis' } });
                return mermaid;
            });
            const mermaid = await mermaidReady;
            const { svg } = await mermaid.render(`fabi-diagram-${++diagramSerial}`, value);
            const visual = document.createElement('div'); visual.className = 'fabi-mermaid';
            visual.innerHTML = svg;
            visual.querySelector('svg')?.setAttribute('role', 'img');
            visual.querySelector('svg')?.setAttribute('aria-label', 'Schéma explicatif');
            block.append(visual);
            const source = document.createElement('details');
            const summary = document.createElement('summary'); summary.textContent = 'Voir le code du schéma';
            source.append(summary, pre); block.append(source);
            return block;
        } catch {
            const note = document.createElement('p'); note.className = 'fabi-diagram-fallback';
            note.textContent = 'Schéma non affichable. Son contenu reste disponible ci-dessous.'; block.append(note);
        }
    }
    if (lang !== 'mermaid') {
        const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', sh: 'shell', bash: 'shell', zsh: 'shell', py: 'python' };
        try { code.innerHTML = await monaco.editor.colorize(value, aliases[lang] || lang, {}); }
        catch { /* Unknown languages remain readable plain text. */ }
    }
    block.append(pre);
    return block;
}
