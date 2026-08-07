# 0042. Add Claude Code as a Second First-Class Agent Runtime

Date: 2026-08-06

## Status

Accepted

Relates to [0025](0025-use-pi-cli-rpc-with-executable-discovery.md) (Pi CLI RPC
runtime), [0040](0040-use-loopback-control-server-for-agent-app-control.md)
(loopback control server), [0012](0012-use-git-backed-checkpoints-for-pi-turns.md)
(git-backed checkpoints) and [0016](0016-use-workspace-trusted-local-execution.md)
(workspace permission modes).

## Context

Ensemblr ran exactly one agent natively: **Pi**. Pi owned the whole first-class
surface — chat tabs, the streaming timeline, tool-call cards, plan mode,
checkpoints, forking, session summaries, the `ensemblr_*` control tools, and the
model picker. Claude Code existed only as a **terminal harness**
([`harnesses.md`](../harnesses.md)): the `claude` TUI inside a `node-pty` tab,
with MCP auto-config and native-session resume, but no chat tab, no structured
timeline, no permission UI and no model picker.

We wanted Claude Code on the native chat surface as a peer of Pi.

Two things made that tractable and one thing made it risky.

`src/main/pi-agent/pi-agent-adapter.ts` already defined a swappable interface —
`createSession` / `shutdown`, and a session exposing
`abort/close/getMetadata/getState/id/setSessionName/subscribe/submit`. The event
and persistence vocabulary below it (`PiAgentEvent`, `PiWireMessagePayload`,
`PiPersistedEnvelope`) was already provider-neutral **in shape**; only the
*names* were `pi`-prefixed.

The risk was that "add a second adapter" quietly becomes "translate Claude into
Pi". A `pi`-named event union, a `pi_sessions` table and a `submitPiPrompt`
channel would make every future runtime a guest in Pi's house, and each new one
would pay the translation tax again.

## Decision

### 1. Drive Claude Code through `@anthropic-ai/claude-agent-sdk`, in-process

Add the SDK as an npm dependency and drive it from the main process, with a
user-settable executable override. This is what Conductor does; inspecting its
bundled runtime yields verbatim SDK internals (`CLAUDE_CODE_ENTRYPOINT="sdk-ts"`,
`--output-format stream-json --verbose --input-format stream-json`, `--resume=`,
and the option names `pathToClaudeCodeExecutable`, `forkSession`,
`settingSources`, `permissionMode`).

**Streaming-input mode is mandatory.** `interrupt()`, `setModel()` and
`setPermissionMode()` exist only when `prompt` is an
`AsyncIterable<SDKUserMessage>`, so a Claude session holds a long-lived async
generator and pushes user turns into it — structurally the same as the existing
long-lived Pi RPC child.

**Authentication is the child's job, not ours.** A Phase-0 spike
(`.context/claude-sdk-spike/FINDINGS.md`) confirmed that both the SDK-bundled
`claude` and a `pathToClaudeCodeExecutable` override authenticate through the
login Keychain under a Finder-like stripped env
(`env -i HOME USER PATH TMPDIR LANG`).

**We do not ship the SDK's bundled binary; a user-installed `claude` is
required.** The SDK's runtime lives in per-platform optional packages
(`@anthropic-ai/claude-agent-sdk-darwin-arm64` and siblings) carrying a ~260 MB
executable. `forge.config.ts` keeps only the SDK's own `sdk.mjs` package and
excludes those siblings, so the bundled tier does not exist in a packaged app.

The reason is that shipping it buys nothing: authentication is interactive and
Keychain-backed, so the user installs and runs `claude /login` regardless —
paying ~260 MB for a second copy of a binary they already have is not a
tradeoff worth making. Executable resolution is therefore **configured override
→ PATH → not found**, and not-found is a first-class error state carrying an
install remediation (the official `curl -fsSL https://claude.ai/install.sh |
bash`, copied to the clipboard, never executed) rather than a silent fallback.
A session that opens with no binary fails with that message instead of an
opaque SDK spawn error, and the model picker simply lists no Claude models.

The cost is that dev and packaged behaviour had to be made *consistent* rather
than convenient: in dev the SDK's binary happens to exist under `node_modules`,
so before this change dev worked silently while a packaged build would not.
That divergence is removed — dev is not special-cased.

### 2. A provider-neutral shared surface — siblings, not a translation layer

The runtime vocabulary moved into `src/main/agent-runtime/`: `AgentEvent`,
`AgentAdapter`, `AgentSessionRequest`, and `createAgentClient`, which dispatches
on `request.provider` across an adapter map. Pi's CLI-RPC implementation and
Claude's SDK implementation are peers behind it; neither is the other's host.

The same principle was applied downwards through persistence, IPC and the
renderer: `PiSessionSnapshot` → `AgentSessionSnapshot`, `PiPersistedEnvelope` →
`AgentPersistedEnvelope`, `ensemblr:submit-pi-prompt` →
`ensemblr:submit-agent-prompt`, `lib/pi-timeline/` → `lib/agent-timeline/`, and
migration `014_agent_session_vocabulary` renaming `pi_sessions` →
`agent_sessions`, `pi_session_events` → `agent_session_events`,
`pi_session_branches` → `agent_session_branches`, `pi_turns` → `agent_turns`,
`pi_runtime_state` → `agent_runtime_state`.

The `pi_session_id` columns split rather than renaming uniformly, because one
name was covering three different ids. `chat_tabs.pi_session_id` and
`checkpoints.pi_session_id` are foreign keys to a session row and became
`agent_session_id`; `pi_sessions.pi_session_id` is the **runtime-native** id
handed to the CLI as `--session-id`, on a row whose own key is `id`, and became
`runtime_session_id`. A third id — the *harness* CLI's own session id, used for
`--resume` on a terminal tab — is `harnessSessionId`. All three had briefly
collided on `agentSessionId`, which TypeScript could not distinguish; keeping
them apart is load-bearing, not cosmetic.

Names that describe **the Pi CLI specifically** kept their prefix: the RPC wire
frames (`src/shared/pi-rpc/`), the stdio transport (`src/main/pi-ipc/`),
executable discovery and readiness (`src/main/pi-runtime/`), the
`pi --list-models` scrape, Pi slash commands, and the shipped Pi extension. The
test is whether the concept exists for every runtime or only for Pi.

The full classification rule is recorded in
`.context/plans/shared-surface-rename-map.md`.

A third runtime implements `AgentAdapter` and registers a provider id. Nothing
routes through Pi.

### 3. Use Claude's own plan mode and MCP, not Ensemblr's synthesised ones

Ensemblr synthesises plan mode and control tools for Pi because stock Pi has
neither. Claude Code ships both, so Claude uses its own:

- **Plan mode** is `permissionMode: 'plan'` plus Claude's native `ExitPlanMode`
  tool. `claude-plan-mode.ts` lifts that call into the plan-review broadcast the
  renderer already consumes, so `usePlanReview` and `plan-review-panel.tsx` work
  unmodified. `PLAN_MODE_GUARDED_TOOLS` (`src/shared/plan-mode/tool-guard.ts`)
  names Pi tools and is **not** applied to Claude.
- **Ensemblr Control** is delivered as a native MCP server entry pointing at the
  loopback server from ADR 0040:
  `mcpServers: { ensemblr: { type: 'http', url, headers } }`. The awareness
  playbook is appended via
  `systemPrompt: { type: 'preset', preset: 'claude_code', append }`, and
  `settingSources: ['project']` loads the repo's `CLAUDE.md`.

### 4. "Has a chat tab" is the real predicate, not "is Pi"

`AgentSpecies` widens to `'pi' | 'claude' | 'harness'`. The four control-service
gates that denied `setSummary`, `askUserQuestion`, plan-mode ops and `setName`
with `species !== 'pi'` now test for the harness case instead. First-class
Claude gets the orchestrator/subagent awareness playbooks, not
`HARNESS_AWARENESS`, and the MCP tool list is filtered per origin so a harness
still cannot see chat-tab tools.

### 5. A chat is pinned to one provider

Any model may be chosen while a chat is new (`activeSessionId == null`). Once a
chat has a session, the picker offers only same-provider models — other
providers' models render **visible-but-disabled** with a "start a new chat to
switch provider" tooltip, because a silently shrinking list reads as a bug.

**The main process derives the runtime; the renderer never states it.** The open
request carries a model id, and main resolves that id's `agentProvider` against
its own merged catalog. The wire contract deliberately has no `provider` field,
so a stale or hostile renderer cannot assert one — the enforcement falls out of
the design instead of needing a validation step. Opening or submitting a model
belonging to the other runtime against an existing session is rejected with
`provider-mismatch`, mirroring the existing `resolveModel` rule for sub-agent
spawn.

A model id no catalog claims means *no opinion*, not *Pi*: a new session falls
back to the default, and an existing session is never rejected. Rejecting
requires positive knowledge that the model belongs to the other runtime, so a
catalog outage can never break a chat that works today.

Note the two distinct axes: a model's `provider` is its **inference** provider
(`anthropic`, `openai`) and drives grouping; `agentProvider` is the **agent
runtime** and drives the pin.

### 6. Do not enable the SDK's file checkpointing

`enableFileCheckpointing` stays off. Ensemblr's checkpoints are git-backed and
wrap turns (ADR 0012); two checkpoint systems over one worktree would fight.

### 7. The workspace permission mode is enforced for Claude only

Agents having full control of their workspace is intended product behaviour —
the workspace's git worktree is the isolation boundary, and
`workspace-trusted` is and remains the default. What was broken is that the two
*stricter* modes were decorative: `security.permissionMode` reached the IPC
channel gate and the `ensemblr_*` control tools, but never the agent runtime.
Selecting `read-only` changed nothing about what an agent would do.

For Claude that is now real, because the SDK gives us enforcement points:

| Ensemblr mode | SDK |
| --- | --- |
| `workspace-trusted` (**default**) | `permissionMode: 'bypassPermissions'`, no prompt |
| `approval-required` | `permissionMode: 'default'` + `canUseTool` → a live per-tool approval card |
| `read-only` | `permissionMode: 'plan'` **plus** `disallowedTools` for the mutating set |

`read-only` needs both halves: plan mode is a mode the model can leave, so the
deny list is what actually holds.

**Pi is deliberately left unenforced.** Its CLI takes no permission flag, so the
only lever would be a `before_tool_use` deny/confirm hook in the shipped
extension — the same round-trip Plan Mode uses. Per the user's decision, Pi
keeps unrestricted workspace control and that machinery is not built.

The approval card reuses the `ComposerSlot` swap `askUserQuestion` already owns,
and offers Allow / Allow for this session / Deny. "Allow for this session" is an
in-memory, session-scoped set of tool names — never persisted, never shared
across sessions. Prompts are serialized per session, because one assistant
message can carry parallel tool calls and the slot holds one card. Every
teardown path — session stop, session close, app quit, and the SDK's own
per-request abort on `interrupt()` — resolves the outstanding promise and
withdraws the card; the callback never returns `null`, which would park the tool
indefinitely.

`src/shared/agents.ts` still bakes `--dangerously-skip-permissions` into the
*harness* `claude` launch by product decision. First-class Claude must never
inherit it, and the two code paths stay visibly distinct so the default cannot
leak across.

## Consequences

- **One accepted parity gap.** Pi emits `tool_execution_update` carrying
  accumulated partial tool output, so a long `bash` streams into its tool card.
  The Agent SDK runs tools inside Claude Code and returns each `tool_result`
  complete, so a Claude tool card shows a spinner until the result lands. This
  is not fixable from our side; it is surfaced rather than faked.
- **Dependency movement.** The SDK pulls in `@anthropic-ai/sdk` and requires
  `@modelcontextprotocol/sdk ^1.29.0`; the repo's pin moved from `^1.24.3` to
  `^1.30.0`. Only `mcp-endpoint.ts` and its test import it.
- **Claude Code is a prerequisite, not a bundled component.** A user with no
  `claude` on PATH gets a failing Providers tab with install and login steps,
  and cannot open a Claude chat until they resolve it. Pi already worked this
  way (ADR 0004), so the two runtimes now share one story: Ensemblr drives the
  agent CLI you installed, it does not ship one.
- **Migration 014 is one-way.** Renaming the tables means an older build cannot
  read a migrated database. Migrations `001`–`013` are frozen and still create
  the `pi_*` names; only `014` renames.
- **The terminal harness stays.** Native Claude is additive; the `claude` TUI tab
  is unchanged. [`harnesses.md`](../harnesses.md) distinguishes the two.
- **Thinking axes stay separate.** Pi has a six-level `off…xhigh` enum; Claude
  has `EffortLevel` (`low|medium|high|xhigh|max`) with per-model
  `supportedEffortLevels`. Each model entry carries its own levels; they are
  never conflated into one global scale.
