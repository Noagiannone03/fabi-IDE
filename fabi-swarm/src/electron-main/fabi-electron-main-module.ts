// Module electron-main de fabi-swarm.
//
// NOTE : le rebind de `ElectronMainApplication` a été déplacé dans **fabi-spaces**
// (`FabiSpacesApplication extends FabiElectronMainApplication`), qui est désormais
// l'UNIQUE rebindeur de l'application. On garde ici la classe `FabiElectronMainApplication`
// (launcher de 1er lancement + branding) exportée pour que fabi-spaces en hérite, mais
// on ne rebind plus rien depuis fabi-swarm → aucun conflit d'ordre de chargement.
//
// (Si fabi-spaces venait à être retiré, restaurer ici le rebind vers
// `FabiElectronMainApplication` pour conserver le launcher.)

import { ContainerModule } from '@theia/core/shared/inversify';

export default new ContainerModule(() => {
    // Intentionnellement vide — voir la note ci-dessus.
});
