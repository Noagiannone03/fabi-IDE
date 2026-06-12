// Barre de titre : toggle sidebar, teinte d'accent de l'espace actif (animée),
// double-clic = agrandir, boutons fenêtre (Windows/Linux).
(() => {
    'use strict';
    const api = window.fabiSpaces;
    if (api && api.platform === 'darwin') {
        document.body.classList.add('mac');
    }

    document.getElementById('toggle').addEventListener('click', () => api.toggleSidebar());
    document.getElementById('winControls').addEventListener('click', e => {
        const btn = e.target.closest('.win-btn');
        if (btn) { api.windowControl(btn.dataset.act); }
    });
    document.getElementById('drag').addEventListener('dblclick', () => api.windowControl('maximize'));

    const spacePill = document.getElementById('spacePill');
    const spaceName = document.getElementById('spaceName');
    const spaceBadge = document.getElementById('spaceBadge');

    // Pose l'icône du space dans le badge : codicon (nom ascii), emoji, sinon une boule.
    function setBadge(icon) {
        spaceBadge.innerHTML = '';
        if (icon && /^[a-z][a-z0-9-]*$/.test(icon)) {
            const i = document.createElement('i');
            i.className = 'codicon codicon-' + icon;
            spaceBadge.appendChild(i);
        } else if (icon) {
            spaceBadge.textContent = icon;
        } else {
            const dot = document.createElement('span');
            dot.className = 'dot';
            spaceBadge.appendChild(dot);
        }
    }

    // Barre neutre, SAUF l'îlot-nom (pastille) qui porte la couleur + l'icône + le nom.
    api.onState(state => {
        if (!state) { return; }
        document.body.classList.toggle('sb-expanded', !!state.expanded);
        if (state.activeColor) {
            document.documentElement.style.setProperty('--accent', state.activeColor);
        }
        spaceName.textContent = state.activeName || '';
        setBadge(state.activeIcon);
        spacePill.style.display = state.activeName ? 'inline-flex' : 'none';
    });
})();
