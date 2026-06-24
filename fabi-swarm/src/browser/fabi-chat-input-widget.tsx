import * as React from '@theia/core/shared/react';
import * as ReactDOM from '@theia/core/shared/react-dom';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { URI } from '@theia/core';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { CHAT_VIEW_LANGUAGE_EXTENSION } from '@theia/ai-chat-ui/lib/browser/chat-view-language-contribution';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { FabiSwarmSelector } from './fabi-swarm-selector';
import { FabiCodeFrontend } from './fabi-code-frontend';
import { FabiCodeState, FABI_CODE_MODES } from './fabi-code-state';

/**
 * Sous-classe de l'input du chat IA de Theia. On NE forke PAS le paquet : on
 * étend la classe et on rebind (cf. fabi-swarm-frontend-module) → la WidgetFactory
 * de Theia instancie automatiquement la nôtre. `render()` est protégé : on
 * réutilise tel quel le rendu parent (éditeur, options, envoi…) et on ajoute
 * juste, AU-DESSUS, notre sélecteur de swarm. Upgrade-safe.
 */
@injectable()
export class FabiChatInputWidget extends AIChatInputWidget {

    @inject(FabiSwarmFrontend)
    protected readonly swarm: FabiSwarmFrontend;

    @inject(FabiCodeFrontend)
    protected readonly engine: FabiCodeFrontend;

    @inject(FabiCodeState)
    protected readonly fabiMode: FabiCodeState;

    /** Prêt = le moteur OpenCode (sidecar) est lancé. C'est lui le cerveau ;
     *  le swarm n'est que le modèle qu'il appelle (ses erreurs s'affichent dans
     *  le chat). On n'attend donc plus `swarm.ready` pour saisir. */
    protected get ready(): boolean {
        return this.engine.server.status === 'ready';
    }

    /**
     * URI de la ressource Monaco de l'input, UNIQUE par instance.
     *
     * Le parent enregistre, dans son `@postConstruct`, une ressource en mémoire à
     * une URI FIXE (`ai-chat:/input.aichatviewlanguage`). Dès qu'on ouvre un 2ᵉ chat,
     * cette URI entre en collision → « Cannot add already existing in-memory
     * resource » → l'instance échoue → pas de 2ᵉ onglet. On donne donc à chaque
     * input sa propre URI (en gardant l'extension `.aichatviewlanguage` pour que le
     * langage/coloration s'appliquent) → multi-chat possible. URI mémoïsée : stable
     * pour toute la vie du widget.
     */
    protected static fabiInputSeq = 0;
    protected fabiResourceUri?: URI;

    protected override getResourceUri(): URI {
        if (!this.fabiResourceUri) {
            const seq = ++FabiChatInputWidget.fabiInputSeq;
            this.fabiResourceUri = new URI(`ai-chat:/input-${seq}.${CHAT_VIEW_LANGUAGE_EXTENSION}`);
        }
        return this.fabiResourceUri;
    }

    /**
     * Active l'input UNIQUEMENT quand le swarm peut réellement servir une requête.
     *
     * Le parent appelle `setEnabled(aiActivationService.canRun)` — un signal qui
     * n'a aucun sens pour Fabi (l'IA n'est jamais « désactivée »). La vraie
     * condition produit, c'est : « le swarm peut-il répondre MAINTENANT ? » =
     * `connection.ready` (vérité scheduler : pipeline prête à router + worker en
     * cours + assez de peers — cf. deriveConnection). On ignore donc l'argument du
     * parent et on lit `connection.ready`.
     *
     * Sans ça, on pouvait taper + envoyer un message dans le vide et se manger un
     * `500 "Server is not ready"` / `503` côté scheduler. Le parent ne bloque que
     * l'ENVOI quand disabled ; on bloque AUSSI la saisie (éditeur en lecture seule)
     * pour que l'input soit franchement inerte tant que le swarm n'est pas prêt.
     * Le « pourquoi » détaillé (pas assez de contributeurs, chargement…) est affiché
     * juste au-dessus par FabiSwarmSelector.
     */
    override setEnabled(_enabled: boolean): void {
        const ready = this.ready;
        super.setEnabled(ready);
        this.editor?.getControl().updateOptions({ readOnly: !ready });
    }

    /**
     * Le parent règle l'état d'activation une seule fois à l'init. Or notre
     * condition (`connection.ready`) évolue en continu (pipeline qui se forme,
     * worker qui charge, peer qui part…). On se réabonne donc aux changements de
     * connexion pour ré-évaluer l'activation à chaque fois, et on ré-applique
     * l'état une fois l'éditeur Monaco prêt (le `readOnly` ne « prend » qu'après
     * sa création).
     */
    @postConstruct()
    protected override init(): void {
        super.init();
        this.toDispose.push(this.swarm.onConnectionChangedEvent(() => this.setEnabled(false)));
        this.toDispose.push(this.engine.onServerStatusEvent(() => { this.setEnabled(false); this.update(); }));
        this.editorReady.promise.then(() => this.setEnabled(false));
    }

    // (FabiModeDropdown défini en bas du fichier.)

    /**
     * Le chip de mode est rendu en frère de l'input (React), mais on le DÉPLACE
     * dans la barre d'options native de l'input (`.theia-ChatInputOptions-left`,
     * à gauche, à côté du 📎) après chaque rendu → il vit VRAIMENT dans la box.
     */
    protected override onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        queueMicrotask(() => {
            const dd = this.node.querySelector('.fabi-mode-dd');
            const opts = this.node.querySelector('.theia-ChatInputOptions-left');
            if (dd && opts && dd.parentElement !== opts) {
                opts.insertBefore(dd, opts.firstChild);
            }
        });
    }

    protected override render(): React.ReactNode {
        // Deux états visuels nets :
        //  - swarm PAS prêt → le sélecteur prend toute la place (gros composant
        //    d'état/choix de modèle) et on NE rend PAS l'input : impossible de
        //    taper/envoyer dans le vide, et pas de champ grisé moche.
        //  - swarm PRÊT → barre de modèle compacte EN HAUT + input réel dessous.
        // (Pas de div wrapper autour de l'input : un conteneur casse le calcul de
        //  largeur de l'éditeur Monaco. Un Fragment n'ajoute aucune boîte.)
        if (!this.ready) {
            return <FabiSwarmSelector frontend={this.swarm} locked />;
        }
        return (
            <React.Fragment>
                <FabiSwarmSelector frontend={this.swarm} />
                {super.render()}
                <FabiModeDropdown state={this.fabiMode} onChange={() => this.update()} />
            </React.Fragment>
        );
    }
}

/** Icône par mode (Agent = outils/édition, Ask = lecture/recherche). */
const MODE_ICON: Record<string, string> = { build: 'codicon-tools', plan: 'codicon-search' };

/**
 * Sélecteur de mode façon Cursor : un petit chip « Agent ▴ » ancré en bas à
 * gauche de l'input ; au clic, un menu s'ouvre VERS LE HAUT avec Agent / Ask,
 * chacun avec son libellé + une courte description, et une coche sur l'actif.
 */
const FabiModeDropdown: React.FC<{ state: FabiCodeState; onChange: () => void }> = ({ state, onChange }) => {
    const [open, setOpen] = React.useState(false);
    const [pos, setPos] = React.useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
    const chipRef = React.useRef<HTMLButtonElement | null>(null);
    const active = FABI_CODE_MODES.find(m => m.id === state.mode) ?? FABI_CODE_MODES[0];

    const toggle = (): void => {
        const el = chipRef.current;
        if (el && !open) {
            const b = el.getBoundingClientRect();
            // Position FIXE au-dessus du chip → échappe au clipping de l'input.
            setPos({ left: b.left, bottom: window.innerHeight - b.top + 8 });
        }
        setOpen(o => !o);
    };

    React.useEffect(() => {
        if (!open) {
            return;
        }
        const close = (): void => setOpen(false);
        // Fermeture au clic ailleurs / scroll / resize.
        const onDoc = (e: MouseEvent): void => {
            const t = e.target as Node;
            if (chipRef.current && !chipRef.current.contains(t) && !(t as HTMLElement).closest?.('.fabi-mode-menu')) {
                close();
            }
        };
        document.addEventListener('mousedown', onDoc, true);
        window.addEventListener('resize', close);
        return () => { document.removeEventListener('mousedown', onDoc, true); window.removeEventListener('resize', close); };
    }, [open]);

    const menu = open ? ReactDOM.createPortal(
        <div className='fabi-mode-menu' role='menu' style={{ left: pos.left, bottom: pos.bottom }}>
            {FABI_CODE_MODES.map(m => (
                <button
                    key={m.id}
                    type='button'
                    className={`fabi-mode-item${state.mode === m.id ? ' active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={() => { state.mode = m.id; onChange(); setOpen(false); }}
                >
                    <span className={`codicon ${MODE_ICON[m.id] ?? 'codicon-circle'} fabi-mode-item-icon`} />
                    <span className='fabi-mode-item-text'>
                        <span className='fabi-mode-item-name'>{m.label}</span>
                        <span className='fabi-mode-item-desc'>{m.hint}</span>
                    </span>
                    {state.mode === m.id && <span className='codicon codicon-check fabi-mode-item-check' />}
                </button>
            ))}
        </div>,
        document.body
    ) : null;

    return (
        <div className='fabi-mode-dd'>
            <button
                ref={chipRef}
                type='button'
                className='fabi-mode-chip'
                title='Mode Fabi'
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
                onClick={toggle}
            >
                <span className={`codicon ${MODE_ICON[active.id] ?? 'codicon-circle'}`} />
                <span className='fabi-mode-chip-label'>{active.label}</span>
                <span className={`codicon codicon-chevron-${open ? 'down' : 'up'} fabi-mode-chip-caret`} />
            </button>
            {menu}
        </div>
    );
};
