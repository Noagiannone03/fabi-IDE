# Desktop check — 2026-09-08

The user authorized local compilation and requested the desktop app, not only the browser preview.

- Compiled branding, swarm and Spaces TypeScript successfully.
- Built Electron frontend, backend and main bundles with Node 22, reduced esbuild parallelism, no watch process.
- Launched Electron from `electron-app` with its existing local plugins; 60 plugin contributions loaded. File and folder icons render in the actual app.
- Terminal and AI launchers activate main-area tabs. Existing right-side chats are reparented without closing sessions. The right-hand vertical launcher is no longer mounted.
- Dock tools now render immediately. The centered compact dock uses equal-sized icon buttons with accessible labels, native tooltips, focus and active states.
- Actual Electron checks: terminal and singleton chat visible in main area after their dock buttons are clicked; no right sidebar launcher; all four tool buttons aligned and inside the 800px viewport.
- Isolated Lumino layout test covers 1440, 900 and 640px widths with sidebar open and closed.

This is a development app, not a packaged/signed release. AI inference remains unverified: the local runtime reports an incomplete installation. No runtime download or inference was started. The earlier browser server does not include these latest desktop-only bundles.

## Native viewport incident

The first live checks incorrectly connected Puppeteer with its default viewport. That emulated 800x600 on every WebContentsView, including the 44px title bar, and visibly broke native composition. The earlier 800px screenshots were therefore not native-window validation. Cleared device-metrics overrides, triggered native window layout and verified the title bar at 1440x44, workspace at 1440x777 and expanded rail at 250x777. `check-midnight-desktop.mjs` now always uses `defaultViewport: null`. Per-view screenshots were inspected; OS-level screen capture was unavailable in this environment.

## Studio revision

The latest user requested a stronger visual departure. The native Spaces view is now a 208x64 bottom-left selector, not a second tab strip. Its management list opens above it, sized to the number of Spaces, without shifting the editor. The host retains native window controls. A 32px native title area is reserved on top; document tabs remain in the workspace.

`fabi-studio.css` revises document tabs, tree density, side-panel headings, inputs, buttons, menus, dialogs, settings, home and the agent selector. `fabi-symbol.tsx` supplies custom vector symbols for the main dock commands and core project views; third-party views retain their own icons. File-type icons still use the installed theme, not custom artwork.

Dock controls have labelled instrument tiles, with terminal and agent distinguished from navigation. The native selector has reserved space in the dock layout. The sidebar refresh now hides its complete container when collapsed; live checks confirmed zero width and successful reopening.

Checks: TypeScript builds, static native-chrome/CSS tests, Lumino at three viewport sizes, live native Space-selector dimensions, sidebar collapse/reopen, and Space picker open/close. Full product behavior and every plugin surface are not claimed as redesigned or qualified.
