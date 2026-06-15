// Popup de création d'un Space : nom + icône + couleur (+ changer de dossier).
// Reçoit MODAL_OPEN (dossier/nom par défaut/couleur), renvoie MODAL_CREATE ou MODAL_CANCEL.

(() => {
    'use strict';
    const api = window.fabiSpaces;
    const SPACE_COLORS = ['#0A84FF', '#5E5CE6', '#BF5AF2', '#FF375F', '#FF453A', '#FF9F0A', '#FFD60A', '#30D158', '#40C8E0', '#8E8E93'];
    const CODICONS = [
        'folder', 'file', 'terminal', 'server', 'server-environment', 'vm', 'remote',
        'remote-explorer', 'rocket', 'flame', 'star', 'gear', 'tools', 'beaker',
        'paintcan', 'book', 'bookmark', 'lightbulb', 'globe', 'database', 'cloud',
        'github', 'heart', 'key', 'lock', 'package', 'symbol-class', 'code', 'browser',
        'window', 'dashboard', 'organization', 'project', 'notebook', 'bug'
    ];

    const el = {
        scrim: document.getElementById('scrim'),
        preview: document.getElementById('preview'),
        previewGlyph: document.getElementById('previewGlyph'),
        previewName: document.getElementById('previewName'),
        name: document.getElementById('nameInput'),
        folderPath: document.getElementById('folderPath'),
        changeFolder: document.getElementById('changeFolder'),
        iconGrid: document.getElementById('iconGrid'),
        swatches: document.getElementById('swatches'),
        cancel: document.getElementById('cancelBtn'),
        create: document.getElementById('createBtn')
    };

    const st = { name: '', icon: 'folder', color: SPACE_COLORS[0], folder: '', nameEdited: false };

    const baseName = p => (p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
    const isCodicon = v => !!v && CODICONS.includes(v);

    function setGlyph(target, icon, name) {
        target.innerHTML = '';
        if (isCodicon(icon)) {
            const i = document.createElement('i');
            i.className = 'codicon codicon-' + icon;
            target.appendChild(i);
        } else {
            const n = (name || '').trim();
            target.textContent = n ? n[0].toUpperCase() : '•';
        }
    }

    function applyColor() {
        document.documentElement.style.setProperty('--accent', st.color);
        [...el.swatches.children].forEach(s => s.classList.toggle('sel', s.dataset.color === st.color));
    }

    function refreshPreview() {
        setGlyph(el.previewGlyph, st.icon, st.name);
        el.previewName.textContent = st.name || 'Espace';
    }

    function renderIcons() {
        el.iconGrid.innerHTML = '';
        for (const name of CODICONS) {
            const b = document.createElement('button');
            b.className = 'icon-btn' + (name === st.icon ? ' sel' : '');
            b.title = name;
            const i = document.createElement('i'); i.className = 'codicon codicon-' + name;
            b.appendChild(i);
            b.addEventListener('click', () => {
                st.icon = name;
                [...el.iconGrid.children].forEach(c => c.classList.toggle('sel', c === b));
                refreshPreview();
            });
            el.iconGrid.appendChild(b);
        }
    }

    function renderSwatches() {
        el.swatches.innerHTML = '';
        for (const color of SPACE_COLORS) {
            const s = document.createElement('button');
            s.className = 'swatch';
            s.dataset.color = color;
            s.style.background = color;
            s.addEventListener('click', () => { st.color = color; applyColor(); });
            el.swatches.appendChild(s);
        }
    }

    function setFolder(path) {
        st.folder = path;
        el.folderPath.textContent = path;
        el.folderPath.title = path;
        if (!st.nameEdited) {
            st.name = baseName(path);
            el.name.value = st.name;
            refreshPreview();
        }
    }

    // --- câblage ---
    el.name.addEventListener('input', () => { st.name = el.name.value; st.nameEdited = true; refreshPreview(); });
    el.name.addEventListener('keydown', e => { if (e.key === 'Enter') { submit(); } });
    el.changeFolder.addEventListener('click', () => api.modalPickFolder());
    el.cancel.addEventListener('click', () => api.modalCancel());
    el.scrim.addEventListener('click', () => api.modalCancel());
    el.create.addEventListener('click', () => submit());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { api.modalCancel(); } });

    function submit() {
        api.modalCreate({ name: (st.name || baseName(st.folder)).trim(), icon: st.icon, color: st.color });
    }

    api.onModalOpen(init => {
        st.folder = init.folder || '';
        st.color = init.color || SPACE_COLORS[0];
        st.icon = 'folder';
        st.nameEdited = false;
        st.name = init.defaultName || baseName(st.folder);
        el.name.value = st.name;
        el.folderPath.textContent = st.folder;
        el.folderPath.title = st.folder;
        renderIcons();
        renderSwatches();
        applyColor();
        refreshPreview();
        el.name.focus(); el.name.select();
    });
    api.onModalFolder(path => setFolder(path));
})();
