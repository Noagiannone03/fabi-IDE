import * as React from '@theia/core/shared/react';
import { createRoot } from '@theia/core/shared/react-dom/client';
import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FabiAgentCliService } from '../../common/fabi-agent-cli-protocol';
import { FabiAgentCli, FabiAgentCliId, FABI_AGENT_CLIS } from '../../common/fabi-agent-clis';

/** Logo d'une CLI d'agent (masque SVG teinté à la couleur de la marque, cf. fabi-projects.css). */
export function FabiAgentLogo({ cli, size }: { cli: string; size?: number }): React.ReactElement {
    return <span className='fabi-agent-logo' data-cli={cli} aria-hidden='true'
        style={size ? { width: size, height: size } : undefined} />;
}

interface PickerProps {
    folder: string;
    installed: Promise<FabiAgentCliId[]>;
    done(cli: FabiAgentCliId | undefined): void;
}

/**
 * Sélecteur « Nouvel agent IA » : carte centrée façon Spotlight, une tuile par
 * CLI. Les CLI absentes du PATH restent visibles mais inactives, avec leur
 * commande d'installation. Flèches / Entrée / Échap.
 */
function AgentPicker({ folder, installed, done }: PickerProps): React.ReactElement {
    const [available, setAvailable] = React.useState<FabiAgentCliId[] | undefined>();
    const [index, setIndex] = React.useState(0);
    React.useEffect(() => {
        installed.then(setAvailable, () => setAvailable(FABI_AGENT_CLIS.map(cli => cli.id)));
    }, [installed]);

    const isReady = (cli: FabiAgentCli) => !available || available.includes(cli.id);
    // Les CLI installées d'abord, l'ordre de la table ensuite.
    const clis = [...FABI_AGENT_CLIS].sort((a, b) => Number(isReady(b)) - Number(isReady(a)));
    const selectable = clis.filter(isReady);
    const current = selectable[Math.min(index, selectable.length - 1)];

    React.useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                done(undefined);
            } else if (event.key === 'Enter' && current && available) {
                done(current.id);
            } else if (['ArrowRight', 'ArrowDown', 'Tab'].includes(event.key)) {
                setIndex(i => (i + 1) % Math.max(1, selectable.length));
            } else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) {
                setIndex(i => (i - 1 + selectable.length) % Math.max(1, selectable.length));
            } else {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [current, available, selectable.length]);

    return <div className='fabi-agent-picker-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) { done(undefined); } }}>
        <div className='fabi-agent-picker' role='dialog' aria-label={`Nouvel agent dans ${folder}`}>
            <header>
                <span className='fabi-agent-picker-eyebrow'>Nouvel agent IA</span>
                <h2>dans <strong>{folder}</strong></h2>
            </header>
            <div className='fabi-agent-picker-grid' role='listbox'>
                {clis.map(cli => {
                    const ready = isReady(cli);
                    const selected = ready && cli === current;
                    return <button key={cli.id} role='option' aria-selected={selected} disabled={!ready || !available}
                        className={'fabi-agent-tile' + (selected ? ' selected' : '') + (ready ? '' : ' missing')}
                        onMouseEnter={() => ready && setIndex(selectable.indexOf(cli))}
                        onClick={() => ready && done(cli.id)}>
                        <span className='fabi-agent-tile-mark'><FabiAgentLogo cli={cli.id} /></span>
                        <span className='fabi-agent-tile-name'>{cli.label}</span>
                        <span className='fabi-agent-tile-vendor'>
                            {!available ? 'Recherche…' : ready ? cli.description : 'Non installé'}
                        </span>
                        {available && !ready && <code className='fabi-agent-tile-install' title='Commande d’installation'>{cli.install}</code>}
                    </button>;
                })}
            </div>
            <footer>
                <span><kbd>←</kbd><kbd>→</kbd> choisir</span>
                <span><kbd>↵</kbd> lancer</span>
                <span><kbd>esc</kbd> fermer</span>
            </footer>
        </div>
    </div>;
}

@injectable()
export class FabiAgentPicker {

    @inject(FabiAgentCliService) protected readonly agentClis: FabiAgentCliService;

    pick(folder: URI): Promise<FabiAgentCliId | undefined> {
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const previousFocus = document.activeElement as HTMLElement | null;
        return new Promise(resolve => {
            let settled = false;
            const done = (cli: FabiAgentCliId | undefined) => {
                if (settled) {
                    return;
                }
                settled = true;
                root.unmount();
                host.remove();
                previousFocus?.focus();
                resolve(cli);
            };
            root.render(<AgentPicker folder={folder.path.base} installed={this.agentClis.installed()} done={done} />);
        });
    }
}
