# 0058. Capture promotional screenshots from a separate demo Electron entrypoint

Date: 2026-09-04

## Status

Accepted.

## Context

Marketing assets need hi-fi images of the app in states that are awkward or
impossible to stage against real data: an agent frozen mid-turn, a board with
cards in every column, a diff with a review thread open. The existing ritual in
`docs/guide/images/CAPTURE.md` is manual and lossy — shoot the real app against
the maintainer's own machine, then scrub Linear titles, blur `/Users/…` paths,
and pixelate the account block. Two shots on that list have stayed outstanding
for exactly this reason: their state is hard to produce on demand.

Rebuilding the UI as static components in the marketing repository was
considered and rejected: a second copy of the interface drifts from the product
the week after it is written.

Three constraints shaped the answer:

1. **The shipped app must be unaffected.** Not "guarded by a dev-only branch" —
   unaffected, with no shipped file altered.
2. **The window must be a real window.** macOS draws the traffic lights, the
   corner radius, and the drop shadow outside `webContents`; a browser cannot
   produce them, and `webContents.capturePage` cannot either. Every screenshot of
   a desktop app shows its chrome.
3. **Iteration must be fast.** Scenarios are composed by eye, many times, while
   shooting.

## Decision

Demo mode is a **second Electron entrypoint** — `demo/demo-main.ts`,
`demo/demo-preload.ts`, and a renderer root at `demo/main.tsx` — launched by
`npm run dev:demo` through `scripts/run-demo.mjs`. It renders the shipped
renderer against a stubbed bridge whose answers come from a scenario file.

- **Nothing under `src/` changes.** Demo mode imports the app read-only; the
  dependency runs one way. Electron Forge is not involved and the packaged app
  has no demo code in it, because there is none to strip.
- **The bridge stub is a `get`-trap `Proxy` installed in the renderer's main
  world.** It cannot live behind `contextBridge`, which deep-clones by
  enumerating own keys and would find none. Leaving `window.ensemblr` unclaimed
  is therefore the demo preload's main job; it exposes only `window.ensemblrDemo`
  (resize, capture) and the window-chrome snapshot `readWindowChrome` reads.
- **A scenario is one TypeScript file.** It declares the repositories, the open
  workspace and chat, the transcript, and the per-workspace diffs. Handlers read
  it through a mutable reference, so editing a scenario repaints the running
  window over Vite HMR without a restart.
- **State is isolated by product name.** The demo window sets its own, so
  Electron derives a `userData` directory that is neither the installed app's nor
  the dev build's.
- **Stills come from `screencapture -o -l <windowId>`**, which addresses the real
  window and so captures the chrome. `webContents.capturePage` is the fallback
  on platforms with no window capture.

`playground/` is deliberately untouched. It is a component-review sandbox with a
different job, and demo mode duplicates roughly ninety lines of its bridge
pattern rather than extracting a shared module — the coupling would make neither
able to move without the other. A guard test in
`tests/renderer/demo-isolation.test.ts` holds all three trees apart.

## Consequences

- The marketing repository consumes PNGs; it never imports from here.
- Deterministic capture is a property of the scenario: a frozen clock, motion and
  caret suppression under `.demo-frozen`, and a `data-demo-ready` attribute the
  capture waits on rather than a timeout — Shiki tokenizes asynchronously and
  xterm substitutes a fallback for a face that has not finished loading, so a
  timer catches whichever lost the race.
- Transcripts are back-dated from the frozen clock so elapsed-time labels read
  plausibly instead of `0.0s`.
- A scenario only has to answer the bridge calls its own route makes; everything
  else falls through to a no-op. Adding a surface means adding handlers, and the
  failure mode is a visibly empty panel rather than a silent wrong value.
- Because demo mode runs the raw `electron` binary rather than a packaged bundle,
  the macOS menu bar reads `Electron`. Shots crop it, as `CAPTURE.md` already
  requires.
- Demo mode is not covered by `tsconfig.json`; it has its own
  `tsconfig.demo.json` so the app's project cannot pick it up. `npm run typecheck`
  runs both.
