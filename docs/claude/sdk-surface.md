# Claude Agent SDK Surface

Exactly which of `@anthropic-ai/claude-agent-sdk` Ensemblr touches, and how its
messages become Ensemblr's provider-neutral `AgentEvent` stream. The narrative
guide is [`README.md`](./README.md); this file is the lookup table.

Everything below was read out of the source, not out of the SDK's docs. Where a
row says "not set", it means no code path in this repo sets it — not that the SDK
lacks the option.

Verified against the tree at `4fbeb65` on 2026-08-08 (SDK pinned `^0.3.223`).

## `query({ options })` — a chat session

Built by `buildQueryOptions` in
`src/main/claude-agent/claude-agent-adapter.ts`. This is the one place a
provider-neutral `AgentSessionRequest` becomes SDK vocabulary — the counterpart
of `buildPiSessionArgs` for Pi.

| Option | Value | Why |
|---|---|---|
| `permissionMode` | `bypassPermissions` \| `default` \| `plan` | From `resolvePermissionSettings({ mode, planMode })`; the plan-mode toggle wins over the workspace mode |
| `allowDangerouslySkipPermissions` | `true`, only in `workspace-trusted` | Pairs with `bypassPermissions` |
| `disallowedTools` | `Bash`, `BashOutput`, `Edit`, `KillShell`, `NotebookEdit`, `Write` — only in `read-only` | Plan mode is a mode the model can leave; the deny list is what actually holds |
| `canUseTool` | set only in `approval-required` | The per-tool approval card; falls back to an allow-and-warn placeholder when the composition root wired no gate |
| `cwd` | `metadata.cwd` | The workspace worktree |
| `env` | `stripLaunchContextEnv({ ...baseEnv, ...metadata.env })` | `baseEnv` is the login-shell env (ADR 0003 / ADR 0031) so a Finder-launched app still finds `claude`; the strip drops the macOS/Electron launch-context keys that would make LaunchServices re-attribute the child to Ensemblr |
| `includePartialMessages` | `true` | Required for `stream_event` deltas — without it the timeline has no streaming text |
| `effort` | `low` \| `medium` \| `high` \| `xhigh` \| `max` | From `toClaudeEffortLevel(request.thinkingLevel)` |
| `maxThinkingTokens` | `0`, **only** when no `effort` resolved | How the SDK expresses "do not think"; the two are mutually exclusive in this code |
| `mcpServers` | the `ensemblr` control server, omitted when the map is empty | See [Control MCP entry](#control-mcp-entry) below |
| `model` | `request.modelOverride`, when non-blank | Otherwise the runtime picks |
| `pathToClaudeCodeExecutable` | the resolved `claude` path, when one resolved | Ensemblr ships no binary |
| `resume` | the runtime session id, when `resumeRuntimeSession` is true | Loads an existing transcript |
| `sessionId` | the runtime session id, when it is **not** a resume | Assigns the id up front; cannot be combined with `resume` unless `forkSession` is set, which this adapter never sets |
| `settingSources` | `['project', 'user']` | The SDK opts out of repo `CLAUDE.md` and project settings by default, unlike the interactive CLI; a first-class chat is expected to honour them |
| `stderr` | a callback into a 64 KiB ring buffer | Kept as `detail` on the `adapter-failure` error when the stream dies |
| `systemPrompt` | `{ type: 'preset', preset: 'claude_code', append? }` | `append` carries the agent-control role playbook, when the session has one |

**Not set, deliberately:** `enableFileCheckpointing` — Ensemblr's checkpoints are
git-backed and wrap turns (ADR 0012); two checkpoint systems over one worktree
would fight (ADR 0042 §6). `forkSession` — see the `sessionId` row.

Neither `resume` nor `sessionId` is passed when the session has no runtime id
yet; the SDK generates one and reports it back through the `system`/`init`
message.

### Control MCP entry

Built by `buildClaudeMcpServers` in
`src/main/claude-agent/claude-mcp-config.ts`:

| Field | Value |
|---|---|
| server name | `ensemblr` — the same name the terminal harnesses use, so `ensemblr_*` tool names resolve identically whichever runtime reads a playbook |
| `type` | `http` |
| `url` | `new URL('/mcp', control.url)` |
| `headers.Authorization` | `Bearer ${ENSEMBLR_CONTROL_TOKEN}` — an **env-var reference**, not the token |

The map is empty (and the option omitted) when the control server has no url or
no token. The reference rather than the literal matters: the SDK serialises this
map verbatim into a `--mcp-config` argument, so a literal token would be readable
via `ps`.

## `query({ options })` — capability sessions

The four short-lived sessions that read capabilities rather than run a
conversation. All four run `permissionMode: 'plan'` so the child cannot touch
anything, and all four close in a `finally`.

| Caller | File | `cwd` | Extra options | Reads |
|---|---|---|---|---|
| Slash commands | `src/main/claude-agent/claude-slash-commands.ts` | workspace dir | — | `supportedCommands()` |
| MCP roster | `src/main/claude-agent/claude-mcp-roster.ts` | workspace dir | — | `mcpServerStatus()`, polled |
| Model lister | `src/main/claude-agent/claude-model-lister.ts` | not set | — | `supportedModels()`, `getContextUsage()` |
| Readiness probe | `src/main/agent-providers/claude-readiness-probe.ts` | not set | `abortController` | `accountInfo()`, `mcpServerStatus()` |

All four set `env: stripLaunchContextEnv({ ...baseEnv })` and
`pathToClaudeCodeExecutable`, and all four report the runtime as unavailable
rather than spawning when no executable resolved. The readiness probe is the only
one holding an `AbortController`, because it is the only one with a deadline
(20 s) that has to tear a wedged child down.

Each of these hands `query()` an input stream that is opened and never fed,
because these methods answer without a turn: the three in `claude-agent/` reuse
`createPromptQueue()`, and the readiness probe has its own local
`createIdlePromptStream()` so `agent-providers/` does not reach into the adapter
concern.

## `Query` methods called

| Method | Called from | Notes |
|---|---|---|
| `interrupt()` | adapter `abort()` | Then the turn is settled and the session shut down as `aborted` |
| `close()` | adapter `abort()`/`close()`, every capability session's `finally` | |
| `setModel(model)` | `applyTurnSelection` | Only when the requested model differs from what is applied |
| `applyFlagSettings({ effortLevel })` | `applyTurnSelection` | The effort dial; only on a genuine change |
| `setPermissionMode(mode)` | `applyTurnSelection` | Re-asserted per turn because native `ExitPlanMode` moves it behind the adapter's back |
| `getContextUsage()` | adapter `probeContextUsage()`, model lister | Ensemblr reads `maxTokens`, `totalTokens`, and (in the lister) `model` |
| `supportedModels()` | model lister | `ModelInfo[]`; account entitlements decide the list |
| `supportedCommands()` | slash-command discovery | `SlashCommand[]`, with no provenance field |
| `mcpServerStatus()` | MCP roster, readiness probe | `McpServerStatus[]` — `name`, `status`, `error` |
| `accountInfo()` | readiness probe | `AccountInfo` for the `auth` check |

`applyTurnSelection` skips all three setters entirely when the submission is a
steer or follow-up: the runtime is already committed to a turn.

## Input: the prompt stream

`prompt` is always an `AsyncIterable<SDKUserMessage>` from
`src/main/claude-agent/prompt-queue.ts`, never a bare string. Streaming input is
not optional — `interrupt()`, `setModel()`, and `setPermissionMode()` exist only
in that mode.

Each turn is pushed as:

```ts
{ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null }
```

where `prompt` is the user's text with the per-turn upkeep block prepended by
`withTurnPreamble`, when there is one. The queue parks on a promise between
turns and drains anything queued in the same tick as `close()`.

## Output: `SDKMessage` → `AgentEvent`

Translated by `createSdkMessageNormalizer` in
`src/main/claude-agent/sdk-message-normalizer.ts`. One instance per session; it
remembers the reported status, the active turn id, the last known window, and the
main model.

| SDK message | Subtype / delta | Emits |
|---|---|---|
| `system` | `init` | `metadata` (model + runtime `sessionId`, via `onDiscovery`); `status` `starting`→`idle` **only** if still `starting` |
| `system` | `compact_boundary` | `context-usage` from `compact_metadata.post_tokens` |
| `stream_event` | `message_start` | nothing — resets the reasoning buffer |
| `stream_event` | `content_block_delta` / `text_delta` | `message` · `text-delta` (broadcast, never persisted) |
| `stream_event` | `content_block_delta` / `thinking_delta` | `message` · `reasoning-delta`, **and** banks the text under the block index |
| `stream_event` | `content_block_delta` / `input_json_delta` | dropped — the wire union has no partial-tool-input variant and the seal delivers the complete input a moment later |
| `assistant` | — | `status`→`streaming`; `message` seal (`text` / `reasoning` / `tool-call` parts); one `message` · `tool-call` per `tool_use` block; `context-usage` when this is a main-thread response |
| `user` | tool output | one `message` · `tool-result` per `tool_result` block |
| `user` | prompt echo | dropped — the adapter already emitted the prompt on submit |
| `result` | any | `context-usage` (window from `modelUsage`); `status`→`idle` |
| `result` | subtype ≠ `success` | additionally a recoverable `error`, `Claude ended the turn: <subtype>.` |
| anything else | | dropped |

That last row is a deliberate choice, recorded in the normalizer's JSDoc: Pi
emits a handful of frame types and the SDK emits dozens (hook chatter, task
notifications, rate-limit pings), so unmodelled types are dropped rather than
forwarded as `unknown` — each would otherwise surface as a system notice on the
timeline.

### Message parts

`toMessagePart` projects one Anthropic content block:

| Block type | Part |
|---|---|
| `text` | `{ kind: 'text', text }`, dropped when empty |
| `thinking` | `{ kind: 'reasoning', text }` — the block's own text, else the banked deltas, else `''`; the row is kept even when both are empty |
| `tool_use` | `{ kind: 'tool-call', name, toolCallId, input }`, named after the tool when the block carries no id |
| `tool_result` | handled by the `user` branch |
| anything else | dropped |

A `tool-result` payload carries `{ content, details }`. `details` is filled only
for a lone result (one message reports one tool's structured output however many
results it batches) and only when `tool_use_result.structuredPatch` yields
complete hunks; `type: 'create'` is skipped. See
`src/main/claude-agent/tool-result-details.ts`.

### Context-usage arithmetic

| Quantity | Source |
|---|---|
| occupancy | one main-thread `assistant` message's own `message.usage`: `input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens` |
| window | `result.modelUsage` entry matching the main model by id or `canonicalModel`, else the widest reported entry |
| opening seed | `getContextUsage()` → `{ contextWindow: maxTokens, tokens: totalTokens }`, seeding only unknown halves and only before the first snapshot |
| after compaction | `compact_metadata.post_tokens` |
| `percent` | `tokens / contextWindow * 100`, or `null` when no window is known |

A message with `parent_tool_use_id !== null` is a subagent response: it seals
normally but never updates occupancy. No snapshot is emitted until both halves
are non-zero, and an unchanged reading is not re-emitted.

## Adapter-emitted events the SDK has no say in

| Event | When |
|---|---|
| `message` · `prompt` | on `submit`, before the prompt is pushed to the runtime and whether or not the turn later fails |
| `status`→`streaming` | on `submit`, via `normalizer.beginTurn()` |
| `metadata` `status: 'starting'` | at session construction |
| `metadata` `status: 'streaming'` | on `submit` |
| `metadata` `status: 'closed'` / `'errored'` | on close/abort and on a pump failure |
| `error` `spawn-error` | `query()` threw synchronously — "Failed to start Claude Code." |
| `error` `adapter-failure` | the message stream threw (detail carries the cause plus buffered stderr), or `interrupt()` failed (recoverable) |
| `shutdown` | `completed` \| `crashed` \| `aborted` \| `manual` |

Events emitted before the first `subscribe` are buffered and replayed to the
first subscriber — without that, a failure raised while `query()` is still
starting would be emitted to nobody, because the caller has not returned from its
`await` yet.

## Error codes

`AgentErrorCode` is provider-neutral (`src/main/agent-runtime/agent-types.ts`)
and runs `adapter-failure`, `invalid-cwd`, `invalid-executable`,
`session-closed`, `spawn-error`, `submit-failed`. The Claude path raises two of
them:

| Code | Raised by | Cause | `recoverable` |
|---|---|---|---|
| `spawn-error` | adapter | `query()` threw synchronously | no |
| `adapter-failure` | adapter | the message stream threw | no |
| `adapter-failure` | adapter | `interrupt()` threw | yes |
| `adapter-failure` | normalizer | a `result` whose subtype is not `success` | yes |

The first four are emitted as `error` events on the session stream. The
provider-neutral client in `src/main/agent-runtime/agent-client.ts` **throws**
rather than emits — an unregistered provider, a `createSession` that rejected, or
an adapter that returned a session id other than the one requested all raise
`AgentClientError` with the same `adapter-failure` code.
