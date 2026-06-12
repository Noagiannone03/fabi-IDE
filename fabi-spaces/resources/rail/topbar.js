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

    // La barre de titre reste neutre : on ne suit que l'état déplié (pour l'icône toggle).
    api.onState(state => {
        if (!state) { return; }
        document.body.classList.toggle('sb-expanded', !!state.expanded);
    });
})();
