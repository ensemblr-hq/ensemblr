# Pi RPC Protocol Notes

Phase 0 protocol discovery for the conversation timeline UI. Every fact below
cites the source it was read from. Facts marked `OBSERVED` were not stated in
docs and must be confirmed against the Phase 1 captures in
`src/renderer/fixtures/pi-captures/`.

Sources inspected (pi `0.79.1`, installed at
`~/.bun/install/global/node_modules/@earendil-works/pi-coding-agent`):

- `docs/rpc.md` — primary RPC mode documentation (cited below as `rpc.md`)
- `dist/modes/rpc/rpc-mode.js` — RPC mode implementation
- `dist/modes/rpc/rpc-types.d.ts` — command/response/extension-UI types
- `dist/modes/rpc/rpc-client.js` — reference subprocess client
- Ensemble's existing adapter: `src/main/pi-agent/pi-agent-client.ts`,
  `src/main/pi-agent/cli-rpc/*`

## Invocation

- RPC mode starts with `pi --mode rpc [options]` (`rpc.md` "Starting RPC
  Mode"). Ensemble already spawns it with exactly
  `DEFAULT_PI_RPC_ARGS = ['--mode', 'rpc']`
  (`src/main/pi-agent/pi-agent-client.ts:21`).
- Useful flags: `--provider <name>`, `--model <pattern>`,
  `--name <session name>`, `--no-session` (disable persistence),
  `--session-dir <path>` (`rpc.md` "Starting RPC Mode"). Captures use
  `--no-session` plus explicit `--provider/--model` so fixtures do not depend
  on local default-model state.

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

| Command | Shape | Notes |
|---|---|---|
| prompt | `{"type":"prompt","message":string,"images?":ImageContent[],"streamingBehavior?":"steer"\|"followUp"}` | Rejected with `success:false` if agent is streaming and no `streamingBehavior` given (`rpc.md` "prompt") |
| steer | `{"type":"steer","message":string}` | Queued; delivered after current assistant turn's tool calls (`rpc.md` "steer") |
| follow_up | `{"type":"follow_up","message":string}` | Delivered when agent fully stops (`rpc.md` "follow_up") |
| abort | `{"type":"abort"}` | Aborts current operation (`rpc.md` "abort") |
| new_session | `{"type":"new_session"}` | Fresh session (`rpc.md` "new_session") |
| get_state | `{"type":"get_state"}` | Model, thinking level, `isStreaming`, session file/id/name, message counts (`rpc.md` "get_state") |
| get_session_stats | `{"type":"get_session_stats"}` | Token usage, cost, `contextUsage` — feeds the status bar (`rpc.md` "get_session_stats") |
| set_model / set_thinking_level | see `rpc.md` | Thinking levels: `off,minimal,low,medium,high,xhigh` |

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

- `{"type":"abort"}` on stdin; current operation stops; the in-flight
  assistant message ends with `assistantMessageEvent.type:"error"`,
  `reason:"aborted"`, and/or `stopReason:"aborted"` (`rpc.md` "abort",
  "AssistantMessage"). `OBSERVED`: exact terminal event sequence after abort
  (does `agent_end` still fire?) — verify in `abort-mid-turn` capture.

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
  timeline unless Ensemble later exposes user-run shell commands.

## Known deviations to verify in Phase 1

1. Whether any frame besides documented events/responses appears on stdout
   (e.g. a session header line on startup).
2. Whether thinking deltas are emitted for the configured default model and
   thinking level.
3. ANSI escapes inside `tool_execution_update.partialResult` text — kept or
   stripped by pi.
4. Truncation behavior for very long tool output (`details.truncation`,
   `fullOutputPath` fields seen in `rpc.md` bash examples).
