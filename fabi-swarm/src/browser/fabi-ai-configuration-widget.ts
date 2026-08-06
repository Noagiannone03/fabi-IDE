import { injectable } from '@theia/core/shared/inversify';
import { AIConfigurationContainerWidget } from '@theia/ai-ide/lib/browser/ai-configuration/ai-configuration-widget';
import { FabiModelStorageSettingsWidget } from './fabi-model-storage-settings';

/** Ajoute les réglages produit Fabi à la configuration IA native de Theia. */
@injectable()
export class FabiAIConfigurationContainerWidget extends AIConfigurationContainerWidget {
    protected storageWidget: FabiModelStorageSettingsWidget;

    protected override async initUI(): Promise<void> {
        await super.initUI();
        this.storageWidget = await this.widgetManager.getOrCreateWidget(FabiModelStorageSettingsWidget.ID);
        this.dockpanel.addWidget(this.storageWidget, { mode: 'tab-after', ref: this.agentsWidget });
        this.update();
    }
}
