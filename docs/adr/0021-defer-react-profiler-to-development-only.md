# 0021. Defer React Profiler to Development Diagnostics

Date: 2026-06-04

## Status

Accepted

## Context

Screenshot inventory surfaced a React profiler/developer diagnostics setting. This is not core to Conductor-style local workspace, agent, terminal, review, or PR parity.

## Decision

Ensemblr will not ship React profiler controls as a normal production user setting in v1.

React profiler and developer diagnostics may exist in development builds or behind an internal debug flag, but they are not a v1 product feature.

## Consequences

- Production settings stay focused on user workflows.
- Developer diagnostics can still be added when performance work requires them.
- Any production diagnostic feature must avoid exposing secrets, private paths, or session content.
- This is implemented as the route/IPC navigation profiler in `src/renderer/lib/instrumentation/route-profiler.ts`, which instruments route loaders, Electron IPC calls, and layout remounts. It is gated to `import.meta.env.DEV` and installed on the renderer router; see ADR 0026.
