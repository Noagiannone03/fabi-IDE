/** Migrate the old synthetic sections without changing native file identities.
 * A file must never acquire a `children` property: Theia uses its presence to
 * distinguish a composite node from a leaf, even when the value is undefined. */
export function migrateProjectTreeState(node: any): any {
    if (!node || typeof node !== 'object') return node;
    if (!Array.isArray(node.children)) return { ...node };
    return { ...node, children: node.children.flatMap((child: any) => {
        if (child.fabiSection === 'agents') return [];
        if (child.fabiSection === 'code') return (child.children ?? []).map(migrateProjectTreeState);
        return [migrateProjectTreeState(child)];
    }) };
}
