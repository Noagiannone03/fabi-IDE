// Module electron-main de fabi-spaces : c'est ICI qu'on rebind l'application Theia
// vers FabiSpacesApplication (qui hérite de FabiElectronMainApplication → launcher +
// branding conservés). UN SEUL rebind de ElectronMainApplication dans tout le projet
// (fabi-swarm ne rebind plus) → aucun conflit d'ordre de chargement de modules.

import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import { FabiSpacesApplication } from './fabi-spaces-application';

export default new ContainerModule((_bind, _unbind, _isBound, rebind) => {
    rebind(ElectronMainApplication).to(FabiSpacesApplication).inSingletonScope();
});
