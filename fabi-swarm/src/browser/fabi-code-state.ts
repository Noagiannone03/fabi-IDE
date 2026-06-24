import { injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';

/** Mode d'agent OpenCode exposé dans l'UI. */
export type FabiCodeMode = 'build' | 'plan';

export const FABI_CODE_MODES: { id: FabiCodeMode; label: string; hint: string }[] = [
    { id: 'build', label: 'Agent', hint: 'Édite les fichiers et lance des commandes' },
    { id: 'plan', label: 'Ask', hint: 'Lecture seule — répond sans modifier' }
];

/**
 * État partagé du moteur fabi-code côté frontend : le sélecteur de mode (dans
 * l'input du chat) écrit ici, l'agent relais le lit à chaque tour pour choisir
 * l'agent OpenCode ('build' = Agent / 'plan' = Ask). Singleton.
 */
@injectable()
export class FabiCodeState {
    protected _mode: FabiCodeMode = 'build';
    protected readonly modeEmitter = new Emitter<FabiCodeMode>();
    readonly onModeChanged: Event<FabiCodeMode> = this.modeEmitter.event;

    get mode(): FabiCodeMode {
        return this._mode;
    }
    set mode(mode: FabiCodeMode) {
        if (mode !== this._mode) {
            this._mode = mode;
            this.modeEmitter.fire(mode);
        }
    }
}
