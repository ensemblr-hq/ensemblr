# Renderer workbench & bundle — performance audit

The renderer's critical path is **13.13 MB raw / 4.32 MB gzip of JS+CSS across 144 modulepreloaded
chunks**, and **86% of it is icon SVG data nobody asked for**: `main.tsx` registers the complete
`@iconify-json/logos` (7.14 MB, 2,110 icons) and `@iconify-json/vscode-icons` (3.58 MB, 1,589 icons)
collections before the first render, while the app references exactly **65 icons totalling 78.7 KB**.
Measured V8 parse+eval for those two object literals alone is **254 ms** on this M-series Mac, on the
boot path, before React mounts. A second eager block, all three i18n catalogues, adds 1.03 MB raw /
271 KB gz for ~548 KB of locales the launch will not use.

Beyond the bundle, one algorithm and one architectural choice dominate: the organic
architecture-diagram layout is super-quadratic and **blocks the main thread for 3.9 s on a
100-node/200-edge document** (measured), and the workspace tree has a 1.9% memo ratio (8 `memo(` calls
across 413 exported components) with an agent-event-driven atom write at its root, so every agent
session event re-renders the whole workspace subtree. Everything else I probed — file-tree building,
terminal output fan-out, query polling, resize/storage persistence, atom-family cleanup, duplication
(0.05%), circular deps (0) — came back sound, and several places carry JSDoc showing the cost was
already reasoned about.

## Bundle

Built with `npx vite build --config vite.renderer.config.mts --outDir /tmp/ensemblr-renderer-build`.
Succeeded unmodified (Vite 8.2.2, 8,297 modules, 7.51 s, 2,409 emitted files). No Forge globals were
needed — they are main-process defines.

### Largest 20 emitted assets

| Asset | Raw | Gzip | Contents | Initial critical path? |
| --- | ---: | ---: | --- | --- |
| `index-DptqpIeX.js` | 7,597 K | 2,786 K | entry: react-dom + app bootstrap + **~7.1 MB of `@iconify-json/logos` SVG path data** | **yes** (entry) |
| `icons-CNCLvGNA.js` | 3,703 K | 1,059 K | `@iconify-json/vscode-icons` (full, 1,589 icons) | **yes** (modulepreload) |
| `JetBrainsMonoNerdFontMono-*.ttf` ×4 | 2,414 K ea. | — | uncompressed TrueType, 4 faces = **9.66 MB** | CSS `@font-face`, `font-display: swap` |
| `debug.pi-replay-CFytzDl9.js` | 2,059 K | 170 K | `/debug/pi-replay` route (Shiki-heavy) | no (lazy route) |
| `route-layout-DJ2Zzhvf.js` | 1,450 K | 404 K | workbench route: xterm 6, `react-diff-view`, TanStack Virtual | no (lazy) |
| `ensemblr-BtbquKVs.js` | 1,028 K | 272 K | **i18next + all three locale catalogues** (81 K Cyrillic + 86 K Greek chars) | **yes** (modulepreload) |
| `emacs-lisp`, `cpp`, `wolfram`, `typst`, `vue-vine`, `angular-ts`, `typescript`, `jsx`, `tsx`, `javascript`, `objective-cpp`, `mdx`, `swift`, … | 790 K → 130 K | | Shiki grammars, one chunk per language | no (all lazy) |
| `chunk-KEIR6QF5`, `chunk-YOKDWASO`, `chunk-I66GZJ75` | 647/429/230 K | | mermaid internals | no (lazy) |
| `wasm-BnjxR4X6.js` | 608 K | 227 K | Oniguruma WASM (Shiki engine) | no (lazy) |
| `cytoscape.esm-B-NFISlW.js` | 425 K | 135 K | mermaid's graph layout | no (lazy) |
| `katex-DhON-x74.js` | 253 K | 76 K | `@streamdown/math` | no (lazy) |
| `index-Dwr22Tgy.css` | 241 K | 35 K | all Tailwind output | **yes** |

**Critical path totals: 13.13 MB raw, 4.32 MB gzip, 144 files.** Everything outside the top three is
small: the remaining 141 critical-path files sum to **357 KB raw**. Strip the icons and ship one
locale and the initial payload is ~1.1 MB raw / ~300 KB gz.

Verified good, no action:

- **Shiki is fully fine-grained.** Every grammar is its own lazy chunk and the Oniguruma WASM is
  lazy; nothing Shiki-related is preloaded. mermaid, cytoscape and KaTeX are likewise lazy.
- **No source maps in production** (`build.sourcemap` left at Vite's `false` default; 0 `.map` files
  emitted).
- **No duplicate React, no duplicate `motion`.** `radix-ui` (the monorepo package, 23 import sites)
  and `@base-ui/react` are both present but `@base-ui/react` is imported in exactly one file —
  `src/renderer/components/ui/combobox.tsx:3`, consumed only by
  `src/renderer/components/settings/models/model-role-picker.tsx` — and tree-shakes cleanly into the
  lazy `models` settings chunk. Two libraries, one primitive, zero critical-path cost.
- **`date-fns` is locale-only**: three named locales (`el`, `enUS`, `ru`) in
  `src/renderer/components/linear/issue-editor-due-date.tsx:2`, in a lazy route.
- **lexical, xterm and its addons are lazy**, reached through `route-layout`.
- `playground/` and `demo/` contribute nothing to this build.
- `src/renderer/types/resources.d.ts` (4,315 lines) is type-only and emits no runtime bytes.

`vite.renderer.config.mts` sets no `build.rollupOptions.output.manualChunks` and no `sourcemap`.
Neither is a defect on its own — Rolldown's default splitting produced a sane 2,400-chunk graph. The
entry chunk is oversized because of what is *statically imported*, not because chunking is wrong.

## Broadcast → re-render fan-out

Every main→renderer broadcast in `src/preload/bridge/ensemblr-api.ts:163-402`, traced to its
renderer handler. Frequency is per-broadcast, not per-render.

| Broadcast | Renderer handler | Writes / invalidates | Subscribers | Diffed? | Verdict |
| --- | --- | --- | --- | --- | --- |
| `agentSessionEvent` | `state/agents/use-agents-panel-state.ts:66`, `state/composer/agent-session-event-sync.ts:102`, `hooks/workspace/use-agent-session-status-invalidation.ts:23`, `hooks/workbench-shell/route-layout/use-pull-request-auto-refresh.ts:118`, `hooks/workbench-shell/timeline/use-timeline-events.ts:56` (sibling's) | `agentConversationLiveStateAtom` replaced wholesale (`state/agents/atoms.ts:118`) | `useAgentsPanelState` is called unconditionally in `workspace-content.tsx:116` | **no** — new top-level object every event, no equality gate | **[WB-03]** |
| `terminalOutput` | `state/workspace/terminal-activity-watch.ts:290`; **one listener per mounted `XtermTerminal`** (`dock-panel/xterm-terminal.tsx:109`) | activity set (identity-preserving); xterm `write()` | N listeners, each filtering by `terminalId` in JS | activity write returns `previous` when unchanged | sound; O(N) dispatch noted in **[WB-06]** |
| `terminalLifecycle` | `terminal-sessions.ts:173`, `terminal-activity-watch.ts:281`, `terminal-tab-live-titles.ts:84`, `use-workspace-agent-busy.ts:58` | per-session snapshot reducers | 4 listeners, session-scoped | reducers fold per session | sound |
| `workspaceFilesChanged` | `hooks/workbench-shell/route-layout/use-workspace-files-watch.ts:103` | invalidates `workspaceFiles`, `settingsResolution`; directory leg throttled to 5 s | the files tree (virtualized, memoized rows) | TanStack structural sharing | sound — main clamps to ~1 broadcast/s; the throttle is documented at lines 16-32 |
| `architectureSnapshotChanged` | `conversation-panel/architecture-diagram/architecture-diagram-panel.tsx:46` | invalidates the snapshot query → new `ir` identity → **full layout recompile** | the diagram panel | `useMemo([ir])` only | **[WB-02]** |
| `appSettingsChanged` | `state/preferences/app-settings.ts:288` | app-settings atom | theme/appearance/language effects | replaces wholesale, but low frequency | sound |
| `configChanged` | `hooks/use-config-reload-sync.ts:19` | invalidates `settings-resolution` | settings surfaces | — | sound |
| `updateStatusChanged` | `api/ensemblr/updates.ts:14` | update atom | update badge | low frequency | sound |
| `piRawFrame` | `state/pi/pi-raw-frames.ts:108` | ring buffer | debug route only | — | sound |
| `agentControlTabsChanged` | `state/workspace/chat-tab-open-mutations.ts:64`, `hooks/workspace/use-clear-unread-on-agent-tab-close.ts:22` | tab list | tab strip | — | sound |
| `agentControlBoardStatus` | `state/workspace/board-status-sync.ts:27` | `workspaceBoardStatusAtom` (localStorage) | dashboard board | — | sound |
| `agentControlReviewCommentsChanged` | `state/workspace/review-comments-sync.ts:18` | comment query | checks panel | — | sound |
| `chatTurnFinished` | `hooks/workspace/use-auto-mark-unread.ts:84` | unread set | sidebar badges | — | sound |
| Git/PR status | no broadcast — polled: nav tree 15 s (`api/ensemblr/navigation.ts:82`), git status 10 s, workspace files 30 s, branches 15 s, merge conflicts 120 s, PR snapshot adaptive | | | **yes** — `structuralSharing` is on (never disabled anywhere in `src/renderer`), so an unchanged poll preserves identity and re-renders nothing | sound |

## Findings

### [WB-01] The whole `logos` and `vscode-icons` Iconify collections ship and parse at boot for 65 icons

- Impact: **High**
- Confidence: **Confirmed** (built and measured)
- Where: `src/renderer/main.tsx:31` → `src/renderer/lib/workbench/icon-collections.ts:18-20`

```ts
export function registerIconCollections(): void {
	addCollection(vscodeIcons);
	addCollection(logosIcons);
```

**Mechanism.** `addCollection` needs the collection object, so both JSON files become JS object
literals inside the entry graph. `node_modules/@iconify-json/logos/icons.json` is 7,487,001 bytes and
`@iconify-json/vscode-icons/icons.json` is 3,752,257 bytes — 11.24 MB. Sampling the entry chunk at
600 KB intervals shows raw `<path d="…">` data from ~585 KB through 7,616 KB; the remaining ~0.5 MB
is react-dom and the app bootstrap. The vscode set lands in its own preloaded chunk.

**Evidence.** Critical path 13.13 MB raw / 4.32 MB gz across 144 files, of which
`index-DptqpIeX.js` (7,597 K) + `icons-CNCLvGNA.js` (3,703 K) are 86%. Parse cost measured under
Node 24 (same V8 major as Electron 44) by importing each file as an `export default {…}` literal, the
shape Rolldown emits: **logos 176.9 ms, vscode-icons 77.0 ms — 254 ms total**, before React's first
render, plus ~11 MB read from disk and a retained heap of the same order. Against a stated budget of
"well under a second to first interactive frame", this is a quarter of it.

The referenced set is closed and statically enumerable. `src/renderer/lib/workbench/file-icons.ts`
maps names by filename and extension through three literal `Record<string, string>` tables, and
`logos:` appears in `src/` exactly three times (`claude-icon`, `mistral-ai-icon`, `openai-icon`).
Resolving all 62 vscode names plus the 3 logos names against the collections: **all 65 resolve, and
they total 78.7 KB of icon data** — 0.7% of what ships.

**Fix.** Generate a trimmed collection at build time. A script under `scripts/` that reads the two
`icons.json` files, picks the names `file-icons.ts` and the three `logos:` call sites declare, and
writes a committed `src/renderer/lib/workbench/icon-subset.generated.ts`; `registerIconCollections`
then calls `addCollection` on that. Keep the guard the JSDoc already names — an unregistered prefix
makes Iconify hit `api.iconify.design`, which in a desktop app is a blank glyph — by having the
generator fail when a referenced name is absent, so a new icon is a red build rather than a silent
network call. Expected: entry chunk 7.6 MB → ~0.5 MB, `icons` chunk gone, critical path
13.13 MB → ~1.9 MB raw, and ~254 ms returned to startup.

### [WB-02] Organic architecture-diagram layout is super-quadratic — 3.9 s of blocked main thread at 100 nodes

- Impact: **High**
- Confidence: **Confirmed** (measured + CPU-profiled)
- Where: `src/renderer/lib/architecture-diagram/route-ladder.ts:131-155`, called from
  `compileOrganic` (`compile.ts:453`), invoked synchronously during render at
  `components/workbench-shell/conversation-panel/architecture-diagram/architecture-diagram-panel.tsx:217`

```ts
function routeClearsComponents(connection, points, nodes): boolean {
	const endpointIds = new Set([connection.from, connection.to]);
	return nodes.every((node) => {
		if (endpointIds.has(node.id) || !Number.isFinite(node.x)) return true;
		for (let index = 0; index < points.length - 1; index += 1) {
			if (segmentIntersectsRect(points[index], points[index + 1], node, 2)) return false;
		}
		return true;
	});
}
```

**Mechanism.** Every candidate route for every connection is tested against **every** node with no
spatial index and no AABB pre-reject. `segmentIntersectsRect` (`routing.ts:718`) does four
`segmentsIntersect` tests, each four `orientation` calls, so the total is
`edges × candidates × nodes × segments × 16` cross products. `route-ladder.ts` calls
`routeClearsComponents` from four sites (lines 199, 351, 363, 437), one of them inside the
`corridorCandidates` generator loop.

**Evidence.** Benchmarked `compileArchitectureLayout` on synthetic documents via
`npx tsx --tsconfig tsconfig.json`:

| nodes / edges | grid | organic |
| --- | ---: | ---: |
| 10 / 15 | 0.5 ms | 9.7 ms |
| 25 / 40 | 0.1 ms | 93.6 ms |
| 50 / 100 | 0.1 ms | 750.6 ms |
| 100 / 200 | 0.1 ms | **4,045.6 ms** |

Roughly ×8 per doubling of nodes — cubic. `--cpu-prof` over the 50n and 100n organic runs attributes
**96% of self time to `architecture-diagram/routing.ts`**: `orientation` 476 ms (10.1%),
`segmentIntersectsRect` 409 ms (8.7%), `segmentsIntersect` 150 ms (3.2%), with the bulk under an
esbuild name-wrapper frame in the same file; `route-ladder.ts` adds 110 ms. Output is real work, not
an early bail — the 100n run returned `nodes=100 edges=200 problems=0`. It runs inside a `useMemo`
during render, so the frame is blocked, and `architectureSnapshotChanged` re-keys `ir` every time an
agent writes the diagram (`architecture-diagram-panel.tsx:46`).

Fallow independently flags `refineForLenses` at `architecture-diagram/organic.ts:424` (cognitive 23,
CRAP 56) as the file's worst function.

**Fix.** Two changes, either of which is worth more than a rewrite. (1) Put a uniform-grid bucket
index over the placed nodes once per compile and query only the buckets a segment's AABB touches —
`routeClearsComponents` then tests ~4 nodes instead of 100. (2) Add a cheap AABB overlap reject at
the top of `segmentIntersectsRect` before any cross product. Together these should be 10–50×. If
that is still not enough for the documents users actually draw, cap the candidate count per
connection, or move the compile off the render path into a `useDeferredValue` so the panel paints
its previous layout while the next one computes.

### [WB-03] Every agent session event re-renders the whole workspace subtree

- Impact: **High**
- Confidence: **Likely** (mechanism confirmed statically; not instrumented at runtime)
- Where: `src/renderer/state/agents/atoms.ts:118`, subscribed from
  `src/renderer/components/workbench-shell/workspace-content.tsx:116`

```ts
		set(agentConversationLiveStateAtom, {
			...current,
			[input.workspaceId]: { ...workspace, [input.sessionId]: { ...previous, … } },
		});
```

**Mechanism.** `applyAgentConversationEventAtom` writes a fresh top-level object on every applied
event with no "did anything observable change" gate. `useAgentsPanelState` reads the whole
cross-workspace map (`use-agents-panel-state.ts:52`) and is called **unconditionally** in
`WorkspaceWorkbenchContent` — not inside the Agents tab, which is a plain `TabsContent` that unmounts
when inactive (`review-panel.tsx:186`). So each event re-renders the 296-line component that is the
root of the workspace UI, re-runs `toAgentConversations` over every session
(`use-agents-panel-state.ts:129-165`), and returns a fresh props object that flows down through
`panel-layout` → `review-panel` → `AgentsPanel`.

Nothing below stops it: the renderer uses manual memoization (`@vitejs/plugin-react` with no compiler
plugin in `vite.renderer.config.mts:17`) and there are **8 `memo(` calls against 413 exported
components — a 1.9% memo ratio**. The five in `workbench-shell` are the diagram node/edge, the two
file rows, and the timeline message; `WorkspaceWorkbenchContent`'s own children are not among them.
Fallow lists `WorkspaceWorkbenchContent` at 296 lines, the fifth-largest renderer function.

**Evidence.** Event rate is tool starts/ends, status transitions and context-usage updates
(`src/main/main.ts:924` broadcasts every persisted session event to every window; token deltas go
through the separate `piRawFrame` channel), so a busy turn with parallel tool calls is plausibly
5–50 events/s, each triggering a full subtree render on the same thread as the streaming timeline the
sibling audit owns.

**Fix.** Two independent steps. (1) Gate the write: compare the computed `activity`, `status`,
`contextUsage` and `lastEventOrdinal` against `previous` and return without `set` when only the
ordinal moved — `reduceAgentActivity` can return `previous.activity` unchanged for events that do not
move it. (2) Narrow the subscription: derive a per-workspace atom
(`selectAtom(agentConversationLiveStateAtom, m => m[workspaceId])`) so a write for another workspace
never reaches this hook, and move `useAgentsPanelState` inside the component that renders the Agents
tab, or wrap `AgentsPanel` in `memo` with a stable props object. A `memo` on the handful of panel-root
components in `panel-layout.tsx` is cheap insurance regardless.

### [WB-04] All three locale catalogues are eager — 548 KB of the 714 KB is never used

- Impact: **Medium**
- Confidence: **Confirmed** (built)
- Where: `src/renderer/lib/i18n/resources.ts:3-26` (24 static JSON imports),
  `src/renderer/lib/i18n/instance.ts:42`

**Mechanism.** All eight namespaces × three languages are statically imported so `init` can run
synchronously. The resulting `ensemblr-BtbquKVs.js` is **1,028 K raw / 272 K gz** and sits in the
initial modulepreload list; it contains 81,464 Cyrillic and 85,829 Greek characters. On disk the
catalogues are en 166,754 B, ru 271,108 B, el 276,503 B — **714 KB, of which ~548 KB is for the two
languages this launch is not rendering**.

**Evidence.** The JSDoc at `resources.ts:49-55` gives the two real constraints: the packaged renderer
loads from `file://`, where an HTTP backend cannot resolve relative URLs, and two `lib/workbench/`
modules call `t()` at module scope, which needs `init` to have completed synchronously. Both are
genuine. But the language is already known synchronously — `instance.ts:22-29` reads it off
`window.ensemblrInitialShellSnapshot` before anything renders — so the constraint is only that the
*chosen* catalogue be present synchronously, not all three.

**Fix.** Keep `resources` as the synchronous seed for the resolved language only, and add the other
two through `i18n.addResourceBundle` after a dynamic `import()` resolves (the language switcher
already has to await something when the user changes language). Vite emits one chunk per locale from
`import.meta.glob('./locales/*/*.json')` with `eager: false`. Saves ~548 KB raw / ~145 KB gz off the
critical path. If the synchronous-seed-per-language shape proves awkward, the cheaper half-measure is
to split the eight namespaces so only `common` and `workbench` are eager.

### [WB-05] 9.66 MB of uncompressed TrueType ships for the terminal font

- Impact: **Medium**
- Confidence: **Confirmed** (built)
- Where: `src/renderer/styles/index.css:18-49`, four `@font-face` rules over
  `src/renderer/styles/fonts/JetBrainsMonoNerdFontMono-{Regular,Italic,Bold,BoldItalic}.ttf`

**Mechanism.** Four Nerd Font faces at ~2.47 MB each ship as raw `.ttf`. There is no network cost —
they load from `file://` — but they are 9.66 MB of the packaged `.dmg`/`.AppImage`, and
`createXtermAdapter` deliberately calls `document.fonts.load` for **all four** faces on terminal
attach (documented at length in `.claude/rules/stack.md`), so every face is decoded before the first
terminal fit resolves.

**Evidence.** Build output: 2,470.11 / 2,472.23 / 2,473.88 / 2,475.14 kB. `font-display: swap` is
already set, so this is a package-size and decode cost, not a FOIT.

**Fix.** Convert to WOFF2 (typically 60–75% smaller for a Nerd Font — ~2.5–3.5 MB for all four) and
keep the `.ttf` only if some path needs it. Chromium decodes WOFF2 natively. Subsetting is the bigger
win but the wrong trade here: the Nerd Font glyph range is exactly what a terminal needs.

### [WB-06] Terminal dock force-mounts every tab, so each hidden terminal holds a live WebGL context

- Impact: **Medium**
- Confidence: **Likely** (mechanism confirmed; the 16-context ceiling not reproduced)
- Where: `src/renderer/components/workbench-shell/dock-panel/dock-panel.tsx:168-211`,
  `src/renderer/lib/terminal/xterm-adapter.ts:239-246`

```tsx
			{terminalTabs.map((tab) => (
				<TabsContent className='… data-[state=inactive]:hidden' forceMount key={tab.id} value={tab.id}>
					<XtermTerminal … />
```

**Mechanism.** Setup, Run and every terminal tab are `forceMount`ed — correct for scrollback and PTY
binding, and the comment at lines 163-167 says so. But `createXtermAdapter` loads `WebglAddon`
unconditionally in `attach`, so N tabs means N live WebGL contexts. Chromium caps a page at ~16
before evicting the oldest; with Setup and Run always mounted, the ceiling is ~14 terminals in one
workspace.

**Evidence.** The eviction is handled, not fatal: `xterm-adapter.ts:242` registers
`addon.onContextLoss(() => addon.dispose())`, which drops that surface to the DOM renderer. The cost
is silent degradation to exactly the slow path `.claude/rules/stack.md` argues against ("a span per
cell, relayout per frame on the renderer's main thread"), plus GPU memory for contexts drawing
nothing. Separately, each mounted `XtermTerminal` registers its own `onTerminalOutput` listener
(`xterm-terminal.tsx:109`) and filters by id in JS, so a chatty PTY dispatches through N listeners —
cheap per call, but it scales with the same N.

**Fix.** Load the WebGL addon lazily on the tab becoming visible and dispose it (not the terminal)
when it is hidden past a small grace period — the DOM renderer draws a hidden `display: none` pane
correctly and costs nothing while it is not painting. That keeps scrollback and the PTY binding
intact, which is what `forceMount` is there for, and keeps the context budget for the tabs the user
can see. A per-terminal id→listener map in one shared `onTerminalOutput` subscription removes the
O(N) dispatch at the same time.

### [WB-07] `debug.pi-replay` ships 2.06 MB into the production build

- Impact: **Low**
- Confidence: **Confirmed** (built)
- Where: `src/renderer/routing/routes/debug.pi-replay.tsx`, backed by
  `src/renderer/components/pi-replay/` and `src/renderer/lib/pi-replay/`

**Mechanism.** The route is code-split, so it costs nothing at startup, but it is reachable in a
shipped build and drags 2,107.92 kB (mostly Shiki) into the package.

**Evidence.** `debug.pi-replay-CFytzDl9.js` 2,059 K raw / 170 K gz, not in the modulepreload list.

**Fix.** If it is a maintainer tool, gate the route registration on `import.meta.env.DEV` — the
constant is compile-time, so the route file and its subtree drop out of the production graph
entirely, the same way `main.tsx:29` already handles the dev tint. If it is meant to be shippable,
leave it; the cost is package size only.

### [WB-08] Five `atomFamily` instances have no `remove` path

- Impact: **Low**
- Confidence: **Confirmed** (static)
- Where: `state/preferences/atoms.ts:393` (`repoSettingsOverrideAtomFamily`), `:411`
  (`prDetailsDraftAtomFamily`), `:436` (`prDetailsLiveDraftAtomFamily`),
  `state/composer/optimistic-prompts.ts:28`, `state/composer/primed-action.ts:26`

**Mechanism.** `jotai-family` families grow forever unless `.remove(key)` is called. Chat-tab and
last-run-script families are cleaned up properly (`composer-drafts.ts:57-60`,
`preferences/atoms.ts:139-144`, `:198`, `follow-up-queue.ts:315-316`) and the JSDoc at
`preferences/atoms.ts:134` shows the pattern is understood; these five were missed.

**Evidence.** The leak is bounded by distinct repo ids and workspace ids seen in one process
lifetime, and each atom holds a small object — a few KB over a long session, plus the
`atomWithStorage`-backed ones leaving `ensemblr:repo_override_<id>` / PR-draft keys in localStorage
after the workspace is gone.

**Fix.** Extend the existing workspace-teardown path (`preferences/atoms.ts:198`'s sibling) to call
`prDetailsDraftAtomFamily.remove` / `prDetailsLiveDraftAtomFamily.remove` and delete the matching
storage keys; add `repoSettingsOverrideAtomFamily.remove` where a repository is removed.

## Verified sound

- **Query polling and structural sharing.** `structuralSharing` is never disabled in
  `src/renderer`, so the 15 s nav-tree poll (`api/ensemblr/navigation.ts:82`), 10 s git status,
  30 s file list, 15 s branches, 120 s merge conflicts and the adaptive PR snapshot
  (`api/ensemblr/github.ts:50`) re-render nothing when the data is unchanged.
  `refetchOnWindowFocus: false` globally (`api/query-client.ts:12`), with one deliberate opt-in at
  `api/ensemblr/settings.ts:46`.
- **Boot cache seeding.** `api/query-client.ts:25-47` hydrates navigation/health/open-targets from
  the preload snapshot, so the first render does not wait on IPC + SQLite; the models-cache
  subscription at `:62` filters on a precomputed `queryHash` rather than serialising per event.
- **File tree.** `buildFileTree` / `listDirectoryPaths` / `flattenFileTree` are all memoized
  (`use-workspace-file-tree.ts:250-271`), rows are virtualized with overscan 12, and both row
  components are `memo`ed (`all-files-list.tsx:160`, `:245`). `localeCompare` in the sort
  (`lib/workbench/file-tree.ts:67-68`) measured **1.97 ms for 5,000 entries** — V8 caches the default
  collator and it beat `new Intl.Collator` — against a `MAX_ENTRIES` of 5,000
  (`src/main/workspace-files/list-workspace-files.ts:93`). Not a cost.
- **Workspace file watch throttling.** `use-workspace-files-watch.ts:33-63` rate-limits the
  per-expanded-folder directory refetch to 5 s with a trailing call, and documents exactly why the
  other two legs are unthrottled.
- **Terminal activity fan-out.** `terminal-activity-watch.ts:105-110` returns `previous` unchanged
  when the id is already active, so a chatty PTY does not re-render the sidebar per chunk.
- **Turn timer.** `useElapsedMs` ticks at 100 ms (`hooks/use-elapsed-ms.ts:14`) and
  `formatTurnDuration` renders tenths (`lib/format-duration.ts:18-31`), so every tick changes the
  label — the cadence is earned, and only one indicator is mounted per timeline.
- **Global keydown listeners.** Exactly two registration sites (`hooks/use-hotkey.ts:50`,
  `hooks/workbench-shell/use-open-target-shortcuts.ts:97`); 23 `useHotkey` call sites, all in
  singleton surfaces, none inside a list row.
- **Settings writes.** `useDebouncedSettingField` debounces 500 ms with an echo-suppressing re-seed
  (`hooks/use-debounced-setting-field.ts:27-52`). No settings path writes per keystroke.
- **Resize persistence.** The concierge resize writes node styles directly during pointer-move and
  commits only on end (`hooks/concierge/use-concierge-resize.ts:262-275`); the right sidebar
  schedules a debounced commit with a `pagehide` flush
  (`hooks/workbench-shell/use-right-sidebar-controller.ts:241-253`). No synchronous localStorage
  write per frame.
- **`atomWithStorage` shapes.** 18 modules, all scalars or short id arrays — largest serialized shape
  is a `BoardFilters` object. Per-write cost is negligible.
- **Dashboard board DnD.** `use-card-dnd.ts` registers one `draggable` + one `dropTargetForElements`
  per card in a single effect, pragmatic-dnd's intended shape; `onDrag` writes a string that React
  bails on when unchanged.
- **Notification sound.** `lib/notification-sound/player.ts:24` constructs the `Audio` element
  lazily on first play; nothing decodes at boot.
- **Command palette.** A small static command list inside a `CommandDialog` that mounts only when
  open (`command-palette/command-palette.tsx:216`). No thousands-of-items filtering.
- **Static quality.** fallow reports **0 circular dependencies, 0 re-export cycles, 0 boundary
  violations, 0 unresolved/unlisted imports** across 2,629 files, and **0.05% duplication**
  (2 clone groups, 152 lines total — a shared agent-session interface shape and two confirm dialogs;
  neither is a perf risk). Of 15 complexity findings above threshold, 4 are in `src/renderer`, and
  only one (`architecture-diagram/organic.ts:424 refineForLenses`) sits on a hot path — it is part of
  [WB-02]. `settings/repo-infisical/infisical-link-form.ts:117` (cc 39) and
  `state/pi/pi-raw-frames.ts:33` (cc 17) are maintainability, not performance.

## Coverage

Covered: the Vite production build and full chunk table; all 27 preload broadcast subscriptions
traced to their renderer handlers; `main.tsx`, `app.tsx`, `routeTree.gen.ts` and the `_workbench`
layout route; `use-app-root-syncs` and everything it mounts; the query client and every
`refetchInterval` / `staleTime`; all 18 `atomWithStorage` modules and all 16 `atomFamily`
declarations; the dock panel and xterm adapter; the files, agents and checks panels; the dashboard
board and its DnD; settings debouncing; the command palette; `lib/architecture-diagram` (benchmarked
and CPU-profiled); `lib/i18n`; `lib/notification-sound`; `lib/workbench/file-tree` (benchmarked);
global listener and memo-discipline counts; fallow health, duplication and cycle passes.

Not covered: the conversation panel's message list, timeline rendering and the streaming re-render
question — owned by `14-renderer-conversation-rendering.md`, and the `agentSessionEvent` interaction
between [WB-03] and that path is worth a joint read. Also not covered: runtime React Profiler traces
(would need the app running, which this audit is not permitted to do), and main-process cost of the
broadcasts themselves.

## Open questions

- **Grid-mode diagrams drop every connection.** `compileArchitectureLayout` on a 100-node grid
  document returned `edges=0` while the same document in organic mode returned `edges=200`
  (`compile.ts:253`). That is plausibly correct — grid mode may require explicit lane/track
  placement the synthetic document omits — but it is worth confirming against a real stored diagram,
  because "fast because it did nothing" would change how [WB-02] should be fixed.
- **Route security.** No route in `src/renderer/routing/routes/` has a `beforeLoad` guard; the only
  gated surface is `onboarding`. In a single-user desktop app with no auth that is the right shape,
  but `/debug/pi-replay` is reachable in production (see [WB-07]) and renders whatever session
  transcript it is pointed at.
- **Is the `logos` collection needed at all?** Three brand icons (`claude-icon`, `mistral-ai-icon`,
  `openai-icon`, 4.76 KB combined) justify a 7.14 MB dependency. Inlining them as three SVG strings
  would let `@iconify-json/logos` leave `package.json` entirely, which is simpler than trimming it.
