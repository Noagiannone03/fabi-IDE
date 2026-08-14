import * as React from '@theia/core/shared/react';
import * as ReactDOM from '@theia/core/shared/react-dom';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { URI } from '@theia/core';
import { Bot, Check, ChevronDown, Hand, ListPlus, MessageCircleQuestion, Square, Target, WandSparkles } from 'lucide-react';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { CHAT_VIEW_LANGUAGE_EXTENSION } from '@theia/ai-chat-ui/lib/browser/chat-view-language-contribution';
import { ChatRequestModel, MutableChatModel } from '@theia/ai-chat/lib/common/chat-model';
import { GenericCapabilitySelections } from '@theia/ai-core';
import type { SimpleMonacoEditor } from '@theia/monaco/lib/browser/simple-monaco-editor';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { FabiSwarmSelector } from './fabi-swarm-selector';
import { FabiCodeFrontend } from './fabi-code-frontend';
import { canAcceptChatInput, shouldRenderChatInput } from '../common/fabi-chat-input-visibility';
import {
    FABI_CODE_PERMISSION_MODE_SETTING, FabiCodePermissionMode,
    normalizeFabiCodePermissionMode
} from '../common/fabi-code-permission-mode';
import { FabiCodeMode, normalizeFabiCodeMode } from '../common/fabi-code-mode';

interface FabiModeControlsPortalProps {
    host: HTMLElement;
    agentMode: FabiCodeMode;
    permissionMode: FabiCodePermissionMode;
    disabled: boolean;
    permissionDisabled: boolean;
    onAgentModeChange: (mode: FabiCodeMode) => void;
    onPermissionModeChange: (mode: FabiCodePermissionMode) => void;
}

interface FabiModeOption<Value extends string> {
    value: Value;
    label: string;
    detail: string;
    icon: React.ReactNode;
}

interface FabiQueueControlsPortalProps {
    host: HTMLElement;
    editor: SimpleMonacoEditor | undefined;
    queuedTurns: number;
    canAbortOwner: boolean;
    onSubmit: () => void;
    onAbortOwner: () => void;
}

function FabiModeMenu<Value extends string>(props: {
    ariaLabel: string;
    className: string;
    value: Value;
    options: readonly FabiModeOption<Value>[];
    disabled: boolean;
    align?: 'start' | 'end';
    onChange: (value: Value) => void;
}): React.ReactElement {
    const [open, setOpen] = React.useState(false);
    const [menuPosition, setMenuPosition] = React.useState({ left: 8, top: 8, maxHeight: 240 });
    const root = React.useRef<HTMLDivElement>(null);
    const menu = React.useRef<HTMLDivElement>(null);
    const selected = props.options.find(option => option.value === props.value) ?? props.options[0];

    const focusTrigger = React.useCallback(() => {
        root.current?.querySelector<HTMLButtonElement>('.fabi-mode-trigger')?.focus();
    }, []);

    const focusOption = React.useCallback((position: 'selected' | 'first' | 'last' | 'next' | 'previous') => {
        const options = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('.fabi-mode-option') ?? []);
        if (options.length === 0) {
            return;
        }
        const active = options.indexOf(document.activeElement as HTMLButtonElement);
        const selectedIndex = Math.max(0, props.options.findIndex(option => option.value === props.value));
        const index = position === 'first' ? 0
            : position === 'last' ? options.length - 1
                : position === 'next' ? (active < 0 ? selectedIndex : (active + 1) % options.length)
                    : position === 'previous' ? (active < 0 ? selectedIndex : (active - 1 + options.length) % options.length)
                        : selectedIndex;
        options[index]?.focus();
    }, [props.options, props.value]);

    const updateMenuPosition = React.useCallback(() => {
        const trigger = root.current?.querySelector<HTMLButtonElement>('.fabi-mode-trigger');
        if (!trigger) {
            return;
        }
        const rect = trigger.getBoundingClientRect();
        const menuWidth = 258;
        const viewportMargin = 8;
        const desiredLeft = props.align === 'end' ? rect.right - menuWidth : rect.left;
        const rightmostLeft = Math.max(viewportMargin, window.innerWidth - menuWidth - viewportMargin);
        setMenuPosition({
            left: Math.max(viewportMargin, Math.min(desiredLeft, rightmostLeft)),
            top: rect.top - 7,
            maxHeight: Math.max(96, rect.top - viewportMargin - 7)
        });
    }, [props.align]);

    React.useEffect(() => {
        if (!open) {
            return undefined;
        }
        const closeOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!root.current?.contains(target) && !menu.current?.contains(target)) {
                setOpen(false);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
                focusTrigger();
            }
        };
        const reposition = () => updateMenuPosition();
        updateMenuPosition();
        document.addEventListener('mousedown', closeOutside);
        document.addEventListener('keydown', closeOnEscape);
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        window.visualViewport?.addEventListener('resize', reposition);
        window.visualViewport?.addEventListener('scroll', reposition);
        return () => {
            document.removeEventListener('mousedown', closeOutside);
            document.removeEventListener('keydown', closeOnEscape);
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
            window.visualViewport?.removeEventListener('resize', reposition);
            window.visualViewport?.removeEventListener('scroll', reposition);
        };
    }, [focusTrigger, open, updateMenuPosition]);

    React.useEffect(() => {
        if (open) {
            focusOption('selected');
        }
    }, [focusOption, open]);

    return (
        <div ref={root} className={`fabi-mode-control ${props.className}${open ? ' open' : ''}`}>
            <button
                type='button'
                className='fabi-mode-trigger'
                aria-label={props.ariaLabel}
                aria-haspopup='listbox'
                aria-expanded={open}
                disabled={props.disabled}
                onClick={() => setOpen(value => !value)}
                onKeyDown={event => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
            >
                <span className='fabi-mode-trigger-icon' aria-hidden='true'>{selected.icon}</span>
                <span>{selected.label}</span>
                <ChevronDown className='fabi-mode-chevron' size={12} strokeWidth={1.9} aria-hidden='true' />
            </button>
            {open && ReactDOM.createPortal(
                <div
                    ref={menu}
                    className='fabi-mode-menu'
                    role='listbox'
                    aria-label={props.ariaLabel}
                    style={{
                        left: `${menuPosition.left}px`,
                        top: `${menuPosition.top}px`,
                        maxHeight: `${menuPosition.maxHeight}px`
                    }}
                    onKeyDown={event => {
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            focusOption(event.key === 'ArrowDown' ? 'next' : 'previous');
                        } else if (event.key === 'Home' || event.key === 'End') {
                            event.preventDefault();
                            focusOption(event.key === 'Home' ? 'first' : 'last');
                        }
                    }}
                >
                    {props.options.map(option => (
                        <button
                            key={option.value}
                            type='button'
                            role='option'
                            aria-selected={option.value === props.value}
                            className={`fabi-mode-option${option.value === props.value ? ' selected' : ''}`}
                            onClick={() => {
                                props.onChange(option.value);
                                setOpen(false);
                                focusTrigger();
                            }}
                        >
                            <span className='fabi-mode-option-icon' aria-hidden='true'>{option.icon}</span>
                            <span className='fabi-mode-option-copy'>
                                <span className='fabi-mode-option-label'>{option.label}</span>
                                <span className='fabi-mode-option-detail'>{option.detail}</span>
                            </span>
                            {option.value === props.value && <Check className='fabi-mode-check' size={13} strokeWidth={2.2} aria-hidden='true' />}
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
}

const AGENT_MODE_OPTIONS: readonly FabiModeOption<FabiCodeMode>[] = [
    {
        value: 'build', label: 'Agent', detail: 'Explore, exécute et modifie le projet',
        icon: <Bot size={13} strokeWidth={1.9} />
    },
    {
        value: 'plan', label: 'Ask', detail: 'Analyse et répond sans appliquer d’edit',
        icon: <MessageCircleQuestion size={13} strokeWidth={1.9} />
    },
    {
        value: 'goal', label: 'Goal', detail: 'Poursuit un objectif jusqu’à sa validation',
        icon: <Target size={13} strokeWidth={1.9} />
    }
];

const PERMISSION_MODE_OPTIONS: readonly FabiModeOption<FabiCodePermissionMode>[] = [
    {
        value: 'ask', label: 'Ask edits', detail: 'Demander avant les outils sensibles',
        icon: <Hand size={13} strokeWidth={1.9} />
    },
    {
        value: 'auto', label: 'YOLO', detail: 'Toujours tout autoriser dans ce chat',
        icon: <WandSparkles size={13} strokeWidth={1.9} />
    }
];

/**
 * Le composant d'options appartient à Theia et n'expose pas de slot. Un portail
 * ciblé remplace visuellement son sélecteur Agent/Ask et ajoute la politique
 * d'outils, sans forker le widget ni dupliquer l'éditeur de chat.
 */
function FabiModeControlsPortal(props: FabiModeControlsPortalProps): React.ReactPortal {
    const mount = React.useMemo(() => document.createElement('span'), []);
    React.useLayoutEffect(() => {
        const target = props.host.querySelector('.theia-ChatInputOptions-left');
        if (!target) {
            return undefined;
        }
        props.host.classList.add('fabi-chat-input-widget');
        mount.className = 'fabi-mode-controls-host';
        const hideNativeMode = () => {
            for (const selector of Array.from(target.querySelectorAll('.theia-ChatInput-ModeSelector'))) {
                selector.parentElement?.classList.add('fabi-native-mode-source');
            }
        };
        hideNativeMode();
        const observer = new MutationObserver(hideNativeMode);
        observer.observe(target, { childList: true, subtree: true });
        const nativeMode = target.querySelector('.theia-ChatInput-ModeSelector')?.parentElement;
        target.insertBefore(mount, nativeMode ?? target.firstChild);
        return () => {
            observer.disconnect();
            props.host.classList.remove('fabi-chat-input-widget');
            for (const selector of Array.from(target.querySelectorAll('.theia-ChatInput-ModeSelector'))) {
                selector.parentElement?.classList.remove('fabi-native-mode-source');
            }
            mount.remove();
        };
    }, [mount, props.host]);
    return ReactDOM.createPortal(
        <span className='fabi-mode-controls'>
            <FabiModeMenu
                ariaLabel='Mode de travail'
                className='fabi-agent-mode'
                value={props.agentMode}
                options={AGENT_MODE_OPTIONS}
                disabled={props.disabled}
                onChange={props.onAgentModeChange}
            />
            <FabiModeMenu
                ariaLabel='Politique des outils'
                className={`fabi-permission-mode fabi-permission-${props.permissionMode}`}
                value={props.permissionMode}
                options={PERMISSION_MODE_OPTIONS}
                disabled={props.permissionDisabled}
                align='end'
                onChange={props.onPermissionModeChange}
            />
        </span>,
        mount
    );
}

/** Adds queue actions beside Theia's native cancel button without replacing its editor. */
function FabiQueueControlsPortal(props: FabiQueueControlsPortalProps): React.ReactPortal {
    const mount = React.useMemo(() => document.createElement('span'), []);
    const [hasDraft, setHasDraft] = React.useState(false);

    React.useLayoutEffect(() => {
        const target = props.host.querySelector('.theia-ChatInputOptions-right');
        if (!target) {
            return undefined;
        }
        mount.className = 'fabi-queue-controls-host';
        target.appendChild(mount);
        return () => mount.remove();
    }, [mount, props.host]);

    React.useEffect(() => {
        const control = props.editor?.getControl();
        if (!control) {
            setHasDraft(false);
            return undefined;
        }
        const update = () => setHasDraft(control.getValue().trim().length > 0);
        update();
        const disposable = control.onDidChangeModelContent(update);
        return () => disposable.dispose();
    }, [props.editor]);

    return ReactDOM.createPortal(
        <span className='fabi-queue-controls'>
            {props.queuedTurns > 0 && (
                <span className='fabi-queue-count' role='status' aria-live='polite'>
                    {props.queuedTurns} en file
                </span>
            )}
            {props.canAbortOwner && (
                <button
                    type='button'
                    className='fabi-queue-action fabi-abort-owner'
                    aria-label='Interrompre le tour actif'
                    title='Interrompre le tour actif'
                    onClick={props.onAbortOwner}
                >
                    <Square size={11} strokeWidth={2} fill='currentColor' aria-hidden='true' />
                </button>
            )}
            <button
                type='button'
                className='fabi-queue-action fabi-enqueue-draft'
                aria-label='Ajouter ce message à la file'
                title='Ajouter à la file (Entrée)'
                disabled={!hasDraft}
                onClick={props.onSubmit}
            >
                <ListPlus size={14} strokeWidth={1.9} aria-hidden='true' />
            </button>
        </span>,
        mount
    );
}

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

    /** Prêt = le swarm peut servir une requête maintenant. OpenCode démarre lazy
     *  au premier message ; attendre son statut ici créerait un deadlock UI :
     *  pas d'input → pas de message → pas de démarrage OpenCode. */
    protected get ready(): boolean {
        return this.swarm.connection?.ready === true;
    }

    /**
     * Once the scheduler has admitted this chat, preserve Theia's editor
     * identity through later busy/recovery/model-switch states. Availability is
     * still enforced by `setEnabled`; this flag never grants permission to type
     * or send.
     */
    protected inputPreviouslyUnlocked = false;

    /** Ticket backend actuellement propriétaire, partagé par tous les Spaces. */
    protected activeTurnId: string | undefined;

    protected get canAcceptInput(): boolean {
        return canAcceptChatInput(
            this.ready,
            this.engine.server.activeTurns,
            this.inputPreviouslyUnlocked
        );
    }

    /** Theia owns request cancellation, so mirror its exact pending predicate. */
    protected get requestInProgress(): boolean {
        // A swarm status update can schedule a render between construction and
        // ChatViewWidget attaching its model. Theia's own render contract assumes
        // that attachment already happened, so this pre-attachment state cannot
        // contain a cancellable request.
        if (!this._chatModel) {
            return false;
        }
        const branchItems = this._branch?.items;
        const requests = this._chatModel.getRequests();
        const currentRequest = (branchItems && branchItems.length > 0
            ? branchItems[branchItems.length - 1].element
            : undefined) ?? requests[requests.length - 1];
        return !!currentRequest && ChatRequestModel.isInProgress(currentRequest);
    }

    /**
     * Theia normally resets a mode to the agent's default whenever its prompt
     * variant changes. Fabi modes are OpenCode primary agents, not Theia prompt
     * variants, so that unrelated event must not undo the user's Agent/Ask
     * choice after every turn.
     */
    protected override syncSelectedModeWithDefault(): void {
        // The selected native mode remains in `receivingAgent.currentModeId` and
        // is serialized by Theia onto each request as `request.modeId`.
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
        const canAccept = this.canAcceptInput;
        super.setEnabled(canAccept);
        this.editor?.getControl().updateOptions({ readOnly: !canAccept });
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
        this.inputPreviouslyUnlocked = this.ready;
        this.toDispose.push(this.swarm.onConnectionChangedEvent(connection => {
            if (connection.ready) {
                this.inputPreviouslyUnlocked = true;
            }
            this.setEnabled(false);
            this.update();
        }));
        this.toDispose.push(this.engine.onServerStatusEvent(() => { this.setEnabled(false); this.update(); }));
        this.toDispose.push(this.engine.onTurnQueueChangedEvent(state => {
            if (state.state === 'active') {
                this.activeTurnId = state.turnId;
            } else if (state.state === 'released' && this.activeTurnId === state.turnId) {
                this.activeTurnId = undefined;
            }
            this.setEnabled(false);
            this.update();
        }));
        this.editorReady.promise.then(() => this.setEnabled(false));
    }

    protected submitQueuedPrompt(): void {
        const editor = this.editor;
        const value = editor?.getControl().getValue() ?? '';
        if (!this.canAcceptInput || value.trim().length === 0) {
            return;
        }
        const capabilityOverrides: Record<string, boolean> = {};
        for (const [key, enabled] of this.userCapabilityOverrides) {
            capabilityOverrides[key] = enabled;
        }
        void this._onQuery(
            value,
            this.receivingAgent?.currentModeId,
            Object.keys(capabilityOverrides).length > 0 ? capabilityOverrides : undefined,
            GenericCapabilitySelections.hasSelections(this.genericCapabilitySelections)
                ? this.genericCapabilitySelections
                : undefined
        ).catch(error => console.error('[fabi-chat] mise en file impossible :', error));
        editor?.document.textEditorModel.setValue('');
        editor?.focus();
    }

    protected abortActiveTurn(): void {
        if (!this.activeTurnId) {
            return;
        }
        const activeRequest = this._chatModel.getRequests().find(request => request.id === this.activeTurnId);
        if (activeRequest && ChatRequestModel.isInProgress(activeRequest)) {
            this._onCancel(activeRequest);
        }
    }

    protected override render(): React.ReactNode {
        // Deux états visuels nets :
        //  - swarm PAS prêt → le sélecteur prend toute la place (gros composant
        //    d'état/choix de modèle) et on NE rend PAS l'input : impossible de
        //    taper/envoyer dans le vide, et pas de champ grisé moche.
        //  - swarm PRÊT → barre de modèle compacte EN HAUT + input réel dessous.
        // (Pas de div wrapper autour de l'input : un conteneur casse le calcul de
        //  largeur de l'éditeur Monaco. Un Fragment n'ajoute aucune boîte.)
        const chatModelAttached = this._chatModel !== undefined;
        if (!shouldRenderChatInput(
            this.ready,
            this.requestInProgress,
            this.inputPreviouslyUnlocked,
            chatModelAttached
        )) {
            return <FabiSwarmSelector frontend={this.swarm} engine={this.engine} locked />;
        }
        const storedPermissionMode = normalizeFabiCodePermissionMode(
            this._chatModel.settings?.[FABI_CODE_PERMISSION_MODE_SETTING]
        );
        const planMode = this.receivingAgent?.currentModeId === 'plan';
        const visiblePermissionMode = planMode ? 'ask' : storedPermissionMode;
        const permissionModeDisabled = planMode || !this.canAcceptInput;
        const branchItems = this._branch?.items;
        const requests = this._chatModel.getRequests();
        const currentRequest = (branchItems && branchItems.length > 0
            ? branchItems[branchItems.length - 1].element
            : undefined) ?? requests[requests.length - 1];
        const canAbortOwner = !!this.activeTurnId && currentRequest?.id !== this.activeTurnId
            && requests.some(request => request.id === this.activeTurnId);
        return (
            <React.Fragment>
                <FabiSwarmSelector frontend={this.swarm} engine={this.engine} />
                {super.render()}
                <FabiModeControlsPortal
                    host={this.node}
                    agentMode={normalizeFabiCodeMode(this.receivingAgent?.currentModeId)}
                    permissionMode={visiblePermissionMode}
                    disabled={!this.canAcceptInput}
                    permissionDisabled={permissionModeDisabled}
                    onAgentModeChange={mode => { void this.handleModeChange(mode); }}
                    onPermissionModeChange={mode => {
                        const mutableModel = this._chatModel as MutableChatModel;
                        mutableModel.setSettings({
                            ...(this._chatModel.settings ?? {}),
                            [FABI_CODE_PERMISSION_MODE_SETTING]: mode
                        });
                        this.update();
                    }}
                />
                {this.requestInProgress && (
                    <FabiQueueControlsPortal
                        host={this.node}
                        editor={this.editor}
                        queuedTurns={this.engine.server.queuedTurns}
                        canAbortOwner={canAbortOwner}
                        onSubmit={() => this.submitQueuedPrompt()}
                        onAbortOwner={() => this.abortActiveTurn()}
                    />
                )}
            </React.Fragment>
        );
    }
}
