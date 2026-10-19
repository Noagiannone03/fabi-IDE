import * as React from '@theia/core/shared/react';
import { inject, injectable } from '@theia/core/shared/inversify';
import { generateUuid, MessageService } from '@theia/core';
import URI from '@theia/core/lib/common/uri';
import { ContextMenuRenderer } from '@theia/core/lib/browser';
import { ScmCommitWidget } from '@theia/scm/lib/browser/scm-commit-widget';
import { ScmInput } from '@theia/scm/lib/browser/scm-input';
import { FabiAgentCliService } from '../common/fabi-agent-cli-protocol';

/** Champ de commit Git de Theia + bouton ✨ « rédiger le message avec l'IA ». */
@injectable()
export class FabiScmCommitWidget extends ScmCommitWidget {

    @inject(FabiAgentCliService) protected readonly agentClis: FabiAgentCliService;
    @inject(MessageService) protected readonly messages: MessageService;

    protected generating = false;
    private generationId?: string;

    constructor(@inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer) {
        super(contextMenuRenderer);
    }

    protected override renderInput(input: ScmInput): React.ReactNode {
        return <div className='fabi-commit-input'>
            {super.renderInput(input)}
            <button className={'fabi-commit-generate codicon ' + (this.generating ? 'codicon-debug-stop' : 'codicon-sparkle')}
                title={this.generating ? 'Annuler la génération' : 'Rédiger le message avec l’IA'} aria-label={this.generating ? 'Annuler la génération' : 'Rédiger le message avec l’IA'}
                disabled={!input.enabled}
                onClick={() => this.generating ? void this.cancelGeneration() : void this.generate(input)} />
            {this.generating && <span className='fabi-commit-status' role='status'>Rédaction du message…</span>}
        </div>;
    }

    private async cancelGeneration(): Promise<void> {
        const id = this.generationId;
        this.generationId = undefined; this.generating = false; this.update();
        if (id) await this.agentClis.cancelCommitMessage(id);
    }

    protected async generate(input: ScmInput): Promise<void> {
        const root = this.scmService.selectedRepository?.provider.rootUri;
        if (!root) {
            return;
        }
        if (this.generating) return;
        const id = generateUuid();
        this.generationId = id;
        const original = input.value;
        this.generating = true;
        this.update();
        try {
            const message = await this.agentClis.commitMessage(new URI(root).path.fsPath(), id);
            if (this.generationId === id && input.value === original && this.scmService.selectedRepository?.provider.rootUri === root) { input.value = message; this.focus(); }
        } catch (error) {
            if (this.generationId === id) void this.messages.warn(error instanceof Error ? error.message : String(error));
        } finally {
            if (this.generationId === id) { this.generating = false; this.generationId = undefined; this.update(); }
        }
    }
}
