import * as React from '@theia/core/shared/react';
import { DisposableCollection, MessageService } from '@theia/core';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { codicon } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { FabiSwarmFrontend } from './fabi-swarm-frontend';
import { ModelStorageLocation, ModelStorageSettings } from '../common/fabi-swarm-protocol';

@injectable()
export class FabiModelStorageSettingsWidget extends ReactWidget {
    static readonly ID = 'fabi-model-storage-settings';
    static readonly LABEL = 'Fabi';

    @inject(FabiSwarmFrontend)
    protected readonly frontend: FabiSwarmFrontend;

    @inject(FileDialogService)
    protected readonly fileDialog: FileDialogService;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @postConstruct()
    protected init(): void {
        this.id = FabiModelStorageSettingsWidget.ID;
        this.title.label = FabiModelStorageSettingsWidget.LABEL;
        this.title.caption = 'Paramètres Fabi';
        this.title.iconClass = codicon('database');
        this.title.closable = false;
        this.addClass('ai-configuration-widget');
        this.addClass('fabi-storage-settings-widget');
        this.update();
    }

    protected render(): React.ReactNode {
        return (
            <FabiModelStorageSettings
                frontend={this.frontend}
                fileDialog={this.fileDialog}
                messages={this.messages}
            />
        );
    }
}

interface StorageSettingsProps {
    frontend: FabiSwarmFrontend;
    fileDialog: FileDialogService;
    messages: MessageService;
}

const FabiModelStorageSettings: React.FC<StorageSettingsProps> = ({ frontend, fileDialog, messages }) => {
    const [settings, setSettings] = React.useState<ModelStorageSettings | undefined>(frontend.modelStorage);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>();

    React.useEffect(() => {
        const disposables = new DisposableCollection();
        disposables.push(frontend.onModelStorageChangedEvent(setSettings));
        void frontend.service.getModelStorageSettings()
            .then(setSettings)
            .catch(reason => setError(errorMessage(reason)));
        return () => disposables.dispose();
    }, [frontend]);

    const addLocation = async (): Promise<void> => {
        const selected = await fileDialog.showOpenDialog({
            title: 'Choisir un disque ou un dossier pour les modèles Fabi',
            openLabel: 'Utiliser cet emplacement',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false
        });
        if (!selected || Array.isArray(selected)) {
            return;
        }
        setBusy(true);
        setError(undefined);
        try {
            setSettings(await frontend.service.addModelStorageLocation(FileUri.fsPath(selected)));
        } catch (reason) {
            const message = errorMessage(reason);
            setError(message);
            messages.error(message);
        } finally {
            setBusy(false);
        }
    };

    const removeLocation = async (path: string): Promise<void> => {
        setBusy(true);
        setError(undefined);
        try {
            setSettings(await frontend.service.removeModelStorageLocation(path));
        } catch (reason) {
            const message = errorMessage(reason);
            setError(message);
            messages.error(message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className='ai-configuration-widget-content fabi-storage-settings'>
            <header className='fabi-storage-heading'>
                <div>
                    <h2>Stockage des modèles</h2>
                    <p>
                        Fabi choisit un seul emplacement capable d’accueillir la tranche sélectionnée.
                        Il ne répartit jamais une même tranche entre plusieurs disques.
                    </p>
                </div>
                <button className='theia-button secondary fabi-storage-add' type='button' disabled={busy} onClick={addLocation}>
                    <span className={codicon('folder-opened')} aria-hidden='true' />
                    Ajouter un emplacement
                </button>
            </header>

            {settings?.workerRestartPending && (
                <div className='fabi-storage-notice' role='status'>
                    <span className={codicon('sync')} aria-hidden='true' />
                    Le changement sera appliqué au worker dès que le tour en cours sera terminé.
                </div>
            )}
            {error && <div className='fabi-storage-error' role='alert'>{error}</div>}

            {!settings && !error && <StorageSkeleton />}
            {settings && (
                <div className='fabi-storage-locations'>
                    {settings.locations.map(location => (
                        <StorageLocationRow
                            key={location.path}
                            location={location}
                            busy={busy}
                            onRemove={removeLocation}
                        />
                    ))}
                </div>
            )}

            <p className='fabi-storage-footnote'>
                Ajouter un emplacement autorise uniquement le sous-dossier Fabi/model-cache.
                Retirer l’autorisation ne supprime aucun fichier.
            </p>
        </div>
    );
};

const StorageLocationRow: React.FC<{
    location: ModelStorageLocation;
    busy: boolean;
    onRemove: (path: string) => Promise<void>;
}> = ({ location, busy, onRemove }) => {
    const usable = location.freeBytes === undefined || location.minimumFreeBytes === undefined
        ? undefined
        : Math.max(0, location.freeBytes - location.minimumFreeBytes);
    return (
        <section className={`fabi-storage-location ${location.available && location.writable ? '' : 'unavailable'}`}>
            <div className='fabi-storage-location-main'>
                <span className={codicon(location.kind === 'primary' ? 'device-desktop' : 'database')} aria-hidden='true' />
                <div className='fabi-storage-location-copy'>
                    <div className='fabi-storage-location-title'>
                        {location.kind === 'primary' ? 'Emplacement système' : 'Emplacement supplémentaire'}
                        <span className={`fabi-storage-state ${location.available && location.writable ? 'ready' : 'offline'}`}>
                            {location.available && location.writable ? 'Disponible' : 'Indisponible'}
                        </span>
                    </div>
                    <code title={location.path}>{location.path}</code>
                    {location.message && <span className='fabi-storage-location-message'>{location.message}</span>}
                </div>
            </div>
            <div className='fabi-storage-stats' aria-label={`Capacité de ${location.path}`}>
                <StorageStat label='Libre' value={formatBytes(location.freeBytes)} />
                <StorageStat label='Réservé au système' value={formatBytes(location.minimumFreeBytes)} />
                <StorageStat label='Disponible pour Fabi' value={formatBytes(usable)} />
                <StorageStat label='Cache Fabi' value={formatBytes(location.cacheBytes)} />
            </div>
            {location.kind === 'extra' && (
                <button
                    className='fabi-storage-remove'
                    type='button'
                    disabled={busy}
                    aria-label={`Retirer ${location.path}`}
                    title='Retirer cet emplacement sans supprimer ses fichiers'
                    onClick={() => void onRemove(location.path)}
                >
                    <span className={codicon('close')} aria-hidden='true' />
                </button>
            )}
        </section>
    );
};

const StorageStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className='fabi-storage-stat'>
        <span>{label}</span>
        <strong>{value}</strong>
    </div>
);

const StorageSkeleton: React.FC = () => (
    <div className='fabi-storage-skeleton' aria-label='Lecture des volumes en cours'>
        <span /><span /><span />
    </div>
);

function formatBytes(value: number | undefined): string {
    if (value === undefined || !Number.isFinite(value)) {
        return 'Non mesuré';
    }
    const gib = value / 1024 ** 3;
    if (gib >= 0.1) {
        return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(gib)} Go`;
    }
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value / 1024 ** 2)} Mo`;
}

function errorMessage(reason: unknown): string {
    return reason instanceof Error ? reason.message : String(reason);
}
