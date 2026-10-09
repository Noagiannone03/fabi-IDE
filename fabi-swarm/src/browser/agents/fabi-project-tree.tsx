// Barre « Projets » : l'explorateur de fichiers de Theia, étendu (pas réécrit).
//
// Chaque dossier du workspace devient une carte dépliable avec deux sections :
//   ▾ Agents IA  — les agents qui travaillent dans ce dossier (statut, non lu) ;
//   ▾ Code       — l'arbre de fichiers habituel.
//
// « Code » est un vrai DirNode qui porte l'URI du dossier racine : tout ce que
// l'explorateur sait faire (menus, glisser-déposer, décorations git, création de
// fichiers, filtres) continue de fonctionner tel quel. Les ids de ses enfants
// restent ceux de Theia (`<racine>:<chemin>`), donc reveal/refresh aussi.

import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { CommandService } from '@theia/core';
import URI from '@theia/core/lib/common/uri';
import { Path } from '@theia/core/lib/common/path';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import {
    CompositeTreeNode, ExpandableTreeNode, NodeProps, SelectableTreeNode, TreeNode
} from '@theia/core/lib/browser';
import { DirNode } from '@theia/filesystem/lib/browser';
import { FileNavigatorTree, WorkspaceRootNode } from '@theia/navigator/lib/browser/navigator-tree';
import { FileNavigatorModel } from '@theia/navigator/lib/browser/navigator-model';
import { FileNavigatorWidget } from '@theia/navigator/lib/browser/navigator-widget';
import { FabiAgentRow, FabiAgentsModel } from './fabi-agents-model';
import { FABI_NEW_AGENT_COMMAND } from './fabi-agent-terminals';
import { FabiAgentLogo } from './fabi-agent-picker';

export interface FabiCodeSectionNode extends DirNode {
    fabiSection: 'code';
}
export namespace FabiCodeSectionNode {
    export function is(node: unknown): node is FabiCodeSectionNode {
        return DirNode.is(node) && (node as Partial<FabiCodeSectionNode>).fabiSection === 'code';
    }
}

export interface FabiAgentsSectionNode extends ExpandableTreeNode, SelectableTreeNode {
    fabiSection: 'agents';
    root: URI;
}
export namespace FabiAgentsSectionNode {
    export function is(node: unknown): node is FabiAgentsSectionNode {
        return CompositeTreeNode.is(node) && (node as Partial<FabiAgentsSectionNode>).fabiSection === 'agents';
    }
}

export interface FabiAgentNode extends SelectableTreeNode {
    agent: FabiAgentRow;
}
export namespace FabiAgentNode {
    export function is(node: unknown): node is FabiAgentNode {
        return !!node && typeof node === 'object' && 'agent' in node;
    }
}

/** Dernière ligne de la section Agents : « + Nouvel agent ». */
export interface FabiNewAgentNode extends SelectableTreeNode {
    newAgentIn: URI;
}
export namespace FabiNewAgentNode {
    export function is(node: unknown): node is FabiNewAgentNode {
        return !!node && typeof node === 'object' && 'newAgentIn' in node;
    }
}

@injectable()
export class FabiNavigatorTree extends FileNavigatorTree {

    @inject(FabiAgentsModel) protected readonly agents: FabiAgentsModel;

    @postConstruct()
    protected override init(): void {
        super.init();
        this.toDispose.push(this.agents.onDidChange(() => this.refreshAgentSections()));
    }

    /** Le dossier racine est toujours visible : c'est la carte du projet. */
    override async createWorkspaceRoot(rootFolder: Parameters<FileNavigatorTree['createWorkspaceRoot']>[0],
        workspaceNode: Parameters<FileNavigatorTree['createWorkspaceRoot']>[1]): Promise<WorkspaceRootNode> {
        const node = await super.createWorkspaceRoot(rootFolder, workspaceNode);
        return Object.assign(node, { visible: true });
    }

    override async resolveChildren(parent: CompositeTreeNode): Promise<TreeNode[]> {
        if (WorkspaceRootNode.is(parent)) {
            return [this.agentsSection(parent), this.codeSection(parent)];
        }
        if (FabiAgentsSectionNode.is(parent)) {
            const launcher: FabiNewAgentNode = {
                id: `${parent.id}:new`, name: 'Nouvel agent', parent, newAgentIn: parent.root, selected: false
            };
            return [...this.agents.rowsFor(parent.root).map(agent => this.agentNode(parent, agent)), launcher];
        }
        return super.resolveChildren(parent);
    }

    protected agentsSection(root: WorkspaceRootNode): FabiAgentsSectionNode {
        const id = `${root.id}#agents`;
        const existing = this.getNode(id);
        if (FabiAgentsSectionNode.is(existing)) {
            return existing;
        }
        return {
            id, name: 'Agents IA', parent: root, root: root.uri,
            fabiSection: 'agents', children: [], expanded: true, selected: false
        };
    }

    protected codeSection(root: WorkspaceRootNode): FabiCodeSectionNode {
        const id = `${root.id}#code`;
        const existing = this.getNode(id);
        if (FabiCodeSectionNode.is(existing)) {
            existing.fileStat = root.fileStat;
            return existing;
        }
        return {
            id, name: 'Code', parent: root, uri: root.uri, fileStat: root.fileStat,
            // Replié par défaut : les agents sont au premier plan, le code s'ouvre à la demande.
            fabiSection: 'code', children: [], expanded: false, selected: false
        };
    }

    protected agentNode(parent: FabiAgentsSectionNode, agent: FabiAgentRow): FabiAgentNode {
        const id = `${parent.id}:${agent.key}`;
        const existing = this.getNode(id);
        if (FabiAgentNode.is(existing)) {
            existing.agent = agent;
            return existing;
        }
        return { id, name: agent.title, parent, agent, selected: false };
    }

    protected refreshAgentSections(): void {
        const root = this.root;
        if (!CompositeTreeNode.is(root)) {
            return;
        }
        for (const workspaceRoot of root.children) {
            const section = this.getNode(`${workspaceRoot.id}#agents`);
            if (FabiAgentsSectionNode.is(section)) {
                void this.refresh(section);
            }
        }
    }
}

@injectable()
export class FabiNavigatorModel extends FileNavigatorModel {

    @inject(FabiAgentsModel) protected readonly agents: FabiAgentsModel;
    @inject(CommandService) protected readonly commands: CommandService;

    protected override doOpenNode(node: TreeNode): void {
        if (FabiAgentNode.is(node)) {
            void this.agents.open(node.agent);
            return;
        }
        if (FabiNewAgentNode.is(node)) {
            void this.commands.executeCommand(FABI_NEW_AGENT_COMMAND, node.newAgentIn);
            return;
        }
        super.doOpenNode(node);
    }

    /** Le fichier vit sous la section « Code » : on la déplie avant de le révéler. */
    override async revealFile(uri: URI): Promise<TreeNode | undefined> {
        if (CompositeTreeNode.is(this.root)) {
            for (const root of this.root.children) {
                if (WorkspaceRootNode.is(root) && root.uri.isEqualOrParent(uri)) {
                    if (!root.expanded) {
                        await this.expandNode(root);
                    }
                    const code = this.getNode(`${root.id}#code`);
                    if (ExpandableTreeNode.is(code) && !code.expanded) {
                        await this.expandNode(code);
                    }
                }
            }
        }
        return super.revealFile(uri);
    }
}

const STATE_LABEL: Record<FabiAgentRow['state'], string> = {
    working: 'Travaille…',
    permission: 'Attend ta validation',
    done: 'Terminé',
    idle: 'Au repos',
    error: 'Échec'
};

@injectable()
export class FabiNavigatorWidget extends FileNavigatorWidget {

    @inject(FabiAgentsModel) protected readonly agents: FabiAgentsModel;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    /** Dossier personnel, pour afficher « ~/Documents » sous le nom du projet. */
    protected home = '';

    @postConstruct()
    protected override init(): void {
        super.init();
        void this.env.getHomeDirUri().then(home => {
            this.home = new URI(home).path.fsPath();
            this.update();
        });
    }

    protected override tapNode(node?: TreeNode): void {
        super.tapNode(node);
        if (FabiAgentNode.is(node)) {
            void this.agents.open(node.agent);
        } else if (FabiNewAgentNode.is(node)) {
            void this.commands.executeCommand(FABI_NEW_AGENT_COMMAND, node.newAgentIn);
        }
    }

    protected override toNodeName(node: TreeNode): string {
        return FabiCodeSectionNode.is(node) ? 'Code' : super.toNodeName(node);
    }

    protected override createNodeClassNames(node: TreeNode, props: NodeProps): string[] {
        const classes = super.createNodeClassNames(node, props);
        if (WorkspaceRootNode.is(node)) {
            classes.push('fabi-project-root');
        } else if (FabiAgentsSectionNode.is(node) || FabiCodeSectionNode.is(node)) {
            classes.push('fabi-project-section');
        } else if (FabiNewAgentNode.is(node)) {
            classes.push('fabi-new-agent-node');
        } else if (FabiAgentNode.is(node)) {
            classes.push('fabi-agent-node', `fabi-agent-${node.agent.state}`);
            if (node.agent.unread) {
                classes.push('fabi-agent-unread');
            }
        }
        return classes;
    }

    protected override renderIcon(node: TreeNode, props: NodeProps): React.ReactNode {
        if (WorkspaceRootNode.is(node)) {
            return <div className='fabi-project-tile'><span className='codicon codicon-folder' /></div>;
        }
        if (FabiNewAgentNode.is(node)) {
            return <div className='fabi-new-agent-glyph codicon codicon-add' />;
        }
        if (FabiAgentsSectionNode.is(node)) {
            return <div className='fabi-section-glyph codicon codicon-sparkle' />;
        }
        if (FabiCodeSectionNode.is(node)) {
            return <div className='fabi-section-glyph codicon codicon-code' />;
        }
        if (FabiAgentNode.is(node)) {
            return <div className='fabi-agent-avatar' title={STATE_LABEL[node.agent.state]}>
                {node.agent.kind === 'fabi'
                    ? <span className='codicon codicon-comment-discussion' />
                    : <FabiAgentLogo cli={node.agent.kind} />}
                <span className='fabi-agent-status' />
            </div>;
        }
        return super.renderIcon(node, props);
    }

    protected override renderCaption(node: TreeNode, props: NodeProps): React.ReactNode {
        if (WorkspaceRootNode.is(node)) {
            return <div className='theia-TreeNodeSegment theia-TreeNodeSegmentGrow fabi-project-caption'>
                <span className='fabi-project-name'>{this.toNodeName(node)}</span>
                <span className='fabi-project-path'>{Path.tildify(node.uri.parent.path.fsPath(), this.home)}</span>
            </div>;
        }
        if (FabiAgentNode.is(node)) {
            const { agent } = node;
            return <div className='theia-TreeNodeSegment theia-TreeNodeSegmentGrow fabi-agent-caption'
                title={agent.preview ? `${agent.title}\n${agent.preview}` : agent.title}>
                <span className='fabi-agent-title'>{agent.title}</span>
                <span className='fabi-agent-subtitle'>{STATE_LABEL[agent.state]}</span>
            </div>;
        }
        return super.renderCaption(node, props);
    }

    protected override renderTailDecorations(node: TreeNode, props: NodeProps): React.ReactNode {
        if (FabiAgentsSectionNode.is(node)) {
            const total = this.agents.rowsFor(node.root).length;
            return total ? <span className='fabi-section-count'>{total}</span> : undefined;
        }
        if (WorkspaceRootNode.is(node)) {
            const folder = node.uri;
            const count = this.agents.rowsFor(folder).filter(agent => agent.unread || agent.state === 'permission').length;
            return <div className='fabi-project-actions'>
                {count > 0 && <span className='fabi-project-badge'>{count}</span>}
                <button className='fabi-project-add codicon codicon-add' title='Nouvel agent IA'
                    aria-label='Nouvel agent IA'
                    onMouseDown={event => event.stopPropagation()}
                    onClick={event => {
                        event.stopPropagation();
                        void this.commands.executeCommand(FABI_NEW_AGENT_COMMAND, folder);
                    }} />
            </div>;
        }
        if (FabiAgentNode.is(node)) {
            return node.agent.unread ? <span className='fabi-agent-dot' aria-label='Non lu' /> : undefined;
        }
        return super.renderTailDecorations(node, props);
    }
}
