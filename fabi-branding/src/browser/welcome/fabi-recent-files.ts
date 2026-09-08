import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { NavigatableWidget } from '@theia/core/lib/browser/navigatable-types';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { DisposableCollection, Emitter } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';

/** Small, workspace-scoped MRU. No filesystem scan or polling. */
@injectable()
export class FabiRecentFiles implements FrontendApplicationContribution {
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(StorageService) protected readonly storage: StorageService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    protected readonly disposables = new DisposableCollection();
    protected readonly changed = new Emitter<void>();
    readonly onDidChange = this.changed.event;
    protected entries: string[] = [];
    protected storageKey: string | undefined;
    protected generation = 0;
    protected writes: Promise<void> = Promise.resolve();
    get files(): readonly string[] { return this.entries; }

    async onStart(): Promise<void> {
        await this.workspace.ready;
        this.disposables.push(this.workspace.onWorkspaceChanged(() => void this.restore()));
        this.disposables.push(this.shell.onDidChangeActiveWidget(() => this.recordCurrent()));
        await this.restore();
    }

    protected accepts(value: string): boolean {
        try {
            const uri = new URI(value);
            return uri.scheme !== 'untitled' && uri.scheme !== 'diff'
                && !uri.query && !uri.fragment && !!this.workspace.getWorkspaceRootUri(uri);
        } catch { return false; }
    }

    protected async restore(): Promise<void> {
        const generation = ++this.generation;
        const workspace = this.workspace.workspace;
        this.storageKey = undefined;
        this.entries = [];
        this.changed.fire();
        if (!workspace) { return; }
        const key = `fabi.midnight.recent-files:${workspace.resource.toString()}`;
        let saved: unknown;
        try {
            // A root update can race the last MRU write for this workspace.
            await this.writes;
            saved = await this.storage.getData<unknown>(key);
        }
        catch { saved = []; }
        if (generation !== this.generation) { return; }
        this.storageKey = key;
        this.entries = Array.isArray(saved)
            ? Array.from(new Set(saved.filter((value): value is string => typeof value === 'string' && this.accepts(value)))).slice(0, 12)
            : [];
        this.recordCurrent();
        this.changed.fire();
    }

    protected recordCurrent(): void {
        const widget = this.shell.activeWidget;
        if (!this.storageKey || !NavigatableWidget.is(widget)) { return; }
        const value = widget.getResourceUri()?.toString();
        if (!value || !this.accepts(value) || this.entries[0] === value) { return; }
        this.entries = [value, ...this.entries.filter(entry => entry !== value)].slice(0, 12);
        this.persist();
        this.changed.fire();
    }

    forget(value: string): void {
        this.entries = this.entries.filter(entry => entry !== value);
        this.persist();
        this.changed.fire();
    }

    protected persist(): void {
        const key = this.storageKey;
        const snapshot = [...this.entries];
        if (!key) { return; }
        this.writes = this.writes.then(() => this.storage.setData(key, snapshot))
            .catch(error => console.warn('[fabi] Historique local non enregistré', error));
    }

    onStop(): void {
        this.generation++;
        this.disposables.dispose();
        this.changed.dispose();
    }
}
