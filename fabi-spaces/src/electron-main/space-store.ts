// Persistance des Spaces. Source de vérité sérialisée = `spaces.json` dans le
// data-dir de l'app (mac : ~/Library/Application Support/Fabi, win : %APPDATA%/Fabi,
// linux : ~/.config/Fabi). Lu au boot, réécrit à chaque mutation (debounce léger).
//
// Volontairement simple : pas de DB, pas de dépendance. Le fichier est petit
// (quelques Spaces) et écrit atomiquement (tmp → rename) pour ne jamais se corrompre.

import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SpaceDescriptor, SPACE_COLORS, MAESTRO_SPACE_ID, MAESTRO_ACCENT } from '../common/space-types';

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
                    this.migratePalette();
                }
            }
        } catch (err) {
            console.error('[fabi-spaces] spaces.json illisible, on repart de zéro :', err);
            this.state = { version: 1, spaces: [] };
        }
    }

    /**
     * Aligne les couleurs des Spaces existants sur la palette courante (couleurs
     * système Apple). Toute couleur hors-palette (legacy gris, orange de marque
     * récupéré par erreur, teintes arbitraires d'anciennes versions) est réassignée
     * à une couleur de la palette par position — répartition variée et cohérente.
     * Une couleur déjà dans la palette est respectée (choix délibéré). Persiste si modifié.
     */
    protected migratePalette(): void {
        const palette = SPACE_COLORS.map(c => c.toUpperCase());
        const inPalette = (c: string | undefined): boolean => !!c && palette.includes(c.toUpperCase());
        let changed = false;
        this.state.spaces.forEach((s, i) => {
            // Maestro garde son accent de marque (hors palette) — on ne le réassigne jamais.
            if (s.kind === 'maestro') {
                return;
            }
            if (!inPalette(s.color)) {
                s.color = SPACE_COLORS[i % SPACE_COLORS.length];
                changed = true;
            }
        });
        if (changed) {
            this.scheduleSave();
        }
    }

    /**
     * Garantit la présence du Space Maestro : épinglé, toujours EN TÊTE, accent de
     * marque, non supprimable. Appelé au boot (et après tout réordonnancement). Si
     * un Maestro existe déjà (relance), on ré-impose ses propriétés canoniques et
     * sa position en tête (au cas où un état legacy l'aurait déplacé/altéré).
     */
    ensureMaestro(): void {
        const existing = this.get(MAESTRO_SPACE_ID);
        if (existing) {
            existing.kind = 'maestro';
            existing.color = MAESTRO_ACCENT;
            existing.workspacePath = '';
            if (!existing.name) {
                existing.name = 'Maestro';
            }
            this.pinMaestroFront();
            this.scheduleSave();
            return;
        }
        this.state.spaces.unshift({
            id: MAESTRO_SPACE_ID,
            name: 'Maestro',
            emoji: 'pulse',
            color: MAESTRO_ACCENT,
            workspacePath: '',
            lastActive: Date.now(),
            kind: 'maestro'
        });
        this.scheduleSave();
    }

    /** Remet le Space Maestro en première position s'il ne l'est pas déjà. */
    protected pinMaestroFront(): void {
        if (this.state.spaces[0]?.id === MAESTRO_SPACE_ID) {
            return;
        }
        const maestro = this.get(MAESTRO_SPACE_ID);
        if (maestro) {
            this.state.spaces = [maestro, ...this.state.spaces.filter(s => s.id !== MAESTRO_SPACE_ID)];
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
        // Maestro reste épinglé en tête, quel que soit l'ordre demandé par le rail.
        this.pinMaestroFront();
        this.scheduleSave();
    }
}
