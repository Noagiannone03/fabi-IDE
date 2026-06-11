import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MonacoThemingService } from '@theia/monaco/lib/browser/monaco-theming-service';
import { fabiIslandsTheme } from './fabi-islands-theme';

/**
 * Enregistre le thème de couleurs « Fabi Islands » (palette îlots sombre +
 * accent orange Fabi) comme thème workbench sélectionnable. On enregistre tôt
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
            label: 'Fabi Islands',
            uiTheme: 'vs-dark',
            json: fabiIslandsTheme as unknown as Record<string, unknown>
        });
    }
}
