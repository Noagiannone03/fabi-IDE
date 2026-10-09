// Agents CLI lançables depuis la barre « Projets » (bouton + d'un dossier).
//
// Même modèle que la table `builtin-terminal-agents` de Superset : une commande
// de lancement et une commande de reprise par agent. La commande est tapée dans
// un vrai terminal Theia (onglet de la zone de code). La reprise relance la
// conversation exacte quand on connaît son id de session (hooks), sinon la plus
// récente du dossier.

/** Variable d'env posée sur le PTY d'un agent : relayée par le client de hooks
 * pour rattacher EXACTEMENT une session Claude/Codex à son onglet de terminal. */
export const FABI_AGENT_TERMINAL_ENV = 'FABI_AGENT_TERMINAL';

/** Préfixe des ids de widget des terminaux d'agents (reste un `terminal-*`). */
export const FABI_AGENT_TERMINAL_PREFIX = 'terminal-agent-';

export type FabiAgentCliId = 'claude' | 'codex' | 'opencode' | 'gemini';

export interface FabiAgentCli {
    id: FabiAgentCliId;
    label: string;
    description: string;
    /** Installation, proposée quand la CLI est absente du PATH. */
    install: string;
    /** Commande de lancement. `sessionId` n'est fourni qu'aux CLI qui l'acceptent. */
    start(sessionId: string): string;
    /** Commande de reprise : session exacte si connue, sinon la dernière du dossier. */
    resume(sessionId?: string): string;
    /** L'agent accepte-t-il un id de session imposé au lancement ? */
    presetSession: boolean;
}

export const FABI_AGENT_CLIS: readonly FabiAgentCli[] = [
    {
        id: 'claude',
        label: 'Claude Code',
        description: 'Anthropic',
        install: 'npm i -g @anthropic-ai/claude-code',
        presetSession: true,
        start: id => `claude --session-id ${id}`,
        resume: id => id ? `claude --resume ${id}` : 'claude --continue'
    },
    {
        id: 'codex',
        label: 'Codex',
        description: 'OpenAI',
        install: 'npm i -g @openai/codex',
        presetSession: false,
        start: () => 'codex',
        resume: id => id ? `codex resume ${id}` : 'codex resume --last'
    },
    {
        id: 'opencode',
        label: 'OpenCode',
        description: 'sst',
        install: 'npm i -g opencode-ai',
        presetSession: false,
        start: () => 'opencode',
        resume: id => id ? `opencode --session ${id}` : 'opencode --continue'
    },
    {
        id: 'gemini',
        label: 'Gemini CLI',
        description: 'Google',
        install: 'npm i -g @google/gemini-cli',
        presetSession: false,
        start: () => 'gemini',
        resume: () => 'gemini --resume'
    }
];

export function agentCli(id: string | undefined): FabiAgentCli | undefined {
    return FABI_AGENT_CLIS.find(cli => cli.id === id);
}
