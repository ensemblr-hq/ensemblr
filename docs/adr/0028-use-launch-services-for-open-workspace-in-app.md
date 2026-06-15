# 0028. Use Launch Services and QuickLook for the Open-Workspace-In Menu

Date: 2026-06-15

## Status

Accepted

## Context

The workbench header carries an "Open workspace in…" split button and dropdown
(Finder, VS Code, Zed, Ghostty, Warp, Terminal, GitHub Desktop, Copy path,
plus a longer set of editors / terminals / source-control GUIs visible only
when installed). It matches Conductor's launcher and is documented in
`docs/product/current-shell-inventory.md`. Before this change the menu was
purely cosmetic — every entry shipped with `installed: true`, no click
handlers, no keyboard bindings.

ENS-080 (Linear `THE-187`) raises four concrete requirements:

- Only show apps the user actually has installed; never link to a missing app.
- Open the workspace path in the chosen app from the menu and from keyboard
  shortcuts (`1`..`9` while the menu is open, `⌘O` for the primary editor,
  `⌘⇧C` for Copy path).
- Use the real macOS app icons in the menu, not lucide / iconify glyphs.
- The menu button must appear on first paint when the workspace shell mounts
  — no placeholder flash and no spinning-up delay on every launch.

The naive implementation hit two macOS surprises that shaped the design:

- `app.getFileIcon(path, { size: 'large' })` is documented as unsupported on
  macOS and routes through `NSWorkspace.iconForContentType:`. Calling it
  concurrently (`Promise.all` over ~25 apps) crashes Electron 42 inside
  IconServices' `findOrRegisterIcon`.
- Detection and icon extraction together take ~500–1000 ms cold — long enough
  that a per-launch round-trip produces either a missing button or a
  fallback-icon flash, both of which fail the parity bar.

## Decision

### Curated registry, Launch Services for detection

A static registry (`src/main/open-target/open-target-registry.ts`) names the
target apps with their bundle ids, an `iconName` fallback, a dispatch strategy
(`reveal-in-finder`, `open-bundle`, `open-app-name`, `copy-path`), and a
detection kind (`builtin`, `bundleId`, `utility`). Order in the array drives
order in the dropdown.

Detection (`detect-installed-targets.ts`) runs one `mdfind
kMDItemCFBundleIdentifier == "…"` per candidate bundle id, in parallel across
registry entries. mdfind is the canonical Launch Services hook and tolerates
multi-version bundle id lists (JetBrains EAP, Warp Stable, Zed Preview, etc).
Built-ins (Finder, Terminal) fall back to known absolute paths because
Spotlight may not index the system volumes. Non-macOS hosts get utility
entries only.

### QuickLook for icons, not IconServices

Icons come from `nativeImage.createThumbnailFromPath(appPath, {width: 64,
height: 64})`, which uses QuickLook and is safe to call concurrently.
`app.getFileIcon` is deliberately avoided because the `large` size is
unsupported on macOS and parallel calls crash IconServices on macOS 15 /
Electron 42. Thumbnails are encoded as PNG data URLs (`image.toDataURL()`) so
the renderer can inline them as `<img src="data:…">` without any blob URL
plumbing. Copy-path keeps its lucide glyph.

### Two-layer cache for instant launches

The list-with-icons is cached two ways:

1. **In-memory in the main process.** `createOpenTargetService` kicks off a
   single resolution promise on construction (gated on `app.whenReady` so the
   Electron APIs are safe) and remembers the resulting snapshots.
2. **On disk** at `<userData>/open-targets-cache.v1.json`. The service reads
   the file synchronously at construction and rewrites it after every
   successful detection.

The preload bootstrap (`src/preload/preload.ts`) already issues a synchronous
`initial-shell-snapshot` IPC and exposes the result as
`window.ensembleInitialShellSnapshot`. The snapshot now carries
`openTargets` alongside `health` and `navigation`; the renderer's
`queryClient` seeder writes it into the
`ensembleQueryKeys.workspaceOpenTargets()` cache key before React mounts. On
subsequent launches the menu paints with real icons on the first frame
because React Query already has the data.

On the very first launch the on-disk cache is empty, the snapshot ships
`openTargets: null`, and the renderer renders nothing (no placeholder) until
the async query completes. The component returns `null` when its data is
absent — there is no fallback-icon flash. A background refresh runs after
`app.whenReady` on every launch so the cache stays in sync with installs and
uninstalls.

### Renderer wiring

`OpenWorkspaceMenu` reads `workspaceOpenTargetsQuery`. The TanStack Query
cache key is hierarchical (`ensemble/workspace-open-targets`) and the query
has `staleTime: Infinity` because detection only changes when apps install or
uninstall. Click handlers and a `keydown` listener (with input-focus guard)
call `window.ensemble.openWorkspaceInTarget({ workspaceId, targetId })`. The
main-side handler resolves the workspace's filesystem path through
`getWorkspacePathById` and hands the path to the service. Copy-path triggers
a `sonner` toast.

The `WorkspaceShellModel.openTargets` field is kept on the model for fixtures
/ storybook but is now empty by default — it is no longer a source of truth.
The single source of truth for an installed target list is the
`workspaceOpenTargetsQuery` cache, seeded from the preload snapshot.

## Consequences

- The menu paints with real macOS icons on the very first frame for every
  launch except the very first one, with no fallback-icon flash.
- The first ever launch shows no menu button for ~500–1000 ms, then it
  appears with real icons; we accept this over a flash.
- We are tied to macOS in the first cut. Non-macOS hosts get only "Reveal in
  Finder" (degraded to `shell.openPath` on the directory) and "Copy path".
  Linux/Windows detection would slot into the same registry shape.
- `app.getFileIcon` becomes a "do not call" API in this codebase. Future
  callers that need an app icon should use `createThumbnailFromPath` and the
  service's cache.
- The on-disk cache embeds data URLs and can grow to a few hundred kilobytes
  on machines with many installed apps. The file is versioned
  (`open-targets-cache.v1.json`) so future schema changes invalidate cleanly.
- Stale cache risk: an installed app removed between launches keeps its
  icon until the background refresh writes a new cache. Acceptable because
  the click handler still calls `open -b <bundleId>` and will surface an
  error toast if the app is genuinely gone.

## Source pointers

- `src/main/open-target/` — registry, detection, service, on-disk cache.
- `src/main/ipc/handlers/open-target.ts` — IPC handlers.
- `src/main/ipc/handlers/health.ts` — initial-shell snapshot includes
  `openTargets`.
- `src/preload/preload.ts` — synchronous snapshot exposure.
- `src/renderer/api/query-client.ts` — query cache seeding.
- `src/renderer/api/ensemble/open-targets.ts` — TanStack Query definition.
- `src/renderer/components/workbench-shell/workbench-header.tsx` —
  `OpenWorkspaceMenu` component, click handlers, keyboard bindings.
- `src/shared/ipc/contracts/open-target.ts` — contract types.
