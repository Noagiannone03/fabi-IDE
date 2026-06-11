import { injectable } from '@theia/core/shared/inversify';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { ColorRegistry } from '@theia/core/lib/browser/color-registry';
import { FABI_COLORS } from '../../common/fox';

/**
 * Injecte les couleurs de marque Fabi dans le système de thèmes.
 *
 * On enregistre :
 *  - des tokens Fabi propres (`fabi.brand.*`) réutilisables par nos widgets ;
 *  - des valeurs par défaut sur des accents que les thèmes laissent souvent
 *    indéfinis (bordure active de l'activity bar, liseré d'onglet actif,
 *    barre de progression, liens…), pour teinter l'UI en orange Fabi.
 *
 * Note : un thème explicite peut surcharger ces accents — le retint « dur »
 * des surfaces clés se fait en complément via la feuille de style (index.css).
 */
@injectable()
export class FabiColorContribution implements ColorContribution {

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
            // --- Accents UI teintés Fabi (defaults seulement) ---
            {
                id: 'activityBar.activeBorder',
                defaults: { dark: FABI_COLORS.orange, light: FABI_COLORS.orange },
                description: 'Bordure de l’icône active dans l’activity bar'
            },
            {
                id: 'activityBar.activeFocusBorder',
                defaults: { dark: FABI_COLORS.orange, light: FABI_COLORS.orange },
                description: 'Bordure focus de l’icône active dans l’activity bar'
            },
            {
                id: 'tab.activeBorderTop',
                defaults: { dark: FABI_COLORS.orange, light: FABI_COLORS.orange },
                description: 'Liseré supérieur de l’onglet actif'
            },
            {
                id: 'progressBar.background',
                defaults: { dark: FABI_COLORS.orange, light: FABI_COLORS.orange },
                description: 'Barre de progression'
            },
            {
                id: 'textLink.foreground',
                defaults: { dark: FABI_COLORS.orangeHover, light: FABI_COLORS.orangeDeep },
                description: 'Couleur des liens'
            },
            {
                id: 'textLink.activeForeground',
                defaults: { dark: FABI_COLORS.yellow, light: FABI_COLORS.orange },
                description: 'Couleur des liens actifs'
            }
        );
    }
}
