// Opérations qui passent par les CLI d'agents installées chez l'utilisateur
// (Claude Code, Codex…) : détection, et message de commit rédigé par l'IA.

import { FabiAgentCliId } from './fabi-agent-clis';

export const FABI_AGENT_CLI_PATH = '/services/fabi-agent-cli';
export const FabiAgentCliService = Symbol('FabiAgentCliService');

export interface FabiAgentCliService {
    /** CLI d'agents trouvées dans le PATH de l'utilisateur (shell de login). */
    installed(): Promise<FabiAgentCliId[]>;

    /**
     * Rédige un message pour les changements indexés du dépôt (à défaut, pour
     * les changements non indexés). `repositoryPath` = chemin FS de la racine git.
     */
    commitMessage(repositoryPath: string): Promise<string>;
}
