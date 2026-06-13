import * as React from '@theia/core/shared/react';
import { FabiLinkGlyph } from './fabi-link-glyph';

/**
 * Illustration d'accueil : la même micro-anim que la vue connexion (deux PC +
 * flux de données), en taille moyenne et en mode « flow » ambiant. Minimaliste,
 * à l'identité de l'IDE (icônes codicon). Cf. FabiLinkGlyph.
 */
export const FabiWelcomeIllustration: React.FC = () => (
    <div className="fabi-wi">
        <FabiLinkGlyph state="flow" size="md" />
    </div>
);
