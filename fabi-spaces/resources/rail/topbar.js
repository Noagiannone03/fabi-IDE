(() => {
    'use strict';
    const api = window.fabiSpaces;
    if (!api) { return; }
    const nav = document.getElementById('spaces');
    const create = document.getElementById('create');
    const buttons = new Map();
    let activeId;
    let draggedId;
    let dropTarget;
    let dropAfter = false;
    const clearDrop = () => {
        for (const button of buttons.values()) { button.classList.remove('drop-before', 'drop-after', 'dragging'); }
        draggedId = undefined; dropTarget = undefined;
    };
    nav.addEventListener('dragover', event => {
        const target = event.target.closest('.desktop');
        if (!draggedId || !target || target.dataset.kind === 'maestro') { return; }
        event.preventDefault(); event.dataTransfer.dropEffect = 'move';
        for (const button of buttons.values()) { button.classList.remove('drop-before', 'drop-after'); }
        dropTarget = target.dataset.spaceId;
        const bounds = target.getBoundingClientRect();
        dropAfter = event.clientY >= bounds.top + bounds.height / 2;
        target.classList.add(dropAfter ? 'drop-after' : 'drop-before');
        const edge = nav.getBoundingClientRect();
        if (event.clientY < edge.top + 24) { nav.scrollTop -= 12; }
        if (event.clientY > edge.bottom - 24) { nav.scrollTop += 12; }
    });
    nav.addEventListener('drop', event => {
        if (!draggedId || !dropTarget) { return; }
        event.preventDefault();
        if (draggedId !== dropTarget) {
            const ids = [...nav.children].map(button => button.dataset.spaceId).filter(id => id !== draggedId);
            const index = ids.indexOf(dropTarget);
            if (index >= 0) { ids.splice(index + Number(dropAfter), 0, draggedId); api.reorder(ids); }
        }
        clearDrop();
    });
    document.getElementById('create').addEventListener('click', () => api.create());
    nav.addEventListener('keydown', event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { return; }
        const items = [...nav.children];
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        event.preventDefault();
        items[next]?.focus();
    });
    api.onState(state => {
        const previousBounds = new Map([...buttons].map(([id, button]) => [id, button.getBoundingClientRect().top]));
        const ids = new Set(state.spaces.map(s => s.id));
        for (const [id, button] of buttons) {
            if (!ids.has(id)) { if (button === document.activeElement) { create.focus(); } button.remove(); buttons.delete(id); }
        }
        state.spaces.forEach((space, index) => {
            let button = buttons.get(space.id);
            if (!button) {
                button = document.createElement('button');
                button.className = 'desktop';
                button.dataset.spaceId = space.id;
                const label = document.createElement('span');
                label.className = 'desktop-name';
                button.append(label);
                button.addEventListener('click', () => api.open(space.id));
                button.addEventListener('contextmenu', event => {
                    event.preventDefault();
                    if (button.dataset.kind !== 'maestro') { api.contextMenu(space.id, event.clientY); }
                });
                button.addEventListener('keydown', event => {
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                        event.preventDefault();
                        if (button.dataset.kind !== 'maestro') { api.contextMenu(space.id, button.getBoundingClientRect().top); }
                    }
                });
                button.addEventListener('dragstart', event => {
                    if (button.dataset.kind === 'maestro') { event.preventDefault(); return; }
                    draggedId = space.id;
                    button.classList.add('dragging');
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', space.id);
                });
                button.addEventListener('dragend', clearDrop);
                buttons.set(space.id, button);
            }
            const name = space.name || 'Espace';
            button.dataset.kind = space.kind || 'workspace';
            button.draggable = space.kind !== 'maestro';
            button.querySelector('.desktop-name').textContent = name;
            button.title = name + (space.workspacePath ? '\n' + space.workspacePath : '');
            button.setAttribute('aria-label', name);
            button.setAttribute('aria-current', state.activeId === space.id ? 'page' : 'false');
            if (/^#[0-9a-f]{6}$/i.test(space.color || '')) { button.style.setProperty('--space-color', space.color); }
            if (nav.children[index] !== button) { nav.insertBefore(button, nav.children[index] || null); }
        });
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
            for (const [id, button] of buttons) {
                const before = previousBounds.get(id);
                const delta = before === undefined ? 0 : before - button.getBoundingClientRect().top;
                if (delta) { button.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
            }
        }
        if (activeId !== state.activeId) {
            activeId = state.activeId;
            buttons.get(activeId)?.scrollIntoView({ block: 'nearest' });
        }
    });
    api.ready();
})();
