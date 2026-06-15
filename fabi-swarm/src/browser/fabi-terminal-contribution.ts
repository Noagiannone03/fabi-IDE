import { injectable } from '@theia/core/shared/inversify';
import { TerminalFrontendContribution } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { TerminalWidget, TerminalWidgetOptions, TerminalLocation } from '@theia/terminal/lib/browser/base/terminal-widget';

/**
 * Ouvre les terminaux comme des ONGLETS de la zone d'édition (main area) par
 * défaut, au lieu du panneau bas. On reste collé au fonctionnement de Theia :
 * le terminal possède déjà une notion de localisation `TerminalLocation.Editor`
 * (→ zone d'édition) vs `Panel` (→ panneau bas), et `open()` route déjà vers
 * `'main'` quand la localisation est `Editor`. Il suffit donc de faire de `Editor`
 * la localisation par défaut des terminaux qu'on crée — aucune réécriture du
 * routage, aucune bidouille.
 *
 * L'utilisateur peut renvoyer un terminal dans le panneau bas (mode classique)
 * via le bouton d'onglet (cf. FabiPanelDockContribution).
 */
@injectable()
export class FabiTerminalFrontendContribution extends TerminalFrontendContribution {

    /**
     * Tout passe par ici (commande « Nouveau terminal », profils via
     * `ShellTerminalProfile.start()` qui appelle `terminalService.newTerminal`,
     * etc.). On force la localisation par défaut à `Editor`, sauf si l'appelant
     * a explicitement demandé une autre localisation (split, viewColumn…).
     */
    override async newTerminal(options: TerminalWidgetOptions): Promise<TerminalWidget> {
        return super.newTerminal({ location: TerminalLocation.Editor, ...options });
    }

    /**
     * Theia pré-crée un terminal dans le panneau bas au tout premier démarrage
     * (layout vierge). On supprime ce pré-amorçage : les terminaux s'ouvrent à la
     * demande, en onglet de la zone d'édition. Un layout déjà sauvegardé est
     * restauré par le LayoutRestorer indépendamment de cette méthode.
     */
    override async initializeLayout(): Promise<void> {
        /* pas de terminal auto dans le panneau bas */
    }

    /**
     * `ctrl+\`` : la version d'origine ne regarde QUE le panneau bas. Comme nos
     * terminaux vivent désormais en zone d'édition, on rend le toggle conscient
     * des deux zones : on cible le dernier terminal utilisé (où qu'il soit),
     * sinon on en ouvre un.
     */
    override toggleTerminal(): void {
        const all = [...this.shell.getWidgets('main'), ...this.shell.getWidgets('bottom')]
            .filter((w): w is TerminalWidget => w instanceof TerminalWidget);
        if (all.length === 0) {
            this.openTerminal();
            return;
        }
        const last = this.lastUsedTerminal;
        const target = last && all.indexOf(last) !== -1 ? last : all[0];
        const area = this.shell.getAreaFor(target);
        if (area === 'bottom') {
            // Panneau bas : déplier / activer / replier (comportement d'origine).
            if (!this.shell.isExpanded('bottom')) {
                this.shell.expandPanel('bottom');
                target.activate();
            } else if (this.shell.activeWidget !== target) {
                target.activate();
            } else {
                this.shell.collapsePanel('bottom');
            }
        } else {
            // Zone d'édition : on ne peut pas « replier » un onglet, on l'active.
            target.activate();
        }
    }
}
