(() => {
    const api = window.fabiSpaces;
    const popover = document.getElementById('space-popover');
    const input = document.getElementById('space-name');
    const error = document.getElementById('edit-error');
    const menu = document.getElementById('space-menu');
    const form = document.getElementById('edit-form');
    const confirmation = document.getElementById('remove-confirm');
    let editingId;
    let anchorY = 12;
    const position = () => {
        popover.style.left = Math.max(8, Math.min(48, innerWidth - popover.offsetWidth - 8)) + 'px';
        popover.style.top = Math.max(8, Math.min(anchorY, innerHeight - popover.offsetHeight - 8)) + 'px';
    };
    const show = (panel, focusId) => {
        for (const item of [menu, form, confirmation]) { item.hidden = item !== panel; }
        position();
        document.getElementById(focusId).focus();
    };
    const cancel = () => {
        if (!editingId) { return; }
        editingId = undefined;
        api.dismissMenu();
    };
    api.onEdit(space => {
        if (!space || space.kind === 'maestro') { return; }
        editingId = space.id;
        anchorY = Number.isFinite(space.y) ? space.y : 12;
        input.value = space.name;
        document.getElementById('menu-title').textContent = space.name;
        error.textContent = '';
        show(space.menu ? menu : form, space.menu ? 'rename-action' : 'space-name');
        if (!space.menu) { input.select(); }
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
            popover.getAnimations().forEach(animation => animation.cancel());
            popover.animate([{opacity: 0, transform: 'translateY(-3px) scale(.98)'}, {opacity: 1, transform: 'none'}],
                {duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)'});
        }
    });
    document.getElementById('rename-action').onclick = () => { show(form, 'space-name'); input.select(); };
    document.getElementById('remove-action').onclick = () => show(confirmation, 'keep-space');
    document.getElementById('keep-space').onclick = () => show(menu, 'remove-action');
    document.getElementById('confirm-remove').onclick = () => {
        if (editingId) { api.close(editingId); cancel(); }
    };
    document.getElementById('cancel').onclick = cancel;
    form.onsubmit = event => {
        event.preventDefault();
        if (!editingId) { return; }
        const name = input.value.trim();
        if (!name) { error.textContent = 'Saisissez un nom.'; input.focus(); return; }
        api.rename(editingId, name);
        cancel();
    };
    document.addEventListener('pointerdown', event => { if (!popover.contains(event.target)) { cancel(); } });
    document.addEventListener('contextmenu', event => { event.preventDefault(); if (!popover.contains(event.target)) { cancel(); } });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
        const controls = [...popover.querySelectorAll('button,input')].filter(el => el.getClientRects().length);
        if (event.key === 'Tab' || (!menu.hidden && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))) {
            event.preventDefault();
            const index = controls.indexOf(document.activeElement);
            const step = event.key === 'ArrowUp' || event.shiftKey ? -1 : 1;
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
                : (index + step + controls.length) % controls.length;
            controls[next]?.focus();
        }
    });
    window.addEventListener('resize', position);
    window.addEventListener('blur', cancel);
    api.ready();
})();
