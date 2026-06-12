// Sidebar des Spaces — logique. Reçoit l'état complet du main et le re-render.
// Façon Arc : repliée par défaut (icônes), dépliée via le toggle (🦊 ou topbar) pour
// montrer les noms + la gestion. Surlignage de sélection GLISSANT (animation entre tabs)
// + couleur reliée. Renommage inline, menu clic-droit, drag-reorder.
// (Electron désactive window.prompt/confirm → toute l'édition est inline.)

(() => {
    'use strict';
    const api = window.fabiSpaces;
    const SPACE_COLORS = ['#EC5B2B', '#E0A82E', '#4Fae6e', '#3B9CCB', '#7C6BD6', '#D45A8A', '#94A3B8'];

    let state = { spaces: [], activeId: undefined, liveIds: [], expanded: false, activeColor: undefined };
    let expanded = false;

    const el = {
        rail: document.getElementById('rail'),
        tiles: document.getElementById('tiles'),
        foxBtn: document.getElementById('foxBtn'),
        addBtn: document.getElementById('addBtn'),
        ctx: document.getElementById('ctxmenu')
    };

    // ------------------------------------------------------------ helpers

    function glyphFor(space) {
        if (space.emoji) { return space.emoji; }
        const n = (space.name || '').trim();
        return n ? n[0].toUpperCase() : '•';
    }

    // ------------------------------------------------------------- rendu

    const rowEls = new Map(); // id -> élément de rangée (réutilisé entre rendus → transitions)

    function findSpace(id) { return state.spaces.find(s => s.id === id); }

    // Rendu réconciliant : on réutilise les rangées existantes (on ne fait que mettre à
    // jour leur contenu + la classe .active) → la `background-color` de la tuile peut
    // transitionner en fondu au changement d'espace / de couleur.
    function render() {
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

        const tile = document.createElement('div');
        tile.className = 'tile';
        const glyph = document.createElement('span');
        glyph.className = 'glyph';
        tile.appendChild(glyph);

        const name = document.createElement('span');
        name.className = 'space-name';

        row.append(tile, name);
        row.addEventListener('click', () => { if (!row.querySelector('.space-name-input')) { api.open(id); } });
        row.addEventListener('contextmenu', e => {
            e.preventDefault();
            const s = findSpace(id);
            if (s) { openContextMenu(e, s, row); }
        });
        wireDrag(row);
        return row;
    }

    function updateRow(row, space, isLive) {
        row.classList.toggle('active', space.id === state.activeId);
        row.style.setProperty('--accent', space.color);
        row.querySelector('.tile').classList.toggle('live', isLive);
        row.querySelector('.glyph').textContent = glyphFor(space);
        const nameEl = row.querySelector('.space-name'); // absent pendant un renommage inline
        if (nameEl) { nameEl.textContent = space.name || 'Espace'; }
    }

    // ------------------------------------------------------ drag-reorder

    function wireDrag(row) {
        row.addEventListener('dragstart', e => {
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
        nameEl.replaceWith(input);
        input.focus(); input.select();
        let done = false;
        const finish = commit => {
            if (done) { return; }
            done = true;
            const value = input.value.trim();
            // On restaure tout de suite le libellé (le rendu réconciliant le réutilise ensuite).
            const span = document.createElement('span');
            span.className = 'space-name';
            span.textContent = (commit ? value : (space.name || '')) || 'Espace';
            input.replaceWith(span);
            if (commit) { api.rename(space.id, value); }
        };
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { finish(true); }
            else if (e.key === 'Escape') { finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('click', e => e.stopPropagation());
    }

    // ------------------------------------------------------- menu clic-droit

    function openContextMenu(e, space, row) {
        ensureExpanded();
        const m = el.ctx;
        m.innerHTML = '';

        const item = (label, onClick, danger) => {
            const b = document.createElement('button');
            b.className = 'ctx-item' + (danger ? ' danger' : '');
            b.textContent = label;
            b.addEventListener('click', ev => { ev.stopPropagation(); onClick(); });
            return b;
        };

        m.appendChild(item('Renommer', () => { closeContextMenu(); startRename(space, row); }));

        const iconLabel = document.createElement('div');
        iconLabel.className = 'ctx-label'; iconLabel.textContent = 'Icône';
        m.appendChild(iconLabel);
        const emoji = document.createElement('input');
        emoji.className = 'ctx-emoji';
        emoji.value = space.emoji || '';
        emoji.placeholder = 'Emoji ou lettre';
        emoji.spellcheck = false;
        emoji.addEventListener('click', ev => ev.stopPropagation());
        emoji.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') { api.setEmoji(space.id, emoji.value.trim().slice(0, 2)); closeContextMenu(); }
        });
        m.appendChild(emoji);

        const colorLabel = document.createElement('div');
        colorLabel.className = 'ctx-label'; colorLabel.textContent = 'Couleur';
        m.appendChild(colorLabel);
        const swatches = document.createElement('div');
        swatches.className = 'ctx-swatches';
        for (const color of SPACE_COLORS) {
            const sw = document.createElement('button');
            sw.className = 'ctx-swatch' + (color === space.color ? ' sel' : '');
            sw.style.background = color;
            sw.addEventListener('click', ev => { ev.stopPropagation(); api.setColor(space.id, color); });
            swatches.appendChild(sw);
        }
        m.appendChild(swatches);

        m.appendChild(Object.assign(document.createElement('div'), { className: 'ctx-sep' }));
        m.appendChild(item('Fermer l\'espace', () => { api.close(space.id); closeContextMenu(); }, true));

        m.classList.remove('hidden');
        const mw = m.offsetWidth || 190, mh = m.offsetHeight || 240;
        const x = Math.min(e.clientX, window.innerWidth - mw - 8);
        const y = Math.min(e.clientY, window.innerHeight - mh - 8);
        m.style.left = Math.max(8, x) + 'px';
        m.style.top = Math.max(8, y) + 'px';
    }

    function closeContextMenu() {
        el.ctx.classList.add('hidden');
    }

    document.addEventListener('click', e => {
        if (!el.ctx.classList.contains('hidden') && !el.ctx.contains(e.target)) { closeContextMenu(); }
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !el.ctx.classList.contains('hidden')) { closeContextMenu(); }
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
})();
