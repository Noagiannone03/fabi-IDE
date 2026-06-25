// FabiFontRemeasureContribution — corrige le bug « la police de l'éditeur ne
// s'applique pas ».
//
// Monaco MESURE la largeur des caractères de la police au moment où l'éditeur est
// créé. Si la webfont (JetBrains Mono) n'est pas ENCORE chargée à cet instant
// (les @font-face, même inlinées en data:, se chargent de façon asynchrone), monaco
// mesure la police de FALLBACK et n'utilise plus jamais JetBrains Mono — Theia ne
// re-mesure pas les polices après leur chargement. Résultat : l'éditeur reste sur
// le fallback (SF Mono/Menlo) → « la police n'a pas changé ».
//
// Fix : on attend explicitement que les polices soient chargées (CSS Font Loading
// API) puis on appelle `monaco.editor.remeasureFonts()` → monaco re-mesure et
// applique enfin JetBrains Mono. Filets de sécurité par timeout.

import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import * as monaco from '@theia/monaco-editor-core';

@injectable()
export class FabiFontRemeasureContribution implements FrontendApplicationContribution {

    onDidInitializeLayout(): void {
        const remeasure = () => {
            try {
                monaco.editor.remeasureFonts();
            } catch {
                /* monaco pas encore prêt — les timeouts rattraperont */
            }
        };

        const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts;
        if (fonts && typeof fonts.load === 'function') {
            Promise.all([
                fonts.load("400 13px 'JetBrains Mono'"),
                fonts.load("500 13px 'JetBrains Mono'"),
                fonts.load("700 13px 'JetBrains Mono'"),
                fonts.load("400 13px 'Inter'")
            ]).then(remeasure, remeasure);
            if (fonts.ready) {
                fonts.ready.then(remeasure, () => { /* noop */ });
            }
        }

        // Filets de sécurité (au cas où l'éditeur s'ouvre après le 1er remeasure).
        window.setTimeout(remeasure, 800);
        window.setTimeout(remeasure, 2500);
    }
}
