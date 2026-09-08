// Sidebar des Spaces — logique. Reçoit l'état complet du main et le re-render.
// Façon Arc : repliée par défaut (icônes), dépliée via le toggle (🦊 ou topbar) pour
// montrer les noms + la gestion. Surlignage de sélection GLISSANT (animation entre tabs)
// + couleur reliée. Renommage inline, menu clic-droit, drag-reorder.
// (Electron désactive window.prompt/confirm → toute l'édition est inline.)

(() => {
    'use strict';
    const api = window.fabiSpaces;
    if (!api) { return; }
    const SPACE_COLORS = ['#0A84FF', '#5E5CE6', '#BF5AF2', '#FF375F', '#FF453A', '#FF9F0A', '#FFD60A', '#30D158', '#40C8E0', '#8E8E93'];
    // Librairie d'icônes = les CODICONS natifs de l'IDE (mêmes icônes que Theia/VS Code).
    const CODICONS = [
        'folder', 'file', 'terminal', 'server', 'server-environment', 'vm', 'remote',
        'remote-explorer', 'rocket', 'flame', 'star', 'gear', 'tools', 'beaker',
        'paintcan', 'book', 'bookmark', 'lightbulb', 'globe', 'database', 'cloud',
        'github', 'heart', 'key', 'lock', 'package', 'symbol-class', 'code', 'browser',
        'window', 'dashboard', 'organization', 'project', 'notebook', 'bug', 'pulse'
    ];
    const isCodicon = v => !!v && CODICONS.includes(v);
    // Pose dans `el` (vidé) l'icône d'un space : codicon, sinon emoji legacy, sinon initiale.
    function setGlyph(glyphEl, space) {
        glyphEl.innerHTML = '';
        if (isCodicon(space.emoji)) {
            const i = document.createElement('i');
            i.className = 'codicon codicon-' + space.emoji;
            glyphEl.appendChild(i);
        } else if (space.emoji) {
            glyphEl.textContent = space.emoji;
        } else {
            const n = (space.name || '').trim();
            glyphEl.textContent = n ? n[0].toUpperCase() : '•';
        }
    }

    let state = { spaces: [], activeId: undefined, liveIds: [], expanded: false, activeColor: undefined };
    let expanded = false;
    let contextTrigger;

    const el = {
        rail: document.getElementById('rail'),
        tiles: document.getElementById('tiles'),
        foxBtn: document.getElementById('foxBtn'),
        addBtn: document.getElementById('addBtn'),
        ctx: document.getElementById('ctxmenu')
    };

    // ------------------------------------------------------------- rendu

    const rowEls = new Map(); // id -> élément de rangée (réutilisé entre rendus → transitions)

    function findSpace(id) { return state.spaces.find(s => s.id === id); }

    // Rendu réconciliant : on réutilise les rangées existantes (on ne fait que mettre à
    // jour leur contenu + la classe .active) → la `background-color` de la tuile peut
    // transitionner en fondu au changement d'espace / de couleur.
    function render() {
        // --accent global = couleur de l'espace actif → le rail peut diffuser une
        // lumière colorée très douce (verre), assortie à l'espace, fondu au switch.
        document.documentElement.style.setProperty('--accent', state.activeColor || '#0A84FF');
        const live = new Set(state.liveIds);
        const seen = new Set();
        let prev = null;
        for (const space of state.spaces) {
            let row = rowEls.get(space.id);
            if (!row) { row = buildRow(space.id); rowEls.set(space.id, row); }
            updateRow(row, space, live.has(space.id));
            const ref = prev ? prev.nextSibling : el.tiles.firstChild;
            if (ref !== row) { el.tiles.insertBefore(row, ref); }
            prev = row;
            seen.add(space.id);
        }
        for (const [id, row] of [...rowEls]) {
            if (!seen.has(id)) { row.remove(); rowEls.delete(id); }
        }
    }

    function buildRow(id) {
        const row = document.createElement('div');
        row.className = 'space-row';
        row.dataset.id = id;
        row.draggable = true;

        const tile = document.createElement('button');
        tile.className = 'tile';
        const glyph = document.createElement('span');
        glyph.className = 'glyph';
        tile.appendChild(glyph);

        const name = document.createElement('span');
        name.className = 'space-name';

        row.append(tile, name);
        const more = document.createElement('button');
        more.className = 'space-options';
        more.textContent = '⋯';
        more.setAttribute('aria-haspopup', 'dialog');
        more.addEventListener('click', event => {
            event.stopPropagation();
            const space = findSpace(id);
            const rect = more.getBoundingClientRect();
            if (space && space.kind !== 'maestro') { openContextMenu({ clientX: rect.left, clientY: rect.bottom + 4 }, space, row); }
        });
        row.appendChild(more);
        row.addEventListener('click', () => { if (!row.querySelector('.space-name-input')) { api.open(id); } });
        row.addEventListener('contextmenu', e => {
            e.preventDefault();
            const s = findSpace(id);
            // Maestro est permanent : pas de menu (ni renommage, ni couleur, ni fermeture).
            if (s && s.kind !== 'maestro') { openContextMenu(e, s, row); }
        });
        wireDrag(row);
        return row;
    }

    function updateRow(row, space, isLive) {
        const isMaestro = space.kind === 'maestro';
        row.classList.toggle('active', space.id === state.activeId);
        row.classList.toggle('maestro', isMaestro);
        // Maestro est épinglé : ni glisser-déposer, ni réordonnancement.
        row.draggable = !isMaestro;
        row.style.setProperty('--accent', space.color);
        row.querySelector('.tile').classList.toggle('live', isLive);
        row.querySelector('.tile').setAttribute('aria-label', 'Ouvrir ' + (space.name || 'Space'));
        row.querySelector('.tile').setAttribute('aria-current', space.id === state.activeId ? 'page' : 'false');
        const more = row.querySelector('.space-options');
        more.hidden = isMaestro;
        more.setAttribute('aria-label', 'Options de ' + (space.name || 'Space'));
        setGlyph(row.querySelector('.glyph'), space);
        const nameEl = row.querySelector('.space-name'); // absent pendant un renommage inline
        if (nameEl) { nameEl.textContent = space.name || 'Espace'; }
    }

    // ------------------------------------------------------ drag-reorder

    function wireDrag(row) {
        row.addEventListener('dragstart', e => {
            // Maestro est épinglé : on bloque le glisser dès la source.
            if (row.classList.contains('maestro')) { e.preventDefault(); return; }
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', row.dataset.id); } catch (_) { /* ignore */ }
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            const ids = [...el.tiles.querySelectorAll('.space-row')].map(r => r.dataset.id);
            api.reorder(ids);
        });
    }
    el.tiles.addEventListener('dragover', e => {
        e.preventDefault();
        const dragged = el.tiles.querySelector('.space-row.dragging');
        if (!dragged) { return; }
        const after = dragAfter(e.clientY);
        if (after == null) { el.tiles.appendChild(dragged); }
        else if (after !== dragged) { el.tiles.insertBefore(dragged, after); }
    });
    function dragAfter(y) {
        const rows = [...el.tiles.querySelectorAll('.space-row:not(.dragging)')];
        let closest = null, closestOffset = -Infinity;
        for (const r of rows) {
            const box = r.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = r; }
        }
        return closest;
    }

    // ----------------------------------------------------- renommage inline

    function ensureExpanded() {
        if (!expanded) { api.toggleSidebar(); }
    }

    function startRename(space, row) {
        ensureExpanded();
        const nameEl = row.querySelector('.space-name');
        if (!nameEl) { return; }
        const input = document.createElement('input');
        input.className = 'space-name-input';
        input.value = space.name || '';
        input.spellcheck = false;
        input.maxLength = 100;
        input.setAttribute('aria-label', 'Nom du Space');
        nameEl.replaceWith(input);
        input.focus(); input.select();
        let done = false;
        const finish = (commit, restoreFocus = false) => {
            if (done) { return; }
            done = true;
            const value = input.value.trim();
            // On restaure tout de suite le libellé (le rendu réconciliant le réutilise ensuite).
            const span = document.createElement('span');
            span.className = 'space-name';
            span.textContent = (commit && value ? value : (space.name || '')) || 'Espace';
            input.replaceWith(span);
            if (commit && value) { api.rename(space.id, value); }
            if (restoreFocus) { row.querySelector('.tile')?.focus(); }
        };
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true, true); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false, true); }
        });
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('click', e => e.stopPropagation());
    }

    // ------------------------------------------------------- menu clic-droit

    function openContextMenu(e, space, row) {
        ensureExpanded();
        const m = el.ctx;
        m.innerHTML = '';
        contextTrigger = row.querySelector('.space-options');
        m.setAttribute('aria-label', 'Options de ' + space.name);

        const item = (label, onClick, danger) => {
            const b = document.createElement('button');
            b.className = 'ctx-item' + (danger ? ' danger' : '');
            b.textContent = label;
            b.addEventListener('click', ev => { ev.stopPropagation(); onClick(); });
            return b;
        };

        m.appendChild(item('Renommer', () => { closeContextMenu(); startRename(space, row); }));
        const movable = state.spaces.filter(s => s.kind !== 'maestro');
        const index = movable.findIndex(s => s.id === space.id);
        const move = delta => {
            const ids = state.spaces.map(s => s.id);
            const from = ids.indexOf(space.id);
            const to = ids.indexOf(movable[index + delta].id);
            [ids[from], ids[to]] = [ids[to], ids[from]];
            api.reorder(ids); closeContextMenu(true);
        };
        if (index > 0) { m.appendChild(item('Déplacer vers le haut', () => move(-1))); }
        if (index >= 0 && index < movable.length - 1) { m.appendChild(item('Déplacer vers le bas', () => move(1))); }
        const appearance = document.createElement('details');
        appearance.className = 'ctx-appearance';
        const summary = document.createElement('summary');
        summary.textContent = 'Icône et couleur';
        appearance.appendChild(summary);
        m.appendChild(appearance);

        const iconLabel = document.createElement('div');
        iconLabel.className = 'ctx-label'; iconLabel.textContent = 'Icône';
        appearance.appendChild(iconLabel);
        const grid = document.createElement('div');
        grid.className = 'ctx-emoji-grid';
        const selectChoice = (container, selected) => {
            for (const button of container.querySelectorAll('button')) {
                button.classList.toggle('sel', button === selected);
                button.setAttribute('aria-pressed', String(button === selected));
            }
        };
        // « Aa » = revenir à l'initiale (pas d'icône).
        const clear = document.createElement('button');
        clear.className = 'ctx-emoji-btn clear' + (!space.emoji ? ' sel' : '');
        clear.textContent = 'Aa'; clear.title = 'Initiale';
        clear.setAttribute('aria-label', 'Utiliser l’initiale du Space');
        clear.setAttribute('aria-pressed', String(!space.emoji));
        clear.addEventListener('click', ev => { ev.stopPropagation(); api.setEmoji(space.id, ''); selectChoice(grid, clear); });
        grid.appendChild(clear);
        for (const name of CODICONS) {
            const b = document.createElement('button');
            b.className = 'ctx-emoji-btn' + (name === space.emoji ? ' sel' : '');
            b.title = name;
            b.setAttribute('aria-label', 'Icône ' + name);
            b.setAttribute('aria-pressed', String(name === space.emoji));
            const i = document.createElement('i');
            i.className = 'codicon codicon-' + name;
            b.appendChild(i);
            b.addEventListener('click', ev => { ev.stopPropagation(); api.setEmoji(space.id, name); selectChoice(grid, b); });
            grid.appendChild(b);
        }
        appearance.appendChild(grid);

        const colorLabel = document.createElement('div');
        colorLabel.className = 'ctx-label'; colorLabel.textContent = 'Couleur';
        appearance.appendChild(colorLabel);
        const swatches = document.createElement('div');
        swatches.className = 'ctx-swatches';
        for (const color of SPACE_COLORS) {
            const sw = document.createElement('button');
            sw.className = 'ctx-swatch' + (color === space.color ? ' sel' : '');
            sw.style.background = color;
            sw.setAttribute('aria-label', 'Couleur ' + color);
            sw.setAttribute('aria-pressed', String(color === space.color));
            sw.addEventListener('click', ev => { ev.stopPropagation(); api.setColor(space.id, color); selectChoice(swatches, sw); });
            swatches.appendChild(sw);
        }
        appearance.appendChild(swatches);

        m.appendChild(Object.assign(document.createElement('div'), { className: 'ctx-sep' }));
        m.appendChild(item('Fermer l\'espace', () => { api.close(space.id); closeContextMenu(); }, true));

        m.classList.remove('hidden');
        const mw = m.offsetWidth || 190, mh = m.offsetHeight || 240;
        const x = Math.min(e.clientX, window.innerWidth - mw - 8);
        const y = Math.min(e.clientY, window.innerHeight - mh - 8);
        m.style.left = Math.max(8, x) + 'px';
        m.style.top = Math.max(8, y) + 'px';
        m.style.maxHeight = Math.max(40, window.innerHeight - Math.max(8, y) - 8) + 'px';
        m.querySelector('button')?.focus();
    }

    function closeContextMenu(restoreFocus = false) {
        el.ctx.classList.add('hidden');
        if (restoreFocus && contextTrigger?.isConnected) { contextTrigger.focus(); }
    }

    document.addEventListener('click', e => {
        if (!el.ctx.classList.contains('hidden') && !el.ctx.contains(e.target)) { closeContextMenu(); }
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !el.ctx.classList.contains('hidden')) { e.preventDefault(); closeContextMenu(true); }
    });

    // ------------------------------------------------------------- câblage

    el.foxBtn.addEventListener('click', () => api.toggleSidebar());
    el.addBtn.addEventListener('click', () => api.create());

    api.onState(next => {
        state = next || state;
        expanded = !!state.expanded;
        document.body.classList.toggle('expanded', expanded);
        el.foxBtn.classList.toggle('pinned', expanded);
        render();
    });
    api.ready();
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !event.defaultPrevented && el.ctx.classList.contains('hidden')) {
            api.toggleSidebar();
        }
    });
})();
