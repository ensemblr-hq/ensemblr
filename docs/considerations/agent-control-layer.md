# Agent → App Control Layer ("Ensemblr Control")

> Design consideration + implementation notes. Lets agents drive Ensemblr from inside their own
> sessions. Implemented on branch `psoldunov/penderecki`.
>
> **Architecture pivot vs. the original plan:** rather than Pi's `extension_ui_request`/`_response`
> reverse channel (which needed a host-side response writer + `protocol-dispatch` routing), both
> species now unify on **one loopback HTTP control server**. Pi reaches it via a shipped extension
> whose tools `fetch` `POST /invoke`; harnesses reach it via an MCP endpoint (`POST /mcp`, built on
> `@modelcontextprotocol/sdk`). This is simpler, touches no Pi protocol internals, and shares one
> validation/scope/permission authority. See **Implementation status** at the bottom.

## Context

Today agents running **inside** Ensemblr are one-directional: the app spawns them and reads
their output, but they cannot act on the app. We want agents to **drive Ensemblr from within
their own sessions** — spawn chat tabs and start conversations, close tabs, launch third-party
harnesses, and start/stop the dock's setup/run/spawn terminals.

Two agent species must be able to control the app:

- **Pi** — first-party runtime (`@earendil-works/pi-coding-agent` v0.79.1, npm-global), a child
  process speaking **JSONL-RPC over stdio**. Stock, no MCP support.
- **Third-party harnesses** — Claude Code, Codex, Vibe — external CLIs launched in **PTY
  terminal tabs**. They speak their own protocols; Claude Code and Codex are native **MCP clients**.

The app already has every capability implemented as main-process services. Nothing needs new
*capability* code — we need a **trusted, scoped, gated entry point** that non-renderer callers
(the agents) can reach, plus **two bridges** that funnel into it.

## Architecture (as built)

One shared **App-Control Service** in the main process, reached over **one loopback HTTP control
server** (`127.0.0.1`, ephemeral port). Two transports on that server feed the same service:

```
  Pi agent  ──(shipped pi extension: tool → fetch POST /invoke, Bearer token)──┐
                                                                                ▼
                                                          Agent-Control Service ──▶ existing main services
                                                                                ▲    (chat-tab, pi-session,
  Claude/Codex ──(MCP client → POST /mcp streamable HTTP, Bearer token)────────┘     terminal, script, harness)
```

- **Agent-Control Service** (`src/main/agent-control/agent-control-service.ts`) owns: origin
  resolution from the token, scope enforcement, permission gating, recursion guardrails, and
  delegation to existing services via **ports**. Single source of truth.
- **Control server** (`control-server.ts`): `POST /invoke` (plain JSON, for the Pi extension),
  `POST /mcp` (MCP streamable HTTP, for harnesses), `GET /health`. Every request carries
  `Authorization: Bearer <token>`; the server hands the token to the service, which resolves it.
- **Pi bridge**: a shipped pi extension (`resources/pi-extensions/ensemblr-control.mts`) loaded via
  `pi --mode rpc -e <ext>`. Each `registerTool` handler `fetch`es `POST /invoke` with the token +
  URL injected into the Pi child's env. No Pi protocol changes.
- **Harness bridge**: `mcp-endpoint.ts` builds a stateless `McpServer` per request
  (`@modelcontextprotocol/sdk`) whose tools forward to the service under the request's bearer
  token. Harnesses point at it with the documented `.mcp.json` `{type:'http', url, headers}` entry
  (`buildHarnessMcpConfig`); credentials are already in their env.

Both transports call **identical** service ops with the **same** result envelope, so the capability
set is defined once (`src/shared/agent-control/`).

**Awareness injection.** Every agent is silently told it runs inside Ensemblr and has the
`ensemblr_*` orchestration tools, coupled to the tools actually being available: Pi via the
extension's `before_agent_start` hook appending to the system prompt (fires only when the extension
loaded); harnesses via the MCP server's `instructions` field (surfaced by MCP clients). One shared
text — the Pi extension's `AWARENESS` and `mcp-endpoint.ts`'s `AWARENESS` are kept in sync.

**Identity is per-workspace** (a pragmatic simplification of the plan's per-session tokens): one
origin/token is minted per workspace and injected into every agent process in that workspace via
`resolveAgentControlEnv` — Pi through its per-session env overlay, harnesses/terminals through the
`workspaceEnvironmentService` assembly. This still enforces token-gating, own-workspace writes,
cross-workspace reads, permission mode, and per-workspace spawn quota/rate. Cross-generation depth
and lineage deadlock detection degrade to no-ops under a shared workspace token; the registry API
keeps per-session support for a later upgrade.

## Locked decisions

| Branch | Decision |
|---|---|
| Controllers | **Pi + third-party harnesses** |
| Transport | **Pi:** shipped pi extension + `extension_ui_request/response`. **Harnesses:** localhost HTTP MCP server. One shared App-Control Service. |
| Scope | **Writes: own workspace only. Reads: cross-workspace.** Identity injected at spawn; agent-supplied ids never trusted. |
| Orchestration | **`wait` flag** — fire-and-forget default; `wait:true` blocks until child conversation completes. |
| Guardrails | **All four:** max nesting depth, per-session spawn quota + rate limit, wait-mode timeout, lineage deadlock check. |
| Permissions | **Uniform, follows mode.** Reads always allowed; all writes auto in `workspace-trusted`, confirm in `approval-required`, blocked in `read-only`. No per-op special-casing. |
| Capabilities | Core + all extras (follow-up, drive terminal stdin, read output, open non-chat tabs). |
| Lifecycle | **Persist — no cascade.** Spawned resources are first-class; parent ending does not tear them down. Lineage tracked for guardrails only. |

## Capability vocabulary

Defined once in a shared contract (`src/shared/agent-control/`), consumed by both bridges.

**Writes (own workspace):**
- `spawnChatTab()` → `{ chatTabId }`
- `startConversation({ chatTabId?, prompt, model?, thinkingLevel?, title?, wait? })` → `{ chatTabId, piSessionId, result? }` (a spawned tab is marked a sub-agent and tinted; `title` names it via Pi `/name`)
- `sendFollowUp({ piSessionId, prompt, wait? })` → `{ result? }` (Pi steer/follow_up + submitPrompt)
- `setName({ name })` → `{ chatTabId, title }` — set the **caller's own** tab name via Pi `set_session_name`
- `closeTab({ chatTabId })`
- `launchHarness({ harnessId })` → `{ chatTabId, terminalId }`
- `startTerminal({ kind: 'setup' | 'run' | 'spawn' })` → `{ terminalId }`
- `stopTerminal({ terminalId | kind })`
- `writeTerminal({ terminalId, input })` (drive a spawn terminal / harness stdin)
- `openTab({ variant: 'file' | 'diff' | 'comment', ... })` → `{ chatTabId }`
- `focusTab({ chatTabId })` — bring a session tab to the foreground
- `focusDockTab({ terminalId | kind })` — focus a dock terminal / the setup or run tab
- `focusPanel({ panel: 'files' | 'changes' | 'checks' })` — focus a review panel

  Focus is the one op family that reaches the **renderer** (active tab/panel is renderer state, not
  main). The `FocusPort` broadcasts a `FocusViewBroadcast` on `IPC_CHANNELS.agentControlFocusView`;
  `WorkspaceRouteContent` subscribes (`window.ensemblr.onAgentControlFocusView`) and applies it only
  for the window showing the payload's `workspaceId`, so focus is workspace-scoped. Focus ops are
  writes (mode-gated) but not spawns (no quota/depth).

**Reads (cross-workspace):**
- `listWorkspaces()`, `listTabs({ workspaceId? })`, `listTerminals({ workspaceId? })`
- `getConversationStatus({ piSessionId })`, `getLastMessage({ piSessionId })`
- `readTerminalOutput({ terminalId })`

## Components to build

### 1. Shared contract — `src/shared/agent-control/`
- `contracts.ts` — request/response types for every op above (mirrors `src/shared/ipc/contracts/` style).
- `schemas.ts` — Zod validators for each op's args (validate at the service boundary; agents are untrusted input).
- Op names namespaced `ensemblr.<op>` to match the pi `extension_ui_request` method convention.

### 2. App-Control Service — `src/main/agent-control/`
- `agent-control-service.ts` — `createAgentControlService(deps)`. Public method `invoke({ op, args, origin })`.
  `origin` is the **resolved** identity (see §5), never agent-supplied. Steps per call:
  1. Validate args with the Zod schema (reject malformed).
  2. Resolve/enforce **scope** (writes must target `origin.workspaceId`; reads may cross).
  3. **Permission gate** — call `classifyPermissionAction({ action, mode })` from
     `src/shared/permissions.ts` directly (these calls bypass `ipcMain.handle`, so the existing
     `permission-gate.ts` does not cover them). `allowed` → run; `blocked` → deny;
     `confirmation-required` → drive a confirm prompt (§6), then run or deny.
  4. **Guardrails** (§4) — depth, quota, rate, deadlock.
  5. Delegate to the matching existing service and return a structured envelope.
- Delegates to existing services (no new capability code):
  - Chat tabs: `src/main/chat-tabs/chat-tab-service.ts`
  - Pi sessions: `src/main/pi-agent/pi-session-service.ts` (`openSession`, `submitPrompt`, follow-up)
  - Terminals: `src/main/terminal/terminal-service.ts` (`create`/`kill`/`write`)
  - Scripts (setup/run): `src/main/scripts/script-lifecycle-service.ts`
  - Harness launch: `src/main/agents/harness-detection-service.ts` + `resolveLaunchCommand`
    (same path `src/main/ipc/handlers/agents.ts` uses)
- Composed in `src/main/main.ts` (~285–484) alongside the other services; receives their handles.

### 3. Identity / session registry — `src/main/agent-control/origin-registry.ts`
- At agent spawn, mint a per-session record: `{ token, piSessionId|harnessSessionId, workspaceId,
  parentSessionId, depth }`. Store in an in-memory registry keyed by token.
- **Pi:** inject `token` + endpoint into the pi extension via spawn env (extend
  `src/main/pi-agent/cli-rpc/spawn-env.ts`); Pi's own session id is already known to the adapter,
  so the extension_ui_request is tagged host-side, not by the agent.
- **Harness:** inject `token` into the MCP config written at launch (extend the harness launch
  path in `src/main/ipc/handlers/agents.ts` / `terminal-service.create`).
- Lineage (`parentSessionId`, `depth`) is derived when a spawn op runs: the child inherits
  `origin` from the caller. Used only for guardrails, never for cleanup.

### 4. Recursion guardrails — `src/main/agent-control/guardrails.ts`
- **Max depth:** deny spawn ops when `origin.depth >= MAX_SPAWN_DEPTH` (config, default 2).
- **Quota + rate:** per-session counters — max N total spawns, M per minute.
- **Wait timeout:** any `wait:true` op resolves with a `timeout` result after `WAIT_TIMEOUT_MS`
  (default 5 min); the child keeps running detached.
- **Deadlock check:** refuse a `wait:true` whose target session is an ancestor in the same
  lineage (cheap cycle walk over `parentSessionId`).

### 5. Pi bridge
- **New:** an Ensemblr pi extension package that registers the control tools and calls
  `ctx.ui.request('ensemblr.<op>', args)`. *(Requires reading the pi extension SDK / `ctx.ui`
  API from the vendored global `@earendil-works/pi-coding-agent` and `docs/pi/rpc-protocol.md`
  before authoring — do not guess the API.)*
- **Spawn with `-e`:** extend Pi spawn args (`buildSessionArgs`, `src/main/pi-agent/pi-agent-client.ts`
  ~L180) to load the extension.
- **Route inbound:** add an `extension_ui_request` case to
  `src/main/pi-agent/cli-rpc/protocol-dispatch.ts` (currently falls to `handleUnknown`). Route
  `method` starting `ensemblr.` to the App-Control Service; leave `confirm`/`notify`/`setStatus`
  as-is.
- **New response writer:** add an `extension_ui_response` frame writer to
  `src/main/pi-agent/cli-rpc-pi-agent-adapter.ts` (~L408 `writeFrame`) so the service can answer
  the blocking request with the op result. This writer does not exist today.

### 6. Harness bridge — `src/main/agent-control/mcp-server.ts`
- Localhost HTTP MCP server hosted by main, exposing the capability set as MCP tools that call
  `agentControlService.invoke`. Token from the request authenticates → resolves `origin`.
- **Config injection:** write a per-launch MCP config referencing the server + token when a
  harness starts. *(Exact Claude Code / Codex MCP-config mechanism — file path, flag, or env —
  must come from current official docs / Context7 at implementation time; the harness registry's
  `buildCommand` in `src/shared/agents/harness-registry.ts` is the injection seam.)*

### 7. Permissions & confirm UX
- Add `PermissionActionKind` values in `src/shared/permissions.ts`: `'app-control-read'`
  (classify like `workspace-read` → always allowed) and `'app-control-write'` (classify like
  `workspace-write` → mode-driven). No sensitive-action special-casing.
- **Confirm UI:** on `confirmation-required`, the App-Control Service surfaces a confirmation in
  Ensemblr's **own** UI (workspace dialog/toast), since harnesses have no native confirm channel.
  Pi-origin ops may reuse Pi's `confirm`, but a single app-side dialog keeps one code path.

## Implementation status

**Built and tested (green: `npm run check`, `npm run typecheck`, full Vitest suite):**

- Shared contract + Zod validators + op classification — `src/shared/agent-control/`.
- Permission action kinds `app-control-read` / `app-control-write` — `src/shared/permissions.ts`.
- Agent-control service, guardrails, origin registry, port adapters — `src/main/agent-control/`.
- Loopback control server with `/invoke`, `/mcp`, `/health` — `control-server.ts` + `mcp-endpoint.ts`.
- Env injection: `resolveAgentControlEnv` threaded into `pi-session-service` → lifecycle →
  `session-open` (per-session `env` overlay) and into `terminal-service` (assembled env).
- Composition in `src/main/main.ts`: server started on boot, env provider, native-dialog confirm,
  server closed on `will-quit`. Pi launched with `-e <ext>` only when the extension + `typebox` resolve.
- Pi extension shipped via Forge `extraResource` — `resources/pi-extensions/`.
- Tests: `tests/shared/agent-control.test.ts`, `tests/main/agent-control-{service,guardrails,
  origin-registry,control-server,mcp-endpoint}.test.ts` (the MCP test drives a real SDK client).

**Remaining — needs a live run to verify (per repo scaffolding policy, don't guess CLI/runtime):**

1. **Pi extension loading is install-agnostic.** Pi's own extension loader bundles `typebox` and
   `@earendil-works/pi-coding-agent` for extensions (jiti `alias` in Node/npm/brew installs via
   `require.resolve` from Pi's deps; `virtualModules` in the Bun compiled binary), so the extension
   needs no colocated `node_modules` regardless of how Pi was installed. Loading is also isolated:
   a failed `-e` extension is caught and reported, never crashing Pi — so `-e` is always safe to
   pass. Ensemblr resolves the Pi binary install-agnostically via `PiExecutableService`.
2. **Harness MCP auto-config — wired for Claude Code + Codex.** `augmentHarnessCommand` (main.ts)
   appends per-harness MCP flags to the launch command in both paths (user launch via
   `handlers/agents.ts`, agent launch via the harness port), built by
   `agent-control/harness-mcp-config.ts`: Claude gets `--mcp-config '<json>'` with the concrete
   per-workspace token; Codex gets `-c mcp_servers.ensemblr.url=… -c
   mcp_servers.ensemblr.bearer_token_env_var=ENSEMBLR_CONTROL_TOKEN` (reads the token from env). The
   control-server URL is a session constant; the token is per-workspace. **Vibe** has no known
   HTTP-MCP config mechanism → left unchanged (no flags). Live-verify the exact flag behavior with a
   real Claude/Codex once (esp. Claude's inline `--mcp-config` parsing).
3. **End-to-end smoke:** launch the app, spawn Pi, confirm the `ensemblr_*` tools appear and a
   `spawnChatTab` + `startConversation` round-trips; then in each permission mode confirm
   `workspace-trusted` auto-runs, `approval-required` shows the dialog, `read-only` blocks writes.
4. Final review gate: `react-doctor` + `fallow` per repo code-review policy.
