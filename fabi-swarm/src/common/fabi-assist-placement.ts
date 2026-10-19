/** Keep the answer beside the pointer when space permits, otherwise above it. */
export function assistPlacement(x: number, y: number, viewportWidth: number, viewportHeight: number, contentHeight = 520, contentWidth = 380) {
    const margin = 12;
    const width = Math.max(0, Math.min(contentWidth, viewportWidth - margin * 2));
    const height = Math.max(0, Math.min(contentHeight, 520, viewportHeight - margin * 2));
    const left = Math.max(margin, Math.min(x + 18, viewportWidth - width - margin));
    const top = Math.max(margin, Math.min(y + 22 + height <= viewportHeight - margin ? y + 22 : y - height - 12, viewportHeight - height - margin));
    return { left, top, width, maxHeight: height };
}

/** Preserve the fox under the action point; shift only when an edge requires it. */
export function assistOrbitPlacement(x: number, y: number, viewportWidth: number, viewportHeight: number) {
    const width = Math.max(0, Math.min(290, viewportWidth - 24));
    const height = Math.max(0, Math.min(212, viewportHeight - 24));
    return { left: Math.max(12, Math.min(x - 27, viewportWidth - width - 12)),
        top: Math.max(12, Math.min(y - 96, viewportHeight - height - 12)), width, maxHeight: height };
}
