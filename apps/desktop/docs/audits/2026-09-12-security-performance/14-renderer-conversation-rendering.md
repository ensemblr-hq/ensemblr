# Renderer: conversation, timeline, and viewer render paths

The streaming hot path is in better shape than the brief feared: deltas are coalesced to one
React commit per animation frame, the projector preserves message identity, `TimelineMessage`
is memoized and holds, and `MessageResponse` re-parses exactly **1 of 41** markdown blocks per
delta (measured). The real costs sit elsewhere. Three findings dominate: Shiki tokenizes whole
files **synchronously on the main thread with no worker and no size cap** — a 5,000-line diff is
~4.8 s of frozen UI (measured, two sides at 2.4 s each); the boot path parses and registers
**11.1 MB of Iconify SVG** before first paint, of which the 7.4 MB `@iconify-json/logos`
collection exists to serve **three** icons; and every settled tool-call row inside a live turn
re-renders on every delta because no memo boundary sits between the turn and its rows
(40 of 40 measured, cost linear in row count). Neither the timeline nor the diff viewer is
virtualized, so a long conversation and a large diff both pay their full mount cost at once.

All numbers below come from probes run in this worktree; happy-dom DOM operations are slower
than Chrome's, so component-render timings are stated as relative scaling and flagged as such.
Shiki and JSON/JS-parse timings are CPU-bound and transfer directly.

---

## Render-path map

### 1. One streamed text delta

`subscribeAgentSessionEvents` → `createBroadcastBuffer` coalesces on `requestAnimationFrame`
(`src/renderer/hooks/workbench-shell/timeline/use-timeline-events.ts:82-116`) → one
`queryClient.setQueryData` per frame → `useQuery(agentSessionEventsQuery)` → new `events` array.
**Delta rate at React is therefore ≤ 60/sec, not 50–200/sec.**

| Component | File:line | Re-renders per delta? | Why | Work done |
| --- | --- | --- | --- | --- |
| `AgentSessionTimeline` | `timeline.tsx:78` | yes | subscribes to `events` | re-runs projector (sibling's scope), `retryPromptsByMessageId` over transcript, builds N `<TimelineMessage>` elements |
| `TimelineMessage` (settled) | `timeline.tsx:267` | **no** | `memo`; `message` identity preserved by projector, and every other prop is stable (`fork` memoized at `use-fork-conversation.ts:205`, `errorRecovery` at `use-runtime-error-recovery.ts:94`, `checkpointsByTurnId` at `use-timeline-session.ts:62`, `requestRestore` deps stable) | none |
| `TimelineMessage` (live) | `timeline.tsx:267` | yes | `message.parts` is a new array | — |
| `ChatAssistantTurn` (live) | `chat-assistant-turn.tsx:47` | yes | — | `visibleTurnParts` filter + `groupSubagentActivity`/`foldTaskPlanRuns` + `collectActivityGlyphs`, each O(parts) |
| `ActivityRow`/`ActivityNodeRow`/`ActivityPart` | `chat-assistant-turn.tsx:155,188,203` | **yes, all of them** | plain functions, no `memo`; parent re-renders | reconcile every settled tool row's subtree — see **[RR-03]** |
| `ChatToolCall` | `chat-tool-call.tsx:44` | yes | no `memo` | `presentToolCall` is `useMemo`'d on `part` identity and **is** skipped; the row subtree below still reconciles |
| `MessageResponse` (settled blocks) | `message.tsx:57` | **no** | `memo` with `children`-identity comparator | none |
| `MessageResponse` (streaming tail) | `message.tsx:57` | yes | `children` string grew | full remark/marked re-lex of the accumulated answer; Streamdown's own `MarkdownSection` memo spares re-rendering settled blocks — see **[RR-06]** |
| `ChatTurnTimer` | `chat-turn-timer.tsx:13` | independently, 10 Hz | `useElapsedMs` interval | leaf `<span>` only — correctly scoped |

**Measured per-delta cost** (happy-dom, live turn, settled tool rows only varying):

```
tools=  0  ms/delta=0.27
tools= 10  ms/delta=2.39
tools= 40  ms/delta=5.80
tools= 80  ms/delta=9.14      → ~0.11 ms per settled row per delta
```

**Measured markdown-tail cost** (happy-dom, one appended token onto a settled prefix):

```
prefix=     8B fences= 0  ms/delta=0.84
prefix=  2180B fences= 2  ms/delta=1.18
prefix= 11468B fences=10  ms/delta=3.42
prefix= 23158B fences=20  ms/delta=4.32
```

A realistic late-turn frame (40 tool rows, 20 KB answer) is ~10 ms in happy-dom. Chrome is
roughly 3–5× faster on these paths, so ~2–3 ms of a 16.6 ms frame — of which the tool-row half
is pure waste.

### 2. A new tool-call event

Same path. The new `dynamic-tool` part appends to `message.parts`, so `splitTurnParts`,
`groupSubagentActivity`, `foldTaskPlanRuns` and `collectActivityGlyphs` all recompute (each
O(parts)), and every existing row reconciles. One extra `presentToolCall` runs for the new part.

### 3. Switching chat tabs

`<Conversation key={activeSession.chatTabId}>` (`timeline.tsx:213`) **remounts the entire
conversation subtree** on every tab switch. Only the active tab's timeline is mounted
(`conversation-content.tsx:106`), so there is no N-tab fan-out — but the price is that every
message, every markdown block, and every code panel mounts from scratch each time. See
**[RR-05]**; the Shiki LRU (`highlighter.ts:36`, 200 entries) absorbs re-highlighting, markdown
parsing is paid again in full.

### 4. Opening a long conversation (mount)

**Not virtualized.** `messages.map(...)` at `timeline.tsx:223` renders every message.
Measured cost of a single settled answer (17 KB markdown, 10 fences, 60 paragraphs) through the
real `MessageResponse`: **66–90 ms** in happy-dom after warmup. A 50-answer transcript is
therefore on the order of a second of synchronous main-thread work at mount, repeated on every
tab switch. See **[RR-05]**.

### 5. A terminal output burst

`ensemblr.onTerminalOutput` → `adapter.write(event.data)` per IPC chunk
(`xterm-terminal.tsx:115`). xterm's own write buffer coalesces to one render per frame, and the
WebGL renderer is attached, so this leg is sound. Each mounted terminal registers its own
broadcast listener and filters by id in JS, so with 5 terminals each chunk runs 5 callbacks —
negligible. Resize is the weak leg: see **[RR-10]**.

### 6. Opening a 5,000-line diff

`useDiffTokens` (`shiki-tokenize.tsx:157`) reconstructs the **whole old side and whole new side**
from the hunks and tokenizes each as one source, then builds the token trees with
`tokenize(hunks, { enhancers })` inside a `useMemo` during render. `codeToTokens` is
synchronous; the `async` wrapper around it yields before the call, not during it.

```
lines=   500 codeToTokens ms=352
lines=  2000 codeToTokens ms=951
lines=  5000 codeToTokens ms=2389
lines= 20000 codeToTokens ms=9652
```

Two sides ⇒ **~4.8 s frozen for a 5k-line diff, ~19 s for a 20k-line diff.** Then `<Diff>`
renders every hunk and every row into the DOM with no virtualization. See **[RR-01]**,
**[RR-04]**.

### 7. Expanding the files tree of this repo

Sound. `useWorkspaceFileTree` (`use-workspace-file-tree.ts:236-307`) builds the tree in a
`useMemo`, flattens only expanded rows, and feeds a TanStack `useVirtualizer` with overscan.
`handleDirectoryToggle` is deliberately kept free of `isExpanded` so memoized rows actually skip.
The only cost is a full `buildFileTree` + `flattenFileTree` per fs-watch invalidation
(`workspace-files.ts:24`, watcher clamped to ~1/s) — see **[RR-12]**.

---

## Findings

### [RR-01] Shiki tokenizes whole files synchronously on the main thread, uncapped

- **Impact:** High
- **Confidence:** Confirmed (measured)
- **Where:** `src/renderer/lib/code/highlighter.ts:166`; callers
  `src/renderer/components/diff-viewer/shiki-tokenize.tsx:163-189`,
  `src/renderer/hooks/code-surface/use-highlighted-code.ts:23-66`

```ts
const result = highlighter.codeToTokens(code, {
    lang: langToUse,
    themes: { dark: theme, light: theme },
});
```

- **Mechanism:** `tokenizeWithShiki` is `async`, but the `await` is on highlighter/theme
  loading; `codeToTokens` itself is one uninterruptible synchronous call. `useDiffTokens`
  reconstructs both full sides of a diff (`reconstructSideSources`) and calls it twice per file,
  then runs `tokenize(hunks, { enhancers })` — also synchronous — inside a render-phase `useMemo`.
  `CodePanel` takes the same path for every fenced block in an answer. There is no size cap, no
  line budget, no chunking, and no `react-diff-view` `useTokenizeWorker`.
- **Evidence:** measured on this machine with the repo's own `shiki` build, TypeScript grammar,
  `github-dark`: 500 lines = 352 ms, 2,000 = 951 ms, 5,000 = 2,389 ms, 20,000 = 9,652 ms. A
  5k-line diff pays it twice. A 500-line fenced code block in one assistant answer is a 350 ms
  freeze, which is reachable in ordinary use.
  Swapping the regex engine is **not** the lever: `createJavaScriptRegexEngine({forgiving:true})`
  measured *slower* than the default WASM oniguruma engine (485 / 1,274 / 2,889 ms for the same
  three sizes).
- **Fix:** move tokenization off the main thread. Smallest change that removes the freeze: run
  `codeToTokens` in a `Worker` behind the existing `highlightCode` callback contract —
  `highlighter.ts` already has the cache, the pending-dedup, and the subscriber set, so only
  `tokenizeWithShiki` moves. Failing that, a line/byte cap that falls back to plain text above a
  threshold (react-diff-view renders un-tokenized fine, and `useSideTokens` already tolerates
  `null`) converts a multi-second freeze into a legible uncoloured diff.

### [RR-02] 11.1 MB of Iconify SVG is parsed and registered before first paint; 7.4 MB of it serves three icons

- **Impact:** High
- **Confidence:** Confirmed (measured against the production build)
- **Where:** `src/renderer/lib/workbench/icon-collections.ts:18-21`, called from
  `src/renderer/main.tsx:31`

```ts
export function registerIconCollections(): void {
    addCollection(vscodeIcons);   // 1,589 icons, 3.73 MB
    addCollection(logosIcons);    // 2,110 icons, 7.45 MB
```

- **Mechanism:** both collections are static imports, so Rolldown inlines them as JS object
  literals into the eager graph. `registerIconCollections()` runs synchronously in `main.tsx`
  *before* `createRoot().render`, so the parse, the evaluation, and ~3,700 `addCollection`
  inserts all land ahead of the first frame, and the strings stay resident for the window's life.
- **Evidence:** production build (`vite build --config vite.renderer.config.mts`): entry chunk
  `assets/index-*.js` is **7.42 MB**, and a window-by-window scan of it is `linearGradient`,
  `radialGradient`, `cloudflare`, `jetbrains`, `delicious` from 0.3 MB to 7.0 MB — it is
  `@iconify-json/logos` end to end (`claude-icon` present, no `file-type-*`). The second-largest
  chunk `assets/icons-*.js` is **3.73 MB** and is `@iconify-json/vscode-icons`
  (400 × `folder-type-`, 17 × `file-type-js`). Both are `modulepreload`ed by `index.html`.
  Together they are **11.1 MB of the 30.96 MB of JS the renderer ships**.
  Actual `logos:` usage across `src/renderer`: **three icons** — `logos:claude-icon`,
  `logos:mistral-ai-icon`, `logos:openai-icon`.
  Evaluation cost of the 7.4 MB literal measured at ~30 ms in Node (vs 24 ms for `JSON.parse` of
  the same data); Electron adds the disk read and the `addCollection` walk on top.
- **Fix:** replace the `logos` bulk registration with an inline three-icon collection built from
  the three bodies (the file already hand-builds an `ensemblr` collection at line 21, so the
  shape exists). That alone removes 7.4 MB from the entry chunk. `vscode-icons` is genuinely
  dynamic — `file-icons.ts:171` probes it by extension — but it can move behind a dynamic
  `import()` awaited off the first-paint path, since a file icon that appears one frame late is
  invisible whereas a 3.7 MB blocking parse is not.

### [RR-03] Every settled tool-call row in the live turn re-renders on every streamed delta

- **Impact:** High
- **Confidence:** Confirmed (render-counted)
- **Where:** `src/renderer/components/chat-assistant-turn.tsx:82-84` and the three plain
  function components below it (`:155`, `:188`, `:203`)

```tsx
const activityRows = activityNodes.map((row) => (
    <ActivityRow key={`${message.id}:a:${row.key}`} row={row} />
));
```

- **Mechanism:** `ChatAssistantTurn` re-renders on every delta (its `message.parts` array is new).
  `ActivityRow`, `ActivityNodeRow`, `ActivityPart` and `ChatToolCall` carry no `memo`, so React
  re-renders and reconciles every settled tool row's whole subtree — collapsible chrome, chips,
  badges, icon lookups — even though `presentToolCall`'s `useMemo` correctly skips the
  presentation work. Cost is linear in the number of tool calls already completed in the turn,
  which is exactly the quantity that grows as a long agent run proceeds.
- **Evidence:** probe rendering `ChatAssistantTurn` with 40 settled `dynamic-tool` parts plus a
  streaming tail, mocking only the leaf components to count renders:
  `MOUNT { text: 41, tool: 40 }` / `PER-DELTA { text: 1, tool: 40 }`. The markdown side is
  memoized correctly (1 of 41); the tool side is not (40 of 40). Timing probe with the real
  components: 0.27 / 2.39 / 5.80 / 9.14 ms per delta for 0 / 10 / 40 / 80 tool rows — ~0.11 ms
  per row per delta in happy-dom.
- **Fix:** wrap `ActivityRow` in `memo`. Its only prop is `row`, and `foldTaskPlanRuns` /
  `groupSubagentActivity` build those nodes from parts whose identity the projector preserves —
  so a settled row's `row.node.part` is referentially stable and the memo will hold. Confirm that
  `groupSubagentActivity` returns identical node objects for unchanged parts; if it allocates
  fresh wrappers per fold, memoize on `row.key` + `part` identity instead, or move the
  `memo` boundary down onto `ChatToolCall` (whose `part` prop is definitely stable).

### [RR-04] The diff viewer renders every hunk and row, with no virtualization and no size guard

- **Impact:** Medium
- **Confidence:** Confirmed
- **Where:** `src/renderer/components/diff-viewer/diff-viewer.tsx:319-333`

```tsx
{(renderHunks) =>
    renderHunks.flatMap((hunk, index) => {
        const rows = [<Hunk hunk={hunk} key={hunk.content} />];
```

- **Mechanism:** `react-diff-view`'s `<Diff>` lays out a table row per change line. A 5,000-line
  diff is 5,000 rows plus one token `<span>` per Shiki token — on the order of 50,000 DOM nodes
  for one file. No cap, no windowing, no "this diff is large, show it plain?" affordance
  anywhere in `diff-viewer/`, `use-file-diff-content.ts`, or `review-files/` (grepped for
  `tooLarge`/`MAX_DIFF`/byte guards — nothing).
- **Evidence:** code path above; combined with [RR-01] the whole open is ~5 s of freeze followed
  by a very large layout.
- **Fix:** the single highest-value change is a threshold — above N changed lines, render the
  file un-tokenized and collapsed-by-default per hunk, which also sidesteps [RR-01]. Virtualizing
  `<Diff>` properly is a larger job because comment widgets and `Decoration` gaps anchor to rows.

### [RR-05] The timeline is not virtualized, and a tab switch remounts the whole transcript

- **Impact:** Medium
- **Confidence:** Confirmed (measured mount cost)
- **Where:** `src/renderer/components/workbench-shell/conversation-panel/timeline/timeline.tsx:213,223`

```tsx
<Conversation className='min-h-0 w-full flex-1' key={activeSession.chatTabId}>
...
{messages.map((message, index) => (
```

- **Mechanism:** every message in the transcript is mounted at once, and the `key` on
  `<Conversation>` forces a full unmount/remount of that subtree whenever the active chat tab
  changes — so the whole mount cost is paid again on each switch. `use-stick-to-bottom`'s
  ResizeObserver then has to settle a fully-laid-out tree rather than a windowed one.
- **Evidence:** measured `MessageResponse` mount for one 17 KB answer with 10 fences and 60
  paragraphs: 177 ms cold, then 102 / 88 / 67 / 72 ms. Even at Chrome's ~3–5× advantage, a
  50-answer transcript is several hundred milliseconds to a second of blocking work per open and
  per tab switch. `git log`-scale conversations (hundreds of turns) scale linearly from there.
- **Fix:** two independent wins. (a) Drop the `key` if the state it resets can be keyed more
  narrowly — `scrollKey` already handles scroll restoration, so the remount may be buying less
  than it costs; verify what state it is actually resetting. (b) Virtualize the message list. The
  repo already has `@tanstack/react-virtual` wired for the file tree with dynamic measurement,
  and messages are variable-height, so `measureElement` is the pattern to copy.

### [RR-06] Streaming re-lex cost grows linearly with the settled answer, not with the delta

- **Impact:** Medium
- **Confidence:** Confirmed (measured)
- **Where:** `src/renderer/components/message.tsx:57-108` → `streamdown`

- **Mechanism:** Streamdown memoizes rendered blocks (`MarkdownSection`, memo with a custom
  comparator), so settled blocks are not re-rendered — but the markdown string must still be
  re-lexed end to end on every delta to find the block boundaries. Cost is therefore O(answer
  length) per frame, and the answer only grows.
- **Evidence:** appending one token onto a settled prefix: 0.84 ms at 8 B, 1.18 ms at 2.2 KB,
  3.42 ms at 11.5 KB, 4.32 ms at 23 KB (happy-dom). Compare 66–90 ms for a cold mount of the same
  23 KB — the block memo is doing real work and saving ~16×. The residual is the lexer.
- **Fix:** this is upstream behavior and mostly acceptable; the mitigation available here is to
  stop growing the string handed to one `MessageResponse`. The projector already splits a turn
  into parts — emitting a fresh text part at each settled block boundary (rather than one growing
  part) would cap each `MessageResponse`'s input at one block and make the per-delta lex O(1).
  That is a projector change and belongs with the pipeline sibling; flagging the render-side
  consequence here.

### [RR-07] The entry document modulepreloads ~150 chunks, including both icon collections

- **Impact:** Medium
- **Confidence:** Confirmed
- **Where:** build output `index.html`; route definitions under `src/renderer/routing/routes/`

- **Mechanism:** `autoCodeSplitting: true` (`vite.renderer.config.mts:15`) splits route
  *components*, but `routeTree.gen.ts` statically imports every route module for its definitions,
  loaders, and search validators — so the eager graph reaches `settings-ui`, `_repoId`,
  `_issueId`, `tool-approval`, `route-boundaries` and their dependencies. Vite then emits a
  `modulepreload` link for each, and the browser fetches and parses them all before the first
  route resolves.
- **Evidence:** the built `index.html` carries ~150 `modulepreload` links, among them
  `icons-CNCLvGNA.js` (3.73 MB). Total shipped JS 30.96 MB across 2,402 files; the Shiki grammar
  split is working (`emacs-lisp` 771 KB, `cpp` 767 KB etc. are separate lazy chunks), `mermaid`
  and `cytoscape` (425 KB) and `katex` (253 KB) are lazy, `xterm` and `react-diff-view` and
  `lexical` and `streamdown` are all out of the entry chunk. The i18n catalogues (864 KB of the
  1.03 MB `ensemblr-*.js`) are eager, which is a deliberate call.
- **Fix:** [RR-02] removes the two largest preloads and is the whole win here in practice. Beyond
  that, the modulepreload list is a symptom of route-definition eagerness that TanStack's codegen
  owns; not worth fighting.

### [RR-08] `useOptimisticPrompts` returns a fresh object, so the reconcile effect runs every frame

- **Impact:** Low
- **Confidence:** Confirmed
- **Where:** `src/renderer/state/composer/optimistic-prompts.ts:88` returning
  `{ prompts, push, remove, removeMany }`; consumed at
  `src/renderer/hooks/workbench-shell/timeline/use-timeline-messages.ts:50-61`

```ts
useEffect(() => {
    if (optimistic.prompts.length === 0) { return; }
    const matchedIds = matchOptimisticAgainstMessages(optimistic.prompts, persistedMessages);
    ...
}, [optimistic, persistedMessages]);
```

- **Mechanism:** the hook builds a new object literal on every render, so `optimistic` is never
  referentially equal and the effect fires on every delta. It early-returns while no prompt is
  pending, so the steady-state cost is nil — but in the window between submit and the persisted
  twin landing, `matchOptimisticAgainstMessages` walks the entire transcript once per frame.
- **Fix:** wrap the return in `useMemo` keyed on `[prompts, push, remove, removeMany]`, or depend
  on `optimistic.prompts` and `optimistic.removeMany` directly at the call site.

### [RR-09] `useHighlightedHunks` copies its whole result map per resolved hunk

- **Impact:** Low
- **Confidence:** Confirmed
- **Where:** `src/renderer/hooks/code-surface/use-highlighted-code.ts:108`

```ts
setAsyncTokens((previous) => new Map(previous).set(source, result));
```

- **Mechanism:** one state commit per hunk, each copying a map that grows with every commit —
  O(n²) allocations and n re-renders of the consuming component for an n-hunk payload. Bounded in
  practice: the only caller is `tool-collapsible/tool-diff-preview.tsx:94`, a tool row's inline
  preview, which is small. It would matter if this hook were ever pointed at a real patch.
- **Fix:** accumulate into a ref and commit once via a microtask/`requestAnimationFrame` flush,
  the same shape `createBroadcastBuffer` already uses for events.

### [RR-10] Terminal resize is undebounced: one `fit()` plus one IPC round trip per observation

- **Impact:** Low
- **Confidence:** Likely
- **Where:** `src/renderer/components/workbench-shell/dock-panel/xterm-terminal.tsx:169` →
  `syncTerminalDimensions` at `:266-282`

```ts
const resizeObserver = new ResizeObserver(() => syncDimensions());
```

- **Mechanism:** dragging the dock splitter fires the observer every frame; each call runs
  `adapter.fit()` (which measures the DOM and forces a reflow) and issues
  `resizeTerminalSession` over IPC. Hidden tabs are force-mounted but have a zero-size container
  and return early (`:270`), so the cost is per *visible* terminal — usually one, up to a few in
  a split dock.
- **Fix:** coalesce on `requestAnimationFrame` and skip the IPC when the computed cols/rows are
  unchanged since the last send.

### [RR-11] The Streamdown code plugin is constructed per message and never reached

- **Impact:** Low
- **Confidence:** Confirmed
- **Where:** `src/renderer/components/message.tsx:63-88`

```ts
const plugins = useMemo(() => ({ cjk, code: createCodePlugin({ themes: [codeTheme, codeTheme] }), math, mermaid }), [codeTheme]);
const answerComponents = useMemo(() => ({ ...components, code: MessageCodeBlock, ... }), [components]);
```

- **Mechanism:** overriding the `code` component slot replaces Streamdown's own code renderer,
  which is the only thing that consults `plugins.code` (and `plugins.mermaid`). So the plugin is
  rebuilt per `MessageResponse` instance per theme change and never highlights anything.
- **Evidence:** rendering `MessageResponse` with a ```ts fence produces the app's `CodePanel`
  markup (`bg-code`, `text-code-foreground`, `sleek-scrollbar`), not Streamdown's
  `data-streamdown` code chrome. The construction itself is cheap — the alias table in
  `@streamdown/code` is module-level — so this is cleanup, not a hot-path cost.
- **Fix:** drop `code` from the `plugins` object. Verify first whether `mermaid` is likewise
  unreachable (see Open questions); `math` operates at the remark layer and is unaffected.

### [RR-12] Every fs-watch broadcast rebuilds the whole workspace file tree

- **Impact:** Low
- **Confidence:** Likely
- **Where:** `src/renderer/hooks/workbench-shell/review-files/use-workspace-file-tree.ts:250,268`;
  invalidation at `src/renderer/api/ensemblr/workspace-files.ts:24`

- **Mechanism:** a refetch produces a new `files` array identity, so `buildFileTree` and
  `flattenFileTree` recompute in full. The watcher is clamped to ~1 broadcast/sec, and the same
  query also feeds composer `@`-mention search — so while an agent is writing files this runs
  once a second over the whole enumeration. Rows are memoized and the list is virtualized, so the
  DOM side is fine; this is pure JS.
- **Fix:** nothing until it is shown to matter on a large repo. If it does, diff the incoming
  file list against the previous one and rebuild only the affected subtrees.

---

## Verified sound

- **Delta coalescing.** `createBroadcastBuffer`
  (`src/renderer/hooks/workbench-shell/timeline/use-timeline-events.ts:82-116`) folds broadcasts
  into the query cache once per `requestAnimationFrame`, with a 512-event ceiling for occluded
  windows. This is what keeps the delta rate at React ≤ 60/sec rather than 50–200/sec.
- **`TimelineMessage` memo actually holds.** Every prop is stable by construction:
  `use-fork-conversation.ts:205` and `use-runtime-error-recovery.ts:94` both `useMemo` their
  returned handler objects *explicitly to preserve this memo* (the JSDoc says so), and
  `checkpointsByTurnId` (`use-timeline-session.ts:62`) and `requestRestore` (`timeline.tsx:116`,
  deps include `setTarget`) are stable too.
- **`MessageResponse` memo boundary.** `message.tsx:105-107` compares `children` identity;
  measured 1 of 41 blocks re-parsing per delta.
- **Shiki caching.** `lib/code/highlighter.ts` is a genuine LRU (200 sources, keyed by a
  full-string FNV-1a hash **and** verified against the stored source so a collision cannot paint
  the wrong text), one shared highlighter promise per language, and a shared pending-record so
  concurrent callers join one run instead of racing. The problem is where the work runs, not how
  it is cached.
- **`typedRunsOf` WeakMap cache** (`use-runtime-error-recovery.ts:152`) turns a per-fold regex
  walk over attachment-inlined prompt text into a map lookup.
- **File tree virtualization.** `use-workspace-file-tree.ts:291` with overscan and
  `initialRect`, plus `handleDirectoryToggle` deliberately kept free of `isExpanded` so the
  memoized rows can skip.
- **Atom granularity.** `atomFamily` per chat tab for drafts, attachments, and editor state
  (`state/composer/composer-drafts.ts`); `hasPendingPromptsAtomFamily`
  (`optimistic-prompts.ts:29`) is a derived boolean specifically so the conversation panel
  re-renders on the flag rather than on every push in every tab. No single mega-atom holding all
  sessions' messages. Drafts are in-memory rather than `atomWithStorage`, so no per-keystroke
  `localStorage` serialization; the `atomWithStorage` atoms hold small scalars only.
- **Query defaults.** `refetchOnWindowFocus: false` (`api/query-client.ts:12`) — correct for
  Electron, where focus toggles constantly. Polls are per-query and deliberate, several with
  functional `refetchInterval` that backs off (`setup-diagnostics-poll.ts`,
  `agent-models-catalog.ts`). The boot snapshot seeds the cache from preload so first paint does
  not wait on IPC.
- **`useElapsedMs` scoping.** The 10 Hz tick lives in `ChatTurnTimer` (`chat-turn-timer.tsx:13`),
  a leaf `<span>` — it does not re-render the turn.
- **Only the active chat tab's timeline is mounted** (`conversation-content.tsx:106`), so the
  "5–10 tabs alive" scenario does not multiply timeline render cost.
- **`motion` usage is minimal.** `AnimatePresence` appears in exactly one file
  (`onboarding/onboarding-wizard.tsx`); `use-raised-shadow.ts` drives a `MotionValue` with no
  `setState` per frame. No layout animations over long lists.
- **Tab strip scrolling** (`hooks/use-tab-scroller.ts`) manipulates the DOM directly — no
  `setState` per scroll event.
- **xterm adapter.** WebGL renderer attached, `allowTransparency` off, webfont load awaited with
  a texture-atlas clear and a re-fit — all documented in `.claude/rules/stack.md` and matching
  the code.

---

## Coverage

Read and reasoned about: `components/conversation.tsx`, `conversation/`, `chat-*.tsx`,
`message.tsx`, `code-block.tsx`, `code-surface/`, `tool-collapsible*`, `diff-viewer/`,
`workbench-shell/conversation-panel/` (timeline, composer state, session tabs, file preview),
`workbench-shell/review-files/`, `workbench-shell/dock-panel/xterm-terminal.tsx`,
`workbench-shell/agents-panel/`, `workbench-shell/checks-panel/`, `hooks/conversation/`,
`hooks/workbench-shell/timeline/`, `hooks/code-surface/`, `hooks/use-elapsed-ms.ts`,
`hooks/use-hotkey.ts`, `hooks/use-tab-scroller.ts`, `hooks/use-raised-shadow.ts`,
`state/composer/`, `state/preferences/atoms.ts`, `api/query-client.ts`, `api/ensemblr/*`,
`routing/router.tsx`, `routing/workbench-route-loaders.ts`, `lib/code/highlighter.ts`,
`lib/terminal/`, `lib/workbench/icon-collections.ts`, `main.tsx`, plus the `streamdown` 2.6 and
`@streamdown/code` dist bundles and a full production renderer build.

Measured: four render/timing probes under Vitest + happy-dom (render counts via leaf mocks,
per-delta scaling vs tool count, markdown mount cost, streaming incremental cost, fence routing),
a production `vite build` with per-chunk attribution, Shiki `codeToTokens` timings across four
file sizes on both regex engines, and icon-collection parse/eval timings. Probe files were kept
under the gitignored `.context/` scratch directory and removed; no file under `src/`,
`tests/`, `scripts/`, `resources/`, or any config was modified.

Not covered (out of dimension or owned elsewhere): the event reducer's own complexity and IPC
batching (sibling, `13-agent-runtime-pipeline.md`), renderer XSS and the rehype sanitize
configuration (sibling), main-process file enumeration cost, `pi-replay/` and `concierge/`
beyond confirming their chunks are lazy, and the dashboard board's drag-and-drop.

Not measured: real-Chrome timings (happy-dom figures are stated as relative scaling only), and
memory retention under a multi-hour session.

---

## Open questions

1. **[RR-03] fix shape.** Does `groupSubagentActivity` / `foldTaskPlanRuns`
   (`lib/agent-timeline/`) return referentially identical node objects for unchanged parts? If
   yes, `memo(ActivityRow)` is a one-line fix; if it allocates fresh wrappers per fold, the memo
   boundary belongs on `ChatToolCall` instead. Whoever owns `lib/agent-timeline/` can answer this
   faster than re-deriving it.
2. **[RR-01] worker vs cap.** A worker preserves syntax colour on large diffs but is real work
   (Shiki in a worker, grammar loading, transferable token grids). A size cap is an afternoon and
   removes the freeze at the cost of colour on files nobody reads line-by-line anyway.
   Recommendation: ship the cap first, worker later. Default taken for this report: both
   described, cap listed as the smallest change.
3. **[RR-05] what does the `key` on `<Conversation>` reset?** If it exists only for scroll
   position, `scrollKey` already covers it and the remount is free to delete. If it is resetting
   `use-stick-to-bottom` internals or disclosure state, it needs to stay and virtualization is
   the only lever.
4. **[RR-11] is `plugins.mermaid` also dead?** Streamdown routes mermaid fences through the same
   `code` component slot this repo overrides, which would mean mermaid diagrams in assistant
   answers currently render as plain code panels. That is a *correctness* question, not a
   performance one, and it was outside what I could confirm without a mermaid fixture — worth a
   five-minute check by whoever owns the markdown surface.
5. **Security one-liner to route to the XSS auditor:** `@streamdown/code`'s module-level token
   cache (`node_modules/@streamdown/code/dist/index.js`) is an **unbounded** `Map` keyed by
   `lang:theme:theme:length:first100chars:last100chars`. It is unreachable in this app today per
   [RR-11], but if the `code` component override is ever removed, that key is both a memory leak
   over a long session and collidable by construction.
