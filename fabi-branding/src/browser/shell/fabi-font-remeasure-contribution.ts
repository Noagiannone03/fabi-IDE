/*
 * Monaco peut mesurer le fallback système avant le chargement de JetBrains Mono puis
 * conserver ces métriques. On charge les faces nécessaires explicitement avant
 * de demander à Monaco de recalculer toutes ses métriques de texte.
 */

import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import * as monaco from '@theia/monaco-editor-core';

@injectable()
export class FabiFontRemeasureContribution implements FrontendApplicationContribution {

    protected loading: Promise<void> | undefined;
    protected readonly onFontsLoaded = () => this.remeasure();

    onStart(): void {
        document.fonts?.addEventListener?.('loadingdone', this.onFontsLoaded);
        void this.loadFonts();
    }

    onDidInitializeLayout(): void {
        void this.loadFonts().then(() => this.remeasure());
    }

    onStop(): void {
        document.fonts?.removeEventListener?.('loadingdone', this.onFontsLoaded);
    }

    protected loadFonts(): Promise<void> {
        if (!this.loading) {
            this.loading = this.doLoadFonts();
        }
        return this.loading;
    }

    protected async doLoadFonts(): Promise<void> {
        const fonts = document.fonts;
        if (!fonts) {
            return;
        }

        await Promise.all([
            fonts.load("400 13px 'Fabi UI'"),
            fonts.load("500 13px 'Fabi UI'"),
            fonts.load("600 13px 'Fabi UI'"),
            fonts.load("400 13px 'JetBrains Mono'"),
            fonts.load("italic 400 13px 'JetBrains Mono'"),
            fonts.load("500 13px 'JetBrains Mono'"),
            fonts.load("600 13px 'JetBrains Mono'"),
            fonts.load("700 13px 'JetBrains Mono'")
        ]);
        await fonts.ready;
        document.documentElement.classList.add('fabi-fonts-ready');
    }

    protected remeasure(): void {
        requestAnimationFrame(() => monaco.editor.remeasureFonts());
    }
}
