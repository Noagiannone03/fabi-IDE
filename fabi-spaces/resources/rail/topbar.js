(() => {
    'use strict';
    const api = window.fabiSpaces;
    if (!api) { return; }
    const manage = document.getElementById('manage');
    manage.addEventListener('click', () => api.toggleSidebar());
    manage.addEventListener('keydown', event => {
        if (event.key === 'Escape' && manage.getAttribute('aria-expanded') === 'true') { api.toggleSidebar(); }
    });
    api.onState(state => {
        const active = state.spaces.find(space => space.id === state.activeId);
        const name = active?.name || 'Espace';
        document.getElementById('activeName').textContent = name;
        manage.setAttribute('aria-expanded', String(state.expanded));
        manage.setAttribute('aria-label', `${name} — changer de Space`);
        manage.title = `${name} · ${state.spaces.length} Spaces`;
        if (/^#[0-9a-f]{6}$/i.test(active?.color || '')) { manage.style.setProperty('--space-color', active.color); }
    });
    api.ready();
})();
