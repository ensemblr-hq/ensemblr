# Main-Process Boot, Event Loop, and Steady-State Work

The main process is disciplined where the codebase has already been burned — the
Linux watch emulation, the disk sweep, the window-state debounce and the update
schedule all carry explicit rationale and are correct. The damage is concentrated
in three places instead. Boot fires an **unbounded `Promise.all` of `git` child
processes** across every registered repository (measured: 48 concurrent spawns,
**269–288 ms**, for the 16 repos on this machine) concurrently with window
creation. Steady state fans **one full branch-scope `git status` per workspace,
all at once, every 30 s** with no in-flight dedupe and no concurrency cap
(measured: 60 spawns, **666 ms** at 15 workspaces). And every single
`localCommandService.run` result pays a **synchronous redaction pass over its
whole stdout** plus a full env clone — 2.85 ms for a 292 KB `git ls-files`,
41 ms at the 8 MB cap — for a `logs` payload that only the setup checks and the
Pi readiness probe ever read.

Everything else is waste rather than stall: a 10 MB `writeFileSync` per second
per active dock terminal, a debug-only Pi frame broadcast that runs with no
subscriber, and an uncached settings read that re-parses `config.json` 35 places
over.

## Boot sequence

Module scope (`src/main/main.ts:240`–`1760`) is held construction-only by
contract (`main.ts:316`) so the instance that loses the single-instance lock
never touches shared `userData`. Spot-checked and honoured: the service graph
does no fs or process work at construction beyond
`resolvePiControlExtensionPath`'s one or two `existsSync` calls
(`agent-control/main-integration.ts:141`).

| # | Step | file:line | Sync? | Critical path | Cost |
| --- | --- | --- | --- | --- | --- |
| 1 | Single-instance lock | `main.ts:308` | sync | yes | µs |
| 2 | `resolveUserDataDirectory` | `main.ts:287` | sync | yes | µs |
| 3 | `allowPlainTextSecretFallback` | `main.ts:1770` | sync | yes | µs (Linux only) |
| 4 | `configService.load()` | `main.ts:1772` | sync | yes | one `readFileSync` + TOML/JSON parse, cached thereafter |
| 5 | `databaseService.open()` | `main.ts:1773` | sync | yes | migrations — see `11-storage-and-persistence.md` |
| 6 | `rootDirectoryService.ensure()` | `main.ts:1775` | sync | yes | ~20 dir-level `existsSync`/`statSync`/`accessSync`/`readdirSync` (`root/root-inspect.ts:92`–`305`); sub-ms, cached in the service |
| 7 | `ensureConciergeHome` | `main.ts:1775` | sync | yes | 3 `mkdirSync` + 1 `existsSync` |
| 8 | `conciergeMemoryService.reconcile()` | `main.ts:1776` | **sync** | yes | **0.72 ms measured** for 24 memory files (read+stat+hash), plus one SQLite write per changed file. Linear in catalogue size |
| 9 | `sharedRootAdoptionService.reconcile()` | `main.ts:1777` | async, `void`-ed | **contends** | **269–288 ms / 48 concurrent `git` spawns measured (16 repos)**, + 6 spawns × workspace. See **MP-01** |
| 10 | `reclaimSweptWorkspaceDisk()` | `main.ts:1778` | async, `void`-ed | contends | deliberately **sequential** (`repository/sweep-workspace-disk.ts:104`) — correct |
| 11 | `rebuildMenu()` | `main.ts:1795` | sync | yes | one `appSettingsService.read()` (42 µs) + template build + `Menu.setApplicationMenu` |
| 12 | `appSettingsService.startWatching` / `configService.startWatching` | `main.ts:1808`, `1817` | sync | yes | two non-recursive dir watches |
| 13 | `registerIpcHandlers(...)` | `main.ts:1841` | sync | yes | ~50 `ipcMain.handle` registrations; **also fires `prStatusSweeper.start()`** → first full PR sweep, every workspace due (`ipc/handlers.ts:402`). See **MP-13** |
| 14 | `terminalService.recoverStaleSessions()` | `main.ts:1904` | sync | yes | SQLite only — no scrollback file reads. Correct |
| 15 | `updateService.start()` | `main.ts:1909` | sync | yes | arms a 2-min delayed first check (`updates/update-service.ts:14`) |
| 16 | `openMainWindow()` | `main.ts:1910` | sync | yes | `BrowserWindow` construction; `ready-to-show` follows |

**First workspace usable** then depends on renderer queries: setup diagnostics
(~10 child processes across 16 checks, `setup/setup-diagnostics.ts:179`),
`listWorkspaceFiles` (4 `git ls-files` + the ignored walk, **39–53 ms + 14.5 ms**
measured), and the navigation-wide git-status fan-out (**MP-02**).

Steps 9 and 13 are the two that scale with repository/workspace count and both
run while the window is being constructed.

## Steady-state work

| Trigger | What runs | Cost/run | Scales with | Coalescing | Verdict |
| --- | --- | --- | --- | --- | --- |
| `setInterval` 30 s (`github/workspace-pr-sweeper.ts:197`) | refresh PR snapshot per due workspace, `gh` spawns | several `gh` per workspace | workspaces (30 s pending / 120 s idle) | `running` re-entry guard, **sequential** `reduce` | sound — except the first tick (**MP-13**) |
| `setInterval` 4 h (`updates/update-service.ts:357`) | update check | one HTTPS request | — | 2-min initial delay | sound |
| `setInterval` 60 s (`agent-runtime/agent-activity-monitor.ts:285`) | `pmset -g batt` | one spawn | — | **armed only while a session streams** | sound |
| `setInterval` 1.5 s per agent terminal (`terminal/terminal-service.ts:908`) | read harness session log: `readdir` + `stat` every candidate `.jsonl` + head scan | ~40 async `stat` + 1 file head | agent terminals × transcripts in dir | none | **MP-12** |
| `setInterval` 500 ms per dock terminal (`terminal/terminal-service.ts:951`) | `pty.process` → `tcgetpgrp` + `sysctl KERN_PROC_PID` (`node_modules/node-pty/src/unix/pty.cc:661`) | <100 µs | terminals | broadcast only on change | sound |
| `setInterval` 20 s per in-flight MCP op (`agent-control/mcp-progress.ts:62`) | one progress notification | µs | concurrent ops | cleared in `finally` | sound |
| `setTimeout` 1 s debounce per restorable terminal (`terminal/terminal-service.ts:743`) | `scrollback.read()` + **`writeFileSync`** of the whole buffer | **~8 ms at the 10 MB default, ~280 ms at the 200 MB max** | active dock terminals | 1 s leading-armed debounce | **MP-04** |
| node-pty `onData` (`terminal/terminal-service.ts:1334`) | ring append + `webContents.send` + 3 scanners | 4.6–32 µs append + one IPC | PTY chunk rate × terminals | **none on the IPC** | **MP-08**, **MP-10** |
| Pi RPC line, both directions (`pi-agent/pi-cli-rpc-adapter.ts:346`) | `sampleRawFrame` + `webContents.send(piRawFrame)` | ~1.2 µs clone + cross-process write | RPC frames per turn | none; **no gate on subscribers** | **MP-05** |
| Agent session event (`main.ts:924`) | `webContents.send(agentSessionEvent)` + activity monitor | — | stream events | — | owned by `13-agent-runtime-pipeline.md` |
| `fs.watch` recursive per workspace (`workspace-files/watch-workspace-files.ts:240`) | debounced `workspaceFilesChanged` broadcast (payload: one cwd) | µs | watched workspaces | **250 ms debounce + 1 s max-wait** | sound; but see **MP-09** |
| `workspaceFilesChanged` → renderer refetch | 4 `git ls-files` + ignored-root walk + symlink probes | **39–53 ms + 14.5 ms measured** | tracked files + ignored tree | renderer `staleTime: 5_000` | **MP-11** |
| Renderer poll 10 s, Changes view (`renderer/api/ensemblr/workspace-git.ts:16`) | `getStatus` for the open workspace | ~121 ms measured | — | query dedupe within a window | acceptable |
| Renderer poll 30 s, navigation (`renderer/hooks/workbench-shell/route-layout/use-workbench-queries.ts:111`) | `getStatus` **per workspace, concurrently** | **666 ms / 60 spawns at 15 workspaces** | workspaces | **none in main** | **MP-02** |
| `config.json` / `.ensemblr` watch (`config/watch-config-file.ts:24`) | reload + broadcast | one read + parse | — | dir watch, filename filter, debounce, echo suppression | sound |
| Every `localCommandService.run` settle (`commands/spawn-command.ts:126`) | redact stdout + stderr, clone+redact whole env | **2.85 ms at 292 KB, 41 ms at the 8 MB cap** | every command the app runs | none | **MP-03** |
| Menu context report (`ipc/handlers/menu.ts:45`) | rebuild + `Menu.setApplicationMenu` | template build | context changes only | **real deep equality** (`shared/menu-commands.ts:201`) | sound |
| Window `move`/`resize` (`app/window-state.ts:142`) | persist geometry to SQLite | one write | — | **500 ms trailing debounce** | sound |

## Findings

### [MP-01] Shared-root adoption fires an unbounded `git` spawn fan-out during window creation

- Impact: **High** · Confidence: **Confirmed (measured)**
- Where: `src/main/main.ts:1777`;
  `src/main/repository/adopt-shared-root/repository-adoption.ts:72`;
  `src/main/repository/adopt-shared-root/workspace-adoption.ts:95`

```ts
// repository-adoption.ts:72 — no queue, no semaphore
const probes = await Promise.all(
    candidates.map(async (candidate) => ({ ..., probe: await gitProbe(candidatePath) })),
);
```

- Mechanism: `void sharedRootAdoptionService.reconcile()` runs three lines
  before `openMainWindow()`. `reconcileRepositories` maps every repository
  candidate through `probeGitRepository` inside one `Promise.all`; each probe is
  3 `git` spawns (`rev-parse --show-toplevel`, default branch, remote URL —
  `repository/git-probe.ts:71`, `:96`). `reconcileWorkspaces` is sequential
  across repositories but fans every workspace of one repository concurrently,
  ~6 spawns each (`git-probe.ts:139`, `:174`). Every spawn also costs main-thread
  work: `spawn` setup, pipe wiring, stdout buffering, promise settle.
- Evidence: measured against the real root (`~/Ensemblr/repos`, 16
  repositories): **48 concurrent `git` spawns, 288 ms then 269 ms warm**. One
  worktree probe: **74 ms, 6 spawns** — so 5–15 workspaces adds another 30–90.
  All of it lands in the same window as `BrowserWindow` construction and the
  renderer's first paint.
- Fix: bound the concurrency — a `mapWithConcurrency(candidates, 4, probe)`
  around both `Promise.all` sites is the whole change. The rationale is already
  written down one module over
  (`sweep-workspace-disk.ts:104`: "running them together only contends for the
  same disk while the app is still opening its window"). Better still, defer the
  whole reconcile behind `window.once('ready-to-show')` — nothing about painting
  the workbench depends on it, and the renderer's navigation query is what
  surfaces the result.

### [MP-02] Navigation git-status fan-out: one full branch-scope status per workspace, concurrently, every 30 s, with no dedupe

- Impact: **High** · Confidence: **Confirmed (measured)**
- Where: `src/renderer/hooks/workbench-shell/route-layout/use-workbench-queries.ts:106`,
  served by `src/main/workspace-git/workspace-git-status.ts:166`

- Mechanism: `getNavigationWorkspaceChangeSummaryTargets`
  (`src/renderer/lib/workbench/workspace-change-summaries.ts:38`) emits one
  target per workspace across every repository in navigation. Each resolves to
  `getBranchStatus` → `merge-base` + `diff --name-status` + `diff --numstat` +
  `status --porcelain -z --untracked-files=all`, then a `stat` per row and an
  `open`+`read` per untracked file — ~4 `git` spawns per workspace, fired by
  `useQueries` with no stagger. The main-process service has **no in-flight
  dedupe and no concurrency limit**, so a Changes view plus the dashboard, or a
  second window, multiplies it rather than sharing it.
- Evidence: measured on this repo — one branch-scope status is **116–124 ms**;
  15 concurrently is **666 ms of sustained churn across 60 `git` processes**,
  every 30 s. Each result additionally pays **MP-03** (4× per workspace).
- Fix: two guards in `createWorkspaceGitService` — (1) an in-flight map keyed by
  `cwd + scope` so concurrent identical requests share one promise (the existing
  `contentId` stamp already makes a shared answer safe); (2) a semaphore of ~4
  around `runGit`. Staggering `refetchInterval` per index would smooth the burst
  but not the multi-consumer case, which is why the limiter belongs in main.

### [MP-03] Every command result synchronously redacts its whole stdout and clones its whole environment, for a payload almost nobody reads

- Impact: **High** · Confidence: **Confirmed (measured)**
- Where: `src/main/commands/spawn-command.ts:126`;
  `src/main/commands/command-redaction.ts:22`, `:80`

- Mechanism: `runSpawnedCommand` builds `logs` unconditionally on every settle.
  `redact` runs `String.split().join()` over the entire stdout once **per**
  sensitive env value — each allocating a fresh copy — then a global regex
  replace, then the same for stderr, then `sanitizeEnvironment` clones and
  redacts every env var. All synchronous, on the main thread, inside the promise
  settle; the result then retains a second full copy of the output. `logs` is
  consumed in exactly two places: `src/main/setup/setup-check-context.ts:197`
  (and siblings) and `src/main/agent-providers/pi-readiness-probe.ts:207`. Every
  other caller — `git ls-files`, `git status`, `git diff`, `gh`, `du`, every
  probe — pays for it and discards it.
- Evidence: measured with a realistic 69-key environment carrying 7
  secret-shaped values, against a 292 KB `git ls-files --stage` stdout (this
  repo, 3,018 tracked files): **2.85 ms per result** (2.52 ms with no secrets
  present); **5.05 ms at 1 MB**; **41.2 ms at the service's 8 MB
  `MAX_OUTPUT_BYTES`** — one dropped frame from a single `git status`. Crossed
  with **MP-02**, a 15-workspace dashboard tick pays ~60 of these passes.
- Fix: make `logs` lazy — keep the raw strings on the result and expose `logs` as
  a getter that calls `createSanitizedLogs` on first access. The two consumers
  read it immediately; nobody else ever triggers it. `redact` should also
  early-return when `values` is empty, so the common case is one regex scan
  rather than N string copies. Coordinate with
  `06-secrets-environment-and-redaction.md`: redaction must stay for the paths
  that do surface logs.

### [MP-04] Terminal scrollback is flushed with a synchronous whole-buffer `writeFileSync` once a second

- Impact: **Medium** · Confidence: **Confirmed (measured)**
- Where: `src/main/terminal/terminal-service.ts:708` →
  `src/main/terminal/terminal-output-file.ts:60` (`writeFileSync(outputPath, text)`)
- Mechanism: every PTY chunk arms a 1 s debounce (`terminal-service.ts:743`); on
  fire the whole ring is joined into one string and written synchronously. The
  buffer is sized from `appearance.terminalScrollbackMb`, default **10**, max
  **200** (`src/shared/config.ts:175`). So while output flows in a dock terminal
  the main thread blocks on a full-buffer write every second — per restorable
  session (`isRestorableTerminalKind` → `kind === 'terminal'`,
  `terminal-service.ts:99`), so three open shells triple it.
- Evidence: measured — `read()` (the join) is 1.1–1.2 ms at 10 MB;
  `writeFileSync` is **6.7 ms at 10 MB** and **70.9 ms at 50 MB**. The 200 MB
  ceiling extrapolates to ~**280 ms of blocked event loop every second**, which
  is a frozen window rather than a hitch.
- Fix: `fs.promises.writeFile` via a staging file + rename (keeping the write
  atomic for the restore path) moves the syscall off the loop. Better: append
  only the delta since the last flush, so the cost stops scaling with the
  scrollback setting.

### [MP-05] Every Pi RPC frame is broadcast to every window in both directions, with no subscriber unless developer mode is on

- Impact: **Medium** · Confidence: **Confirmed (unambiguous code path)**
- Where: `src/main/main.ts:743` (`onRawFrame: broadcastRawFrame`, ungated) →
  `main.ts:628`; emitted at `src/main/pi-agent/pi-cli-rpc-adapter.ts:346`
- Mechanism: `emitRawFrame` only checks that the callback exists
  (`pi-cli-rpc-adapter.ts:347`), and `main.ts` always supplies one. Every JSONL
  line Pi writes or reads — every token delta included — is sampled
  (`sampleRawFrame`, 8 KB cap), wrapped, and posted to every window. The only
  subscriber is `usePiRawFrameCapture(developerMode)`
  (`src/renderer/components/workbench-shell/conversation-panel/conversation-content.tsx:63`),
  so with developer mode off — the normal case — the payload is serialized,
  written across the process boundary, deserialized, and dropped. It runs
  *alongside* the `agentSessionEvent` broadcast of the same content
  (`main.ts:924`), roughly doubling a streaming turn's IPC volume.
- Evidence: no `piRawFrame` subscriber exists outside that hook —
  `grep -rn "RawFrame" src/renderer/` reaches only `state/pi/pi-raw-frames.ts`
  and that one call site. In-process `structuredClone` of a representative frame
  measures 1.22 µs; the real Electron path adds a Mojo message and a
  renderer-side dispatch, so tens of µs per frame across both processes — tens
  of ms per heavy turn, all discarded.
- Fix: gate the tap. Count live `piRawFrame` subscriptions (a paired
  subscribe/unsubscribe channel), or read developer mode in main, and pass
  `onRawFrame: undefined` when nobody is listening — `emitRawFrame` already
  early-returns on that, so the hot path disappears rather than getting cheaper.

### [MP-06] Working-tree status reads every untracked file concurrently with a 512 KB buffer each

- Impact: **Medium** · Confidence: **Likely (code path clear, not measured at scale)**
- Where: `src/main/workspace-git/workspace-git-status.ts:309` and `:432`
  (unbounded `Promise.all`), `:736` (`countUntrackedLines`), `:405`
  (`withContentIds`)
- Mechanism: `getWorkingTreeStatus` and `readUntrackedFiles` map the untracked
  set through `Promise.all` with no bound. Each entry `open`s a handle,
  `Buffer.alloc`s up to `MAX_UNTRACKED_COUNT_BYTES` (512 KB), reads, and counts
  newlines with `for (const byte of buffer)` — an iterator step per byte.
- Evidence: with N untracked files the peak is N open descriptors and up to
  N × 512 KB of live buffers. A user who just unpacked a tarball, generated a
  build into a non-ignored directory, or checked out a branch that drops a
  tracked tree hits a few hundred at once — hundreds of MB of simultaneous
  allocation, a real `EMFILE` risk, and a byte-at-a-time scan of all of it on
  the main thread.
- Fix: bound the map to ~16 concurrent, count newlines with
  `buffer.indexOf(0x0a, …)` in a loop, and cap how many untracked rows get line
  counts at all — past a few hundred, `null` counts are honest.

### [MP-07] `appSettingsService.read()` re-reads and re-parses `config.json` on every call

- Impact: **Medium** · Confidence: **Confirmed (measured)**
- Where: `src/main/config/app-settings-service.ts:150` —
  `ensureExists()` (`existsSync`) then `settingsFrom(readRaw())`
  (`readFileSync` + `JSON.parse` + Zod parse)
- Mechanism: no memoisation, despite `startWatching` already knowing exactly
  when the file changed and already holding `lastWritten`. 35 call sites across
  main, 19 in `main.ts` alone, most of them closures (`readHiddenModelIds`,
  `readCoAuthorEnabled`, `resolveScrollbackLimit`, `resolvePermissionMode` via
  `config-resolution.ts:140`, …) deliberately re-read per use so a live setting
  change is picked up. `settingsResolutionService.resolve()` calls it too, so
  every agent-control op that resolves a permission mode pays it.
- Evidence: measured against the real `~/.config/ensemblr/config.json`
  (5,991 bytes): `existsSync` + `readFileSync` + `JSON.parse` = **29.3 µs**;
  `parseAppSettings` (Zod 4) = **11.8 µs**; full `read()` = **42.1 µs**. Four
  reads per agent-control op is ~170 µs of blocking work where the answer cannot
  have changed.
- Fix: cache the parsed `AppSettings` and invalidate from the three places that
  already know it moved — `writeRaw` (it sets `lastWritten` anyway), the
  watcher's non-echo branch, and `ensureExists`'s seed write. Live-reload
  semantics are preserved exactly, because the watcher is what makes them live.

### [MP-08] Terminal output is broadcast once per PTY chunk with no frame coalescing

- Impact: **Medium** · Confidence: **Likely**
- Where: `src/main/terminal/terminal-service.ts:1334` (`pty.onData` → `onOutput`),
  wired to `broadcastToAllWindows` at `src/main/main.ts:1271`
- Mechanism: one structured-clone IPC message per node-pty chunk, per window,
  plus three JS scanners over the same chunk (preview URL, OSC title, braille
  spinner). The scrollback flush is debounced and the renderer buffers into
  xterm, but the IPC itself is not coalesced anywhere.
- Evidence: a build or a `cat` of a large file drives node-pty at hundreds to
  thousands of chunks per second per terminal; with several harness terminals
  the message rate multiplies. Nothing in the path batches.
- Fix: accumulate into a per-session pending string and flush on a ~16 ms timer
  before `onOutput`, keeping `seq` monotonic over the batch. The renderer's
  `onTerminalOutput` already appends into xterm, so a concatenated chunk needs
  no renderer change.

### [MP-09] The watcher's ignore test only inspects the top path segment, so a nested `node_modules` storms it

- Impact: **Low–Medium** · Confidence: **Confirmed (code path)**
- Where: `src/main/workspace-files/watch-workspace-files.ts:245` —
  `const topSegment = changed.split(/[/\\]/, 1)[0]`
- Mechanism: `IGNORED_DIRECTORY_NAMES` (`.git`, `node_modules`) is matched
  against the first segment only, so a monorepo's `packages/web/node_modules/**`
  passes the filter, arms the debounce, and broadcasts. The Linux walk in
  `linux-recursive-watch.ts` already skips these names at *any* depth, so the
  two legs disagree.
- Evidence: `npm install` inside a workspace package writes tens of thousands of
  paths under a nested `node_modules`; each burst broadcasts at the 1 s
  max-wait ceiling, and each broadcast costs a full `listWorkspaceFiles`
  (**MP-11**), bounded only by the renderer's `staleTime: 5_000`
  (`renderer/api/ensemblr/workspace-files.ts:40`).
- Fix: test every segment —
  `changed.split(/[/\\]/).some((segment) => IGNORED_DIRECTORY_NAMES.has(segment))`.
  One extra split on an already-rare path, and it matches the Linux leg.

### [MP-10] The scrollback ring copies its whole chunk array on every trim

- Impact: **Low** · Confidence: **Confirmed (measured)**
- Where: `src/main/terminal/terminal-scrollback.ts:38` —
  `chunks = chunks.slice(1)` / `chunks = [head.slice(overflow), ...chunks.slice(1)]`
- Mechanism: once at the limit — where a busy terminal lives — every append
  triggers a trim and every trim rebuilds the whole array. At the 10 MB default
  with small chunks that array holds ~20,000 entries.
- Evidence: measured at the limit — **32.3 µs per append at 512 B chunks**
  (20,480 entries), 4.6 µs at 4 KB. At 1,000 chunks/s that is **~32 ms of
  main-thread CPU per second per terminal**, purely array copies and their
  garbage.
- Fix: a head index (`let start = 0`) with periodic compaction, or a real
  circular buffer. `read()` becomes `chunks.slice(start).join('')`; the trim
  becomes `start += 1`.

### [MP-11] Workspace file listing re-walks the ignored tree and re-spawns four `git` processes per request, uncached

- Impact: **Low** · Confidence: **Confirmed (measured)**
- Where: `src/main/workspace-files/list-workspace-files.ts:164` (the four-way
  `Promise.all`), `:587` (`expandIgnoredEntries`), `:670` (`walkIgnoredRoot`)
- Mechanism: four `git` spawns plus a depth-first `readdir` walk per ignored
  root, which climbs to `min(2000, remaining)` entries and then discards the
  whole walk (`return null`) to keep the directory collapsed. That bail work
  repeats identically on every request; nothing is memoised between the
  watcher-driven invalidation and the 30 s poll.
- Evidence: measured on this repo — 4 parallel `git ls-files` = **39–53 ms**
  (3,018 tracked entries, 292 KB stdout); `walkIgnoredRoot('node_modules', 2000)`
  = **5–14.5 ms across 66 `readdir` calls**, always bailing. Each of the four
  results also pays **MP-03**.
- Fix: cache per `workspaceCwd` and invalidate from the watcher that already
  fires the broadcast — both are constructed in `main.ts` and the wiring is one
  call. Separately, remember per root (keyed on its `mtime`) that it exceeded
  the cap, so the discarded walk is not re-run.

### [MP-12] Harness conversation-title polling stats every transcript in the candidate directories every 1.5 s

- Impact: **Low** · Confidence: **Likely**
- Where: `src/main/terminal/terminal-service.ts:908`,
  `src/main/terminal/agent-conversation-title.ts:527` (`listJsonlByMtime`)
- Mechanism: one `setInterval(…, 1_500)` per agent terminal session. Each tick
  `readdir`s one or two candidate directories and `stat`s **every** `.jsonl` in
  them to sort by mtime (Claude names transcripts by UUID, so there is nothing
  in the name to sort on), then reads heads until a cwd matches.
- Evidence: `~/.claude/projects/` holds 234 project directories on this machine,
  the largest with 20 transcripts — ~40 `stat` calls per tick per session, so
  five agent terminals is ~130 `stat`/s. Async and individually cheap, but it
  grows with transcript history and never prunes.
- Fix: cache the listing and re-`stat` only when a `readdir`'s entry set
  changes; or watch the directory, since the poll exists to catch a *newly
  written* session id.

### [MP-13] The first PR sweep runs inside `registerIpcHandlers`, before the window exists

- Impact: **Low** · Confidence: **Confirmed (code path)**
- Where: `src/main/ipc/handlers.ts:402` — `prStatusSweeper.start()`
- Mechanism: `registerIpcHandlers` is called at `main.ts:1841`, before
  `openMainWindow()` at `:1910`. `start()` fires an immediate sweep
  (`workspace-pr-sweeper.ts:196`) and on the first tick no workspace has a
  recorded sweep time, so `isDue` returns true for all of them (`:113`). The
  sweep is correctly sequential, so this is `gh` spawn churn and network rather
  than a stall — but it is churn competing with renderer startup for the whole
  first minute.
- Fix: a `startDelayMs`, or arm `start()` from `window.once('ready-to-show')`.
  Nothing reads the snapshot before the sidebar renders, and the cache already
  covers the gap.

## Verified sound

- **Linux recursive watch** — `workspace-files/linux-recursive-watch.ts`:
  directories only, `node_modules`/`.git` never descended, walk off the
  synchronous path. The documented fix, correctly applied.
- **Workspace-files debounce** — `watch-workspace-files.ts:6`, `:12`, `:115`:
  250 ms trailing debounce **with a 1 s max-wait clamp**, so sustained churn
  cannot starve the renderer forever. Ref-counted per cwd, single teardown path
  (`:140`), all timers cleared in `stopAll`.
- **Boot disk sweep** — `repository/sweep-workspace-disk.ts:104`: explicitly
  sequential, reason stated ("while the app is still opening its window"). This
  is the policy **MP-01** should inherit.
- **Login-shell environment capture** — `commands/local-command.ts:83`–`137`:
  memoised per resolution cwd; a `'shell'` snapshot cached for the session, a
  `fallback` cached only until a 30 s cooldown lapses so a slow shell cannot
  storm interactive-shell spawns. Measured here: `zsh -lic` 10–20 ms,
  `fish -lic` 150–320 ms — either way, once.
- **`pty.process` polling** — `terminal/pty-backend.ts:76` at 500 ms per
  terminal resolves to `tcgetpgrp` + `sysctl KERN_PROC_PID`
  (`node_modules/node-pty/src/unix/pty.cc:661`) — two syscalls, not a spawn —
  and broadcasts only on change (`terminal-service.ts:934`).
- **Battery poll** — `agent-runtime/agent-activity-monitor.ts:285`: armed only
  while a session streams, cancelled the moment none does, 30 s sample TTL on
  top.
- **Other schedules, all correctly bounded** — the update check
  (`updates/update-service.ts:352`: 2-min delay then 4 h, re-arm guarded); the
  MCP progress heartbeat (`agent-control/mcp-progress.ts:62`: scoped to one op,
  cleared in `finally` and again on a rejected notification); window-state
  persistence (`app/window-state.ts:137`: 500 ms trailing debounce on
  `move`/`resize`, immediate on `close`); and the setup-diagnostics poll
  (`renderer/api/ensemblr/setup-diagnostics-poll.ts`: 4 s while settling, hard
  stop at 15 not-ready fetches, stops on `ready`, budget advances only on a
  completed fetch).
- **PR sweeper** — `github/workspace-pr-sweeper.ts:164`–`197`: `running`
  re-entry guard, sequential refresh chain, per-row cadence, and `recordSweep`
  prunes ids that leave the listing so the map cannot grow forever.
- **Config watchers** — `config/watch-config-file.ts:24`: watches the
  *directory* (survives rename-replace saves), filters by filename, debounces;
  `app-settings-service.ts:186` suppresses the echo of its own write by exact
  bytes.
- **Menu rebuild gating** — `menu/menu-command.ts:49` +
  `shared/menu-commands.ts:201`: real structural equality over all six context
  fields, so `Menu.setApplicationMenu` runs on genuine change only.
- **Stale-session recovery** — `terminal-service.ts:1793`: SQLite rows only.
  Scrollback files are read lazily on restore, so boot pays nothing for a 200 MB
  log.
- **Quit teardown** — `main.ts:2016`–`2029`: settings and config watchers
  stopped, update service stopped, activity monitor disposed, control server
  closed, `terminalService.shutdown()`, `ipcHandlersHandle.dispose()` (which
  disposes the PR sweeper), `workspaceFilesWatcher.stopAll()`, database closed.
  Per-session timers all cancel through the one `clearSessionTimers` /
  `clearOutputFlushTimer` path (`terminal-service.ts:683`, `:986`), and every
  interval is `unref()`ed so a pending tick cannot hold the process open.
- **No listener accumulation** — no `process.on` in `src/main`; no
  `ipcMain.on`/`handle` inside per-session code (registration is one-shot at
  `main.ts:1300`–`1370` and in `ipc/handlers/**`);
  `agent-control/started-terminals.ts:34` is an insertion-ordered LRU with a
  real eviction, not an unbounded map; `agent-control/session-lineage.ts:277`
  builds a fresh cycle-guard `Set` per call.
- **Broadcast payload sizes** — the 21 `broadcastToAllWindows` sites in
  `main.ts` all carry deltas or ids (`workspaceFilesChanged` is one cwd;
  `agentControlTabsChanged` is one workspace id). Nothing ships the whole
  workspace list, session set, or event log per change, so there is no O(N)
  payload per event to become O(N²) over a session.

## Coverage

Read in full or in the relevant part: `src/main/main.ts` (boot order, every
timer and listener it wires, all 47 send/broadcast sites); `app/**`, `root/**`,
`repository/**` (adoption, git probe, list-all-workspaces, directory-bytes, disk
sweep), `workspace-files/**`, `workspace-git/workspace-git-status.ts`,
`github/**`, `terminal/**`, `commands/**`, `setup/setup-diagnostics.ts`,
`config/**`, `concierge/{concierge-home,concierge-memory-service}.ts`,
`architecture/architecture-file.ts`,
`agent-control/{main-integration,mcp-progress,started-terminals,session-lineage}.ts`,
`agent-runtime/agent-activity-monitor.ts`, `updates/update-service.ts`,
`menu/menu-command.ts`, `ipc/handlers.ts` — all under `src/main/`. Plus the
renderer poll cadences that drive main (`src/renderer/api/ensemblr/*.ts`,
`src/renderer/hooks/workbench-shell/route-layout/use-workbench-queries.ts`).

Measured (throwaway scripts under `/tmp`, no app launch): the boot git-probe
fan-out over the real 16-repo root; branch-scope `getStatus` singly and at
15-way concurrency; the four `git ls-files` calls and the `node_modules`
ignored walk; the redaction pass at 292 KB / 1 MB / 8 MB with a realistic
secret-bearing environment; `appSettingsService.read()` including the Zod parse
(`npx tsx` against `src/shared/config.ts`); scrollback append at the limit,
`read()`, and `writeFileSync` at 10 and 50 MB; the concierge memory reconcile
pass; `zsh -lic` and `fish -lic` environment capture; `structuredClone` of a raw
frame.

Not covered (owned elsewhere): SQLite PRAGMAs, indexes, per-token insert cost
and event replay — `11-storage-and-persistence.md`; the agent streaming pipeline
and the `agentSessionEvent` broadcast — `13-agent-runtime-pipeline.md`;
`git`/`gh` argument safety and path containment —
`05-filesystem-git-and-process-exec.md`; redaction as a *security* control —
`06-secrets-environment-and-redaction.md`; renderer-side render cost of any
broadcast.

## Open questions

1. **Is developer mode a persisted setting main can read?** If so, **MP-05**'s
   fix is a one-line gate at `main.ts:743`; if it is renderer-only state it
   needs a subscribe/unsubscribe count. Worth settling before scoping.
2. **Should `appearance.terminalScrollbackMb` still allow 200?** With **MP-04**
   unfixed the top of the range is a ~280 ms main-thread stall per second. If
   the flush goes async the ceiling is harmless; if not, the ceiling is the bug.
3. **Does a second window ever exist in practice?** `openMainWindow` is guarded
   to one (`main.ts:1630`), which makes `broadcastToAllWindows` a one-element
   loop and **MP-02**'s cross-window duplication hypothetical. If multi-window
   is out of scope, those loops could be simplified.
4. **Security observation, for routing:**
   `src/main/terminal/terminal-output-file.ts:60` writes raw terminal scrollback
   — ANSI and any echoed secrets included — to `.context/terminals/<id>.log`
   inside the user's worktree, relying on `.context` being root-gitignored.
   `writeArchivedTerminalOutput:82` validates its id against path traversal but
   `writeTerminalOutput` does not (it trusts generated ids). Route to whoever
   owns terminal/scripts security.
