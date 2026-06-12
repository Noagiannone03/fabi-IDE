// Persistance des Spaces. Source de vérité sérialisée = `spaces.json` dans le
// data-dir de l'app (mac : ~/Library/Application Support/Fabi, win : %APPDATA%/Fabi,
// linux : ~/.config/Fabi). Lu au boot, réécrit à chaque mutation (debounce léger).
//
// Volontairement simple : pas de DB, pas de dépendance. Le fichier est petit
// (quelques Spaces) et écrit atomiquement (tmp → rename) pour ne jamais se corrompre.

import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SpaceDescriptor } from '../common/space-types';

interface PersistedState {
    version: 1;
    spaces: SpaceDescriptor[];
    activeId?: string;
}

export class SpaceStore {

    protected readonly file: string;
    protected state: PersistedState = { version: 1, spaces: [] };
    protected saveTimer: NodeJS.Timeout | undefined;

    constructor() {
        const dir = app.getPath('userData');
        this.file = join(dir, 'spaces.json');
        this.load();
    }

    protected load(): void {
        try {
            if (existsSync(this.file)) {
                const raw = JSON.parse(readFileSync(this.file, 'utf8'));
                if (raw && Array.isArray(raw.spaces)) {
                    this.state = { version: 1, spaces: raw.spaces, activeId: raw.activeId };
                }
            }
        } catch (err) {
            console.error('[fabi-spaces] spaces.json illisible, on repart de zéro :', err);
            this.state = { version: 1, spaces: [] };
        }
    }

    /** Écriture atomique, debouncée (les rafales de mutations ne touchent le disque qu'une fois). */
    protected scheduleSave(): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => this.flush(), 150);
    }

    flush(): void {
        this.saveTimer = undefined;
        try {
            const dir = app.getPath('userData');
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            const tmp = `${this.file}.tmp`;
            writeFileSync(tmp, JSON.stringify(this.state, undefined, 2), 'utf8');
            renameSync(tmp, this.file);
        } catch (err) {
            console.error('[fabi-spaces] échec d\'écriture de spaces.json :', err);
        }
    }

    // --- Lecture ---

    getSpaces(): SpaceDescriptor[] {
        return this.state.spaces;
    }

    getActiveId(): string | undefined {
        return this.state.activeId;
    }

    get(id: string): SpaceDescriptor | undefined {
        return this.state.spaces.find(s => s.id === id);
    }

    isEmpty(): boolean {
        return this.state.spaces.length === 0;
    }

    // --- Mutation (toutes persistent) ---

    add(space: SpaceDescriptor): void {
        this.state.spaces.push(space);
        this.scheduleSave();
    }

    remove(id: string): void {
        this.state.spaces = this.state.spaces.filter(s => s.id !== id);
        if (this.state.activeId === id) {
            this.state.activeId = this.state.spaces[0]?.id;
        }
        this.scheduleSave();
    }

    update(id: string, patch: Partial<SpaceDescriptor>): void {
        const space = this.get(id);
        if (space) {
            Object.assign(space, patch);
            this.scheduleSave();
        }
    }

    setActive(id: string): void {
        this.state.activeId = id;
        const space = this.get(id);
        if (space) {
            space.lastActive = Date.now();
        }
        this.scheduleSave();
    }

    /** Réordonne selon la liste d'ids donnée (les ids inconnus sont ignorés, les manquants gardés à la fin). */
    reorder(orderedIds: string[]): void {
        const byId = new Map(this.state.spaces.map(s => [s.id, s]));
        const next: SpaceDescriptor[] = [];
        for (const id of orderedIds) {
            const s = byId.get(id);
            if (s) {
                next.push(s);
                byId.delete(id);
            }
        }
        // Spaces non cités (sécurité) → conservés dans leur ordre d'origine.
        for (const s of this.state.spaces) {
            if (byId.has(s.id)) {
                next.push(s);
            }
        }
        this.state.spaces = next;
        this.scheduleSave();
    }
}
