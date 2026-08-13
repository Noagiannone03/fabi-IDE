import type { Rectangle, View } from 'electron';

type NativeViewParent = Pick<View, 'addChildView' | 'removeChildView'>;

/**
 * Attache une vue avant d'appliquer ses bounds.
 *
 * Sur macOS, l'attachement d'une WebContentsView peut recréer sa surface avec le
 * viewport Chromium implicite 800x600. Appliquer les bounds avant l'attachement
 * ne suffit donc pas : l'ordre officiel `addChildView` puis `setBounds` fait
 * partie du contrat de composition.
 */
export function attachNativeView(parent: NativeViewParent, view: View, bounds: Rectangle): void {
    parent.addChildView(view);
    view.setBounds(bounds);
}

/** Rattache une vue existante en conservant le même contrat d'ordre. */
export function reattachNativeView(parent: NativeViewParent, view: View, bounds: Rectangle): void {
    parent.removeChildView(view);
    attachNativeView(parent, view, bounds);
}
