// Popup de création d'un Space : nom + icône + couleur (+ changer de dossier).
// Reçoit MODAL_OPEN (dossier/nom par défaut/couleur), renvoie MODAL_CREATE ou MODAL_CANCEL.

(() => {
    'use strict';
    const api = window.fabiSpaces;
    if (!api) { return; }
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
        error: document.getElementById('nameError'),
        folderPath: document.getElementById('folderPath'),
        changeFolder: document.getElementById('changeFolder'),
        iconGrid: document.getElementById('iconGrid'),
        cancel: document.getElementById('cancelBtn'),
        create: document.getElementById('createBtn')
    };

    const st = { name: '', icon: 'folder', color: SPACE_COLORS[0], folder: '', nameEdited: false, submitted: false };

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
            b.setAttribute('aria-label', 'Icône ' + name);
            b.setAttribute('aria-pressed', String(name === st.icon));
            const i = document.createElement('i'); i.className = 'codicon codicon-' + name;
            b.appendChild(i);
            b.addEventListener('click', () => {
                st.icon = name;
                [...el.iconGrid.children].forEach(c => {
                    c.classList.toggle('sel', c === b);
                    c.setAttribute('aria-pressed', String(c === b));
                });
                refreshPreview();
            });
            el.iconGrid.appendChild(b);
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
    el.name.addEventListener('input', () => {
        st.name = el.name.value; st.nameEdited = true;
        el.error.hidden = true; el.name.removeAttribute('aria-invalid');
        refreshPreview();
    });
    el.name.addEventListener('keydown', e => { if (e.key === 'Enter') { submit(); } });
    el.changeFolder.addEventListener('click', () => api.modalPickFolder());
    el.cancel.addEventListener('click', () => api.modalCancel());
    el.scrim.addEventListener('click', () => api.modalCancel());
    el.create.addEventListener('click', () => submit());
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !st.submitted) { e.preventDefault(); api.modalCancel(); }
        if (e.key === 'Tab') {
            const focusable = [...document.querySelectorAll('button:not(:disabled), input:not(:disabled), summary')]
                .filter(node => node.getClientRects().length > 0);
            const first = focusable[0]; const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
    });

    function submit() {
        if (st.submitted) { return; }
        const name = st.name.trim();
        if (!name || !st.folder) {
            el.error.textContent = !name ? 'Donnez un nom à ce Space.' : 'Choisissez un dossier pour ce Space.';
            el.error.hidden = false;
            el.name.setAttribute('aria-invalid', String(!name));
            (!name ? el.name : el.changeFolder).focus();
            return;
        }
        st.submitted = true;
        el.create.disabled = true;
        el.create.textContent = 'Création…';
        api.modalCreate({ name, icon: st.icon, color: st.color });
    }

    api.onModalOpen(init => {
        st.folder = init.folder || '';
        st.color = SPACE_COLORS.includes(init.color) ? init.color : SPACE_COLORS[0];
        st.submitted = false;
        el.create.disabled = false;
        el.create.textContent = 'Créer le Space';
        el.error.hidden = true;
        el.name.removeAttribute('aria-invalid');
        st.icon = 'folder';
        st.nameEdited = false;
        st.name = init.defaultName || baseName(st.folder);
        el.name.value = st.name;
        el.folderPath.textContent = st.folder;
        el.folderPath.title = st.folder;
        renderIcons();
        applyColor();
        refreshPreview();
        el.name.focus(); el.name.select();
    });
    api.onModalFolder(path => setFolder(path));
})();
