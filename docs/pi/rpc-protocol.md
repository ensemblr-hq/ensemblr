# Pi RPC Protocol Notes

Phase 0 protocol discovery for the conversation timeline UI. Every fact below
cites the source it was read from. Facts marked `OBSERVED` were not stated in
docs and must be confirmed against the Phase 1 captures in
`tests/fixtures/pi-captures/`.

Sources inspected (pi `0.79.1`, from the `@earendil-works/pi-coding-agent`
npm-global install; the original capture predates the Bun→npm migration in
ADR 0038, so the historical `~/.bun/...` path below is stale — read the current
install from `npm ls -g @earendil-works/pi-coding-agent`):

- `docs/rpc.md` — primary RPC mode documentation (cited below as `rpc.md`)
- `dist/modes/rpc/rpc-mode.js` — RPC mode implementation
- `dist/modes/rpc/rpc-types.d.ts` — command/response/extension-UI types
- `dist/modes/rpc/rpc-client.js` — reference subprocess client
- Ensemblr's existing adapter: `src/main/pi-agent/pi-agent-client.ts`,
  `src/main/pi-agent/cli-rpc/*`

## Invocation

- RPC mode starts with `pi --mode rpc [options]` (`rpc.md` "Starting RPC
  Mode"). Ensemblr's base args are
  `DEFAULT_PI_RPC_ARGS = ['--mode', 'rpc']`
  (`src/main/pi-agent/pi-agent-client.ts:21`); `buildSessionArgs` then appends
  `--model <provider/id>`, `--thinking <level>`, and `--session-id <id>` from
  the resolved request when present.
- Useful flags: `--provider <name>`, `--model <pattern>`,
  `--name <session name>`, `--no-session` (disable persistence),
  `--session-dir <path>` (`rpc.md` "Starting RPC Mode"). Captures use
  `--no-session` plus explicit `--provider/--model` so fixtures do not depend
  on local default-model state.
- **Model/thinking selection (Ensemblr).** The picked model and thinking level
  bind at spawn via `--model`/`--thinking`. The `prompt` command carries **no**
  model field — Pi ignores unknown keys — so mid-session switches go through
  the RPC `set_model` (`{type,provider,modelId}`) and `set_thinking_level`
  (`{type,level}`) commands, which the adapter writes ahead of the next
  `prompt` only when the selection differs from what the runtime is already on
  (`src/main/pi-agent/cli-rpc-pi-agent-adapter.ts`).
- **Ephemeral utility sessions (Ensemblr).** Chat-title and session-summary
  generation spawn their own short-lived RPC sessions; each is launched with
  `--model` set to the chat's current model (`pi_sessions.model`) so they run on
  the same provider as the conversation rather than Pi's default
  (`pi-chat-title-service.ts`, `session-summary-writer.ts`).
- **Catalog caching (renderer).** `pi --list-models` output is cached in
  `localStorage` and used as React Query `initialData`, so the model picker is
  populated instantly on launch and refreshed silently in the background; an
  empty result never overwrites the last-known-good catalog
  (`src/renderer/api/ensemblr/pi-models-cache.ts`).

## Framing

- Strict JSONL: one JSON object per line on stdin (commands) and stdout
  (responses + events). LF (`\n`) is the only record delimiter; a trailing
  `\r` must be stripped; `U+2028`/`U+2029` are valid *inside* JSON strings and
  must not split records — Node `readline` is explicitly non-compliant
  (`rpc.md` "Framing").
- Events are emitted by piping every `AgentSessionEvent` through
  `output(event)` → `JSON.stringify` + `\n` (`rpc-mode.js`, `rebindSession`).
- stderr is not part of the protocol. Anything on stderr is diagnostic only.
  `OBSERVED`: confirm whether pi writes anything to stderr in normal runs.

## Client → agent: commands (stdin)

Full union in `rpc-types.d.ts` (`RpcCommand`). All commands accept an
optional `id` echoed back on the matching response (`rpc.md` "Protocol
Overview"). The ones the timeline client needs:

The complete set of frames Ensemblr actually writes to Pi stdin is
`prompt`, `steer`, `follow_up`, `set_model`, `set_thinking_level`, and
`get_session_stats` (`cli-rpc-pi-agent-adapter.ts`). Abort is an OS signal, not a
frame (see "Aborting"). The rest of the table is Pi capability, not app usage.

| Command | Shape | Notes |
|---|---|---|
| prompt | Pi contract: `{"type":"prompt","message":string}`. **Ensemblr sends** `{"type":"prompt","message":string,"turnId":string,"attachments":[]}` (`cli-rpc-pi-agent-adapter.ts`). | `turnId`/`attachments` are client metadata Pi ignores today; `attachments` is always empty. No `images` field is sent — image/file attachments are serialized *into* `message` as text (see "Attachments"). `streamingBehavior` is **not** a prompt field: when set, the adapter emits a separate `steer`/`follow_up` frame instead (`"steer"\|"followUp"`). Pi rejects a `prompt` with `success:false` if it is already streaming (`rpc.md` "prompt"). |
| steer | `{"type":"steer","message":string}` | Queued; delivered after current assistant turn's tool calls (`rpc.md` "steer") |
| follow_up | `{"type":"follow_up","message":string}` | Delivered when agent fully stops (`rpc.md` "follow_up") |
| get_session_stats | `{"type":"get_session_stats"}` | Token usage, cost, `contextUsage` — feeds the status bar. The app refreshes it on every `turn_end`/`agent_end` (`rpc.md` "get_session_stats"). |
| set_model / set_thinking_level | `{"type":"set_model","provider","modelId"}` / `{"type":"set_thinking_level","level"}` | Written ahead of the next `prompt` only when the selection differs from what the runtime is already on. Thinking levels: `off,minimal,low,medium,high,xhigh` |
| abort / get_state / new_session | Pi capabilities, **not used by Ensemblr** | Abort is done by signal, not this frame. Session status is derived from the `agent_start`/`turn_start`/`agent_end` lifecycle, so `get_state` is never sent. |

Response frames: `{"id?":string,"type":"response","command":string,
"success":boolean,"data?":...,"error?":string}` (`rpc.md` "Commands",
"Error Handling"). For `prompt`, `success:true` means *accepted/queued*;
post-acceptance failures arrive as events, never as a second response
(`rpc.md` "prompt").

## Agent → client: events (stdout)

Documented event types (`rpc.md` "Events"):

| Event | Payload highlights |
|---|---|
| `agent_start` | none |
| `agent_end` | `messages: AgentMessage[]` (everything generated this run) |
| `turn_start` | none |
| `turn_end` | `message` (assistant `AgentMessage`), `toolResults` |
| `message_start` / `message_end` | `message: AgentMessage` |
| `message_update` | `message` (partial) + `assistantMessageEvent` delta |
| `tool_execution_start` | `toolCallId`, `toolName`, `args` |
| `tool_execution_update` | + `partialResult` — **accumulated** output so far, not a delta (`rpc.md` "tool_execution_*") |
| `tool_execution_end` | + `result`, `isError` |
| `queue_update` | `steering: string[]`, `followUp: string[]` |
| `compaction_start` / `compaction_end` | `reason: "manual"\|"threshold"\|"overflow"`, result/abort/error fields |
| `auto_retry_start` / `auto_retry_end` | attempt counters, delay, error text |
| `extension_error` | `extensionPath`, `event`, `error` |

> Ensemblr models **none** of `queue_update`, `compaction_*`, `auto_retry_*`, or
> `extension_error` — they are Pi-runtime-provided but fall through the
> unknown-frame fallback (`protocol-dispatch.ts`, `parse.ts`) and never appear in
> the fixtures. Keep them documented as Pi-provided/unconsumed; do not treat them
> as app behavior. The modeled event set is enumerated in `event-taxonomy.md`.

`message_update.assistantMessageEvent` delta types (`rpc.md`
"message_update"): `start`, `text_start`, `text_delta`, `text_end`,
`thinking_start`, `thinking_delta`, `thinking_end`, `toolcall_start`,
`toolcall_delta`, `toolcall_end` (carries full `toolCall`), `done`
(reason `stop|length|toolUse`), `error` (reason `aborted|error`).

Documented lifecycle for one prompt (`rpc.md` examples):

```
response(prompt) → agent_start → turn_start
  → message_start → message_update* → message_end
  → [tool_execution_start → tool_execution_update* → tool_execution_end]*
  → turn_end
  → (more turns if the model issued tool calls)
→ agent_end
```

`OBSERVED`: exact interleaving of `message_end` vs `tool_execution_start`,
and whether `turn_end` fires per LLM call or per tool-loop iteration — verify
in `multi-tool-chain` capture.

## Message/event payload types

- `UserMessage` `{role:"user", content, timestamp, attachments}` — `content`
  is string or `TextContent|ImageContent[]` (`rpc.md` "UserMessage").
- `AssistantMessage` `{role:"assistant", content: (text|thinking|toolCall)[],
  api, provider, model, usage{input,output,cacheRead,cacheWrite,cost},
  stopReason, timestamp}`; stop reasons `stop|length|toolUse|error|aborted`
  (`rpc.md` "AssistantMessage").
- `ToolResultMessage` `{role:"toolResult", toolCallId, toolName, content,
  isError, timestamp}` (`rpc.md` "ToolResultMessage").
- Messages carry epoch-ms `timestamp` fields — candidate source for turn
  timing. `OBSERVED`: confirm presence/precision in captures; top-level event
  frames themselves are NOT documented to carry timestamps, so client capture
  time is the likely fallback.

## Aborting

- **Ensemblr aborts by signal, not by RPC frame.** `abort()` sends `SIGINT`, then
  `SIGKILL` after `killGraceMs` (`cli-rpc-pi-agent-adapter.ts`). The
  `{"type":"abort"}` command is a real Pi capability the app does not use.
- The in-flight assistant message still ends with
  `assistantMessageEvent.type:"error"`, `reason:"aborted"`, and/or
  `stopReason:"aborted"`, and `agent_end` still fires (confirmed in the
  `abort-mid-turn` capture; sealed with `stopReason:"aborted"` in `reducer.ts`).

## Attachments

- Image/file/@-mention attachments are serialized **into the prompt `message`
  text**, not sent as a structured field. Files and images become
  `<attached_file path="…">…</attached_file>` blocks and referenced directories
  become a `Referenced workspace folders:\n@<path>` header
  (`src/renderer/lib/workbench/mention-payload.ts`), round-tripped by
  `src/renderer/lib/pi/prompt-attachment-parser.ts`.
- Raster images are saved to the workspace `.context/images/` and referenced by
  path only — no image bytes cross the RPC wire (ADR 0036,
  `composer-attachments.ts`).

## Tool approval / permission handshake

- pi has **no built-in tool-approval gate** in RPC mode. The only
  user-interaction handshake is the **extension UI protocol**: extensions
  call `ctx.ui.select()/confirm()/input()/editor()`, which surface as
  `{"type":"extension_ui_request","id":..., "method":...}` on stdout and
  block until the client replies
  `{"type":"extension_ui_response","id":...,"value"|"confirmed"|"cancelled"}`
  on stdin (`rpc.md` "Extension UI Protocol"). Fire-and-forget methods
  (`notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`) expect
  no reply.
- Consequence for Phase 1: the `permission-gate` scenario requires installing
  a small extension in the sandbox project (`.pi/agent/extensions/`) that
  gates a tool via `ctx.ui.confirm()`; without one, no approval events exist
  to capture. If that holds, the timeline gets an extension-UI dialog item,
  not a bespoke "permission" item.

## Noise / non-timeline traffic

- `queue_update`, `auto_retry_*`, `compaction_*`, `extension_error`, and
  command `response` frames are session/status traffic, not conversation
  content. `get_session_stats` responses feed the status bar (tokens, cost,
  `contextUsage`) (`rpc.md` "get_session_stats").
- The `bash` RPC command's `BashExecutionMessage` emits **no event** and only
  enters LLM context on the next prompt (`rpc.md` "bash") — irrelevant to the
  timeline unless Ensemblr later exposes user-run shell commands.

## Known deviations to verify in Phase 1

1. Whether any frame besides documented events/responses appears on stdout
   (e.g. a session header line on startup).
2. Whether thinking deltas are emitted for the configured default model and
   thinking level.
3. ANSI escapes inside `tool_execution_update.partialResult` text — kept or
   stripped by pi.
4. Truncation behavior for very long tool output (`details.truncation`,
   `fullOutputPath` fields seen in `rpc.md` bash examples).

## Capability discovery (ENS-035 / THE-135)

Probed live on 2026-06-11 against pi `0.79.1` (then a Bun-global install; the
project has since moved to npm — ADR 0038), via
`pi --mode rpc --no-session --offline` with JSONL commands on stdin, plus a
full read of `dist/modes/rpc/rpc-types.d.ts` (`RpcCommand` union) and
`pi --help`. Unknown commands fail safely:
`{"type":"response","command":"<name>","success":false,"error":"Unknown command: <name>"}`.

| Capability | Status | Evidence / mechanism |
|---|---|---|
| Model listing | **Supported** | `get_available_models` returned 8 models offline; `set_model`, `cycle_model` in `RpcCommand` |
| Thinking levels | **Supported** | `set_thinking_level` / `cycle_thinking_level`; levels `off,minimal,low,medium,high,xhigh`; per-model `thinkingLevelMap` visible in `get_state` |
| Context usage | **Supported** | `get_session_stats` (`contextUsage`) + `usage` on assistant messages |
| Compaction | **Supported** | `compact` command (`customInstructions?`), `set_auto_compaction`; `compaction_start/end` events |
| Plan mode | **Unsupported in core** | `{"type":"plan_mode"}` → `Unknown command`. Help text: "Extensions can register additional flags (e.g., `--plan` from plan-mode extension)" — plan mode exists only as an optional extension (not installed here; `pi list` shows none). Would surface via extension slash commands / `get_commands`, not a core RPC toggle |
| Fast mode | **Unsupported** | No CLI flag, no RPC command (`set_fast_mode` → `Unknown command`). No core concept of a fast/low-latency output mode |
| Browser control | **Unsupported in core** | No CLI flag, no RPC command, no built-in tool (built-ins are read/bash/edit/write). Only achievable via an extension-provided tool |
| Separate review model | **Unsupported as a setting** | No review-model concept anywhere in `RpcCommand` or flags. A review pass must be a separate Ensemblr-managed session spawned with its own `--model` |
| Tool allowlist (read-only / approval-required) | **Partially supported** | Spawn-time only: `--tools`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools` all accepted in `--mode rpc` (verified: `--tools read,grep,glob,ls`, `--no-tools`, `--exclude-tools bash,write,edit` start cleanly). There is **no runtime RPC command** to change the allowlist mid-session, and no built-in approval gate — approval-required needs the extension `confirm()` handshake (see "Tool approval / permission handshake") |
| Steering / follow-up modes | **Supported (bonus)** | `set_steering_mode` / `set_follow_up_mode` (`all` \| `one-at-a-time`) |
| Auto retry | **Supported (bonus)** | `set_auto_retry`, `abort_retry` |
| Session ops | **Supported by Pi, unused by Ensemblr** | `switch_session`, `fork`, `clone`, `get_fork_messages`, `get_messages`, `set_session_name`, `export_html`, client-side `bash`. Ensemblr uses **none** of these over RPC — conversation "forking" is an app-side markdown summary plus a SQLite branch kind (`'main'\|'retry'\|'fork'`, `pi-session-service.ts`), and per-turn "checkpoints" are git snapshots on a private ref namespace `refs/ensemblr/checkpoints/…` (ADR 0012, `src/main/checkpoints/git-checkpoint.ts`), captured before each user turn. |

### Recommendations for Ensemblr settings (v1)

- **Enable:** model picker, thinking level, context usage, manual + auto
  compaction toggles (all already wired or trivially wireable).
- **Implement Ensemblr-side:** read-only / approval-required permission modes
  as *spawn profiles* — restart the RPC process with the corresponding
  `--tools` / `--exclude-tools` set. Mid-session permission switching is not
  possible without a restart; the settings UI must say so.
- **Defer:** plan mode (revisit if the plan-mode extension becomes a managed
  dependency; remember RPC mode loads no project extensions without explicit
  `-e`), browser control (no core support), separate review model (model
  picker per session covers the need — a "review with different model" flow
  should open a new session).
- **Decision Needed:** none of the deferred gaps block v1 — no Conductor-parity
  feature in scope depends on plan/fast/browser modes.
