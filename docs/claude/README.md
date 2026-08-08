# The Claude Code Runtime

How Ensemblr drives Claude Code as a first-class agent runtime: what is wired
where, why the SDK is unbundled, what is discovered live from the user's own
`claude` install, and which parts of the machinery are Claude-specific rather
than shared with Pi.

This is the Claude counterpart of [`../pi/rpc-protocol.md`](../pi/rpc-protocol.md),
but it documents a different kind of thing. Pi is a CLI spoken to over JSONL on
stdin/stdout, so its guide is a wire protocol. Claude Code is reached through
`@anthropic-ai/claude-agent-sdk` (pinned `^0.3.223` in `package.json`), driven
**in-process from main** against the binary the user installed themselves. There
is no Ensemblr-owned wire format to document — there is an SDK surface, and the
translation from it to Ensemblr's provider-neutral event stream.

The decision record is
[ADR 0042](../adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md).
This guide is the implementation reference; where the two disagree, the code
wins and this file is wrong. The SDK options, `Query` methods, and message
mapping are tabulated separately in [`sdk-surface.md`](./sdk-surface.md).

Verified against the tree at `4fbeb65` on 2026-08-08.

## 1. How the runtime is wired

### The adapter line

`src/main/agent-runtime/agent-adapter.ts` defines the whole contract a runtime
implements:

- `AgentAdapter` — `createSession(input)` and `shutdown()`.
- `AgentAdapterSession` — `abort`, `close`, `getMetadata`, `getState`, `id`,
  `setSessionName`, `subscribe`, `submit`.

Two contract rules are stated in that file and are load-bearing: the returned
`AgentAdapterSession.id` **must** equal `input.metadata.id` (the
`agent_sessions.id` the request opened under — the client rejects a mismatch in
`src/main/agent-runtime/agent-client.ts`), and listener fan-out in `subscribe`
must isolate exceptions so one throwing listener cannot starve the others.

`src/main/claude-agent/` and `src/main/pi-agent/` are **siblings** over that
contract. Neither imports the other; the module-boundary comment at the top of
`src/main/claude-agent/index.ts` says so explicitly. Dispatch happens once, in
the composition root:

```ts
// src/main/main.ts
const agentClient = createAgentClient({
    adapters: { claude: claudeAgentAdapter, pi: piAgentAdapter },
});
```

### Where the provider id lives

`src/shared/agent-provider.ts` owns the runtime axis:

- `AGENT_PROVIDER_IDS = ['pi', 'claude']`, with
  `DEFAULT_AGENT_PROVIDER = 'pi'` so every pre-Claude session row still resolves.
- `AgentProviderDescriptor` carries the non-behavioural facts, so neither
  process hardcodes them in a `switch`. Claude's:

  | Field | Value |
  |---|---|
  | `executableCommand` | `claude` |
  | `executableSettingKey` | `claude.executablePath` |
  | `label` | `Claude Code` |
  | `loginCommand` | `claude /login` |
  | `settingsFile` | `~/.claude/settings.json` (`~`-relative; expanded in main only) |

That file also states the distinction the rest of the codebase depends on: the
**runtime** axis (`pi` \| `claude`) is not the **inference vendor** axis
(`anthropic`, `openai`, `claude-code`). #236 renamed the vendor axis to `vendor`
and branded it `ModelVendorId` precisely so the two can no longer be compared
without a type error.

### What is provider-neutral, and what is not

**Above the adapter line — `src/main/agent-runtime/`, knows no CLI flag and no
SDK option name:**

- `AgentSessionRequest` and the `AgentEvent` union
  (`src/main/agent-runtime/agent-types.ts`). Events are `context-usage`,
  `error`, `message`, `metadata`, `shutdown`, `status`; statuses are `closed`,
  `errored`, `idle`, `starting`, `streaming`.
- Session open/resume, persistence, naming, summaries —
  `src/main/agent-runtime/session/`, `src/main/agent-runtime/naming/`,
  `src/main/agent-runtime/agent-session-persistence.ts`,
  `src/main/agent-runtime/session-summary-writer.ts`.
- The provider pin (`src/main/agent-runtime/session/provider-pin.ts`) and the
  control wiring (`src/main/agent-runtime/session/agent-control-wiring.ts`).
- `createAgentErrorEmitter`, shared so a Pi failure and a Claude failure reach
  the timeline in the same shape.

**Below it — every file under `src/main/claude-agent/`, which owns every SDK
name:**

| File | Owns |
|---|---|
| `src/main/claude-agent/claude-agent-adapter.ts` | the session, the `query()` options, turn submission |
| `src/main/claude-agent/sdk-message-normalizer.ts` | `SDKMessage` → `AgentEvent` |
| `src/main/claude-agent/streamed-reasoning.ts` | the `thinking_delta` buffer |
| `src/main/claude-agent/prompt-queue.ts` | the streaming-input `AsyncIterable<SDKUserMessage>` |
| `src/main/claude-agent/claude-permission-bridge.ts` | permission mode → SDK gates, `canUseTool` |
| `src/main/claude-agent/claude-tool-approval.ts`, `src/main/claude-agent/claude-tool-approval-ipc.ts` | the per-tool approval card |
| `src/main/claude-agent/claude-plan-mode.ts`, `src/main/claude-agent/claude-plan-bridge.ts` | native `ExitPlanMode` → the plan review path |
| `src/main/claude-agent/claude-thinking.ts` | thinking level → `EffortLevel` |
| `src/main/claude-agent/claude-mcp-config.ts` | the `mcpServers` map pointing at Ensemblr Control |
| `src/main/claude-agent/claude-slash-commands.ts`, `src/main/claude-agent/claude-mcp-roster.ts`, `src/main/claude-agent/claude-model-lister.ts`, `src/main/claude-agent/claude-model-catalog.ts` | live capability discovery |
| `src/main/claude-agent/tool-result-details.ts` | `structuredPatch` → a unified patch for edit cards |

`src/main/claude-agent/claude-tool-approval-ipc.ts` is deliberately absent from
that concern's barrel: it imports `electron`, and the barrel is loaded by Vitest
suites running under plain Node, so `src/main/main.ts` imports
`installClaudeToolApproval` from the module directly.

`buildQueryOptions` in the adapter is the explicit counterpart of Pi's
`buildPiSessionArgs`: it is the one place a provider-neutral request becomes
runtime vocabulary.

### The session is long-lived, and so is its input stream

`interrupt()`, `setModel()`, and `setPermissionMode()` exist **only** in the
SDK's streaming-input mode, so each session holds one long-lived async generator
and pushes user turns into it (`src/main/claude-agent/prompt-queue.ts`). The
queue parks on a promise between turns rather than returning — a generator that
ended after the first
prompt would tear the session down — and drains anything queued in the same tick
as `close()`. Structurally this is the same shape as Pi's long-lived RPC child,
which is what lets both sit behind one adapter contract.

Session identity is chosen in `resolveSdkSessionIdentity`. The SDK's `resume`
and `sessionId` are mutually exclusive and mean different things: `resume` loads
an existing transcript (the CLI exits 1 with `No conversation found with session
ID` if there is none), while `sessionId` assigns an id up front. The
provider-neutral `AgentSessionRequest.resumeRuntimeSession` flag is what tells
them apart — every open carries a `runtimeSessionId`, so its presence alone says
nothing about whether the runtime has ever seen it. Pi ignores the flag, because
`pi --session-id` is create-or-resume either way.

### Live state reaches a fixed system prompt via the turn preamble

The SDK fixes `systemPrompt` at session open, so anything the app learns later
has no way in through it. `withTurnPreamble` prepends the app's per-turn upkeep
block to the prompt **the runtime receives**, never to the one the app persisted
— so it stays out of the user's transcript. A resolver that throws is treated as
"nothing outstanding": losing a reminder is cheaper than failing the turn that
carried it. Pi needs none of this; its extension pulls the same block over
`getSessionBrief` on `before_agent_start`.

### Known parity gap

Pi streams partial tool output through `tool_execution_update`, so a long `bash`
fills its card as it runs. The Agent SDK runs tools inside Claude Code and
returns each `tool_result` complete, so a Claude tool card shows a spinner until
the result lands. Recorded in the adapter's JSDoc and in ADR 0042's
Consequences; not fixable from this side.

## 2. Why the SDK is `external` and unbundled

`vite.main.config.mts` lists exactly two `external` packages, and the Claude SDK
is one of them:

```ts
external: [
    'node-pty',
    '@anthropic-ai/claude-agent-sdk',
],
```

The reason, quoted from that file: the SDK "calls `createRequire(import.meta.url)`
at module load. Rollup rewrites `import.meta.url` to `{}.url` for the CJS main
bundle, so bundling it throws `ERR_INVALID_ARG_VALUE` before the app starts."
Electron 43 runs Node 24, which can `require()` this ESM-only package, so
leaving it external costs nothing.

Because it is external, `sdk.mjs` has to exist on disk in the packaged app.
`forge.config.ts` keeps it:

```ts
const PACKAGE_KEEP_EXACT = new Set([
    '/package.json',
    '/node_modules',
    '/node_modules/@anthropic-ai',
    '/node_modules/@anthropic-ai/claude-agent-sdk',
]);
const PACKAGE_KEEP_PREFIXES = [
    '/.vite',
    '/node_modules/node-pty',
    '/node_modules/node-addon-api',
    '/node_modules/@anthropic-ai/claude-agent-sdk/',
];
```

The trailing slash on the last prefix is deliberate. The SDK's per-platform
`claude-agent-sdk-<platform>` sibling packages are **not** kept — they carry a
**~260 MB `claude` binary**, and the user has to install and authenticate the
real `claude` CLI anyway (`claude /login`). First-class Claude therefore always
runs the user's own binary, found on `PATH` or set as an override. The matching
`KEEP_EXACT` entries hold the directories the slash prefix would otherwise drop.

Adding another unbundled dependency means both halves — `external` in the
relevant Vite config **and** a `PACKAGE_KEEP_*` entry — or the packaged app ships
without it. See [`../../.claude/rules/stack.md`](../../.claude/rules/stack.md).

## 3. Discovery and readiness

### Executable discovery

`src/main/agent-providers/claude-executable.ts` resolves which `claude` a session
would run, in this order:

1. The user's override — the `claude.executablePath` app-scope row in the
   `settings` table, written through the Providers page. A bare command name is
   resolved against the shell `PATH`; a `~`-rooted or absolute path is expanded
   and checked for the executable bit; anything relative is refused outright,
   with the rejection message carried on the resolution.
2. The shell-derived `PATH` (`findExecutableOnPath`, shared from
   `src/main/pi-runtime/executable-discovery.ts`).
3. Nothing — an `error` resolution with source `missing`. That is an honest
   failure, not a silent fallback: Ensemblr ships no `claude`.

`src/main/main.ts` exposes this as `resolveClaudeExecutablePath`, which returns
`null` when neither tier produced a path. Every Claude child — sessions, the
model lister, slash-command discovery, the MCP roster — takes that path as
`pathToClaudeCodeExecutable`, so what the Providers page reports is what actually
runs.

### The readiness probe

`src/main/agent-providers/claude-readiness-probe.ts` runs one pass producing
four checks:

| Check id | How |
|---|---|
| `executable` | the resolution above; offers a `select-claude-executable` remediation |
| `version` | `<claude> --version` through `LocalCommandService`, 5 s timeout, 4 KiB output cap |
| `auth` | `session.accountInfo()` on a throwaway `query()` |
| `mcp` | `session.mcpServerStatus()` on the same session; unhealthy servers are a `warning`, never a `failure` |

The version probe and the session probe **race under `Promise.all`** — neither
reads the other's result and each spawns its own child, so the page waits on the
slower rather than the sum. The session gets a 20 s deadline; when it elapses
the probe aborts the SDK's own controller and returns a normal failure rather
than leaking the child. Concurrent `probe()` calls share one in-flight run,
cleared on settle.

The throwaway session runs `permissionMode: 'plan'`. The file says why in a
comment worth repeating: this is deliberately **not** the terminal harness's
`--dangerously-skip-permissions`, which is a product decision scoped to the PTY
tab and must never leak into first-class Claude.

Remediations offered (copied to the clipboard, never executed):
`curl -fsSL https://claude.ai/install.sh | bash`, the setup docs at
`https://code.claude.com/docs/en/setup`, and `claude /login`.

### There is no blocking setup check for Claude

This is the sharpest difference from Pi. `src/main/setup/` holds
`src/main/setup/setup-checks-core.ts`,
`src/main/setup/setup-checks-github.ts`,
`src/main/setup/setup-checks-linear.ts`, and
`src/main/setup/setup-checks-pi.ts` — **there is no `setup-checks-claude.ts`,
and the word `claude` does not appear anywhere in that directory.** Pi's check
is `blocking: true`; nothing gates the app on Claude Code at all.

Claude readiness is probed on demand behind **Settings → Providers**
(`src/renderer/components/settings/agent-providers/agent-providers-section.tsx`,
one tab per descriptor from `listAgentProviderDescriptors()`), through
`agentProviderReadinessQuery` in
`src/renderer/api/ensemblr/agent-providers.ts` with `staleTime: 60_000`.

The consequence is the intended one: with no `claude` installed the model picker
simply shows no Claude models and the Providers page is where that is explained
— the app still starts, and every Pi surface is unaffected.

## 4. Live-discovered capabilities

All three capability reads follow the same shape: a short-lived `query()` running
`permissionMode: 'plan'` so the child cannot touch anything, closed in a
`finally` as soon as it has answered, and driven by a prompt queue that is never
prompted — these methods answer without a turn. All three are deferred until
something asks, so no runtime child is spawned on mount.

Slash commands and the MCP roster are additionally pointed at the workspace
directory; the model catalogue is not, because entitlements are an account fact
rather than a project one.

### Slash commands (#228, fixed in #229)

`src/main/claude-agent/claude-slash-commands.ts` calls
`session.supportedCommands()` and projects each onto
`AgentProviderSlashCommandWire`.

- **Workspace-scoped on purpose.** `.claude/commands`, project skills, and
  project-installed plugins are declared relative to a directory, so a lookup
  with no `cwd` would report only the user-level tier.
- **No provenance.** Claude Code returns built-ins, project commands, and plugin
  skills in one undifferentiated list, so `source` is left unset rather than
  guessed, and `autoSubmit` stays `false` — picking a command never sends a turn
  the user did not ask for.
- **Deduped in the renderer.** A runtime can report the same command many times
  (Claude Code resolves a skill once per discovery root, so `/code-review`
  arrived four times); `normalizeSlashCommands` in
  `src/renderer/hooks/workbench-shell/composer/use-slash-commands.ts` sorts by
  menu group, then by how much each entry says about itself, and keeps one per
  name.
- **Cached** for five minutes (`staleTime: 5 * 60_000`), and `enabled` only once
  `cwd` is non-empty, so the first cost is paid when the slash menu first opens.

Before #228 this was a Pi-only channel, so a Claude chat was offered Pi's
commands; both runtimes now answer the same provider-parameterized channel.

### MCP server roster (#228)

`src/main/claude-agent/claude-mcp-roster.ts` calls `session.mcpServerStatus()`
and **re-reads it** every 750 ms until nothing is `pending` or an 8 s settle
deadline passes. Servers connect asynchronously, so a single read catches most
of them mid-handshake; polling is what turns "awaiting status" into the
connected / failed / needs-auth split the user acts on. One wedged server cannot
hold the panel open past the deadline.

Workspace-scoped for the same reason as commands: `project` and `local` servers
are declared relative to a directory, so a lookup with no `cwd` silently reports
only the user, plugin, and remote-connector tiers.

The renderer surfaces this as a chip beside the context gauge on a Claude-backed
composer
(`src/renderer/components/workbench-shell/conversation-panel/composer/mcp-servers-panel.tsx`),
cached with `staleTime: 60_000` and refreshable from the panel. A `needs-auth`
row is a button that opens Claude Code's own `/mcp` screen in a dock terminal.

### Model catalogue (#228)

Listing models means starting a `claude` child, because `supportedModels()` is a
method on a live `Query` — the signed-in account's entitlements decide the list.
`src/main/claude-agent/claude-model-lister.ts` caches the result for five minutes
(`CATALOG_TTL_MS`), shares one child between in-flight callers, and **never
caches an unavailable runtime**, so installing `claude` takes effect on the next
listing.

`src/main/claude-agent/claude-model-catalog.ts` (`presentClaudeModels`) then does
the presentation work:

- Drops the `default` alias — a real selectable option, but not a model the user
  can reason about.
- Names an alias row after the model it **resolves to**: the runtime's own
  display names drop the version and add a window qualifier (`Opus (1M context)`,
  `Sonnet`), which reads as ambiguous, so `claude-opus-5[1m]` renders as
  `Opus 5`.
- Appends `PINNED_MODELS` — releases Claude Code accepts as an explicit `--model`
  id but does not advertise (Opus 4.8, Opus 4.7, Sonnet 4.6) — deduped by
  release key against any alias that already covers them.
- Orders by `FAMILY_ORDER = ['fable', 'opus', 'sonnet', 'haiku']`, then newest
  version first.
- Stamps every row with vendor `claude-code` and `agentProvider: 'claude'`;
  Claude Code model ids carry no vendor segment to parse.

`src/main/agent-providers/agent-model-catalog.ts` merges this with Pi's and
builds the model-id → runtime index (also 5 min TTL) that both spawn routes
consult. One runtime being unavailable degrades to nothing on its own rather
than emptying the picker for the other. Deriving a session's runtime from this
catalog **in main** — rather than trusting a `provider` field off the wire — is
what stops a stale renderer from opening a Claude model on Pi.

## 5. Reasoning and effort

Pi steers *thinking*; Claude steers *effort*. `src/shared/agent-thinking.ts`
holds both vocabularies and refuses to collapse them into one enum:

| Runtime | Levels, ascending | Axis label |
|---|---|---|
| Pi | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` | Thinking |
| Claude | `off`, `low`, `medium`, `high`, `xhigh`, `max` | Effort |

They overlap on four values and differ at both ends — Pi has `minimal` and no
`max`, Claude the reverse. Before #228 the picker assumed Pi's ladder, so
Claude's top rung rendered as a raw `max` and scored its bar against the wrong
scale.

`src/main/claude-agent/claude-thinking.ts` translates:

- `toClaudeEffortLevel(level)` maps a level onto the SDK's `EffortLevel`. `off`
  returns `null`, and the adapter then passes **no `effort` option**.
- `CLAUDE_THINKING_CONFIG` is the `thinking` option every session opens with —
  `{ type: 'adaptive', display: 'summarized' }`, unconditionally, whatever the
  level. It supersedes the deprecated `maxThinkingTokens` option.
- `steerClaudeThinking(query, level)` moves a live session onto a level in
  either direction: `applyFlagSettings({ effortLevel })` for how hard to think,
  then `setMaxThinkingTokens` for whether to at all — `0` for `off`, or `null`
  plus the display for anything else.
- `toThinkingLevels(model.supportedEffortLevels)` narrows the ladder to what a
  specific model advertises, so the picker never offers an effort the model
  would reject. A model reporting none gets `['off']` alone. Pinned rows get the
  full Claude ladder, because `supportedModels()` never mentions effort for them.

Mid-session, `applyTurnSelection` calls `steerClaudeThinking` only when the
requested level differs from what is already applied, and skips the switch
entirely for a steer or follow-up because the runtime is already committed to a
turn. That mirrors Pi's `set_thinking_level` discipline exactly.

### The level pins to the session (#232)

`src/renderer/state/composer/composer-model-selection.ts` resolves both axes the
same way, and the persisted session is the step that was missing:

```
explicit per-chat pick → persisted session value → Settings default → runtime default
```

then clamped to the selected model's own ladder. Before #232 the thinking axis
skipped the persisted session, so an existing chat reported and sent whatever the
Settings default happened to be rather than the rung it was started with. This
matters most for a **spawned sub-agent**, which has no per-chat override of its
own: without the session rung its tab reported the user's default instead of what
the child is actually running.

A sub-agent's chat tab renders no composer, so #232 also added
`src/renderer/components/workbench-shell/conversation-panel/sub-agent-status-panel.tsx`
— a read-only readout in the slot the composer would have taken, reporting the
child's model label, its thinking level (always named, so `off` stays
distinguishable from "not reported"), and its context gauge. Nothing in it
mutates the child.

## 6. Context measurement

### Occupancy comes from the live thread (#230)

The occupancy figure is read off **each main-thread `assistant` response's own
`message.usage`**, in `readContextTokens`:

```
input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens
```

which is how the Messages API defines a prompt's size. It is deliberately **not**
`result.modelUsage`, whose counters are cumulative session totals kept for
billing: every turn re-reads the prompt cache, so summing `cacheReadInputTokens`
across a session reported several times the window's worth of tokens within a
handful of turns.

Two more rules in `src/main/claude-agent/sdk-message-normalizer.ts`:

- **Subagent responses do not restate the user's thread.** A message with
  `parent_tool_use_id !== null` is measured against its own window and skips the
  occupancy update entirely.
- **The window is the main model's.** `readContextWindow` matches the
  `result.modelUsage` entry by id or `canonicalModel` against the model the main
  thread last answered on, falling back to the widest reported entry only when
  the id cannot be matched. `modelUsage` also covers subagents, sidechains, and
  compaction calls, so one wide-window subagent would otherwise pin the
  denominator for the rest of the session and halve the reported percentage.

A compaction reports a fresh occupancy through `system`/`compact_boundary`'s
`compact_metadata.post_tokens`.

`reportUsage` stays silent until both halves are non-zero and does not re-emit an
unchanged reading. `percent` is `null` when no window is known, so the renderer
shows "unknown" rather than a bar pinned at zero — "this model publishes no
window" stays distinguishable from "this model has no room left".

### The gauge gets a window before the first turn ends (#235)

Both runtimes name their window only at a turn's `result`, so before #235 the
gauge had no denominator until a turn completed and fabricated a hardcoded one.
Three sources now fill the gap, in order of authority:

1. **The adapter asks the runtime directly at session open.**
   `probeContextUsage` calls `activeQuery.getContextUsage()` and feeds
   `normalizer.observeContextUsage({ contextWindow: usage.maxTokens, tokens:
   usage.totalTokens })`. That seeds only what is still unknown, and nothing at
   all once a snapshot has already been emitted, so it can never walk back a
   fresher figure. Pi's equivalent is an unprompted `get_session_stats`.

   The `if (closed)` guard sits *after* the await on purpose — it asks whether
   the session died during the control round trip, which hoisting it would stop
   it being able to answer. `react-doctor`'s `async-defer-await` rule is
   overridden for this call in `doctor.config.jsonc` rather than the code being
   "fixed".

2. **The catalogue publishes a window per model** — except Claude, which has none
   to publish. So the listing session's own `getContextUsage()` reading is
   stamped on the one model it was measured on and no other (`windowForModel`).
   A 1M Opus reading spread across the catalog would put a denominator five times
   too wide on a Sonnet chat's gauge for the whole of its first turn.

3. **The renderer falls back** to the selected model's published window at zero
   occupancy, and to an em dash when there is none.

## 7. Transcript persistence

Normalized events land in `agent_session_events.payload_json` as the tagged
`AgentPersistedEnvelope` (`src/main/agent-runtime/agent-session-persistence.ts`),
so the renderer matches on `payload.kind` instead of sniffing raw runtime shapes.
Persistence is best-effort on the live path; the timeline rehydrates from
whatever landed.

Streaming deltas are the exception: `text-delta` and `reasoning-delta` take a
fast path in `src/main/agent-runtime/session/handle-runtime-event.ts` that
synthesizes an ephemeral row with a fractional ordinal and broadcasts it
directly, skipping a `BEGIN IMMEDIATE` write per token. **They are never
persisted** — the authoritative seal carries the full text.

### Redacted reasoning (#237)

That last sentence is exactly why Claude needed extra machinery. The SDK seals an
assistant message with its `thinking` blocks **already emptied** —
`{ type: 'thinking', thinking: '', signature }` — so the seal carries no text to
persist. The content only ever exists as `thinking_delta` stream events, which
were broadcast and dropped. A turn's reasoning therefore vanished the moment the
timeline rehydrated.

`src/main/claude-agent/streamed-reasoning.ts` fixes it with a buffer keyed by
content-block index:

- `append(index, text)` banks each `thinking_delta` chunk as it streams.
- `take(index)` **consumes** what it returns, so the same reasoning can never
  refill a second block.
- `reset()` clears whatever a message left behind, at each message boundary.

`toMessagePart` then refills the emptied `thinking` block from the buffer before
the seal reaches the timeline. A delta whose `index` is not a non-negative
integer is **dropped rather than defaulted to block 0** — misfiling one block's
reasoning onto another is something nothing downstream could detect.

A thinking block that comes through empty on both paths keeps its row anyway: a
turn that reasoned should say so rather than vanish. Pi's normalizer was tightened
in the same change to require non-empty thinking text, so only Claude — which
genuinely redacts its prose — can produce the empty part.

### Why the deltas were empty too (#239)

The buffer alone was not enough, because the `thinking_delta` events carried no
text either — a redacted block streams as pings whose `thinking` is `''` and
whose only payload is `estimated_tokens`. The cause is upstream of the
normalizer: the CLI forces `display: 'omitted'` on any **non-interactive**
session that did not name a display mode itself, and on Opus 4.7 and later
`omitted` is the API default regardless. Every SDK session is non-interactive,
so Ensemblr got signatures and no prose.

`CLAUDE_THINKING_CONFIG` names it explicitly — `{ type: 'adaptive', display:
'summarized' }` — which the SDK forwards as `--thinking adaptive
--thinking-display summarized`. Verified against the bundled CLI on one prompt:
without the flag, 5 `thinking_delta` frames carrying 0 characters and a seal of
0; with it, 7 frames carrying 628 characters and a seal of 628.

A summary is only produced when there is enough reasoning to summarize. A short
thinking block still arrives empty, and still renders as the inert "Thought" row
above.

### Why `off` is a budget, not a thinking mode (#239)

The `thinking` option becomes a `--thinking` flag on the CLI's argv, and that
flag is **sticky for the life of the process**. A session opened
`{ type: 'disabled' }` can never be talked back out of it, so a chat that opened
at `off` could never turn reasoning on again. Measured against the bundled CLI,
`claude-code` 2.1.220, one reasoning prompt per row:

| Session opened | Steer applied | `thinking_delta` frames / chars |
|---|---|---|
| `adaptive` + `summarized` | none | 6 / 372 |
| `adaptive` + `summarized` | `applyFlagSettings({ alwaysThinkingEnabled: false, effortLevel: null })` | 4 / 298 |
| `adaptive` + `summarized` | `setMaxThinkingTokens(0)` | **0 / 0** |
| `adaptive` + `summarized`, plus `maxThinkingTokens: 0` | none | 4 / 327 |
| `disabled` | `applyFlagSettings({ effortLevel: 'high' })` + `setMaxThinkingTokens(null, 'summarized')` | 0 / 0 |
| `disabled` | the same plus `alwaysThinkingEnabled: true` | 0 / 0 |
| `disabled` | the same plus `setMaxThinkingTokens(8000, 'summarized')` | 1 / 0 |

Three things follow, and each one rules out an option that reads like it should
work:

- **`alwaysThinkingEnabled` does not move a live session.** It is a settings key,
  and the `--thinking` flag outranks the flag-settings layer. Row 2 still thought.
- **The `maxThinkingTokens` *option* is dead when `thinking` is set**, exactly as
  the SDK documents. Row 4 still thought.
- **`setMaxThinkingTokens(0)` is the only lever that turns a live session off**,
  and `(null, 'summarized')` is what turns it back on. Rows 3 and 5–7.

So every session opens with `CLAUDE_THINKING_CONFIG` and a chat set to `off` is
switched off after the open instead — `applyOpeningThinking` in the adapter. The
prompt queue is created `held` and opened only once that steer settles, so the
runtime cannot read a first turn before it lands. Holding the stream rather than
awaiting inside `submit` is deliberate: a yield between recording a prompt and
queueing it would let two overlapping submits reach the runtime in the opposite
order to the transcript. All four quadrants
were then measured through `steerClaudeThinking` itself: open `high` thinks
(8 frames / 342 chars), open `off` stays silent, `high` → `off` goes silent, and
`off` → `high` thinks again.

One limit survives. A level steered mid-session reasons more shallowly than the
same level named on the opening argv — 1–2 frames against 8 — and a block that
short has nothing to summarize, so its prose arrives empty and the timeline shows
the inert "Thought" row. Swapping the order of the two calls changes nothing
(measured both ways), and it is not the zeroing: a session that was never zeroed
and only had its effort raised reasons just as shallowly. The steer restores
*whether* the model thinks, and the opening flag is what makes it think hard.

Confirmed on Opus (account default), Haiku 4.5, and Sonnet 4.6 — `adaptive` is
accepted on all three, so opening every session able to think costs nothing on
models that predate adaptive thinking.

### Turns open on the prompt, not on the answer (#237)

`submit` calls `normalizer.beginTurn()` the instant the prompt is queued, before
the runtime has said anything. The timeline keys its working indicator and turn
timer off `status` events and Claude takes seconds to reach its first message, so
without this the chat looked idle for the whole gap. The `system`/`init` message
arriving afterwards only settles to `idle` when the session is still `starting`
— a session that has already been prompted is not idle.

The prompt itself is emitted as a `message` event immediately on submit — whether
or not the turn later fails. The turn preamble is resolved *before* that emit, so
nothing awaits between recording the prompt and queueing it: two overlapping
submits that yielded in between would reach the runtime in the opposite order to
the one the transcript shows.

Because the adapter already emitted it, `normalizeUser` **drops the SDK's prompt
echo** and projects only `tool_result` blocks. Otherwise every prompt would
render as two bubbles — the timeline keys user groups by event id and never
merges them — and resuming a session, which replays earlier user turns down the
same path, would duplicate history Ensemblr already persists.

Tool results travel in a `{ content, details }` envelope.
`src/main/claude-agent/tool-result-details.ts` lifts a `structuredPatch` into a
unified single-file patch so an edit's card renders a diff instead of the prose
confirmation the tool wrote back to the model; a `type: 'create'` result is
skipped, since its card already shows the content.

## 8. Agent control

Claude Code as a **runtime** reaches Ensemblr Control at `POST /mcp` — the same
endpoint the terminal **harness** reaches.
`src/main/claude-agent/claude-mcp-config.ts` builds the `mcpServers` entry:

```ts
{ ensemblr: { type: 'http', url: '<control>/mcp', headers: { Authorization: 'Bearer ${ENSEMBLR_CONTROL_TOKEN}' } } }
```

The `Authorization` header carries an **env-var reference, not the token**. The
Agent SDK serialises this map verbatim into a `--mcp-config` argument, so a
literal token would be readable via `ps` by any process on the machine; Claude
expands the reference itself.

`src/main/agent-runtime/session/agent-control-wiring.ts` decides who gets this.
`NATIVE_MCP_PROVIDERS` is `new Set(['claude'])` — declared as a capability rather
than tested by name, so a third runtime says once whether it brings its own MCP
client. Pi takes neither the endpoint nor the role playbook, because its bundled
extension *is* its MCP client and reads the same env overlay itself.

**The two surfaces are told apart by `ControlAudience`, never by runtime name.**
`ControlAudience` (`src/shared/agent-control/awareness.ts`) has exactly two
fields — `hasChatTab` and `role` (`orchestrator` \| `subagent`) — and the file
says why: both axes are properties of the caller rather than of any one runtime,
so a runtime added later selects its surface by declaring those two facts.
`AgentSpecies` in `src/main/agent-control/ports.ts` is `'pi' | 'claude' |
'harness'`, and the gates read `originHasChatTab(origin)` against
`CHAT_TAB_SPECIES`, not an equality test.

For the tool inventory, the permission model, the guardrails, and the
questionnaire, read [`../agent-control.md`](../agent-control.md) — none of it is
restated here.

### A spawned child is pinned to its caller's runtime (#236)

`src/main/agent-providers/spawn-model-resolver.ts` holds the invariant: **a spawn
never crosses the agent runtime axis.** It lives beside the model catalog rather
than in the control layer, because "which runtime owns this model id" is the same
question the renderer's own open request asks, and one answer is what stops the
two spawn routes from disagreeing.

Resolution order for a delegated child:

1. An explicit `model`, honoured **only** when it belongs to the caller's
   runtime — refused by name otherwise, never silently substituted.
2. The caller's own model: its live value first, its persisted session row
   second.
3. The catalog's default for that runtime.

Thinking level follows the same shape — requested, else the caller's, else
`medium` (the one rung both ladders publish) — each accepted only if the child's
model publishes it, so `max` never lands on a Pi chat. A refusal is a modelled
`{ ok: false, reason }` outcome carrying prose the calling agent can act on, and
it consumes no tab, session, or spawn-guardrail slot.

A **terminal harness has no runtime the app can name**: `originRuntime` returns
`null` for it, because its control origin is minted per workspace and shared by
every terminal in it. It therefore gets the unfiltered model list and must pass
`model` outright. `ensemblr_list_models` is cut to the caller's runtime for
everyone else.

Once opened, a chat is pinned for life: `assertProviderPin`
(`src/main/agent-runtime/session/provider-pin.ts`) rejects a model from the other
runtime main-side, because the two speak different native session formats and
crossing mid-chat would hand the new runtime a history it cannot resume.

### Permission modes and plan mode are Claude-specific below the line

`src/main/claude-agent/claude-permission-bridge.ts` maps the workspace permission
mode onto SDK gates:

| Ensemblr mode | SDK settings |
|---|---|
| `workspace-trusted` (default) | `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions` |
| `approval-required` | `permissionMode: 'default'` + a `canUseTool` gate |
| `read-only` | `permissionMode: 'plan'` **plus** `disallowedTools` for `Bash`, `BashOutput`, `Edit`, `KillShell`, `NotebookEdit`, `Write` |

`read-only` needs both halves because plan mode is a mode the model can leave on
its own; the deny list is what actually holds.

Plan Mode is re-resolved and re-asserted on **every turn**, not just at session
open: Claude's native `ExitPlanMode` drops the live session out of plan mode
without telling the adapter. `forward()` therefore sets `appliedPlanMode = null`
on a detected submission, which forces the next turn to re-assert — Refine has to
restore `plan`, and Approve has to restore the *workspace mode's own baseline*
rather than a fixed `default`, or a trusted chat would lose `bypassPermissions`
and a read-only one would lose its gate.

Ensemblr does not re-synthesise plan mode for Claude the way it does for Pi.
`detectPlanSubmission` spots the native `ExitPlanMode` call in the normalized
event stream and `createClaudePlanBridge` hands it to the same plan-submission
service `ensemblr_exit_plan_mode` reaches, so both runtimes save under
`.context/plans/`, post into the chat, and raise the one review panel. A
submission whose control token resolves to no origin is dropped rather than filed
against a synthesised one — `submit` writes into `origin.workspaceCwd`.

The `approval-required` card lives in
`src/main/claude-agent/claude-tool-approval.ts` and
`src/main/claude-agent/claude-tool-approval-ipc.ts`. Its governing rule is that
**nothing may be left pending**: a prompt with no answer and no withdrawal parks
the tool call forever,
since permission prompts have no deadline of their own. Every teardown path —
session stop, session close, app quit, and the SDK's per-request abort on
`interrupt()` — resolves the outstanding promise and withdraws the card, and the
adapter releases the seam from `emitShutdown` so every shutdown path is covered.

Per ADR 0042 §6, the SDK's `enableFileCheckpointing` stays **off**: Ensemblr's
checkpoints are git-backed and wrap turns (ADR 0012), and two checkpoint systems
over one worktree would fight.

## 9. The two Claude Codes

"Claude Code" names two different things in this app, and both reach the same
control server, so the name alone will not tell you which caller you are looking
at:

- The **terminal harness** — the `claude` TUI running in a `node-pty` terminal
  tab, launched from `HARNESS_REGISTRY` in `src/shared/agents.ts`, always with
  `--dangerously-skip-permissions`, species `harness`.
- The **native runtime** — this document. A chat tab driven through the Agent
  SDK in-process, honouring the workspace permission mode, species `claude`,
  with its own per-session control origin and lineage.

Native Claude never inherits the harness's skip-permissions flag, and the two
code paths are kept visibly distinct so that default cannot leak across. The
full side-by-side comparison — transport, binary, surface, playbook, control
tools, spawning rules — is the table in
[`../harnesses.md`](../harnesses.md#harness-claude-code-is-not-native-claude-code),
and is not duplicated here.

## Tests

The behaviour above is pinned by `tests/main/claude-*.test.ts`:
`claude-agent-control-wiring`, `claude-agent-normalizer`, `claude-agent-submit`,
`claude-context-usage-probe`, `claude-executable-plumbing`, `claude-mcp-roster`,
`claude-model-catalog`, `claude-plan-bridge`, `claude-plan-mode-persistence`,
`claude-readiness`, `claude-session-continuity`,
`claude-session-permission-mode`, `claude-slash-commands`,
`claude-tool-approval`, `claude-turn-preamble`. Pure-logic suites under
`tests/main/` must be listed in `vitest.config.mts`'s explicit `include` array.

## See also

- [ADR 0042](../adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md)
  — the decision record and its seven numbered decisions.
- [`sdk-surface.md`](./sdk-surface.md) — the SDK options, `Query` methods, and
  message→event mapping, tabulated.
- [`../agent-control.md`](../agent-control.md) — Ensemblr Control.
- [`../harnesses.md`](../harnesses.md) — the terminal-harness side.
- [`../pi/rpc-protocol.md`](../pi/rpc-protocol.md) and
  [`../pi/event-taxonomy.md`](../pi/event-taxonomy.md) — the Pi equivalents.
