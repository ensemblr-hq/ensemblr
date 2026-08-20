# Agent → App Control Layer ("Ensemblr Control")

> Design record + as-built notes for Ensemblr Control. Lets agents drive Ensemblr from inside their
> own sessions. **Shipped:** #166 (control layer), #168 (role-aware orchestration), #169 (sub-agent
> naming + status sync), #182 (`ask_user_question`), #191 (spawned children inherit Plan Mode),
> #192 (sub-agent surface narrowed by durable role), #193 (read the workspace diff and its review
> comments), #194 (audit a sub-agent's transcript; cascading stops), #223 (start a run script by
> name), #224 (unbounded `ask_user_question`; canonical argument names), #232 (a spawned child's
> runtime is shown; a chat's thinking level pins to its session), #236 (a spawned child is pinned to
> its caller's agent runtime), THE-202 (a diff-comment op lands the user in Checks).
>
> This file records **why** the layer is shaped the way it is. It is not the tool reference: the
> authoritative, enumerated `ensemblr_*` surface — every tool, its argument names and types, its
> gate, and who it is withheld from — is in [`docs/agent-control.md`](../agent-control.md#tool-reference),
> read off `TOOL_DEFS` and the Zod schemas. Prefer that when the two disagree.
>
> See [ADR 0040](../adr/0040-use-loopback-control-server-for-agent-app-control.md)
> for the accepted decision and [`docs/agent-control.md`](../agent-control.md) for the user-facing guide.
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
loaded); harnesses via the MCP server's `instructions` field (surfaced by MCP clients). Two role
variants (`ORCHESTRATOR_AWARENESS` / `SUBAGENT_AWARENESS` in `src/shared/agent-control/awareness.ts`)
are selected by lineage depth (`roleForDepth`); the Pi extension embeds byte-identical copies and a
parity test guards drift (#168). See [`agent-orchestration-playbook.md`](./agent-orchestration-playbook.md).

> **Superseded by #191/#192.** Two axes were added on top of role. Plan Mode gives a second pair of
> playbooks — `PLAN_MODE_ORCHESTRATOR_AWARENESS` / `PLAN_MODE_SUBAGENT_AWARENESS` — which *replace*
> the role variant for as long as the conversation is planning, and are consumed only by the Pi
> extension (an MCP-only runtime has its system prompt fixed at session open). And role is no longer
> read from depth alone: `resolveAgentRole(marked, depth)` prefers the durable sub-agent marker on
> the chat tab and falls back to `roleForDepth`, because depth lives in an in-memory registry a
> restart clears. `awarenessForAudience` is now the single selection rule, keyed off
> `ControlAudience` (`hasChatTab` + `role`) rather than off a runtime's name.

**Identity is per-workspace** (a pragmatic simplification of the plan's per-session tokens): one
origin/token is minted per workspace and injected into every agent process in that workspace via
`resolveAgentControlEnv` — Pi through its per-session env overlay, harnesses/terminals through the
`workspaceEnvironmentService` assembly. This still enforces token-gating, own-workspace writes,
cross-workspace reads, permission mode, and per-workspace spawn quota/rate. Cross-generation depth
and lineage deadlock detection degrade to no-ops under a shared workspace token; the registry API
keeps per-session support for a later upgrade.

> **Superseded — the later upgrade landed.** Identity is now split by caller kind. An **agent
> conversation** registers its own per-session origin carrying real lineage (`parentSessionId`,
> `depth`), so the depth cap, per-session quota/rate, `childrenOf` cascading stops, and the
> ancestor-deadlock check all operate as designed. A **terminal** — a harness or a dock terminal —
> still shares one workspace-level origin, minted as the pseudo-session `ws:<workspaceId>`, because
> a PTY has no session to mint a token for. That residual sharing is why a harness cannot be told
> which agent runtime it is and must pass `model` explicitly when it spawns a child (#236).

## Locked decisions

| Branch | Decision |
|---|---|
| Controllers | **Pi + third-party harnesses** |
| Transport | **One loopback HTTP control server.** Pi reaches it via a shipped extension (`POST /invoke`); harnesses via an MCP endpoint (`POST /mcp`). One shared App-Control Service. _(Superseded the original `extension_ui_request/response` plan — see the pivot note at the top.)_ |
| Scope | **Writes: own workspace only. Reads: cross-workspace.** Identity injected at spawn; agent-supplied ids never trusted. |
| Orchestration | **`wait` flag** — fire-and-forget default; `wait:true` blocks until child conversation completes. |
| Guardrails | **All four:** max nesting depth, per-session spawn quota + rate limit, wait-mode timeout, lineage deadlock check. |
| Permissions | **Uniform, follows mode.** Reads always allowed; all writes auto in `workspace-trusted`, confirm in `approval-required`, blocked in `read-only`. No per-op special-casing. |
| Capabilities | Core + all extras (follow-up, drive terminal stdin, read output, open non-chat tabs). |
| Lifecycle | **Persist — no cascade.** Spawned resources are first-class; parent ending does not tear them down. Lineage tracked for guardrails only. _(Partly superseded by #194 — see below.)_ |

> **Lifecycle, superseded in part by #194.** Tabs and terminals still persist, and lineage is still
> never used for cleanup. But *stopping a conversation now cascades*: `stopSession` walks the origin
> registry's `childrenOf` lineage and aborts every live descendant with reason
> `orchestrator-stopped`. The original decision assumed a user could always reach a stranded child
> and stop it themselves; withholding the composer from a sub-agent's tab (#169) removed the Stop
> button along with it, so "no cascade" would have left children running with nobody able to steer
> them or read their reports. Descendants are collected in a `finally`, so a wedged root whose own
> abort rejects — the likeliest one to have stranded something — still takes its lineage down.

## Capability vocabulary

Defined once in a shared contract (`src/shared/agent-control/`), consumed by both bridges.

**Writes (own workspace):**
- `spawnChatTab()` → `{ chatTabId }`
- `startConversation({ chatTabId?, prompt, model?, thinkingLevel?, title?, wait? })` → `{ chatTabId, agentSessionId, result? }` (a spawned tab is marked a sub-agent and tinted; `title` names it via Pi `/name`). Since #236 the child is **pinned to the caller's agent runtime**: the service passes `callerRuntime` to the port, and a `model` belonging to the other runtime comes back `invalid-args` naming both rather than being substituted. Omitting `model` inherits the caller's; a terminal harness, whose runtime the app cannot name, must pass one
- `sendFollowUp({ agentSessionId, prompt, wait? })` → `{ result? }` (Pi steer/follow_up + submitPrompt)
- `setName({ title })` → `{ applied, title, message }` — set the **caller's own** tab name via Pi `set_session_name`. Stamps `titleProvenance: 'agent'`; a title the user chose outranks it and the call reports `applied: false` rather than failing. **Chat-tab callers only** (a terminal harness owns no chat tab)
- `setBranchName({ name, userRequested? })` → `{ applied, name, branchName, message }` — name the caller's **workspace and its git branch** together from one slug. Gated on the branch, not the display name: it applies while the git branch still carries the name it was cut with, and a workspace the user has already titled keeps that title while only its branch moves. Reports `applied: false` rather than failing once the branch is named, unless `userRequested` says the user asked for a different one by name. An adopted branch never moves, and `git.renameWorkspaceOnBranch` overrides everything, `userRequested` included
- `setSummary({ title, summary })` → `{ capturedAtOrdinal, message }` — record the caller's session summary. **Chat-tab callers only** — the axis is the tab, not the runtime, so native Claude holds it and a terminal harness does not. Writes SQLite only; the summary queue projects it to `.context/sessions/` at the next turn boundary, so nothing materializes `.context/` mid-turn
- `closeTab({ chatTabId })`
- `launchHarness({ harnessId })` → `{ chatTabId, terminalId }`
- `startTerminal({ kind: 'setup' | 'run' | 'spawn', scriptName? })` → `{ terminalId }` — `scriptName` (#223) picks one of the repository's named run scripts and is accepted with `kind: 'run'` only; omitted, it starts whichever script the repository marks default. A name the repository does not configure fails `not-found` and lists the ones it does, rather than quietly launching something else
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

- `addDiffComments({ comments: [{ filePath, lineNumber?, body }] })` → `{ added, commentIds, message }` — file review comments on the caller's **own** workspace diff. Rows land in the `comments` table with `origin: 'agent'`, stamped by the port rather than taken from the args, and render twice: inline on their lines in Changes, and as a list in Checks. Takes no `workspaceId`, so a cross-workspace write is unreachable by construction
- `resolveDiffComments({ commentIds })` → `{ resolved, resolvedIds, alreadyResolved, notFound, message }` — close the review comments the caller has fixed, so a review pass does not leave a queue of stale findings. Resolve-only: no reopen, no archive. The port lists the caller's own comments first and writes only ids in that set, so a foreign id lands in `notFound` without reaching the store; `notFound` merges "no such id", "another workspace's", and "archived" so the op is not an id-existence oracle. Unknown ids are reported rather than failing the call, because re-running the cleanup step after a restart is a legitimate no-op. Refused in Plan Mode — see below

  **Either op lands the user in Checks** (THE-202). Checks is the view that answers "what did the
  agent just leave me, and what is still open"; a pass leaving six findings wants that list, not six
  files to scroll. `review-focus.ts` pulls it through the same `focusPanel` port the tool exposes, so
  there is no second focus mechanism — and it is enforced rather than steered, for the reason
  `linear-ports.ts` enforces the tracker rules: behaviour that depends on a model remembering to call
  `ensemblr_focus_panel` is behaviour the user does not get. The pull is coalesced per workspace on a
  60-second window that **every comment op extends**, so a pass pulls focus once however many calls it
  makes and however long it runs, while a pass an hour later pulls again. A resolve batch that closed
  nothing pulls no focus at all — the same condition the cache-invalidation broadcast is gated on.

**Reads (cross-workspace):**
- `listWorkspaces()`, `listTabs({ workspaceId? })`, `listTerminals({ workspaceId? })`
- `getConversationStatus({ agentSessionId })`, `getLastMessage({ agentSessionId })`
- `readTerminalOutput({ terminalId })`

**Reads (own workspace only):**
- `getWorkspaceDiff({ filePath?, stat? })` → `{ baseRef, files?, summary?, diff?, truncated, omittedFiles }` — the workspace's branch diff, scoped like the Changes panel (`merge-base(base_branch, HEAD)` → working tree, untracked files included). `stat: true` returns rows and totals with **no** per-file git call; `filePath` returns one patch whole. The full read is capped at `MAX_AGENT_PAYLOAD_CHARS` (32,000), cut on whole-file boundaries, with the dropped paths in `omittedFiles`
- `getDiffComments({ filePath? })` → `{ comments }` — the workspace's Ensemblr-local review comments, each carrying `origin`. GitHub-synced PR threads are excluded: they are a live `gh` snapshot rather than local rows, and no op here could reply to or resolve one

**Added after the original vocabulary was locked.** The list above is the #166 surface plus the
review ops; the ops below arrived with later work and are recorded here so this section is not read
as the whole set. Their argument shapes live in
[`docs/agent-control.md`](../agent-control.md#tool-reference).

- `setWorkspaceStatus({ status })` / `getWorkspaceStatus()` — move and read the caller's own kanban
  column. The write is root-only: the status describes the whole workspace, not one delegated unit
- `waitForAgents({ targets?, mode?, reports?, timeoutMs? })` → `{ completed, pending, timedOut, note? }` —
  block on delegated children instead of polling. Classified a **read**, so it survives `read-only`
- `notifyOrchestrator({ reason, message })` — a child pulls its orchestrator back. Also a read, so a
  blocked child can escalate in any mode
- `askUserQuestion({ questions })` → `{ answers, cancelled, summary }` (#182, unbounded since #224) —
  put up to four multiple-choice questions to the human and block with no timeout. Chat-tab callers
  only, and refused to a sub-agent whatever the mode
- `exitPlanMode({ title, plan })` → `{ planPath, summary }` — hand a finished plan to the user and
  end the turn. Deliberately outside `WRITE_OPS` although it writes a file: it is the only exit from
  Plan Mode, so a mode gate would strand a planning agent with no way out
- `readConversation({ agentSessionId, stat?, fromOrdinal?, ordinal? })` (#194) — page a conversation's
  persisted transcript, tool calls included, so an orchestrator can audit what a child actually ran
  rather than trusting its report
- `listModels()` → `{ defaultModelId, models, runtime }` — cut to the caller's own agent runtime for
  a chat caller, unfiltered for a terminal harness whose runtime the app cannot name
- `listRunScripts()` → `{ scripts }` (#223) — the repository's named run scripts and which is default
- `getSessionBrief()` and `checkPlanModeTool({ tool, command? })` — control ops with **no** MCP tool.
  They are the Pi extension's own per-turn hooks; nothing reaches them over `POST /mcp`

## Components to build

> **Superseded — pre-pivot build plan (historical).** This section describes the original
> `extension_ui_request`/`extension_ui_response` + `protocol-dispatch` routing approach. The shipped
> design instead unifies on one loopback HTTP control server; **Architecture (as built)** above and
> **Implementation status** below are authoritative. Retained to record the reasoning behind the pivot.
>
> **Its file paths are historical too — do not follow them.** Five named below no longer exist:
> `pi-session-service.ts` and `pi-agent-client.ts`/`cli-rpc-pi-agent-adapter.ts` (session ownership
> moved to `src/main/agent-runtime/`; the Pi adapter is now the single
> `src/main/pi-agent/pi-cli-rpc-adapter.ts`), `mcp-server.ts` (shipped as
> `src/main/agent-control/mcp-endpoint.ts`), and `src/shared/agents/harness-registry.ts` (the registry
> is `src/shared/agents.ts`, and the injection seam turned out to be
> `src/main/agent-control/harness-launch-config.ts` rather than `buildCommand`).

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
- At agent spawn, mint a per-session record: `{ token, agentSessionId|harnessSessionId, workspaceId,
  parentSessionId, depth }`. Store in an in-memory registry keyed by token.
- **Pi:** inject `token` + endpoint into the pi extension via spawn env (extend
  `src/main/pi-agent/cli-rpc/spawn-env.ts`); Pi's own session id is already known to the adapter,
  so the extension_ui_request is tagged host-side, not by the agent.
- **Harness:** inject `token` into the MCP config written at launch (extend the harness launch
  path in `src/main/ipc/handlers/agents.ts` / `terminal-service.create`).
- Lineage (`parentSessionId`, `depth`) is derived when a spawn op runs: the child inherits
  `origin` from the caller. Used only for guardrails, never for cleanup.

### 4. Recursion guardrails — `src/main/agent-control/guardrails.ts`
- **Max depth:** deny spawn ops when `origin.depth >= MAX_SPAWN_DEPTH` (config, default **1**; see `DEFAULT_GUARDRAIL_CONFIG` in `src/main/agent-control/guardrails.ts`).
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
- Env injection: `resolveAgentControlEnv` threaded into the agent-session service
  (`src/main/agent-runtime/agent-session-service.ts`) → `agent-session-lifecycle.ts` →
  `session/session-open.ts` (per-session `env` overlay) and into `terminal-service` (assembled env).
  The Pi-specific `pi-session-service.ts` named in the superseded plan above no longer exists — session
  ownership moved to the provider-neutral `src/main/agent-runtime/` when Claude became a second
  first-class runtime.
- Composition in `src/main/main.ts`: server started on boot, env provider, native-dialog confirm,
  server closed on `will-quit`. Pi launched with `-e <ext>` only when the extension + `typebox` resolve.
- Pi extension shipped via Forge `extraResource` — `resources/pi-extensions/`.
- Tests: `tests/shared/agent-control.test.ts`, `tests/main/agent-control-{service,guardrails,
  origin-registry,control-server,mcp-endpoint}.test.ts` (the MCP test drives a real SDK client).

**Validated during the #166–#169 rollout (retained as the live-verification checklist):**

1. **Pi extension loading is install-agnostic.** Pi's own extension loader bundles `typebox` and
   `@earendil-works/pi-coding-agent` for extensions (jiti `alias` in Node/npm/brew installs via
   `require.resolve` from Pi's deps; `virtualModules` in the Bun compiled binary), so the extension
   needs no colocated `node_modules` regardless of how Pi was installed. Loading is also isolated:
   a failed `-e` extension is caught and reported, never crashing Pi — so `-e` is always safe to
   pass. Ensemblr resolves the Pi binary install-agnostically via `PiExecutableService`.
2. **Harness MCP auto-config — wired for all three harnesses.** `augmentHarnessCommand` (main.ts)
   decorates the launch command in both paths (user launch via `handlers/agents.ts`, agent launch
   via the harness port), built by `agent-control/harness-launch-config.ts`. Claude gets
   `--mcp-config '<json>'` whose bearer header expands `${ENSEMBLR_CONTROL_TOKEN}`; Codex gets `-c
   mcp_servers.ensemblr.url=… -c mcp_servers.ensemblr.bearer_token_env_var=ENSEMBLR_CONTROL_TOKEN`;
   **Vibe** has no MCP-config flag at all, so it gets a `VIBE_MCP_SERVERS='<json>'` env prefix with
   `api_key_env`. No harness ever receives the token value on its command line. The control-server
   URL is a session constant; the token is per-workspace. The harness playbook rides along the same
   seam — `--append-system-prompt-file` for Claude, `--add-dir` for Vibe, and for Codex the MCP
   server's `instructions` field, which is its only additive channel.
3. **End-to-end smoke:** launch the app, spawn Pi, confirm the `ensemblr_*` tools appear and a
   `spawnChatTab` + `startConversation` round-trips; then in each permission mode confirm
   `workspace-trusted` auto-runs, `approval-required` shows the dialog, `read-only` blocks writes.
4. Final review gate: `react-doctor` + `fallow` per repo code-review policy.
