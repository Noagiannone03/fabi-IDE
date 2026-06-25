import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplicationContribution, Widget, WidgetManager } from '@theia/core/lib/browser';
import { MaestroWidget } from './maestro-widget';

/**
 * Bascule le frontend Theia en « mode maestro » quand l'URL porte `?maestro=1`
 * (cf. fabi-spaces → buildFrontendUrl pour le Space Maestro).
 *
 * Disposition : la LISTE des agents (MaestroWidget) occupe une barre latérale
 * gauche étroite ; la ZONE PRINCIPALE reçoit le VRAI widget de l'agent sélectionné
 * (terminal rattaché au PTY pour Claude/Codex, vue de conversation pour Fabi AI) —
 * pas un iframe du workspace. On masque tout le reste du chrome (menu, status bar,
 * barre d'activité, onglets, panneaux droite/bas).
 *
 * Chargée dans TOUS les frontends mais inerte hors mode maestro.
 */
@injectable()
export class MaestroModeContribution implements FrontendApplicationContribution {

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(WidgetManager) protected readonly widgetManager: WidgetManager;

    protected maestro = false;

    initialize(): void {
        this.maestro = this.detectMaestro();
        if (this.maestro) {
            document.body.classList.add('fabi-maestro-mode');
        }
    }

    protected detectMaestro(): boolean {
        try {
            return new URLSearchParams(window.location.search).get('maestro') === '1';
        } catch {
            return false;
        }
    }

    async onDidInitializeLayout(): Promise<void> {
        if (!this.maestro) {
            return;
        }
        this.closeIntruders();
        // Maestro = UN SEUL widget plein écran dans la zone principale (il dessine
        // lui-même sa liste + sa scène). Tout le reste du shell est masqué en CSS.
        const widget = await this.widgetManager.getOrCreateWidget(MaestroWidget.ID);
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);

        // Garde-fou : d'autres contributions (chat, accueil, outline…) peuvent ouvrir
        // des widgets. On ferme tout SAUF le widget Maestro. (Le terminal embarqué
        // n'est PAS dans le shell — il est attaché dans la scène — donc épargné.)
        this.shell.onDidAddWidget(w => this.evict(w));
        setTimeout(() => this.closeIntruders(), 0);
        setTimeout(() => this.closeIntruders(), 300);
    }

    /** Seul le widget Maestro est légitime dans le shell en mode maestro. */
    protected isAllowed(widget: Widget): boolean {
        return widget.id === MaestroWidget.ID;
    }

    protected closeIntruders(): void {
        for (const area of ['main', 'left', 'right', 'bottom'] as ApplicationShell.Area[]) {
            for (const widget of [...this.shell.getWidgets(area)]) {
                this.evict(widget);
            }
        }
    }

    protected evict(widget: Widget): void {
        if (this.maestro && !this.isAllowed(widget)) {
            setTimeout(() => widget.close(), 0);
        }
    }
}
