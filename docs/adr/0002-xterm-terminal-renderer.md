# 0002. Use xterm.js for Terminal Rendering

Date: 2026-06-04

## Status

Accepted

## Context

Ensemblr needs terminal panes for workspace shells, run scripts, command output, checks, logs, and optional raw Pi interactive sessions. The renderer must handle interactive PTYs, resize events, large output streams, ANSI escape sequences, copy/paste, scrollback, and predictable behavior inside Electron.

wterm was considered because it offers a React package, DOM rendering, native browser text selection, accessibility advantages, WASM-based parsing, and a modern terminal architecture. It is promising but still comparatively young.

xterm.js is the established web terminal renderer used by mature developer tools and has a broad addon ecosystem, including fit, WebGL, search, serialization, web links, clipboard, and Unicode-related addons.

## Decision

Use xterm.js as Ensemblr's terminal renderer.

Terminal integration will be isolated behind a renderer-side terminal adapter so future renderer swaps remain possible. The Electron main process will own PTY/process supervision and expose terminal sessions to the renderer through explicit IPC channels.

## Alternatives Considered

### wterm

wterm is attractive for native DOM selection, browser find, accessibility, and a modern React-facing API. It is not selected for the initial implementation because it is newer, less battle-tested, and its documented integration path centers on WebSocket transport to a PTY backend.

### Custom terminal renderer

A custom renderer would provide maximum control but is unjustified. Terminal emulation is deep, error-prone, and not core product differentiation for Ensemblr.

## Consequences

- Ensemblr starts with the most proven Electron-compatible terminal path.
- The app can use known xterm.js addons for fitting, search, links, WebGL rendering, and serialization when needed.
- The renderer will not get native DOM text selection by default in the same way wterm provides.
- Terminal behavior must be tested with interactive CLI programs such as `vim`, `less`, shell prompts, long-running run scripts, and Pi interactive mode.
- Keeping an adapter boundary leaves room to revisit wterm after the rest of the product stabilizes.
