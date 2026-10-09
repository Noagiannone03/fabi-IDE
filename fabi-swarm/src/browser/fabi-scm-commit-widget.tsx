import * as React from '@theia/core/shared/react';
import { inject, injectable } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
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

    constructor(@inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer) {
        super(contextMenuRenderer);
    }

    protected override renderInput(input: ScmInput): React.ReactNode {
        return <div className='fabi-commit-input'>
            {super.renderInput(input)}
            <button className={'fabi-commit-generate codicon ' + (this.generating ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle')}
                title='Rédiger le message avec l’IA' aria-label='Rédiger le message avec l’IA'
                disabled={this.generating || !input.enabled}
                onClick={() => void this.generate(input)} />
        </div>;
    }

    protected async generate(input: ScmInput): Promise<void> {
        const root = this.scmService.selectedRepository?.provider.rootUri;
        if (!root) {
            return;
        }
        this.generating = true;
        this.update();
        try {
            input.value = await this.agentClis.commitMessage(new URI(root).path.fsPath());
            this.focus();
        } catch (error) {
            void this.messages.warn(error instanceof Error ? error.message : String(error));
        } finally {
            this.generating = false;
            this.update();
        }
    }
}
