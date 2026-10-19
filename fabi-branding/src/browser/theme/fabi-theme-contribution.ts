import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MonacoThemingService } from '@theia/monaco/lib/browser/monaco-theming-service';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { fabiMidnightTheme } from './fabi-midnight-theme';

/** Versioned ID avoids restoring the old desaturated theme from Monaco's
 * IndexedDB cache over the newly registered JSON. Existing Fabi users migrate
 * once; independently selected third-party themes remain selected. */
@injectable()
export class FabiThemeContribution implements FrontendApplicationContribution {

    @inject(MonacoThemingService)
    protected readonly theming: MonacoThemingService;

    @inject(ThemeService) protected readonly themes: ThemeService;

    onStart(): void {
        void this.themes.initialized.then(() => {
            if (this.themes.getCurrentTheme().id === 'fabi-islands') {
                this.themes.setCurrentTheme('fabi-cursor-dark');
            }
        });
    }

    initialize(): void {
        this.theming.registerParsedTheme({
            id: 'fabi-cursor-dark',
            label: 'Fabi · Cursor Dark',
            uiTheme: 'vs-dark',
            json: fabiMidnightTheme as unknown as Record<string, unknown>
        });
    }
}
