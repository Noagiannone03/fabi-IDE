// Rail des Spaces — logique de rendu + interactions. Reçoit l'état complet du main
// (fabiSpaces.onState) et le re-render intégralement (idempotent). Toute action
// utilisateur repart vers le main ; le main renvoie un nouvel état → re-render.

(() => {
    'use strict';
    const api = window.fabiSpaces;
    const SPACE_COLORS = ['#EC5B2B', '#E0A82E', '#4Fae6e', '#3B9CCB', '#7C6BD6', '#D45A8A', '#94A3B8'];

    /** @type {{spaces:Array, activeId?:string, liveIds:string[]}} */
    let state = { spaces: [], activeId: undefined, liveIds: [] };
    let overviewOpen = false;

    const el = {
        tiles: document.getElementById('tiles'),
        foxBtn: document.getElementById('foxBtn'),
        addBtn: document.getElementById('addBtn'),
        settingsBtn: document.getElementById('settingsBtn'),
        overview: document.getElementById('overview'),
        overviewScrim: document.getElementById('overviewScrim'),
        cards: document.getElementById('cards'),
        topbar: document.getElementById('topbar'),
        winControls: document.getElementById('winControls')
    };

    if (api && api.platform === 'darwin') {
        document.body.classList.add('mac');
    }

    // ---------------------------------------------------------------- helpers

    function glyphFor(space) {
        if (space.emoji) { return space.emoji; }
        const n = (space.name || '').trim();
        return n ? n[0].toUpperCase() : '•';
    }

    // ------------------------------------------------------------ rail (fin)

    function renderRail() {
        const live = new Set(state.liveIds);
        el.tiles.innerHTML = '';
        for (const space of state.spaces) {
            const tile = document.createElement('button');
            tile.className = 'tile';
            tile.dataset.id = space.id;
            tile.draggable = true;
            tile.style.setProperty('--accent', space.color);
            tile.title = space.name;
            if (space.id === state.activeId) { tile.classList.add('active'); }
            if (live.has(space.id)) { tile.classList.add('live'); }

            const glyph = document.createElement('span');
            glyph.className = 'glyph';
            glyph.textContent = glyphFor(space);
            tile.appendChild(glyph);

            tile.addEventListener('click', () => api.open(space.id));
            tile.addEventListener('contextmenu', e => { e.preventDefault(); openOverview(); });
            wireDrag(tile);
            el.tiles.appendChild(tile);
        }
    }

    // ------------------------------------------------------- drag-reorder

    let draggingId = null;

    function wireDrag(tile) {
        tile.addEventListener('dragstart', e => {
            draggingId = tile.dataset.id;
            tile.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', draggingId); } catch (_) { /* ignore */ }
        });
        tile.addEventListener('dragend', () => {
            tile.classList.remove('dragging');
            draggingId = null;
            const ids = [...el.tiles.querySelectorAll('.tile')].map(t => t.dataset.id);
            api.reorder(ids);
        });
    }

    el.tiles.addEventListener('dragover', e => {
        e.preventDefault();
        const dragged = el.tiles.querySelector('.tile.dragging');
        if (!dragged) { return; }
        const after = dragAfter(e.clientY);
        if (after == null) { el.tiles.appendChild(dragged); }
        else if (after !== dragged) { el.tiles.insertBefore(dragged, after); }
    });

    function dragAfter(y) {
        const tiles = [...el.tiles.querySelectorAll('.tile:not(.dragging)')];
        let closest = null, closestOffset = -Infinity;
        for (const t of tiles) {
            const box = t.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = t; }
        }
        return closest;
    }

    // --------------------------------------------------------- vue d'ensemble

    function openOverview() { overviewOpen = true; api.showOverview(); syncOverview(); }
    function closeOverview() { overviewOpen = false; api.hideOverview(); syncOverview(); }

    function syncOverview() {
        el.overview.classList.toggle('hidden', !overviewOpen);
        el.overview.setAttribute('aria-hidden', String(!overviewOpen));
        if (overviewOpen) { renderCards(); }
    }

    function renderCards() {
        el.cards.innerHTML = '';
        for (const space of state.spaces) {
            el.cards.appendChild(buildCard(space));
        }
        // Carte « nouvel espace ».
        const add = document.createElement('button');
        add.className = 'card new';
        add.innerHTML =
            '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
            + '<span>Nouvel espace</span>';
        add.addEventListener('click', () => api.create());
        el.cards.appendChild(add);
    }

    function buildCard(space) {
        const card = document.createElement('div');
        card.className = 'card' + (space.id === state.activeId ? ' active' : '');
        card.style.setProperty('--accent', space.color);

        // Tête : badge (emoji éditable au clic) + titre éditable.
        const head = document.createElement('div');
        head.className = 'card-head';

        const badge = document.createElement('div');
        badge.className = 'card-badge';
        badge.textContent = glyphFor(space);
        badge.title = 'Changer l\'emoji';
        badge.addEventListener('click', () => {
            const next = window.prompt('Emoji de l\'espace (laisser vide pour l\'initiale) :', space.emoji || '');
            if (next !== null) { api.setEmoji(space.id, next.trim().slice(0, 2)); }
        });

        const title = document.createElement('input');
        title.className = 'card-title';
        title.value = space.name || '';
        title.placeholder = 'Sans nom';
        title.spellcheck = false;
        const commit = () => { if (title.value !== space.name) { api.rename(space.id, title.value.trim()); } };
        title.addEventListener('blur', commit);
        title.addEventListener('keydown', e => { if (e.key === 'Enter') { title.blur(); } });

        head.append(badge, title);
        card.appendChild(head);

        if (space.workspacePath) {
            const path = document.createElement('div');
            path.className = 'card-path';
            path.textContent = space.workspacePath;
            path.title = space.workspacePath;
            card.appendChild(path);
        }

        // Pastilles de couleur.
        const swatches = document.createElement('div');
        swatches.className = 'swatches';
        for (const color of SPACE_COLORS) {
            const sw = document.createElement('button');
            sw.className = 'swatch' + (color === space.color ? ' sel' : '');
            sw.style.background = color;
            sw.title = color;
            sw.addEventListener('click', () => api.setColor(space.id, color));
            swatches.appendChild(sw);
        }
        card.appendChild(swatches);

        // Actions.
        const actions = document.createElement('div');
        actions.className = 'card-actions';
        const open = document.createElement('button');
        open.className = 'open';
        open.textContent = space.id === state.activeId ? 'Actif' : 'Ouvrir';
        open.addEventListener('click', () => { api.open(space.id); closeOverview(); });
        const close = document.createElement('button');
        close.className = 'close';
        close.textContent = 'Fermer';
        close.addEventListener('click', () => {
            if (window.confirm(`Fermer l'espace « ${space.name || 'Sans nom'} » ?`)) { api.close(space.id); }
        });
        actions.append(open, close);
        card.appendChild(actions);

        return card;
    }

    // ------------------------------------------------------------- câblage

    el.foxBtn.addEventListener('click', () => overviewOpen ? closeOverview() : openOverview());
    el.settingsBtn.addEventListener('click', () => overviewOpen ? closeOverview() : openOverview());
    el.addBtn.addEventListener('click', () => api.create());
    el.overviewScrim.addEventListener('click', () => closeOverview());

    // Boutons fenêtre (Windows/Linux) + double-clic sur la barre de titre = agrandir.
    el.winControls.addEventListener('click', e => {
        const btn = e.target.closest('.win-btn');
        if (btn) { api.windowControl(btn.dataset.act); }
    });
    el.topbar.addEventListener('dblclick', e => {
        if (!e.target.closest('.win-btn')) { api.windowControl('maximize'); }
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && overviewOpen) { closeOverview(); }
    });

    api.onState(next => {
        state = next || state;
        renderRail();
        if (overviewOpen) { renderCards(); }
    });

    // Demande l'état initial.
    api.ready();
})();
