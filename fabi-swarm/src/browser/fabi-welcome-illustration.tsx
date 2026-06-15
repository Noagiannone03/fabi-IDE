import * as React from '@theia/core/shared/react';
import { FabiWelcomeAnim } from './fabi-welcome-anim';

/**
 * Illustration d'accueil : trois renards Fabi en triangle (pixel art) qui
 * apparaissent en fondu et se passent un fichier de code en relais — celui qui
 * le reçoit code. Lent, doux, léger. Cf. FabiWelcomeAnim.
 */
export const FabiWelcomeIllustration: React.FC = () => (
    <div className="fabi-wi">
        <FabiWelcomeAnim size={140} />
    </div>
);
