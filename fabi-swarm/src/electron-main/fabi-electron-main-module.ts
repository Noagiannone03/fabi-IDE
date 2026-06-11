// Module electron-main de Fabi : rebind ElectronMainApplication vers notre
// sous-classe (launcher de 1er lancement). Chargé par le bootstrap electron-main
// généré (via theiaExtensions.electronMain dans package.json) AVANT
// `application.start()` → le rebind est effectif quand le conteneur résout
// ElectronMainApplication.

import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import { FabiElectronMainApplication } from './fabi-electron-main-application';

export default new ContainerModule((_bind, _unbind, _isBound, rebind) => {
    rebind(ElectronMainApplication).to(FabiElectronMainApplication).inSingletonScope();
});
