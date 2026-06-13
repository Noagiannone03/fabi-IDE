import { injectable } from '@theia/core/shared/inversify';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { ColorRegistry } from '@theia/core/lib/browser/color-registry';
import { FABI_COLORS } from '../../common/fox';

/**
 * Injecte les couleurs de marque Fabi dans le système de thèmes.
 *
 * On enregistre :
 *  - des tokens Fabi propres (`fabi.brand.*`) réutilisables par nos widgets ;
 *  - des valeurs neutres par défaut sur les accents UI que les thèmes laissent
 *    souvent indéfinis. L'orange reste réservé aux assets de logo.
 *
 * Note : un thème explicite peut surcharger ces accents — le retint « dur »
 * des surfaces clés se fait en complément via la feuille de style (index.css).
 */
@injectable()
export class FabiColorContribution implements ColorContribution {

    protected readonly neutralAccent = '#8a9099';
    protected readonly neutralAccentHover = '#aab0b8';
    protected readonly neutralAccentActive = '#cfd1d6';

    registerColors(colors: ColorRegistry): void {
        colors.register(
            // --- Tokens de marque Fabi ---
            {
                id: 'fabi.brand.orange',
                defaults: { dark: FABI_COLORS.orange, light: FABI_COLORS.orange },
                description: 'Orange de marque Fabi'
            },
            {
                id: 'fabi.brand.orangeHover',
                defaults: { dark: FABI_COLORS.orangeHover, light: FABI_COLORS.orangeHover },
                description: 'Orange Fabi (survol)'
            },
            // --- Accents UI neutres (defaults seulement) ---
            {
                id: 'activityBar.activeBorder',
                defaults: { dark: this.neutralAccent, light: this.neutralAccent },
                description: 'Bordure de l’icône active dans l’activity bar'
            },
            {
                id: 'activityBar.activeFocusBorder',
                defaults: { dark: this.neutralAccent, light: this.neutralAccent },
                description: 'Bordure focus de l’icône active dans l’activity bar'
            },
            {
                id: 'tab.activeBorderTop',
                defaults: { dark: this.neutralAccent, light: this.neutralAccent },
                description: 'Liseré supérieur de l’onglet actif'
            },
            {
                id: 'progressBar.background',
                defaults: { dark: this.neutralAccent, light: this.neutralAccent },
                description: 'Barre de progression'
            },
            {
                id: 'textLink.foreground',
                defaults: { dark: this.neutralAccentHover, light: this.neutralAccent },
                description: 'Couleur des liens'
            },
            {
                id: 'textLink.activeForeground',
                defaults: { dark: this.neutralAccentActive, light: this.neutralAccentHover },
                description: 'Couleur des liens actifs'
            }
        );
    }
}
