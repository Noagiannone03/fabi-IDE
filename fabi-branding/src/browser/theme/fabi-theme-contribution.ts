import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MonacoThemingService } from '@theia/monaco/lib/browser/monaco-theming-service';
import { fabiMidnightTheme } from './fabi-midnight-theme';

/**
 * Enregistre le thème « Fabi Midnight » avec l'identifiant historique conservé
 * pour les préférences des workspaces existants. On enregistre tôt
 * (`initialize`) pour qu'il soit dispo quand le ThemeService applique le thème
 * par défaut configuré dans les préférences (`workbench.colorTheme: fabi-islands`).
 */
@injectable()
export class FabiThemeContribution implements FrontendApplicationContribution {

    @inject(MonacoThemingService)
    protected readonly theming: MonacoThemingService;

    initialize(): void {
        this.theming.registerParsedTheme({
            id: 'fabi-islands',
            // Keep the persisted ID so existing workspaces receive the redesign.
            label: 'Fabi Midnight',
            uiTheme: 'vs-dark',
            json: fabiMidnightTheme as unknown as Record<string, unknown>
        });
    }
}
