# Navigation revision — 2026-09-08

## Direct Space management and native focus

Removed the three-dot management launcher and the obsolete rail.js/rail.css management UI (recoverable from Git). Context-menu actions use Electron's native menu: rename, color and confirmed removal. Removal warns about closing tabs/processes and leaves disk files untouched. Rename uses a focused, validated form with Enter/Escape. The persistent rail implements drag-and-drop with an insertion marker, pinned Maestro, auto-scroll near edges, cancellation without persistence and commit on drop. Reordered labels animate using their actual previous positions.

Theia's FocusWindow handler targets BrowserWindow, which cannot focus a BaseWindow-hosted WebContentsView. SpaceManager now routes unnamed focus requests from the active view to its native host and webContents; inactive views cannot steal focus. A Space switch also focuses its view. Document motion now follows tab selection signals, not keyboard focus (which previews intentionally leave in the explorer). Arrival is 340ms/10px for documents, 480ms/30px for Spaces.

Verification: TypeScript and Electron bundle compile; static context-menu dispatch, reorder payload and rename validation; reduced-motion/readiness tests and layout geometry. The native README single-click → Agent tab → README path passed without focus emulation during the interactions. Cold-start renderer visibility on this test machine needed temporary focus emulation to finish initialization; this environment limitation is not evidence that all startup/focus problems have been eliminated.

## Readiness-aware motion and terminal diagnostics

Document activation uses a 240ms content-only fade/3px translation. Space changes use a 420ms/12px arrival with a stationary outgoing fade; first-load arrivals wait for Theia's preload to become hidden. Observers are disconnected on completion, subsequent navigation or a bounded timeout. Native background and preload use #191a1e; the preload uses an indeterminate quiet line, not a fake progress percentage. Reduced-motion remains respected.

Claude 2.1.263 was launched in the actual native terminal in minimal and normal modes without sending a prompt; both remained alive during the eight-second observation. The reported crash was not reproduced. Theia's automatic failed-process disposal was confirmed in source. Fabi now retains failed user-shell output with the exit code, excludes stopped terminals from dock/toggle reuse, and preserves explicit close and normal exits. This is diagnostic hardening, not evidence that an underlying Claude crash has been fixed.

## Latest refinement — connected Spaces and quiet chrome

Supersedes the thumbnail design below. Spaces now occupy a 52px rail with vertical labels, no images and no horizontal list. The selected tab shares #191a1e with the workspace; concave shoulders connect it to the right-hand page. Keyboard navigation, full-name tooltips, creation and management remain available. The thumbnail cache and state payload were removed; a departure screenshot is still used transiently for the Space transition only.

Document tabs use transparent inactive surfaces, a flat #28292e selected surface, 28px height and 7px corners. No bevel, border or stacked shadow. The dock has a single subdued surface, no hover/selected button tiles, a small active dot, 460ms reversible contraction/expansion and a 320ms pointer-departure grace period. Reduced motion remains supported.

Design references: [Dia's quieter profile indicator](https://www.diabrowser.com/changelog/1-16-0), [Apple motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion). The redesign skill guided a targeted refinement, preserving existing commands and layout ownership.

## Earlier iteration (historical)

Supersedes the Studio dock/Space selector described in earlier chronological notes.

- Phosphor regular replaces the bespoke command symbols. Original SVGs and MIT license are vendored, with no new runtime dependency.
- Files, search, Git and extension views remain in the explorer header. Collapsing the explorer hides the entire panel; a small document-header button restores it.
- Terminal and Agent are the only floating dock actions. The overlay is attached outside the shell layout, centered over the actual editor bounds. It reserves no bottom row. At rest it contracts over 320ms, preserving both icons while fading their labels; hover or keyboard focus expands it. A short departure delay avoids pointer flicker.
- Spaces are code desktops: a persistent 104px native column offers desktop previews, names, active state and scrolling. Snapshots are captured only on departure, kept in memory (12 thumbnails maximum), never persisted or uploaded. A bounded 70ms capture wait precedes a directional 340ms transition; rapid requests use latest-selection-wins ordering. Reduced-motion disables animation. The separate management popup preserves rename, reorder and creation. No Space tabs above document tabs.
- Document tabs are separated 30px islands with 9px corners, quieter inactive surfaces, and preserved dirty/pin/close behavior.
- Native titlebar, theme titlebar and navigation background share #191a1e. ANSI blue and bright blue are blue again, not neutral gray.

### Terminal launch environment

The automation shell exports TERM=dumb, COLORTERM="" and NO_COLOR=1. Do not pass these automation defaults into a desktop launch: use `env -u NO_COLOR -u FORCE_COLOR TERM=xterm-256color COLORTERM=truecolor` before the existing Electron command. Theia already declares xterm-256color/truecolor, but inherited environment values can override COLORTERM. This is a launch correction, not a global override of users' deliberate NO_COLOR preferences. Existing terminal processes must be reopened to inherit the corrected environment.

References: [VS Code terminal colors](https://code.visualstudio.com/docs/terminal/appearance), [Claude terminal theme](https://code.claude.com/docs/fr/terminal-config).

Motion revision verified: focused TypeScript and Electron bundles; layout tests at three sizes; tab CSS cascade; intermediate dock width, visible compact icons and reduced motion; native desktop preview capture and transition-overlay cleanup; new native terminal reports xterm-256color/truecolor with NO_COLOR unset. Parsed xterm cells preserve ANSI red/green/blue and exact RGB #be96e6. The temporary diagnostic terminal was disposed. Claude itself was not launched. Individual native views were visually inspected without viewport emulation; no full macOS-composited screenshot was available.

Verified: TypeScript builds; three isolated Lumino viewport sizes with sidebar open/closed; overlay centering, no reserved row and disposal; static Space keyboard navigation and selection; native sidebar collapse/restore; dock rest/reveal; terminal and chat in main tabs; switch to Maestro and back to the existing Space.

The desktop was compiled and relaunched. Tests never override native viewport dimensions. Temporary focus emulation was used and reverted to let backgrounded renderers finish loading. No AI inference, runtime download, release packaging or remote push was performed for this revision.

## Space lifecycle follow-up

### Custom context menu

The native Electron menu is replaced by an app-styled HTML popover in the existing transparent chrome view. It is anchored to the selected Space's pointer/keyboard position and clamped inside the window. Only rename and remove remain; removal requires an inline confirmation with cancellation focused first. Escape, outside click, blur, Tab and arrow navigation are covered. Color selection was also removed from the creation dialog; persisted descriptor colors remain compatible. Static interaction tests and TypeScript compilation pass. The standalone popover was visually inspected; native compositor integration still requires an app restart to load the main-process changes.

Space activation now revalidates the descriptor, view identity and renderer lifetime after asynchronous loading. Removal, suspension or disposal during loading cannot activate a stale view. `tools/check-space-lifecycle.mjs` exercises the production method and confirms these cases and latest-request-wins behavior without changing persisted Spaces.

The active WebContentsView is focused again after the host is shown. This alone did **not** resolve the cold-start stall in the current native test session: Chromium still reported the views hidden, and Theia waited for its startup animation frame. Temporary focus emulation allowed initialization and was then reverted. Native cold-start validation remains incomplete; this must not be reported as a proven startup fix.

The native workflow check restores the starting Space in `finally` and uses timer polling for state assertions, avoiding requestAnimationFrame-based waits on an inactive native rail. Static chrome, production transition/readiness, dock layout and lifecycle checks pass. After the diagnostic-assisted initial boot described above, the native README → Agent → README → another Space → original Space workflow also passes with focus emulation disabled throughout its interactions. The same editor remains visible on return. This does not validate an unassisted cold start.
