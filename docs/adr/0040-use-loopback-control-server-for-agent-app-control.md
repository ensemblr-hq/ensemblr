# 0040. Use a Loopback HTTP Control Server for Agent → App Control

Date: 2026-07-22

## Status

Accepted

Relates to [0025](0025-use-pi-cli-rpc-with-executable-discovery.md) (Pi CLI RPC
runtime) and [0016](0016-use-workspace-trusted-local-execution.md) (workspace
permission modes).

## Context

Agents running **inside** Ensemblr were one-directional: the app spawned them
and read their output, but they could not act on the app. We wanted agents to
drive Ensemblr from within their own sessions — spawn conversations, launch
third-party harnesses, start/stop the dock's setup/run/spawn terminals, open
file/diff/comment tabs, focus panels, and move the workspace across the board.

Every one of those capabilities already existed as a main-process service. What
was missing was a **trusted, scoped, gated entry point** that non-renderer
callers (the agents) could reach — and two very different agent species had to
reach it:

- **Pi** — the first-party runtime, a child process speaking JSONL-RPC over
  stdio (ADR 0025). Stock Pi has no MCP support.
- **Third-party harnesses** — Claude Code, Codex, and Vibe — external CLIs
  launched in PTY terminal tabs. Claude Code and Codex are native MCP clients;
  Vibe is neither.

An initial plan routed Pi through its `extension_ui_request` /
`extension_ui_response` reverse channel — which required a host-side response
writer and `protocol-dispatch` routing into Pi protocol internals — and routed
harnesses through a separate localhost MCP server. Two transports, two code
paths, and edits into Pi's own protocol handling.

## Decision

Unify both species on **one loopback HTTP control server** (bound to
`127.0.0.1` on an ephemeral port) fronting a **single Agent-Control Service**.

- **Pi bridge.** A shipped Pi extension (`resources/pi-extensions/ensemblr-control.mts`,
  loaded with `pi --mode rpc -e <ext>`) registers the `ensemblr_*` tools; each
  handler `fetch`es `POST /invoke` (plain JSON) with a bearer token and URL
  injected into the Pi child's env. No Pi protocol changes.
- **Harness bridge.** An MCP endpoint `POST /mcp` (streamable HTTP, built on
  `@modelcontextprotocol/sdk`) exposes the same ops as MCP tools. The launch
  command is augmented with per-harness MCP config for Claude Code and Codex
  (`src/main/agent-control/harness-mcp-config.ts`). **Vibe** has no known
  HTTP-MCP config mechanism and launches without control flags.
- **One authority.** The Agent-Control Service
  (`src/main/agent-control/agent-control-service.ts`) resolves each request's
  bearer token to an origin, enforces scope (writes act only on the caller's own
  workspace; reads may span open workspaces), gates on the workspace permission
  mode (ADR 0016), applies recursion guardrails, and delegates to existing
  services via ports. The capability set and its Zod validators live once in
  `src/shared/agent-control/`; both transports call identical ops with the same
  result envelope.
- **Guardrails** (`src/main/agent-control/guardrails.ts`): `maxSpawnDepth: 1`
  (delegation is shallow by design — only a root orchestrator may spawn),
  `maxSpawnsPerSession: 20`, `maxSpawnsPerMinute: 10`, a 5-minute blocking-wait
  timeout, and refusal of a wait whose target is an ancestor (deadlock).
- **Role-aware awareness.** Two variants — `ORCHESTRATOR_AWARENESS` and
  `SUBAGENT_AWARENESS` (`src/shared/agent-control/awareness.ts`) — are selected
  by lineage depth (`roleForDepth`) and injected into every agent: Pi via the
  extension's `before_agent_start` hook, harnesses via the MCP server's
  `instructions` field. A parity test guards the Pi extension's embedded copies
  against drift.

## Consequences

- One validation/scope/permission authority instead of two, and **no Pi
  protocol internals are touched** — no `extension_ui_response` writer, no
  `protocol-dispatch` routing. The design is simpler and safer to evolve.
- A loopback HTTP server runs for the app lifetime, bound to `127.0.0.1` with
  per-origin bearer tokens injected into agent env and never accepted from the
  agent. It is started on boot and closed on `will-quit`.
- **Identity is per-workspace** — a pragmatic simplification of per-session
  tokens. Token-gating, own-workspace writes, cross-workspace reads, permission
  mode, and per-workspace spawn quota/rate all hold; cross-generation depth and
  lineage-deadlock detection degrade to no-ops under a shared workspace token.
  The registry API keeps per-session support for a later upgrade.
- The service introduces **no new capability code** — it delegates to the
  existing chat-tab, Pi-session, terminal, script, and harness-launch services.
- **Vibe cannot be driven** through Ensemblr Control (no MCP config path); it
  launches as a plain auto-approve harness.
- Focus ops are the one family that reaches the renderer (active tab/panel is
  renderer state); they broadcast over IPC and apply only in the window showing
  the target workspace, so focus stays workspace-scoped.
- The full design record lives in
  [`docs/considerations/agent-control-layer.md`](../considerations/agent-control-layer.md);
  the tool guidance in
  [`docs/considerations/agent-orchestration-playbook.md`](../considerations/agent-orchestration-playbook.md)
  and the user-facing guide in [`docs/agent-control.md`](../agent-control.md).
