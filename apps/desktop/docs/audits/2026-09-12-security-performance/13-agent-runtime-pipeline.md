# Agent Event Pipeline — parse → normalize → persist → broadcast → reduce

The pipeline is well-engineered in its hot-path *shapes*: text deltas skip persistence entirely,
the renderer coalesces broadcasts on `requestAnimationFrame`, the timeline projector folds
incrementally, the JSONL reader is rope-safe and byte-capped, and every adapter listener set is
cleared on shutdown. The damage is not in the streaming loop — it is in **what gets admitted to the
stream in the first place**. Measured against the real production database on this machine
(`~/Library/Application Support/dev.ensemblr.app/ensemblr.db`, 990 MB, 891,177 events, 472
branches), **706,547 events — 79% of every agent event ever recorded, 165 MB of payload — are Pi
`extension_ui_request` frames (`setStatus`/`setWidget` spinner chatter) that the renderer projects to
literally nothing**. Each one pays a `BEGIN IMMEDIATE` SQLite transaction on the main thread, a
structured-clone IPC broadcast to every window, a second raw-frame IPC broadcast, and a renderer
cache append. They are also the reason session open is expensive: opening the largest real chat blocks
the main process for **~460 ms cold** loading 26,922 rows / 13.5 MB of wire JSON that produce
**2 UI messages**.

Everything else found here is a tail risk by comparison.

---

## Pipeline map

### Pi (`pi --mode rpc`, JSONL over stdout)

| Stage | Where | Per-event cost | Batching | Memory held |
| --- | --- | --- | --- | --- |
| child stdout chunk | `src/main/pi-agent/cli-rpc/child-streams.ts:59` | `lineStream.feed(chunk)` | none needed; OS pipe backpressures naturally | — |
| line framing | `src/main/pi-ipc/jsonl-line-stream.ts:113` | O(chunk); byte length + preview accumulated per chunk, never re-derived from the rope | — | one partial line, capped at 16 MiB (`pi-cli-rpc-adapter.ts:46`) |
| raw-frame tap | `pi-cli-rpc-adapter.ts:346` → `main.ts:614` | **1 `webContents.send` per line per window, ungated** | none | line truncated to 8 KiB (`RAW_FRAME_SAMPLE_CHARS`) |
| `JSON.parse` | `cli-rpc/line-stream-handlers.ts:45` | O(line) | — | — |
| dispatch | `cli-rpc/protocol-dispatch.ts:433` | switch on `type`; **unmodelled types fall to `handleUnknown:376` and emit `{kind:'unknown', raw: frame}`** | — | `unechoedPrompts`, `pendingStatsIds`, `pendingStateResolvers` (all settled on shutdown) |
| listener fan-out | `cli-rpc/listener-fanout.ts:27` | snapshot-copy of the listener set, try/catch per listener | — | `listeners` cleared at `pi-cli-rpc-adapter.ts:575` |
| **delta fast path** | `agent-runtime/session/handle-runtime-event.ts:95` | synthesizes an ephemeral row with a fractional ordinal, **no DB write**, 1 IPC | none (1 IPC per delta) | none |
| **everything else** | `handle-runtime-event.ts:273` | `BEGIN IMMEDIATE` + `SELECT MAX(ordinal)` + `INSERT` + `COMMIT` + a second `SELECT` round-trip (`agent-event-repository.ts:77`), all synchronous on the main thread | none | — |
| activity fold | `handle-runtime-event.ts:287` | `reduceAgentActivity` + one `{...active}` object copy | — | `ActiveSession` per open session — **no event array retained in main** |
| broadcast | `handle-runtime-event.ts:388` → `main.ts:907` | 1 `webContents.send` per window + `agentActivityMonitor.handle` | none | — |
| preload | `src/preload/bridge/ensemblr-api.ts:376` | thin `subscribe` | — | — |
| renderer intake | `hooks/workbench-shell/timeline/use-timeline-events.ts:97` | queued per branch, flushed **once per `requestAnimationFrame`**, hard-capped at 512 queued (covers a minimized window where rAF never fires) | ✅ rAF coalescing | full `AgentSessionEventWire[]` in the TanStack cache, `gcTime` 5 min |
| cache merge | `use-timeline-events.ts:146` | append fast path when ordinals extend in order; `sortedUnion` + sort otherwise | ✅ | one `[...existing, ...incoming]` copy per frame |
| projection | `lib/agent-timeline/event-to-ui-message.ts:117` | resume check O(events) + `[...events]` copy + fold of the new tail + finalize passes O(messages) | ✅ incremental | `ProjectionCursor` (a second copy of the event array) + 4 `WeakMap` decoration caches |

### Claude (`@anthropic-ai/claude-agent-sdk`)

Same spine from `handle-runtime-event.ts` onward. Differences upstream:

| Stage | Where | Notes |
| --- | --- | --- |
| SDK message loop | `claude-agent/claude-agent-adapter.ts:403` | `for await` over the query; `includePartialMessages: true` at `:786` |
| normalize | `claude-agent/sdk-message-normalizer.ts:323` | **unmodelled SDK message types return `[]`** — nothing unknown is persisted. This is the correct behavior Pi lacks. |
| text deltas | `sdk-message-normalizer.ts:390` | `content_block_delta`/`text_delta` → `{kind:'text-delta'}` → the same no-DB fast path |
| `input_json_delta` | `sdk-message-normalizer.ts:361` (doc) | deliberately dropped; the sealing `assistant` message carries the complete input |
| reasoning banking | `claude-agent/streamed-reasoning.ts:56` | one buffer per `parent_tool_use_id`, **never pruned** for the session's life |
| raw-frame tap | — | none. Claude sessions pay no debug-broadcast tax. |

---

## Findings

### [RT-01] Unmodelled Pi frames are persisted verbatim and broadcast — 79% of the event table is spinner chatter that renders nothing

- **Impact:** High
- **Confidence:** Confirmed (measured against the production database)
- **Where:** `src/main/pi-agent/cli-rpc/protocol-dispatch.ts:376`

```ts
function handleUnknown(typed: FrameObject, deps: ProtocolDispatchDeps): void {
	const frameType = typeof typed.type === 'string' ? typed.type : 'unknown';
	deps.emit({
		at: deps.now().toISOString(),
		payload: { frameType, kind: 'unknown', raw: typed },
		role: 'agent',
		turnId: typeof typed.turnId === 'string' ? typed.turnId : null,
		type: 'message',
	});
}
```

- **Mechanism:** Main process, once per Pi stdout frame whose `type` has no `case` in the dispatcher
  (`protocol-dispatch.ts:489`). `extension_ui_request` is such a type — even though `src/shared/pi-rpc/schemas.ts:322`
  models it in full. Each one becomes a `message` event, so it takes the *slow* path in
  `handle-runtime-event.ts:273`: a `BEGIN IMMEDIATE` transaction with three statement compiles and two
  queries plus a read-back `SELECT`, then `webContents.send` to every window, then the activity monitor,
  then (for Pi only) a second `webContents.send` for the raw-frame tap. In the renderer it is appended to
  the query cache, folded by the projector, and produces **zero UI**: `event-to-ui-message.ts:709` is
  `case 'unknown': return []`.
- **Evidence:** Production DB, 891,177 events total, `agent_session_events` = 700 MB of a 990 MB file.

  | `payload.frameType` | count | payload bytes | avg |
  | --- | ---: | ---: | ---: |
  | `extension_ui_request` | **706,547** | **165.4 MB** | 246 B |
  | `entry_appended` | 2,033 | 1.9 MB | 975 B |
  | `session_info_changed` | 448 | 0.1 MB | 170 B |
  | `queue_update` | 358 | 0.1 MB | 435 B |

  Broken down by method: `setStatus` 364,765 · `setWidget` 341,220 · `notify` 562. These are
  fire-and-forget status-line/widget repaints — exactly what `command-query.ts:124` already classifies as
  `PASSIVE_UI_METHODS` during discovery. The largest branch is 26,922 events of which **26,729 (99.3%)
  are `unknown`**, and the projector turns the whole branch into **2 messages / 79 parts**.
- **Fix:** Add an explicit `case 'extension_ui_request':` to the dispatcher that returns without emitting
  (or routes `confirm` to the existing approval path and drops `setStatus`/`setWidget`/`notify`). More
  durably: make `handleUnknown` emit a *diagnostic-only* event that is not persisted, or allowlist the
  frame types worth keeping — recording a frame the timeline cannot render is a debug feature, and the
  raw-frame tap already covers debugging.

---

### [RT-02] Session open loads the entire branch unbounded — ~460 ms of blocked main thread and 13.5 MB across IPC for the largest real chat

- **Impact:** High
- **Confidence:** Confirmed (measured)
- **Where:** `src/main/agent-runtime/agent-session-service.ts:435`, `src/main/ipc/handlers/agent-session.ts:320`

```ts
listEvents: (branchId) => {
	const database = requireSessionDatabase();
	const events = listEventsByBranch({ branchId, database });
	// Checkpoint restores hide (never delete) the overwritten turns.
	const branch = getAgentSessionBranchById({ database, id: branchId });
	const hiddenRanges = branch ? readHiddenEventRanges(branch.metadata) : [];
```

- **Mechanism:** Renderer main thread → main process, once per chat-tab mount (`use-timeline-events.ts:47`,
  `agentSessionEventsQuery` with `staleTime: 0`). `listEventsByBranch` takes no `limit` from the handler,
  so the whole branch is read, mapped, JSON-serialized, structured-cloned across IPC, deserialized, and
  folded. The main process is single-threaded, so for the duration every other IPC reply — terminal
  output, a second streaming session's broadcasts, window events — is queued behind it.
- **Evidence:** Measured on the real DB against the p99 branch (26,922 events):

  ```
  run0: sqlite all() 463ms | map+JSON.parse 51ms | serialize 38ms | 13.5 MB wire
  run1: sqlite all() 165ms | map+JSON.parse 56ms | serialize 21ms
  run2: sqlite all()  83ms | map+JSON.parse 37ms | serialize 17ms
  ```

  Branch-size distribution across the 472 real branches: p50 = 422 events, p90 = 4,747, p99 = 25,789,
  max = 26,922. Renderer-side the parsed array retains **11.5 MB of heap**, and the cold projection costs
  **10.9 ms**. `gcTime` is the 5-minute default, so navigating away and back re-pays the whole cost.
- **Fix:** Two independent levers, both small. (a) Fixing RT-01 removes ~79% of the rows and most of the
  ~460 ms on its own. (b) Pass a `limit` through the IPC request — `listEventsByBranch` already accepts
  `fromOrdinal` and `limit` (`agent-event-repository.ts:222`) — and load the newest N with
  older events fetched on scroll-back.

---

### [RT-03] The Pi raw-frame debug tap broadcasts every JSONL line to every window whether or not anyone is listening

- **Impact:** Medium
- **Confidence:** Confirmed
- **Where:** `src/main/main.ts:614` (fan-out), `src/main/main.ts:743` (unconditional wiring)

```ts
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send(IPC_CHANNELS.piRawFrame, payload);
		}
	}
```

- **Mechanism:** Main process, **once per Pi stdout line** (plus once per stdin write), per window, for the
  whole life of the app. The only consumer is `usePiRawFrameCapture(developerMode)`
  (`components/workbench-shell/conversation-panel/conversation-content.tsx:63`), which subscribes only
  when developer mode is on — but the *send* side has no gate. This doubles the IPC message count of a
  streaming Pi turn: one `agentSessionEvent` per token plus one `piRawFrame` per `message_update` frame.
  With RT-01 unfixed it also fires for all 706k `extension_ui_request` frames.
- **Evidence:** The comment at `pi-cli-rpc-adapter.ts:61-67` states the problem outright — "it is not gated
  on anyone listening, so a line is sampled rather than forwarded whole". The mitigation addresses the
  *size* of each message (8 KiB cap) but not the count. `onRawFrame` is passed unconditionally at
  `main.ts:743`; the adapter's only gate is `if (!onRawFrame) return` at `pi-cli-rpc-adapter.ts:347`,
  which is never true in production.
- **Fix:** Track whether any renderer has subscribed (a counted `ensemblr:pi-raw-frame-subscribe` handle, or
  read the developer-mode setting main already owns for other purposes) and pass `onRawFrame: undefined`
  when nobody is. The existing `if (!onRawFrame)` short-circuit then makes the whole path free.

---

### [RT-04] Every non-delta event is a synchronous 5-statement SQLite transaction on the main thread, with no batching

- **Impact:** Medium
- **Confidence:** Confirmed (code path; the DB layer itself is the storage sibling's audit —
  cross-reference `11-storage-and-persistence.md`)
- **Where:** `src/main/storage/repositories/agent-event-repository.ts:77`, called per event from
  `src/main/agent-runtime/session/handle-runtime-event.ts:273`

```ts
	database.exec('BEGIN IMMEDIATE');
	try {
		const next = database
			.prepare(`SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM agent_session_events WHERE branch_id = ?`)
			.get(input.branchId) as { next: number };
		database.prepare(`INSERT INTO agent_session_events …`).run(…);
		database.exec('COMMIT');
	…
	const row = getEventById({ database, id });
```

- **Mechanism:** Main process, once per persisted event. Three `database.prepare()` calls (statements are
  compiled fresh each time rather than cached), a `MAX(ordinal)` lookup, the insert, a commit, and a
  **second `SELECT` round-trip** to read the row back so the broadcast can carry it. An `appendAgentEvents`
  batch variant already exists at `:130` and is not used by the live path.
- **Evidence:** The mitigation that matters is already in place — deltas bypass this entirely
  (`handle-runtime-event.ts:95`), which is why the production DB holds no `text-delta` rows at all. What
  remains is every tool call, tool result, tool update, message end, and (until RT-01 is fixed) every
  `extension_ui_request`. Real event mix: `tool-result` averages 6,994 B and 481 payloads exceed 100 KB
  (123.9 MB total, largest single payload 1,015,249 B — a 1 MB structured clone per window on arrival).
- **Fix:** Cache the two prepared statements on the connection, and return the inserted row from the
  values already in hand instead of the read-back `SELECT`. Batching the writes behind a microtask-drained
  queue is the larger win but changes broadcast/persist ordering, which `handle-runtime-event.ts:63-74`
  documents as load-bearing — do the cheap two first.

---

### [RT-05] Timeline re-projection is linear in *message* count on every animation frame of a streaming turn

- **Impact:** Medium
- **Confidence:** Confirmed (measured)
- **Where:** `src/renderer/lib/agent-timeline/event-to-ui-message.ts:128`

```ts
	return (events) => {
		const resumed = canResumeProjection(cursor, events);
		const result: UIMessage[] = resumed ? [...cursor.result] : [];
		let pending = resumed ? cursor.pending : null;
		for (const event of events.slice(resumed ? cursor.folded.length : 0)) {
			pending = handleEvent(event, pending, result);
		}
		cursor = { folded: [...events], pending, result };
		return finalizeProjection(result, pending, decorations);
	};
```

- **Mechanism:** Renderer main thread, once per rAF flush during a stream (so up to 60/s per visible
  timeline). Even though the *fold* is incremental, four things are not: the `canResumeProjection` walk over
  every folded event, the `[...events]` cursor copy, the `[...cursor.result]` message copy, and the three
  whole-transcript finalize passes (`dropFlushedSkillDuplicates` → `relocateSkillInvocations` →
  `withPromptTimes`, `event-to-ui-message.ts:177`). Cost is dominated by message count, not event count.
- **Evidence:** Synthetic benchmark (`npx tsx`, warm, importing the real module):

  | history | messages | `+1 delta` mean |
  | ---: | ---: | ---: |
  | 500 events | 500 | 0.103 ms |
  | 1,000 | 1,000 | 0.200 ms |
  | 5,000 | 5,000 | 1.042 ms |
  | 10,000 | 10,000 | **2.397 ms** |
  | 10,000 | 2 | 0.078 ms |

  ≈ **0.24 µs per message per projection**; the event-linear half (resume check + array copy over 10k
  events) is only 0.078 ms. On the real 26,922-event branch the incremental cost is 0.25 ms because it
  projects to 2 messages. The 2.4 ms figure needs a transcript with ~10k *messages*, which the real data
  does not contain — so this is a scaling cliff rather than a current regression.
- **Fix:** Cheap and safe: skip the `[...cursor.result]` and `[...events]` copies when `resumed` and the
  fold appended nothing structural, and memoize the three finalize passes on `(messages.length, lastMessage)`
  so a delta that only grew the trailing message's text does not re-walk the transcript. The decoration
  `WeakMap`s already keep the per-message derivations stable — the walk itself is what remains.

---

### [RT-06] Pi stderr is persisted and broadcast one row per chunk

- **Impact:** Low
- **Confidence:** Confirmed
- **Where:** `src/main/pi-agent/cli-rpc/child-streams.ts:65`

```ts
	child.stderr.on('data', (chunk: Buffer) => {
		stderrRing.write(chunk);
		emit({
			at: now().toISOString(),
			error: { code: 'adapter-failure', detail: chunk.toString('utf8'),
				message: 'Pi RPC stderr', recoverable: true },
			type: 'error',
		});
	});
```

- **Mechanism:** Main process, once per stderr `data` chunk. Each becomes an `error` event routed to the
  `stderr` stream (`agent-session-persistence.ts:116`) — so a full transaction plus broadcast per chunk —
  and the renderer then discards it (`event-to-ui-message.ts`: `if (event.stream === 'stderr') return pending`).
  A Pi build that logs progress to stderr, or a tool that does, turns a log line into a DB write.
  `createRingBuffer` also does `Buffer.concat([stored, chunk])` on every write (`ring-buffer.ts:25`),
  which is O(64 KiB) per chunk rather than a true ring.
- **Evidence:** Benign in practice today — 259 stderr rows / 78,819 bytes across 891k events. The exposure
  is the unbounded coupling, not the current volume.
- **Fix:** Keep the ring-buffer write (it is the crash post-mortem, per `child-streams.ts:153-161`) and drop
  the `emit`, since the renderer already discards it. If the timeline should keep *something*, coalesce to
  one event per turn from the ring snapshot.

---

### [RT-07] `StreamedReasoningByThread` retains one buffer per sub-agent tool call for the session's life

- **Impact:** Low
- **Confidence:** Confirmed (code path)
- **Where:** `src/main/claude-agent/streamed-reasoning.ts:56`

```ts
	const buffersByThread = new Map<string, StreamedReasoning>();
	return {
		forThread: (parentToolCallId) => {
			const threadKey = parentToolCallId ?? '';
			const existing = buffersByThread.get(threadKey);
			if (existing) return existing;
			const created = createStreamedReasoning();
			buffersByThread.set(threadKey, created);
			return created;
		},
	};
```

- **Mechanism:** Main process, one `Map` entry per distinct `parent_tool_use_id` a Claude session ever
  produces. Nothing removes an entry when its sub-agent thread ends; the per-entry `chunksByIndex` is
  cleared on `reset` so the retained bytes are small, but the entry count grows monotonically with the
  number of sub-agent tool calls in the session. Dies with the adapter session, so it is bounded by session
  lifetime rather than app lifetime.
- **Evidence:** No `delete` on `buffersByThread` anywhere in the file; the only prune is
  `chunksByIndex.clear()` inside a buffer (`:88`).
- **Fix:** Drop the thread's buffer when the sealing `assistant` message for that `parent_tool_use_id`
  lands — the seal is already the point at which the banked text is consumed.

---

## Verified sound

- **Text deltas never touch the database.** `handle-runtime-event.ts:95` synthesizes an ephemeral row with a
  fractional ordinal (`lastBroadcastOrdinal + deltaCounter * 1e-6`) and broadcasts it directly; the
  authoritative `message_end` persists the full text. Confirmed against the production DB: zero
  `text-delta` rows in 891,177 events.
- **Renderer broadcast intake is rAF-coalesced with a hard ceiling.** `use-timeline-events.ts:97-137`.
  The 512-event cap exists precisely because `requestAnimationFrame` never fires in a minimized window,
  which is the failure mode an unattended multi-hour turn would otherwise hit.
- **Cache merge has an ordinal-monotonic append fast path.** `use-timeline-events.ts:146-158` skips both the
  id `Set` and the sort when the batch extends in order, which is the normal streaming case.
- **The projector resumes rather than refolds**, and compares the *whole* folded prefix by reference rather
  than sampling its ends (`event-to-ui-message.ts:159`) — the sampled variant would silently serve a stale
  transcript. Measured refold after a deliberate identity break on the real 26,922-event branch: 5.7 ms.
- **JSONL framing is rope-safe and byte-capped.** `jsonl-line-stream.ts:75` accumulates byte length and the
  discard preview per chunk rather than re-measuring the accumulated line, avoiding the quadratic flatten;
  the 16 MiB cap (`pi-cli-rpc-adapter.ts:46`) is sized for inlined base64 image reads, and an oversize line
  is recovered into a synthetic tool-completion frame (`line-stream-handlers.ts:66`) so the call settles as
  failed instead of hanging forever.
- **Adapter listeners are released on shutdown.** `pi-cli-rpc-adapter.ts:575` (`listeners.clear()`),
  plus `pendingStatsIds.clear()` and every `pendingStateResolvers` entry settled with `null` so no caller
  hangs. `agent-client.ts:180` drops the session from its registry on close; `handle-runtime-event.ts:239`
  and `agent-session-lifecycle.ts:749` drop the `ActiveSession`.
- **Main holds no per-session event array.** `ActiveSession` (`session/active-session.ts:13`) carries the
  row, the subscription, the activity projection, and the newest `contextUsage` — the last explicitly so
  the agent-control wait loop does not re-scan the transcript. Memory per open session in main is
  kilobytes, not megabytes.
- **The activity monitor is O(1) per event and reacts only to `status`/`shutdown`**
  (`agent-activity-monitor.ts:400-430`). The battery poll is 60 s, armed only while something is streaming,
  disarmed when nothing is, and `readMacosBattery` shells out to `pmset` asynchronously with a 2 s timeout
  (`macos-battery.ts:37`) so it never blocks the event loop.
- **The Claude normalizer drops what it does not model** (`sdk-message-normalizer.ts:334`,
  `default: return []`) — the discipline RT-01 asks the Pi dispatcher to adopt.
- **Sub-agent fan-out is bounded**: depth limit, 20 lifetime spawns per rooted delegation tree, 10/minute
  (`agent-control/guardrails.ts:37-39`), enforced against durable per-tree counters.
- **`refetchOnWindowFocus` is off globally** (`api/query-client.ts:12`), so alt-tabbing does not trigger a
  refetch storm of the unbounded events query.
- **`pi-replay/reducer.ts` is dev-only** — reachable solely from `/debug/pi-replay`
  (`types/pi-replay.ts:2`), not on any production path.

---

## Coverage

Read and traced end to end: `src/main/pi-ipc/**`; `src/main/pi-agent/**` (adapter, `cli-rpc/*`, wire
normalizer); `src/main/claude-agent/claude-agent-adapter.ts`, `sdk-message-normalizer.ts`,
`streamed-reasoning.ts`; `src/main/agent-runtime/` — `agent-client.ts`, `agent-session-lifecycle.ts`,
`agent-session-persistence.ts`, `agent-activity-monitor.ts`, `macos-battery.ts`,
`session/handle-runtime-event.ts`, `session/active-session.ts`, service `listEvents`;
`src/main/main.ts` broadcast sites; `src/main/storage/repositories/agent-event-repository.ts` (append and
list paths only); `src/preload/bridge/ensemblr-api.ts`; `src/renderer/api/ensemblr/agent-sessions.ts`,
`api/query-client.ts`; `hooks/workbench-shell/timeline/*`; `lib/agent-timeline/event-to-ui-message.ts`;
`routing/workbench-route-loaders.ts`; `agent-control/guardrails.ts`.

Measured: timeline projector cold/incremental scaling on synthetic runs (500→10,000 events) and on the
real 26,922-event branch; `listEventsByBranch` + JSON.parse + serialize on the production DB; renderer heap
retention for one branch; production event-type, payload-kind, frame-type, and branch-size distributions.

Not covered (owned elsewhere): SQLite PRAGMAs, index design, WAL behavior and replay-query shape
(→ `11-storage-and-persistence.md`); React memoization, markdown/Shiki per token, virtualization
(→ `14-renderer-conversation-rendering.md`); the agent-control HTTP server's auth and scope model.

---

## Open questions

- **Are `extension_ui_request` `confirm` frames reaching a user surface at all?** They currently land in the
  same `unknown` bucket as `setStatus`. If Pi's extension-side `confirm` blocks until an
  `extension_ui_response` is written back (as `schemas.ts:318` documents), a dropped-on-the-floor `confirm`
  is a hang, not just noise. Worth confirming before RT-01's fix chooses "drop" over "route".
- **Should `agent_session_events` have a retention policy at all?** 990 MB for one developer's usage, with
  no pruning path found on the pipeline side. Even with RT-01 fixed the table grows without bound.
- **Security observation (routed here, not in scope):** `handleUnknown` persists `raw: typed` — the entire
  unmodelled frame — to disk verbatim, and the raw-frame tap broadcasts the first 8 KiB of every JSONL
  line to *every* `BrowserWindow` regardless of workspace. Both paths carry whatever Pi put on the wire,
  including tool arguments and results, across a boundary nothing filters by workspace.
- **`AgentEventRow.ordinal` uses fractional deltas (`+ deltaCounter * 1e-6`)**; a turn emitting more than
  10⁶ deltas between two persisted events would collide with the next integer ordinal and break
  `extendsInOrder`'s strict-monotonic assumption. Not reachable in practice — flagging it as a documented
  invariant rather than a bug.
