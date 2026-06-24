// Pont éditeur du moteur fabi-code.
//
// Les outils d'OpenCode éditent les fichiers DIRECTEMENT sur le disque (ils ne
// connaissent pas l'éditeur). Ce pont rend ces changements VISIBLES, façon
// Cursor/Cline : quand un outil touche un fichier (event `file.edited`), on
// ouvre le fichier dans l'éditeur et on scrolle dessus. Le contenu du diff
// lui-même est affiché dans la carte d'outil du chat (sortie de l'outil edit).
//
// (La sauvegarde des buffers AVANT un tour est faite côté FabiCodeAgent via
//  core.saveAll, pour qu'OpenCode lise toujours l'état à jour du disque.)

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { FabiCodeFrontend } from './fabi-code-frontend';

@injectable()
export class FabiCodeEditorBridge implements FrontendApplicationContribution {

    @inject(FabiCodeFrontend) protected readonly engine: FabiCodeFrontend;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    /** Anti-spam : ne pas ré-ouvrir/scroller le même fichier en rafale. */
    protected lastOpened = new Map<string, number>();

    onStart(): void {
        this.engine.onFileEditedEvent(e => void this.revealEdited(e.path).catch(() => undefined));
    }

    /** Transforme un chemin OpenCode (absolu, ou relatif au workspace) en URI Theia. */
    protected toUri(path: string): URI | undefined {
        const root = this.workspace.tryGetRoots()[0];
        if (path.startsWith('/')) {
            // Chemin absolu : on garde le schéma/authority de la racine (file://…).
            return root ? root.resource.withPath(path) : new URI(`file://${path}`);
        }
        // Chemin relatif → résolu contre la racine du workspace.
        return root ? root.resource.resolve(path) : undefined;
    }

    protected async revealEdited(path: string): Promise<void> {
        const uri = this.toUri(path);
        if (!uri) {
            return;
        }
        // Débounce : un même fichier édité plusieurs fois dans la même seconde
        // n'est révélé qu'une fois (évite le clignotement pendant un gros edit).
        const key = uri.toString();
        const now = Date.now();
        const last = this.lastOpened.get(key) ?? 0;
        if (now - last < 800) {
            return;
        }
        this.lastOpened.set(key, now);

        // mode 'reveal' : amène l'onglet au premier plan SANS voler le focus du
        // champ de chat (l'utilisateur continue à dialoguer). preview = onglet léger.
        await this.editors.open(uri, {
            mode: 'reveal',
            preview: true,
            revealOption: 'center'
        });
    }
}
