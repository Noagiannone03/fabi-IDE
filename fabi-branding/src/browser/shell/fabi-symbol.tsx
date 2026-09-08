import * as React from '@theia/core/shared/react';

/** Phosphor regular icons, vendored unchanged under their MIT license. */
export function FabiSymbol({ name }: { name: string }): React.ReactElement {
    return <span className={'fabi-symbol ph-' + name} aria-hidden="true" />;
}

export function viewSymbol(id: string): string | undefined {
    if (/navigator|explorer/.test(id)) { return 'files'; }
    if (/search/.test(id)) { return 'search'; }
    if (/scm/.test(id)) { return 'branch'; }
    if (/debug/.test(id)) { return 'debug'; }
    if (/plugin|vsx|extension/.test(id)) { return 'extensions'; }
    if (/test/.test(id)) { return 'test'; }
    return undefined;
}
