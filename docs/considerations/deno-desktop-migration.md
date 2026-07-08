# Future consideration: migrating from Electron to `deno desktop`

> **Status:** Exploratory — not a decision. Captured 2026-07-08.
> **Do not action without a fresh check:** `deno desktop` is experimental (Deno 2.9 canary). Config keys and TypeScript APIs are stated to change before stable. Re-verify everything below before committing effort.

## TL;DR

Porting this app to `deno desktop` is **moderate difficulty and feasible — no hard blockers** — but the cost is a genuine rewrite of the IPC layer plus a bet on a canary API. Not recommended until `deno desktop` reaches a stable release. When it does, it is attractive: smaller binary, no IPC round-trip, built-in auto-update, TS-only, full npm/native-module compat.

## What `deno desktop` is

Shipped in **Deno 2.9 (2026-06-25), experimental**. `deno desktop <entry>` compiles a Deno project into a single self-contained native bundle = app code + Deno runtime + a web rendering engine.

- **Rendering backends:** OS WebView by default (WebKit on macOS, ~40 MB) or bundled **CEF/Chromium** (~150–300 MB) for identical cross-platform rendering.
- **Backend ↔ UI:** in-process channels, **no socket/IPC round-trip**.
- **Frontend:** serves via `Deno.serve()`; auto-detects Next/Astro/Fresh/Remix/Nuxt/SvelteKit/SolidStart/TanStack Start/Vite SSR (SSR frameworks — a Vite **SPA** just gets served as static assets).
- **Distribution:** cross-compile from one machine (`--target`), built-in bsdiff auto-update, `.app`/`.dmg` output on macOS.
- **Compat:** full npm ecosystem via Node compat; NAPI native addons supported (`--allow-ffi` + `node_modules` dir).

## This app's surface (why it's moderate, not trivial)

Measured 2026-07-08 against the current tree:

| Aspect | Finding | Migration impact |
|---|---|---|
| Stack | React 19 + Vite 8, TS-only, **electron ^43**, electron-forge, macOS-only | Fits Deno's target well |
| Windows | Single `new BrowserWindow` (`src/main/app/main-window.ts`) | No multi-window porting |
| IPC | **~101 `ipcMain` handlers** across ~15 files + `contextBridge` preload | **Bulk of the work** — rewrite every channel to in-process bindings, drop preload |
| Custom protocol | ~28 `protocol.*` sites serving the renderer | Re-express as a `Deno.serve()` handler (simpler) |
| Terminals | **node-pty `^1.1.0`** | Already the NAPI build → works on Deno |
| Process spawning | git / scripts via child_process | `Deno.Command` / Node `child_process` compat — fine |
| Native UI | dialogs (~122 refs), tray/dock, notifications, menus | All provided by `deno desktop` |
| Packaging | electron-forge makers | Swap to `deno desktop --target`; redo icon/DMG/entitlements in `deno.json` |

## Blockers — resolved and residual

**node-pty (was the scary one — now clear):** node-pty ≤1.0 uses node-internal symbols (`node_module_register`) and does **not** run on Deno. node-pty **1.1+ uses NAPI and works**. The last blocker (`Pipe.prototype.open` not implemented, `deno#6529`) was fixed in **`deno#31624` (2025-12-19)**. This app already pins `^1.1.0`. Caveats: needs `--allow-ffi`, a real `node_modules` dir, and `--allow-scripts` for the `fix-node-pty-permissions` postinstall (Deno skips lifecycle scripts by default).

**Residual risks:**
- **Experimental API.** Riding canary; config + TS surface will change before stable.
- **Rendering engine.** App is Chromium-tuned. WebKit default may render differently → use the **CEF backend** to guarantee parity (forfeits the binary-size win).
- **Notarization is manual.** `deno desktop` code-signs (ad-hoc, or Developer ID via `deno.json` `macos.codesignIdentity`, with Hardened Runtime + timestamp) but there is **no built-in `notarytool` submit / staple** yet — a separate step, on a macOS host.
- Windows auto-update, MSI, and `.deb`/`.rpm` not yet supported (irrelevant while macOS-only).

## Rough effort

**~2–5 weeks.** The ~101-channel IPC rewrite + preload removal dominates; then packaging/signing re-setup; then WebKit-vs-CEF rendering QA. No showstopper.

## Recommended next step (before any commitment)

Time-box a **~2-day spike**:
1. `deno desktop` the built Vite frontend, served via `Deno.serve()`.
2. Port 3–5 representative IPC channels to in-process bindings.
3. Confirm **node-pty spawns a terminal** in a **CEF** build (`--allow-ffi`, `node_modules` present).
4. Sanity-check signing config in `deno.json`.

If the canary API holds across that spike, revisit when Deno marks `deno desktop` stable. Do **not** start the full 101-channel rewrite against an experimental surface.

## Sources

- Deno Desktop docs — https://docs.deno.com/runtime/desktop/
- Comparison vs Electron — https://docs.deno.com/runtime/desktop/comparison/
- Distribution / code signing — https://docs.deno.com/runtime/desktop/distribution/
- Deno 2.9 release — https://deno.com/blog/v2.9
- node-pty on Deno (issue) — https://github.com/denoland/deno/issues/31032
- Pipe.prototype.open fix (PR) — https://github.com/denoland/deno/pull/31624
