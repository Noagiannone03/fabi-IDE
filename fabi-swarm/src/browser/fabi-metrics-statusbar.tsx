import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { FabiMetricsDialog } from './fabi-metrics-modal';
import { FabiMetrics } from '../common/fabi-swarm-protocol';

const ITEM_ID = 'fabi-metrics';

/**
 * Petit afficheur de perfs dans la status bar (bas-droite, près des notifs) :
 * `CPU% · RAM%` coloré selon la pression. Clic → modale détaillée. Les données
 * viennent du push onMetricsChanged (backend systeminformation) — aucun poll ici.
 */
@injectable()
export class FabiMetricsStatusBar implements FrontendApplicationContribution {

    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(FabiSwarmFrontend) protected readonly frontend: FabiSwarmFrontend;

    protected dialog: FabiMetricsDialog | undefined;

    onStart(): void {
        void this.render(this.frontend.metrics);
        this.frontend.onMetricsChangedEvent(m => void this.render(m));
    }

    protected async render(m?: FabiMetrics): Promise<void> {
        const text = m
            ? `$(pulse) CPU ${Math.round(m.system.cpu)}% · RAM ${Math.round(m.system.memPct)}%`
            : '$(pulse) Moniteur';
        const color = m?.pressure === 'critical' ? 'var(--theia-errorForeground)'
            : m?.pressure === 'elevated' ? 'var(--theia-editorWarning-foreground)'
                : undefined;
        const tooltip = m
            ? `Machine — CPU ${Math.round(m.system.cpu)} % · RAM ${Math.round(m.system.memPct)} %`
              + (m.worker?.running
                  ? ` · worker ${Math.round(m.worker.cpu)} % / ${m.worker.memGb.toFixed(1)} Go`
                  : ' · worker inactif')
              + ' — clique pour le détail'
            : 'Moniteur Fabi — perfs machine & worker';
        await this.statusBar.setElement(ITEM_ID, {
            text,
            alignment: StatusBarAlignment.RIGHT,
            priority: 900,
            tooltip,
            color,
            onclick: () => this.open()
        });
    }

    protected open(): void {
        // Réutilise une seule instance ; recrée si elle a été fermée/disposée.
        if (!this.dialog || this.dialog.disposed) {
            this.dialog = new FabiMetricsDialog(this.frontend);
        }
        void this.dialog.open();
    }
}
