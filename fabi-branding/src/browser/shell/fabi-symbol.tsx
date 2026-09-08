import * as React from '@theia/core/shared/react';

/** Fabi instruments: an optical 24px grid, open corners and paired strokes. */
export function FabiSymbol({ name }: { name: string }): React.ReactElement {
    const paths: Record<string, React.ReactNode> = {
        terminal: <><path d="M4 8V5h16v14H4v-3M7 9l3 3-3 3m6 0h4" /><path d="M3 12h1" /></>,
        agents: <><rect x="5" y="5" width="14" height="14" rx="5" /><path d="M9 10v3m6-3v3M9 2v3m6 14v3" /><path d="M10 16h4" /></>,
        files: <><path d="M4 7h6l2 3h8v10H4V7Zm0-3h7l2 3h7" /><path d="M8 14h8" /></>,
        search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5M7 10h6" /></>,
        branch: <><circle cx="7" cy="5" r="2" /><circle cx="7" cy="19" r="2" /><circle cx="18" cy="6" r="2" /><path d="M7 7v10m0-4h5a6 6 0 0 0 6-5" /></>,
        debug: <><path d="m9 7 9 5-9 5V7ZM4 5v14" /></>,
        extensions: <><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><path d="M14 17h6m-3-3v6" /></>,
        test: <><path d="M8 3h8m-6 0v7l-5 9c-.5 1 .2 2 1.5 2h11c1.3 0 2-1 1.5-2l-5-9V3M8 15h8" /></>,
        settings: <><path d="M4 7h7m5 0h4M4 17h3m5 0h8" /><circle cx="13.5" cy="7" r="2.5" /><circle cx="9.5" cy="17" r="2.5" /></>,
        more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>
    };
    return <svg className="fabi-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.more}</svg>;
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
