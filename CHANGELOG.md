# Changelog

All notable changes to Ensemblr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.1.0-beta.3] - 2026-08-13

Terminal shutdown fixes on top of beta.2. Signed, notarized, Apple silicon.
[Release](https://github.com/ensemblr-hq/ensemblr/releases/tag/v0.1.0-beta.3) ·
[`.dmg`](https://github.com/ensemblr-hq/ensemblr/releases/download/v0.1.0-beta.3/Ensemblr-0.1.0-beta.3-arm64.dmg)

### Fixed

- **Quit no longer abandons a dying PTY child.** `TerminalService.disposeAll()` signalled each shell and
  returned immediately, so a child could report its exit while Electron was already destroying the JS
  environment — node-pty dispatches that callback from a native thread-safe function, and node-addon-api
  aborts the process (SIGABRT) rather than surfacing it. Quit now waits for each child to actually exit,
  bounded by a SIGHUP → 1s → SIGKILL → 1s escalation that fits inside the app's quit window, and a PTY
  stream listener can no longer throw across the native boundary.
- **An agent tab exiting just before quit no longer kills every other terminal.** Agent sessions finalize
  asynchronously, so for up to two seconds after the child is gone the session row still reads `running`.
  Shutdown took that as a live child and waited on an exit event that had already fired, stalling both grace
  windows and then SIGKILLing terminals that were seconds away from exiting cleanly.
- **A terminal created during the quit grace is wound down with the rest** instead of surviving as an
  orphaned child with a live exit handler.

## [0.1.0-beta.2] - 2026-08-12

Dependency maintenance on top of beta.1 — no behaviour change. Signed, notarized, Apple silicon.
[Release](https://github.com/ensemblr-hq/ensemblr/releases/tag/v0.1.0-beta.2) ·
[`.dmg`](https://github.com/ensemblr-hq/ensemblr/releases/download/v0.1.0-beta.2/Ensemblr-0.1.0-beta.2-arm64.dmg)

### Changed

- **Dependency updates** (#267, #269–#273): TypeScript 6 → 7, Electron 43.1 → 43.3, Vite 8.1 → 8.2,
  `ai` 7.0.17 → 7.0.58, `radix-ui` 1.6.2 → 1.6.7, `lucide-react` 1.23 → 1.31, `jotai-family` 1.0.2 → 1.1.0,
  `@testing-library/jest-dom` 6 → 7, plus the rest of the dev-dependency group. CI actions moved to
  `actions/checkout@v7` and `actions/setup-node@v7`. Each PR was verified against master separately, so the
  lockfiles were resolved against trees the others had not seen; reinstalling reconciled them and dropped 102
  stale packages.
- **`@types/node` held at `^24`** — Electron 43 embeds Node 24, so typing against `^26` buys a compiler that
  accepts APIs the runtime does not have. Dependabot reads it as an ordinary devDependency rather than a
  mirror of `engines`; the constraint is now recorded in [`.claude/rules/stack.md`](.claude/rules/stack.md).
- **README wordmark** (`146f52a`): the loop runs 16s instead of 4s, holding a full flicker cycle at the low
  end of the app's 12–20s range rather than compressing it past recognition, and the canvas moved to
  GitHub's `#0d1117` so the mark sits flush in the README instead of reading as a near-black card.

## [0.1.0-beta.1] - 2026-08-12

First public build — signed, notarized, Apple silicon.
[Release](https://github.com/ensemblr-hq/ensemblr/releases/tag/v0.1.0-beta.1) ·
[`.dmg`](https://github.com/ensemblr-hq/ensemblr/releases/download/v0.1.0-beta.1/Ensemblr-0.1.0-arm64.dmg)

### Added

- **English, Russian, and Greek — the App and Its Agents** (`e7ab199`, #246; `b68621e`, #248; `685a438`, #249; `5ba397f`, #250): Ensemblr ships in three languages. i18next 26 + react-i18next 17 carry bundled catalogues for `en`, `ru`, and `el` across eight namespaces (`common`, `errors`, `git`, `linear`, `onboarding`, `review`, `settings`, `workbench`), with no empty `ru`/`el` value. English is extracted from the `t('key', 'Default English')` call sites and never hand-written; `ru` and `el` are hand-filled against [`docs/i18n-glossary.md`](docs/i18n-glossary.md), which fixes the product vocabulary up front. The full contract lives in [`.claude/rules/i18n.md`](.claude/rules/i18n.md).
  - The render language resolves in the main process and is seeded through the preload shell snapshot, so the first paint is already in the user's language rather than flashing English while an effect corrects it. The native macOS menu rebuilds from `src/main/menu/menu-strings.ts` on a language change, and main and renderer share `resolveLanguage()` so the bar and the window cannot disagree
  - `src/shared/` and `src/main/` return locale-neutral **codes**, never English labels — they cannot reach the renderer's i18n instance, so a label they returned would be English forever. `src/renderer/lib/failure-text/` maps all 140 codes exported from `src/shared/ipc/contracts/` to a `t()` call, making a new code in main a compile error rather than English prose on a translated screen; main's own message renders as a second line only when it carries interpolated data (a path, a branch name, an exit code, git stderr)
  - Only prose Ensemblr authors is localized. Passthrough text — thrown `Error` messages, git and `gh` stderr, upstream service diagnostics — carries no code and surfaces as it arrived
  - Agent prose follows the app: `buildLanguageDirective` in `src/shared/agent-control/language-directive.ts` renders one block naming the reader's language, appended by every playbook surface — Pi per turn over `getSessionBrief`, Claude in the per-turn preamble, a harness in both its `AGENTS.md` playbook and `instructions`. English resolves to *no* directive, so an English-defaulted app does not become an English-only agent for a user who types Russian
  - An untitled chat tab stores the empty string rather than the literal `New chat`, with the renderer painting the localized placeholder over it (migration `015` blanks the stored literal, and `titleProvenance` spares a title someone deliberately chose). Closed-tab timestamps render through `Intl.RelativeTimeFormat`
  - `npm run check` runs `i18n:lint` plus `scripts/check-hardcoded-strings.mjs`, which covers i18next-cli's blind spot: prose in an object literal, a const table, or a template literal. `docs/i18n-audit-2026-08-09.md` recorded the audit findings (removed before the public release)

- **First-Run Setup Wizard** (`7ddd7d7`, #247): A first launch opens `/onboarding` instead of the workbench — a welcome moment, a language picker, one screen per gate (agent CLI, GitHub CLI, Linear), and a terminal screen naming whatever is still unresolved. Both exits, finishing and skipping, record `app.onboarding.completedAt`, so the wizard never nags. The agent-CLI gate is **either-or**: Ensemblr needs *an* agent runtime, never a particular one, so a machine carrying only Pi or only Claude Code reads as ready and the skipped runtime dims instead of turning red. The same rule governs the diagnostics rollup — `setupDiagnostics` resolves the gate onto each check's blocking flag before computing `blocked`. Both gates read one table, `AGENT_RUNTIME_CHECK_GROUPS` in `src/shared/setup-checks.ts`, because a second hand-written copy would let the wizard call a machine ready that diagnostics still reports as blocked. Adds the `claude-executable` setup check (deliberately narrower than the provider readiness probe, which opens a throwaway SDK session), and moves the playground's scenes into a registry with a sidebar so the wizard can be driven from fixtures.

- **Attach Files, Issues, and Directories From the Composer** (`75da912`, #256; `36464ec`, #257; `cd4ff13`, #261): The composer could reference workspace files by `@`-mention and little else. Pasting an image, dropping a file, handing the agent an issue, or forwarding a review comment all meant leaving it. Every one is now a chip in one ordered list.
  - One `ComposerAttachment` list replaces the three parallel atom families (uploads, mentions, externals), so the order the user attached things in is the order the outgoing prompt carries
  - Pastes, drops, and picked files are written to a content-addressed store under `.context/attachments/<digest>/` the moment they are attached, so every chip carries a real path and re-attaching the same bytes costs nothing. Placement is `link`-based, so a concurrent reader never sees a partial file. Pasted images are validated by magic bytes against their declared MIME type before they are persisted; a paste over 5k chars becomes a `.txt` attachment with a preview chip
  - One picker searches Linear and GitHub together and writes the whole issue — metadata, body, every comment — out as a markdown document, so the agent reads it as a file rather than a summary line. Replaces the Linear-only picker
  - "Add to chat" on a review comment serializes the whole thread to a markdown document and drops a chip wearing the comment's provider mark, replacing `formatCommentContext`/`formatAllCommentsContext`, which flattened a thread to a one-line summary and told the agent every non-local comment came from GitHub. "Add all" attaches at most ten and names the shortfall; each comment inlines up to 8k chars. The cross-component attachment channel is addressed to one chat tab or one workspace root, so an entry cannot outlive a workspace switch and drain a workspace-relative path into a chat on another root
  - **Linked directories**: a chat can be granted read access to a directory outside its workspace, per chat and sticky across sends, backed by an app-global recents list and riding `openAgentSession` into the Claude SDK's `additionalDirectories`. Symlinks are deliberately not resolved. Claude takes those roots only at launch, so a directory linked mid-session is marked pending and the composer says the chat has to reopen. New `src/main/linked-directories/` concern with its own repository, IPC handlers, and request schemas
  - The textarea is now a **Lexical** plain-text editor, so a chip sits where the user put it in the sentence rather than stacking above it. A chip is a decorator node — the caret steps over it, Backspace deletes it whole, and the "remove last mention" shortcut is gone. The editor publishes the draft back out as plain text plus its runs and chips in document order, so the autocomplete engine and the send pipeline never learn about Lexical; the outgoing prompt interleaves each `<attached_file>` block where its chip sat instead of hoisting every attachment to one end
  - PDFs render in the file preview: the workspace read returns them as bytes under `application/pdf` and the renderer embeds them through a blob URL, since Chromium refuses to navigate a frame to a `data:` URL and ships its PDF viewer as a plugin (the main window opts into plugins)

- **A Follow-Up Queue the User Can See and Edit** (`0d48d19`, #258; `a73d16f`, #260): Mid-turn sends under the `queue` and `block` behaviors land in a per-tab renderer queue instead of the runtime's own follow-up frame. Neither runtime can read back or cancel what it holds, so a queued message used to be invisible and final; here it stays listed, reorderable, editable, and removable until the turn ends. `queue` drains one entry per turn end so each queued message gets its own turn; `block` holds the queue for the user to release; a stop pauses it rather than draining into the gap. Checks-panel chores queue too, and drain under every behavior, because the panel already reported them as handed over. `onSubmit` returns an outcome instead of throwing, so a send that fails after the optimistic clear puts the draft back. The queue then moved out from behind a counter chip into a stack pinned above the composer: the header carries the count and *why* the queue is sitting still, the head row reads in the accent colour and is labelled Next, and each row gains an out-of-turn send (a steer frame mid-turn, an ordinary jump-the-queue send when idle). A send that does not land goes back to the index it was taken from — `take` now returns the place it held, where `requeue` used to prepend and promote a steered message past ones the user had deliberately put in front of it.

- **Per-Chat Unread Tracking** (`41eb972`, #255): A workspace-level unread flag could only say "something happened in here" and was cleared by opening the workspace at all. Agent activity now marks the individual chat, so the user can see which tab is waiting and reading one tab does not silence its siblings. State lives in a new `src/renderer/state/unread/` concern — a persisted, bounded list of marks with pure reducers over it, scoped read hooks, and the active-chat identity the marker checks against. A mark carries both a session id and a tab id, because a turn that lands while its workspace is closed knows only the former; the tab id resolves lazily, on click. Surfaces: a dot with the count in the sidebar row's tooltip, a dot on the session tab (hidden while active or hovered), and a "Last unread" pill in the composer that crosses workspaces. Marks are dropped when their chat becomes unreachable, so the jump control cannot pin itself open on something the user has no way to clear.

- **A Sub-Agent's Work Nested Inside the Call That Spawned It** (`fd97a13`, #253): The Claude SDK forwards a `Task`'s messages flat at top level tagged `parent_tool_use_id`, never nested, so a delegate's tool rows, prose, and reasoning read as the main agent's own and a turn that delegated looked like one that did the work itself. The normalizer copies that id onto every event a subagent message produces as `AgentEvent.parentToolCallId`, riding inside the persisted payload as an optional field so Pi rows and rows written before it existed stay byte-identical, and the renderer re-nests the flat stream into one card per delegation. Three things the link has to carry beyond attribution: `forwardSubagentText: true`, or the SDK sends only the delegate's `tool_use`/`tool_result` blocks; reasoning banked per thread rather than per session, since an interleaved subagent's `message_start` must not clear the main thread's buffer and both number their content blocks from zero; and streaming text merged only within a thread, so a delegate's deltas cannot splice into the middle of the agent's own paragraph.

- **A Native Menu Bar Driven by a Renderer Command Bus** (`5cf92de`, #264): The single `close-active-tab` broadcast is replaced by a general menu command bus, growing the bar from 6 to 9 menus. The renderer reports which commands currently have a handler plus the entries filling the dynamic submenus; main enables items from that report and rebuilds only when the report actually changes the menu. `src/shared/menu-commands.ts` holds the command table, the reported context, and the equality check that skips no-op rebuilds; `src/main/menu/` splits `application-menu.ts` into one builder per menu behind `createMenuItemFactory`, which owns enabling, checked state, and accelerators; `src/renderer/state/menu-commands/` registers handlers as a per-command stack so overlapping route transitions restore the right one. Accelerators attach only to commands flagged `ownsAccelerator` — on macOS AppKit matches an item's key equivalent before the web contents sees it, and Electron's `registerAccelerator: false` escape hatch is documented Windows/Linux only, so composer- and dialog-scoped chords carry none (`CommandOrControl+Return` is four different submits only the renderer's layered handling can tell apart). `tab.close` is reported as always available so its item stays enabled with nothing registered; a disabled item never fires its click, which would swallow the keystroke rather than fall through to closing the window. Drops the bundled product roadmap from the Help menu and from `extraResource`.

- **Legible Terminal Reads and Survivable Summaries for Agents** (`a73d16f`, #260): Three round trips an agent driving the app was paying for no reason. Reading a terminal returned raw PTY bytes, so one `Local: http://localhost:5199/` arrived buried in colour codes, the cursor-home-and-erase pair a full-screen repaint opens with, and the blank-line runs it leaves behind; reads now render readable by default (escape sequences dropped, repaint blank-line runs collapsed, carriage-return line rewrites and the backspace walk-back npm/pip/cargo/docker use resolved), with `ansi: true` still returning raw bytes. Reading also demanded an id, and now takes the same `terminalId`-or-`kind` selector the start and stop ops take, echoing back the id it resolved and scope-checking it like any other. Starting a second script of a kind was refused with prose alone; the diagnostic now carries the id of the terminal holding the slot, and `restart` replaces it outright. `setSummary` rejected an over-long title or body at the schema boundary — the heaviest payload on the surface, and the only one whose whole point is to survive the turn — so it is stored truncated with a per-field report of what was cut, the cut falling between characters and never through a surrogate pair.

- **Gated Linear Reads and Writes for Agents** (`973a3d1`, #244): Five control ops over the Linear integration the renderer already uses — three reads (`linearListIssues`, `linearGetIssue`, `linearGetMetadata`) and two writes (`linearCreateComment`, `linearUpdateIssue`) — through a new gated port at `src/main/agent-control/linear-ports.ts` over the same `LinearService`, so no GraphQL or cache logic lands in the control layer. The port is where the policy lives: **Done and Canceled are refused** — `terminalStateRefusal` resolves the target `stateId` against the cached workflow states and refuses any whose Linear type is `completed` or `canceled`, so the `AGENTS.md` rule that agent work stops at In Review is enforced rather than documented, and it fails closed on an unknown id, a cached row with no type, or a metadata read that could not reach Linear. Payloads are budgeted like the workspace diff, fitted to `MAX_AGENT_PAYLOAD_CHARS` and reporting what was cut (`omittedIssues`, `omittedComments`, one shared budget filled in priority order for metadata). Nothing throws: the service's typed failure envelope maps onto one `status` word — `ok`, `not-connected`, `not-found`, `refused`, `failed` — so an agent can tell "never linked" from "wrong id" from "Linear is down". None of the ops is workspace-scoped, since Linear is an app-level integration bound to one account. Both writes are withheld from sub-agents, and `linearUpdateIssue` is blocked in Plan Mode for the same reason `resolveDiffComments` is — it would claim an implementation that does not exist. Commenting stays available while planning.

- **Greek and Cypriot Composers in the Workspace Name Pool** (`4015695`, #254): The workspace placeholder pool covered baroque through game music but had no Greek or Cypriot representation beyond Vangelis. Adds 30 surnames in two regional sections, following the existing "Game music — Japanese/western" precedent: the Ionian School (Mantzaros, Carrer, Samaras) through the National School (Kalomiris, Lavrangas), the modernists (Skalkottas, Christou, Xenakis), the popular and film traditions (Theodorakis, Hatzidakis, Karaindrou), and Cypriot coverage from Michaelides to living composers such as Kyriakides and Skordis. All entries stay ASCII so the slug pipeline keeps producing clean branch names, and none collides with an existing one at slug level.

- **Claude Code as a Second First-Class Agent Runtime** (`069cd0b`, #226; `239f507`, #228; `7a7be33`, #229; `9b1766d`, #232; `4fbeb65`, #237): Claude Code now drives a native chat tab as a peer of Pi — structured timeline, tool cards, Plan Mode, checkpoints, forking, session summaries, the `ensemblr_*` control tools, and the model picker — rather than existing only as a terminal harness. To avoid translating Claude into Pi, the shared vocabulary was renamed provider-neutral: `src/main/pi-agent/` became `src/main/agent-runtime/`, with `src/main/pi-agent/` and `src/main/claude-agent/` as sibling adapters behind one `AgentAdapter` contract dispatched on a per-session provider pin. See [ADR 0042](docs/adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md).
  - The `pi_*` tables became `agent_*` (migration `014_agent_session_vocabulary`, which renames in place so existing sessions survive the upgrade) and the `pi`-prefixed IPC channels, contracts, and events became `agent`-prefixed
  - New `src/main/agent-providers/` concern for executable discovery, readiness probing, and model catalogues, plus a Settings → Providers surface and a per-tool approval card for workspaces in `approval-required` mode
  - The control-server bearer token reaches Claude as a `${ENSEMBLR_CONTROL_TOKEN}` reference rather than a literal, so it cannot leak through process argv the way an inlined `--mcp-config` value would
  - Slash commands and the MCP server roster are served over provider-parameterized channels (`listAgentProviderSlashCommands`, `listAgentProviderMcpServers`), replacing the pi-only channel. Both are workspace-scoped, so project-scope commands and servers resolve, and both defer until something asks so no runtime child is spawned on mount. A Claude-backed composer gains an MCP roster chip beside the context gauge; a `needs-auth` row is a button that opens `claude /mcp` in a dock terminal
  - Each runtime keeps its own thinking vocabulary in `src/shared/agent-thinking.ts` — Pi steers *thinking* (off → minimal → … → xhigh), Claude steers *effort* (off → low → … → max) — and the composer chip and Settings → Models label whichever runtime is selected, including the axis name
  - Claude model rows are named after the release each moving alias resolves to and ordered by family and version, with the pinned ids Claude Code accepts as an explicit `--model` but never advertises appended and deduped
  - Per-turn upkeep reaches Claude through `resolveTurnPreamble`: a runtime driven over MCP has its system prompt fixed at session open, so Pi's `before_agent_start` route has no equivalent. The block is prepended to the prompt the model receives, never to the one persisted, so it stays out of the user's transcript
  - Reasoning survives rehydration — a `StreamedReasoning` buffer banks `thinking_delta` text by content-block index and refills the seal the SDK empties, and a genuinely redacted thinking block renders an inert "Thought" row instead of vanishing
  - Turns open the instant their prompt is queued rather than when the runtime answers, so the working indicator and turn timer start on the tick the prompt renders — on both runtimes

- **Context Gauge With a Measured Window** (`dd53296`, #230; `3c096ce`, #235): The composer's context gauge now reports a real denominator from the first tick of a chat instead of a hardcoded 258,400. Three sources fill it in order of authority: both adapters ask their runtime directly at session open (Claude via `Query.getContextUsage()`, Pi via `get_session_stats`), the model catalogues publish a window per model (Pi reads the `context` column of `--list-models`), and the renderer falls back to the selected model's published window at zero occupancy, or an em dash when there is none. "Unknown" is modelled as `null` end to end, so "this model publishes no window" stays distinguishable from "this model has no room left". Occupancy is measured from each main-thread `assistant` response's own `message.usage` rather than summed from `result.modelUsage`, whose cumulative billing counters also cover sub-agents, sidechains, and compaction — summing them reported several times the window's worth of tokens within a handful of turns. Sub-agent responses are measured against their own window and no longer restate the user's.

- **Resolved Review Comments in the Checks Panel** (`5a00d04`, #234): A resolved review comment renders struck through with a Resolved badge, matching the diff thread and the done-todo row; an unresolved one keeps its Unresolved badge, and a comment carrying no resolution state at all — a plain issue comment, a bot annotation — shows neither and is treated as unresolved. "Add all to chat" now hands the agent the unresolved comments only, and the header action disappears once nothing is left unresolved. Adding a single resolved comment still works and states "Thread is resolved." so the agent does not read settled feedback as work to do. Also fixes a duplicate: the PR model already projects open local comments into `pullRequest.comments`, and the panel merged its own copy on top, so every open local note was listed — and bulk-sent — twice once a PR existed.

- **Onboarding Runbook & Architecture Map** (`5a00d04`, #234): [`docs/onboarding.md`](docs/onboarding.md) walks clone → prerequisites → install → run → first change → first PR, including which runner a new test belongs to, and [`docs/architecture-map.md`](docs/architecture-map.md) records which directory owns which concern across the four runtime boundaries, the IPC contract path, and where state persists. Two agent rule files land alongside them: `.claude/rules/stack.md` for the pinned versions and the constraints that are not obvious from `package.json`, and `.claude/rules/patterns.md` for the structural rules a change has to respect.

- **Agent Review Ops — Read the Diff, Leave Findings, Resolve Them** (`84f4b03`, #193; `9b1766d`, #232): An agent can now review the work in its own workspace and leave findings on the line rather than describing a location in prose. `getWorkspaceDiff`, `getDiffComments`, and `addDiffComments` all take the workspace from the caller's origin, so a cross-workspace read or write is unreachable by construction, and the diff read is scoped the way the Changes panel scopes it. `resolveDiffComments` closes what an agent fixed in the same turn it fixed it — resolve-only, with no reopen (that would reverse a human judgement silently) and no archive (a delete by another name). Unknown ids come back in `notFound` rather than failing the call, and "no such id", "another workspace's id", and "archived" merge into that one bucket so the op cannot be used as a cross-workspace id-existence oracle; the review repository's comment update and delete are now scoped by workspace, since comment ids travel across workspace boundaries. Plan Mode refuses the op — nothing is fixed while `write` and `edit` are blocked. A comment's `path:line` anchor is clickable in the preview, and the viewer scrolls to the row, flashes it, and escalates once to full-file view when the line falls outside the rendered hunks. See [`docs/agent-control.md`](docs/agent-control.md).

- **Named Run Scripts Per Repository** (`5e28b06`, #220; `c7b5387`, #222; `b1f73fa`, #223): A repository can declare any number of run scripts as `[scripts.run.<name>]` tables in `.ensemblr/settings.toml`, each with a command, a curated icon, an optional default flag, and `available_in` gating. The dock's Run button becomes a split control listing every configured script, ⌘R targets the workspace's remembered pick, and the legacy `run = "..."` string keeps working as an implicit default. One shared parser in `src/shared/scripts/run-scripts.ts` owns the wire shape for both the TOML spelling and the camelCase shape persisted to SQLite, so main, the renderer, and the settings screen cannot drift on key names or defaults; a mistyped field costs only that field and is reported as a config diagnostic rather than dropping an otherwise launchable script. Per [ADR 0041](docs/adr/0041-write-repository-scripts-to-ensemblr-settings-toml.md), the Scripts settings screen now reads and writes the repository root's committed `.ensemblr/settings.toml` instead of personal SQLite rows, and a startup pass migrates existing rows into that file — atomically, preserving every other section but not comments. `run_mode` gains its documented meaning, governing whether workspaces of one repository may run scripts in parallel, and run launches serialize on the repository so two workspaces starting at once cannot both survive `nonconcurrent`. New `[scripts] auto_run_after_setup` key gives the previously SQLite-only toggle a TOML spelling. Agents reach the same set through `ensemblr_list_run_scripts` and a `scriptName` argument on `ensemblr_start_terminal` — both withheld from sub-agents — and a launch that starts nothing returns a failure envelope naming `not-found` (with the names that do exist) or `conflict` (with the script already holding the workspace) instead of a success carrying an empty terminal id.

- **Ask The User A Question** (`613749d`, #182; `27f7b5b`, #224): An agent can put a multiple-choice question to the human and block on the answer. The questionnaire renders in the chat tab that asked, taking the composer's place, so the answer lands where the question came from; a harness caller has no such tab and is refused with `denied-scope`. The call no longer expires — the 30-minute timeout is gone and the call is held until the user answers or dismisses it, the asking turn ends, or the session does. The Pi extension posts over `node:http` rather than `fetch`, whose undici `headersTimeout` was aborting every blocking call at five minutes and sending the answer to a dead socket; `/invoke` watches its socket so a turn ending mid-question withdraws the card instead of leaving it live; and main replays every open questionnaire on `did-finish-load` so a reload cannot lose the card while the agent stays blocked. Argument names across the control surface are now one vocabulary in `src/shared/agent-control/arg-naming.ts` — `title` labels a UI surface, `name` identifies a durable thing, `filePath` is always a path — with known near misses rewritten before validation rather than rejected, an unknown key answered by naming the keys the op does accept, and a conformance test holding the Zod schemas, TypeBox tools, and MCP `TOOL_DEFS` against the table.

- **Workspace Branch Take-Over** (`b0eeba5`, #225): Creating a workspace from a branch or pull request used to fork a new branch off the source tip and store that same tip as the base, so the review panel diffed the branch against itself and showed nothing. A workspace is now created from a `branchPlan`: `adopt` checks the branch out and owns it, so its commits show up in review and pushes land on the pull request it already backs, while `create` cuts a fresh branch at a fork point. The base branch keeps its separate meaning as the merge target, defaulting to the PR's own base, and `resolveBaseBranch` skips any candidate naming the adopted branch so a workspace can never be its own diff base. `git worktree add` argv moves behind a `WorktreeBranchPlacement` union in `worktree-placement.ts`; adopting a branch another worktree holds — or one that exists nowhere — fails up front with a named diagnostic that distinguishes the repository folder from a workspace; rollback never deletes a branch this creation did not cut; and rename refuses to move an adopted branch. Picking the default branch still cuts a fresh branch at `origin/<default>`, since the repository folder always holds it. Source labels pass through `toWorkspaceDisplayName` so a branch's `/` or a PR title's `feat(scope):` no longer fails name validation before git is reached, and placeholder-name allocation folds every local branch into the taken set so a leftover branch from a deleted workspace cannot break creation.

- **Target-Branch Selector for Workspaces** (`915f017`, #216): Retarget which branch a workspace diffs and opens pull requests against without touching its worktree — the fork already happened, so only `workspaces.base_branch` moves, re-scoping the merge-base that the review panel, the conflict probe, and the PR base all read from. One `BranchPicker` is shared between the header control and the repo-level branch-from setting; the list comes from `gh`, so a typed ref is stored verbatim to keep non-GitHub repos, other remotes, and tags reachable when GitHub cannot answer. `src/shared/branch-ref.ts` centralises the `origin/<name>` vs `<name>` rule, and ref validation now rejects a dash-led segment anywhere in a ref, not only at the front, so `origin/--upload-pack=…` cannot reach `git fetch` as an option.

- **Merge Conflicts Surfaced Across the Workbench** (`e8b2fe2`, #215): A new `getWorkspaceMergeConflicts` IPC answers "does this branch merge into its base" once in the main process, running `git merge-tree --write-tree` entirely in the object database — no ref written, no working tree touched — because GitHub's own mergeability signal is a single boolean and cannot name files. A worktree already mid-merge or mid-rebase skips the probe, and a failed probe reports its reason rather than being flattened into "this branch is fine". `useWorkspaceConflicts` feeds three readers: the PR header resolves to `pr-blocked` with a `Merge conflicts` label and the overflow menu swaps `Merge` for `Resolve conflicts`, the Checks panel grows a `Conflicts` section, and the Changes list marks conflicting paths `conflicted` and splits the flat view into Conflicts then Clean.

- **Markdown Preview Toggle in the File Preview** (`a3222a3`, #217): A `.md` file can toggle between its raw source and a formatted preview rendered through `MessageResponse`, persisted app-wide via `filePreviewMarkdownPreviewAtom`. The toggle and the word-wrap control are mutually exclusive, and both hide behind an image preview. The panel's header actions and body split into `file-preview-actions.tsx`, `file-preview-body.tsx`, and shared `file-preview-helpers.ts`.

- **One Code Surface Behind the File and Diff Viewers** (`d2cacbb`, #211; `cbed051`, #212): The file preview, turn diff, workspace file diff, and tool diff previews now render through the same chrome, split into panel, lines, header, hunk-gap, and style parts. Adds a shared file-path label, an "open in" menu for the toolbar and file rows, a gutter-width helper, and per-file viewed marks backed by workspace-git status. Gutter width stops over-counting a hunk's last line and the `+`/`−` counts read from the diff palette rather than the status one. The surface's runtime gutter measurements and container width are named in `@theme inline` as `code-gutter`, `code-gutter-indent`, and `container-inline`, with the CSS-counter line number registered as a `code-line-counter` utility, so nothing on that surface is spent as a Tailwind arbitrary value.

- **One Ephemeral Preview Tab for Files, Diffs, and Comments** (`552f6a9`, #207; `6771607`, #208): Opening a file, diff, or PR comment lands in a single ephemeral preview slot per workspace instead of appending a tab every time, so browsing a change set no longer floods the strip. The next preview open retargets that same tab in place — same id, same strip position — until the user pins it by double-clicking the tab or the row, or by dragging the tab. PR comment rows carry the pin flag through the opener context, the Checks panel callback, and `PullRequestCommentRow`, so double-clicking a comment pins it rather than re-previewing it into the same slot.

- **Readable Pull-Request Comments** (`df016b8`, #209): Comment bodies arrive wrapped in machine metadata — Vercel packs a base64 state blob into a link-reference definition, and most bots open with an HTML comment marker — so a row showing the body's first line showed the encoding rather than the prose. Comment summaries now carry the whole thread: the stripped body, the diff anchor, the timestamp, and every reply, with the row deriving its label from the cleaned text.

- **Image Preview for Changed Images** (`377b46c`, #205): Git renders a changed image as "Binary files differ", so the Changes panel's diff view showed nothing useful. A row — or its right-click View item — now opens the image preview when the workspace still holds the file, and falls back to the diff otherwise. Only scopes whose new side is the working tree qualify, since a commit's image is a historical blob the preview cannot read from disk.

- **Preview Deployment Link in the Sidebar** (`6ff6a98`, #196; `b6f148e`, #197): The sidebar preview button opens the deployed site rather than a provider dashboard, and appears when a deployment exists. Ranking moved out of `pull-request-model.ts` into a dedicated preview-deployment module that adds provider bot PR comments as a third source after deployment statuses and check links. Both header pills build their classes from the same `PullRequestHeaderTone` so they read as one control group; a failed deployment still overrides that tone, since GitHub reports deployments separately from check runs and the header can otherwise stay green while the preview URL points at a broken build.

- **Continue a Workspace Past Its Merged Pull Request** (`6744ef2`, #198): A "Continue" action on the merged-PR header branches the workspace onto a `.v<n>` successor and checks it out, so work carries on in the same workspace without the merged pull request trailing along. The successor forks from the base branch when the workspace's committed tree already matches it, so the review panel opens empty instead of re-listing squash-merged work.

- **Plan Mode** (`c44bd8f`, #184; `4773a7d`, #191): A per-chat Plan Mode toggle (⌥⇧P) holds an agent to planning until the user approves what it proposes. Enforcement is layered rather than advisory: the shipped Pi extension intercepts `bash`, `edit`, and `write` through the `tool_call` hook and asks the app per call, failing closed when the control channel is unreachable, and the app answers from a single classifier in `src/shared/plan-mode/`. A spawned child inherits its parent's Plan Mode, so a planning orchestrator can fan out read-only investigators, and a role-aware policy decides which control ops each half may reach — an orchestrator may delegate, a sub-agent may not delegate onward, submit a plan, or question the user, because all three belong to the orchestrator blocked waiting on its report.

- **Sub-Agent Control Surface Narrowed by Durable Role** (`bebf10e`, #192): Sub-agent restriction previously lived almost entirely in Plan Mode; outside it, only `setBranchName` consulted the caller's role and everything else was stopped by the spawn guardrail noticing `depth >= 1`. That counter lives in an in-memory registry, so a session resumed after a restart came back at depth 0 with the spawn tools restored while `notifyOrchestrator` — its one escape hatch — broke on the same missing state. Role is now durable and the surface is narrowed from it.

- **Transcript Audit, Recovered Reports, and Cascading Stops** (`e1fb889`, #179; `7839987`, #194): `ensemblr_get_last_message` answers what a delegated child concluded and `ensemblr_read_conversation` answers what it actually did, so an orchestrator can confirm a unit of work ran what it claims to have run before building on it. The projector merges Pi's two persistences of every tool invocation on `toolCallId`, so a call renders once at its call site even when its result lands many ordinals later, and skips the streaming deltas the closing composite message already carries; reads page. A child's final assistant answer is retrievable once the child closes or the app restarts, parsed from the real `PiPersistedEnvelope` union rather than a stale shape that never matched a persisted event.

- **Harness Playbook** (`e36b3f1`, #188): Harnesses launch as root sessions and were served the orchestrator playbook, which describes a chat tab they do not own. `HARNESS_AWARENESS` is a shorter variant naming only the tools the MCP endpoint serves, and `ensemblr_set_name` is dropped from that surface and refused for a harness origin — a harness tab is a terminal titled from its own session log, so there is nothing to rename. See [`docs/harnesses.md`](docs/harnesses.md).

- **Timeline Rebuilt Around Tool Presentation Descriptors** (`b87280b`, #186; `5e1e175`, #187): The chat timeline renders tool activity from presentation descriptors rather than per-tool special cases, and bash rows are titled by the action they perform. A prompt written to the Pi child but not yet echoed back was only recovered on abort, so a crash or an app quit dropped it from the transcript with no error; every terminal reason now settles the queue, and echoes are matched by identity rather than queue position so a steer echo cannot retire an unrelated prompt. Skill invocations collapse: Pi expands `/skill:name` into a full `<skill>` block containing the whole `SKILL.md`, which buried the chat when rendered verbatim, so the block is lifted out into a one-line activation row and the prompt bubble is rewritten back to the command the user typed — parsed in one shared module so the main-process echo matcher and the renderer cannot drift. Session naming was rebuilt on the same pass.

- **Tab Strip Navigation** (`f57d933`, #189; `39063d8`, #190): Both tab strips clipped their overflow with no way back to the active tab. A `TabScroller` primitive reveals whichever tab is active, realigns it when a resize or tab-count change reflows the strip under it, and overlays an auto-hiding scrollbar that costs the strip no layout height; closing a tab lands on the last visited one. Tabs opened from inside a conversation — file, diff, comment, terminal, review actions — now land directly beside the tab they came from, threading an `insertAfterChatTabId` anchor through the IPC contract down to SQLite, while the strip's own new-tab button keeps appending.

- **Ensemblr Control — Agent → App Control Layer** (`2d6503f`, #166): Agents running inside a workspace can now drive Ensemblr itself through permission-gated `ensemblr_*` tools — spawn/steer/close conversations, launch harnesses, run terminals, open file/diff/comment tabs, focus panels, and move the workspace board. Pi reaches a loopback HTTP control server via a shipped extension (`POST /invoke`); MCP-client harnesses (Claude Code, Codex) via an embedded MCP endpoint (`POST /mcp`). One service enforces a per-workspace bearer token, own-workspace write scope, the workspace permission mode, and fork-bomb guardrails (spawn depth 1, 20/session, 10/min, 5-min wait), delegating to existing services — no new capability code. See [ADR 0040](docs/adr/0040-use-loopback-control-server-for-agent-app-control.md) and [`docs/agent-control.md`](docs/agent-control.md).

- **Multi-Agent Orchestration** (`fd71174`, #168): Role-aware guidance teaches a root orchestrator to *delegate → wait → evaluate → integrate* — spawn sub-agents, block on `ensemblr_wait_for_agents`, then integrate results — while a spawned sub-agent does its one unit of work and never fans out. The two role playbooks (`ORCHESTRATOR_AWARENESS` / `SUBAGENT_AWARENESS`) live in `src/shared/agent-control/awareness.ts` and are injected into every agent (Pi via the extension, harnesses via MCP `instructions`). See [`docs/considerations/agent-orchestration-playbook.md`](docs/considerations/agent-orchestration-playbook.md).

- **Sub-Agent Naming & Live Status Sync** (`d4a4855`, #169): Sub-agents name their own tabs, and their live status syncs into the dock and session-tab UI.

- **Multi-Harness Support — Claude Code, Codex, Vibe** (`ab8304e`, #152; `d9acabd`, #153): Launch third-party coding-agent CLIs in workspace terminal tabs with baked-in auto-approve flags, exact-conversation resume from each tool's on-disk session logs, busy-state detection, and conversation-title extraction. The renderer sends only a harness id, never free-text shell. See [`docs/harnesses.md`](docs/harnesses.md).

- **Resumable Agent Sessions & Session Tabs** (`611525c`, #149; `2cd2140`, #154; `f88554c`, #162): Agent sessions resume across restart, session naming is consolidated and stopped chat tabs are preserved, and session-tab keyboard shortcuts move between tabs.

- **Dock Terminal Session Restoration** (`923b86f`, #155; `432c0f0`, #165): Dock terminals (setup/run/spawn and agent terminals) restore across app restart with clean scrollback.

- **Rich Diff Viewer with Inline Review Comments** (`fc7c610`, #151): The Changes tab renders a rich diff viewer with review comments anchored inline to specific lines.

- **Pull Request Check Status List** (`daae03b`, #137): The pull-request panel shows a per-check CI status list.

- **Settings Persistence & Live Config Reload** (`890beb3`, #145; `a512e95`, #147): App and repository settings are wired to `~/.config/ensemblr/config.json` and apply on a live config reload with no restart; the per-chat model is preserved and deferred Help/nav rows were removed.

- **macOS Code Signing & Notarization** (`289946d`, #148): `npm run make` produces a signed, hardened-runtime, notarized `.dmg` (stapled via the postMake hook) plus a `.zip` when Apple App Store Connect credentials are present; `ENSEMBLR_SKIP_SIGN` opts out, and channel builds (`make:canary` / `make:dev`) get their own bundle identity. See [`docs/build-and-release.md`](docs/build-and-release.md).

- **Runtime-Aware Workspace Setup State** (`3f2f69b`, #135): Workspace setup state reflects the resolved agent runtime.

- **Dashboard Workspace Board** (`c73ced6`, #125; `eee3e6f`, #128; `2f4aeb7`, #130): The Dashboard route now shows a draggable workspace board with Backlog, In progress, In review, Done, and Canceled columns, persisted local board status/order, workspace card action menus, and fixed drop targets. The board stays reachable when setup is blocked, the sidebar is collapsed, or no workspaces remain.

- **Bundled Terminal Font** (`d2220aa`, #122): JetBrains Mono Nerd Font assets are bundled under `src/renderer/styles/fonts/` and wired into terminal/code typography so first launch has stable monospace rendering before user font customization.

- **Clickable File & Directory References in Assistant Messages** (`c94b502`, #100): Inline-code in assistant markdown that resolves to a workspace path now renders as an attachment chip instead of a plain `code` span. File chips open a file-preview tab; directory chips switch to the All files tab and expand/reveal that folder in the tree:
  - Path classification is isolated in `src/renderer/lib/pi/inline-attachment.ts` — an extension/filename allowlist gated by a safe-path pattern, excluding library display names (`node.js`, `next.js`, …) so prose does not render dead chips
  - `MessageInlineCode` (in `message.tsx`) wires the classifier into Streamdown's inline-code renderer; chips use per-extension icons via `@iconify/react` (`getWorkspaceFileIconName`) instead of generic file/folder glyphs
  - File-vs-directory is resolved through a new `WorkspacePathKindResolver` context; directory reveals flow through the transient `workspaceDirectoryRevealRequestAtom` and a new `expandDirectories` writer on `useFileTreeExpansion`; `toWorkspaceLookupPath` canonicalizes paths so chip lookups and tree keys compare equal
  - New tests: `tests/renderer/message-attachment-chips.test.tsx`, `tests/renderer/chat-directory-attachments.test.tsx`, `tests/renderer/all-files-directory-reveal.test.tsx`

- **Pasted Image Attachments** (`1cbf07c`, #99): The chat composer now accepts pasted images and resolves workspace file payloads so they render as attachment chips and `@`-mention payloads:
  - New workspace-files payload resolution reads file bytes/metadata over a dedicated IPC channel (`src/main/workspace-files/list-workspace-files.ts`, `src/shared/ipc/contracts/workspace-files.ts`)
  - Composer state tracks attachments (`use-composer-state.ts`), with pure attachment/mention helpers in `src/renderer/lib/workbench/composer-attachments.ts` and `mention-payload.ts` plus per-extension `file-icons.ts`
  - New tests: `tests/renderer/composer-attachments.test.ts`, `tests/renderer/mention-payload.test.ts`, and expanded `tests/main/list-workspace-files.test.ts`

- **Social Avatar Generator** (`e502d2c`, #92): `npm run avatar:generate` (`scripts/generate-avatar.mjs`) renders a borderless 512×512 avatar (gitignored `assets/avatar.png`). The dot-matrix "E" glyph shrank 20% (CELL 88 → 70.4) with a proportional chromatic-split offset, and shared icon geometry/colors/rasterization were extracted into `scripts/icon-art.mjs` and `scripts/icon-colors.mjs` so the app icon and avatar share one `renderMaster` source.

- **Appearance Settings Wired to `config.json`**: The Settings → Appearance page is now fully functional and persisted in `~/.config/ensemblr/config.json` under `app.appearance` (source of truth; see ADR 0029). All eight prefs apply live:
  - Theme, accessible-color variants (Okabe-Ito palettes for protanopia/deuteranopia/tritanopia), and code ligatures toggle document-root classes; the mono font drives the `--ensemblr-font-mono` CSS variable so every `font-mono` surface re-fonts instantly (`src/renderer/state/preferences/use-appearance-effect.ts`)
  - Code theme now flows through the Shiki (`code-block.tsx`) and Streamdown (`message.tsx`) renderers — previously hardcoded to GitHub themes; the picked theme loads on demand and feeds both light/dark slots
  - Terminal font and size live-apply to open xterm surfaces without re-mounting the PTY (`xterm-terminal.tsx` + adapter `setFont`); the shared fallback stack is exported once as `DEFAULT_FONT_FAMILY`
  - Markdown style adds a `prose` preset via `@tailwindcss/typography`; sidebar diff stats render with active-row-aware tokens (`diff-stats.tsx`)
  - One-time migration of the legacy `ensemblr_pref_*` `localStorage` values into `config.json` on first launch (legacy `one-dark` → `one-dark-pro`), removing legacy keys only after a successful write (`use-appearance-migration.ts`)
  - New tests: `tests/renderer/use-appearance-effect.test.tsx`, `tests/renderer/use-appearance-migration.test.tsx`, `tests/renderer/workspace-diff-stats.test.tsx`

- **Run Script Hotkey** (`run.start`): ⌘/Ctrl+R now toggles the active workspace's run script from anywhere in the workbench — starts it when stopped, stops it while running, and no-ops when no run script is configured:
  - The View → Reload menu item is now accelerator-less so ⌘R reaches the renderer; Force Reload (⌘⇧R) remains the keyboard path to a full reload (`src/main/menu/application-menu.ts`)
  - Registered as the `run.start` shortcut in `src/shared/keymap/shortcuts.ts`; the toggle logic lives in the `useRunScriptHotkey` hook and is captured even while a text field or terminal has focus (so ⌘R never falls through to a native reload)
  - The Run dock empty state surfaces the ⌘R hint on its "Start Run" action
  - New test: `tests/renderer/use-run-script-hotkey.test.tsx`

- **Ask Agent to Create Setup Script**: The Setup dock tab's "no setup script configured" empty state now offers two actions instead of one:
  - "Ask agent" opens a fresh chat and seeds — never auto-submits — a prompt directing the agent to inspect the project and author the repository's `.ensemblr/settings.toml` `[scripts]` block (`src/renderer/hooks/workbench-shell/composer/use-ask-agent-setup-script.ts`)
  - "Add manually" opens the repository's Scripts settings as before
  - Dock empty states split into dedicated components (`setup-missing-empty-state`, `setup-not-run-empty-state`, `run-stopped-empty-state`)
  - New test: `tests/renderer/use-ask-agent-setup-script.test.tsx`

- **Git Settings UI** (`d61d93e`): New Settings → Git page with user-scope git defaults stored in `~/.config/ensemblr/config.json` under `app.git`. Settings include:
  - `branchPrefixSource`: `'github-username'` | `'custom'` | `'none'` - Source for branch name prefix
  - `branchPrefixCustom`: Custom prefix string when source is `'custom'`
  - `renameWorkspaceOnBranch`: Auto-rename workspace from LLM-generated branch name (enabled by default)
  - `deleteLocalBranchOnArchive`: Delete local branch when workspace is archived (disabled by default)
  - `archiveAfterMerge`: Auto-archive workspace after PR merge (disabled by default)
  - `setUpstreamOnPush`: Set upstream on first push (enabled by default)

- **Auto Branch Naming** (`d61d93e`): Automatic branch name generation from first Pi message in placeholder workspaces. Uses Pi CLI RPC mode with `--mode rpc` to generate a descriptive branch name, then:
  - Sanitizes to kebab-case
  - Truncates to 40 characters (word boundary)
  - Prefixes with user-specified or GitHub username prefix
  - Renames both workspace and git branch atomically
  - 20-second timeout for LLM generation

- **File Tree View** (`d2158d5`): All files panel now renders as a collapsible folder tree with:
  - Virtualized rendering via `@tanstack/react-virtual` (28px row height, 12-row overscan)
  - Collapsible directories (start collapsed by default)
  - Live filesystem watch with 250ms debounce
  - Polling fallback (30s interval) for platforms without recursive watch support
  - Ignored directory exclusion (`.git`, `node_modules`, `.DS_Store`)
  - Persistent expansion state with stale path pruning

- **Lazy Live Tree for Ignored Directories** (`6ef81a7`): Git-ignored directories are collapsed in the initial tree view and lazy-loaded on demand:
  - Cap of 1000 entries per ignored directory
  - Single IPC call per directory expansion via `readWorkspaceDirectory`
  - Point-in-time snapshot (not live-refreshed after initial load)
  - Deduplication against base file list
  - Used for `.context/` (generator scaffold output) and `.vite/` (Vite dev server cache)

- **Gitignore Updates** (`6ef81a7`): Added the following to `.gitignore`:
  - `.context/` - Generator output directory for official scaffolding (per AGENTS.md policy)
  - `.vite/` - Vite dev server cache and build artifacts

- **Wordmark Animation** (`957a71d`): Glitch burst effect now fires immediately on `WelcomeWordmark` component mount (line 155 in `welcome-wordmark.tsx`), eliminating the static "dead" period on welcome screen load. The periodic glitch pattern (9-17s interval) continues thereafter unchanged.

- **Context-Aware Close Action** (`695de4f`): ⌘/Ctrl+W close action is now context-aware:
  - In workspace view: Closes the active tab with smart behavior (close if multiple tabs, reset sole chat tab to fresh state, no-op for empty sole tab)
  - In Settings: Returns to the screen Settings was opened from (tracked via `settingsReturnToAtom`)
  - On other screens: Falls back to closing the BrowserWindow
  - Centralized via `CloseActionProvider` with a stack-based registration system
  - New IPC channels: `closeActiveTab` and `closeWindow`
  - New test: `tests/renderer/session-tab-close.test.ts`

- **Clone GitHub Repo Search** (`70f86b2`): The clone-GitHub dialog's URL field is now a search combobox over the full accessible repo set:
  - Type to search every accessible repository, not just the recent list; arrow/Enter to confirm a match, or paste a URL directly
  - Full repo set is fetched lazily in the background, paginated and deduped via a new `recent | full` scope on the `gh` repository-list IPC (`src/main/repository/list-github-repositories.ts`, `src/main/ipc/request-schemas.ts`)
  - Pure, tested search/rank helpers in `src/renderer/lib/welcome/github-repo-search.ts`; search + keymap logic extracted into the `useCloneRepoSearch` hook (`src/renderer/hooks/welcome/use-clone-repo-search.ts`)
  - "Searching all repositories…" hint stays visible on empty results; the clone action is gated on URL-like input so a bare search term cannot start a doomed clone
  - New tests: `tests/renderer/github-repo-search.test.ts`, `tests/renderer/clone-github-recent-repos.test.tsx`, `tests/renderer/dom/clone-github-dialog.test.tsx`, `tests/main/list-github-repositories.test.ts`

### Changed

- **Settings Screens Restructured, Diagnostics Localized** (`b68621e`, #248): The catch-all Advanced page is gone and its rows moved where they belong — the Ensemblr root directory to General, the terminal scrollback limit to Appearance, the Pi executable override into the Providers tab that already owns per-runtime executables. Two pages are new: a read-only **Shortcuts** reference, and a per-repository **Security** page persisting a workspace permission mode under the resolver's `security.permissionMode` key. Developer mode joins the experimental defaults. Shared settings primitives come out of the routes that had grown their own (`settings-async-state`, `settings-code-value`, `agent-provider-brand`), and the active repository a settings visit lands on persists through `settings-ui` atoms. Diagnostics, provider readiness checks, and the Shortcuts reference had rendered English-only because their prose was composed in the main process or lived as literals in the shared keymap; main now sends a catalogue code plus interpolation values and the renderer owns the wording. `ShortcutDef` carries bindings only — shortcut names live in the renderer catalogues, keyed by shortcut id.

- **Dark and Light Palettes Retuned** (`2b55290`, #263): Both cuts of the `--ensemblr-*` palette move. Dark lifts off near-black (canvas `0.135` → `0.21`) so the app floor reads as charcoal rather than a void, and light darkens its cool cast so a white card still reads as paper against it. The terminal component moves off hardcoded `zinc-*` classes onto the semantic tokens `.terminal-surface` already re-points. WCAG AA is held as the surfaces move: `--ensemblr-code` recesses to `0.222` rather than landing on `--ensemblr-surface` (which had left a dark code block with no separation from the card under it), the dark status cuts rise with the surfaces beneath them (warning 4.25 → 4.54, danger 3.68 → 4.53, ok 4.55 → 4.72), `--ensemblr-muted-ink` is set by `--ensemblr-pane-strong` rather than the canvas because that token doubles as shadcn's `--accent` (dark 4.25 → 4.67, light 4.08 → 4.59), and the accent is set by its own badge tint (dark 3.87 → 4.55, light 4.09 → 4.51). The colorblind `.dark.a11y-*` blocks track the base dark cuts. **Still open:** light-mode status badges miss AA on their own fill (ok 3.45, warning 3.11, danger 4.27) — unchanged by this pass, and fixing it needs a `--ensemblr-status-*-foreground` companion cut per status.

- **Composer Chrome and Markdown Previews** (`4e17e97`, #259): The plan-mode and thinking chips collapse to icon-only when they carry no label, every composer popover gets the same scrollbar gutter, and the control rows pull out to the card's optical edge so their ink lines up with the message text above. The ready placeholder no longer interpolates the chat's own title — it is keyed off what the chat is: a first message, a follow-up, or a plan. A `.md` file's formatted preview and a pull-request comment preview now share one reading column stated in `document-column.ts` — the conversation timeline's own measure — so a document reads the same whether an agent wrote it into the chat or it is being previewed off disk. The prose rules those previews inherit get the same pass: unbreakable tokens wrap instead of pushing a scrollbar onto the surface (tables excepted, they carry their own scroll frame), nested lists change marker per level, a list hugs the paragraph introducing it, and task-list items drop the bullet the checkbox already replaces.

- **Slash Catalogue Cached and Ranked by Use** (`d28e249`, #241): Opening the slash menu meant waiting on a child process — discovery spawns a real `claude` for the Claude runtime, and the in-memory query cache dies with the window, so every launch reopened the menu onto a loading state. Each runtime's catalogue now persists to `localStorage` behind a versioned, byte-budgeted LRU envelope and seeds the query, reporting its real fetch time through `initialDataUpdatedAt` — which is what stops a warm workspace from spawning a probe on every launch, since a cache younger than `staleTime` fetches nothing at all. A runtime answering with zero commands clears its entry rather than letting a stale copy resurrect deleted skills. Matches rank by pick history as well as match quality: `fuzzyMatch` reports its tier alongside the score and the matched spans, and the comparator orders tier before history, so a constantly-used command can lead its tier but never lift a weak subsequence hit above a real prefix match. History decays on read with a 30-day half-life.

- **Skill Rows Named, Control-Tool Files Pinned as Chips** (`a49d627`, #245): Both runtimes render a skill activation as `Skill: <name>`. Claude Code reports it as a `skill` tool call whose wire name never varies, so three skills in a turn read as three identical rows unless the row reads the name out of the arguments; Pi's `presentSkillInvocation` drops its "Skill activated" preview to match. Control tools gain `pathKeys`, so a call naming a workspace file pins the same clickable chip a `write` or `edit` row carries instead of spending its title on the path. The argument walker takes a `*` segment to reach every element of a batched array, and a batched path earns a chip only when every item names the same file — one `ensemblr_add_diff_comments` call can span as many files as the reviewer touched, and pinning the first would label the row with a file most of its body is not about.

- **Plan Review Bar Is Now the Composer's Header** (`d87062e`, #218; `960075e`, #221): The plan-review decision bar moved inside the composer card instead of floating above the footer, divided from the textarea by a hairline so it reads as the top of the composer rather than a separate panel. Its title went with it — the bar sits directly under the plan message, so the title only restated the plan's own heading while squeezing the composer, and the bar now carries the three ways forward and nothing else. A composer playground scene drives the shipped `ComposerPanel` so the bar can be judged as the composer's top edge.

- **Pull-Request Header Held to One Control Height** (`e8b2fe2`, #215; `960075e`, #221): The header split from one component into `header-action-buttons`, `merged-header-actions`, and `pull-request-menu`, its state table re-ordered so local work the remote does not have outranks any checks verdict against an unpublished tree, and every control held to a uniform 1.75rem. Agent activity is an overlay on that table rather than a row in it: the header keeps its kind, label, and tone but freezes every trailing action behind a spinner. A real Vercel preview arrives labelled with its project name, which crowded the pills out of a sidebar at its 22rem minimum, so the header's pill row is now the `pr-header` query container and the preview pill drops its text label to the provider mark below 20rem, moving the label to the hover title — only pills with a provider mark to fall back on collapse.

- **Workbench Error and Empty States** (`5661b83`, #180; `a644a77`, #183): Ad-hoc inline banners across the review and checks panels were replaced with reusable `PanelPlaceholder` (centered, muted/danger tones) and `PanelAlert` (inline) components. The workspace git-failure channel is typed as `WorkspaceGitFailure { code, message }` so the UI renders human-readable copy keyed on the failure code with git's raw text demoted to a mono detail line, and the main process now prefers git's stderr and decodes bare exit codes over the generic spawn message. Long branch names and absolute paths no longer blow out the archive and delete dialogs — the `DialogContent` grid column is constrained and identity and diagnostic values wrap rather than truncate, with the shared identity card (`LifecycleSummary`) and cleanup row (`CleanupToggle`) extracted and semantic `DialogDescription`/`DialogFooter` adopted for correct aria wiring.

- **Complexity and Duplication Cleared Codebase-Wide** (`0f5f4b1`, #214; `9b1766d`, #232): fallow was run across the whole codebase and what it surfaced was resolved. Duplication went from 13 clone groups (414 lines) to zero — `withTemporaryIndex`/`writeWorkingTree` in git-checkpoint, `parseBodiedNodes` in pr-snapshot, `patchAdoptionMetadata`, `toLifecycleTargets`, `readStringColumns`/`readNullableString`, `parseNumberedRows`, and shared `DialogDiagnosticsList`/`DialogActionFooter`/`validateEntityName` for the quick-start and rename dialogs. Complexity went from 31 findings to zero across two passes: `classifyStderr` became table-driven, the agent-control dispatch switch became a `Record<AgentControlOp, OpHandler>` lookup that makes op coverage a compile-time check, `assembleEnvironment` was layered into `environment-assembly.ts`, and 14 more over-threshold functions were split — most of them hook-density rather than branching, so related hooks were grouped into named model and controller hooks (`useSessionTabState` 971 → 281 LOC, `useComposerState` 751 → 209, `useAgentComposerController` 426 → 147).

- **Module, Type, and Documentation Organization Aligned to the AGENTS Rules** (`c9df7a7`, #181; `1309cf1`, #174): `request-schemas.ts` had grown to 1069 lines holding every IPC payload validator in the app, well past the 800-line ceiling, and was split per concern; `scripts/` had been treated as outside the JSDoc policy and now carries it uniformly. The mandated concern barrels, runtime-loaded Pi extensions, and the generated `routeTree.gen.ts` are registered as fallow entries or ignored exports, and the genuinely-unused exports this surfaced were deleted or privatized so fallow dead-code reports zero issues.

- **react-doctor at 100/100** (`b7cf808`, #185; `74c11f6`, #204; `3c3bc6f`, #173; `3c096ce`, #235): The reconcile and re-seed effects in reorder-list, session-tabs, and `use-debounced-setting-field` became render-phase state adjustment, removing the you-might-not-need-an-effect diagnostics and the stale-order flash; the composer primed-action drain was extracted into `useComposerPrimedActionConsumer`. Gitignored build output (`.vite`, `out`, `dist`, `coverage`, `.context`) is excluded from the scan — all ten insecure-crypto-risk hits were minified vendor bundles there. Three `async-defer-await` overrides are documented in `doctor.config.jsonc` where the deferred await is deliberate, including the context-usage probe whose `if (closed)` guard exists precisely to observe whether the session shut down while the control request was in flight.

- **`shadcn` 3 → 4, Moved To `devDependencies`**: `src/renderer/styles/index.css` imports `shadcn/tailwind.css`, so the package is a build-time asset, not a runtime dependency — Vite inlines the CSS and `electron-forge` now prunes the CLI out of the packaged app. The v3 line also pulled in `node-fetch@3` → `fetch-blob` → the deprecated `node-domexception`, plus `msw` (an otherwise-unused optional peer of `@vitest/mocker`), which tripped npm's deprecation and `allow-scripts` warnings on every install; v4 drops both (it uses `undici`). `dist/tailwind.css` is a strict superset of v3's — 0 removed lines.

- **Workspace Services & Renderer State Refinements** (`455536e`, #143; `3f75d47`, #140; `7725421`, #138): Refined workspace services and renderer state handling, removed inactive-workspace dead ends and stabilized tabs, and persisted action prompts while preserving the app-detection cache.

- **Pull Request Editing** (`dfebc6b`, #139): Improved pull-request editing and collapsed-header actions.

- **Shared Renderer Components** (`8860cbe`, #146): Extracted a shared `OpenInTargetsSubmenu` and `PanelMessage` from duplicated renderer code.

- **Workspace Process Environment** (`4695229`, #120; `b9bdd09`, #121): Setup/run scripts and terminal sessions now inherit the user's shell-derived environment and workspace toolchain `PATH`, then merge workspace environment overlays and `ENSEMBLR_*` variables while keeping macOS launch-context variables stripped.

- **Setup Scripts Resolved from Workspace Settings** (`1de8f4f`, #97): Setup and Run scripts now resolve from the workspace's own resolved settings rather than repository-only config, so per-workspace `.ensemblr/settings.toml` `[scripts]` overrides take effect (`src/main/scripts/script-lifecycle-service.ts`, `src/renderer/hooks/use-scripts-settings-form.ts`). Live-workspace file watching and query keys were reworked to key off the workspace model.

- **Package Manager → npm**: Migrated JavaScript/TypeScript package management from Bun to npm. `npm install` now manages dependencies against a `package-lock.json` lockfile (Bun and `bun.lock` are retired). Details:
  - Guardrail hooks (`.claude/hooks/enforce-npm.sh`, `.codex/hooks/enforce-npm-package-manager.sh`) now block direct `bun`, `bunx`, `pnpm`, `pnpx`, `yarn`, `yarnpkg`, and matching `corepack` calls
  - Scripts run through npm (`npm run check`, `npm run typecheck`, `npm run dev`, `npm run package`, `npm run make`)
  - Vitest stays the test runner, now invoked via `npx vitest run` (`npm run test` / `npm run test:coverage`); main-process suites remain on `electron --test`
  - Dev tooling scripts ported off Bun runtime APIs (`Bun.spawn` → `node:child_process`), runnable via `npx tsx scripts/<name>.ts`
  - `@types/node` pinned to `^24` to match the pinned Node 24 runtime (`.nvmrc` / `mise.toml` / `engines`); `npm run typecheck` now also type-checks dev `.ts` scripts via `tsconfig.scripts.json`, which caught a latent `TextDecoder.decode` type error the untyped `tsx` runner would have shipped

- **Wordmark Mount Behavior** (`957a71d`): Changed from `scheduleNextBurst()` to `runBurst()` on component mount, ensuring immediate visual feedback.

- **Repository Resolution Precedence** (`d61d93e`): Added `user-default` source to the config resolution chain, feeding user-scope git defaults (`app.git.*`) into repository settings as the 7th precedence level (before built-in defaults).

- **Setup Diagnostics** (`a7c7b56`): Reworked panel with per-check remediation actions. Remediation documentation links now open in the default browser through a new `openExternal` IPC channel with URL validation (http/https schemes only).

- **Documentation** (`dd2baf4`): Corrected overstated rule-suppression rationale in doctor-config documentation.

- **Test Runner → Vitest**: Renderer (`tests/renderer/**`) and shared (`tests/shared/**`) suites migrated off `bun test` onto Vitest, run with `npx vitest run` under npm (see the Package Manager → npm entry above). Details:
  - Config in `vitest.config.mts`; default `environment` is `node` so pure-logic tests keep the real `navigator`/`process`, and DOM component tests opt into happy-dom per file via a `// @vitest-environment happy-dom` docblock
  - Scoped DOM harness `tests/renderer/support/dom.tsx` (`renderWithProviders` + `window.ensemblr` stubs); jest-dom matchers registered in `tests/renderer/support/vitest.setup.ts`
  - Coverage is native Istanbul (`npx vitest run --coverage`, provider `@vitest/coverage-istanbul`) emitting `coverage/coverage-final.json`, read directly by `fallow audit`
  - New aggregate scripts: `test` (`npx vitest run`) and `test:coverage`; mocks use `vi.fn()`/`vi.spyOn()`/`vi.mock()`
  - Removed the global happy-dom registrator (`tests/renderer/support/register-dom.ts`), the lcov→istanbul bridge (`scripts/lcov-to-istanbul.mjs`), and `bunfig.toml`
  - Main-process suites (`tests/main/**`) stay on `electron --test` — they need the Electron runtime

### Fixed

- **Welcome Held When the Last Workspace or Project Goes Away** (`f82c0eb`, #251): Removing the workspace you were in, or archiving the project itself, dropped you into an unrelated project — the launch resolver fell through to the first workspace anywhere, and the archive action explicitly hopped to the first sibling project it could find. A stored selection is now a hard project boundary: when the stored project is gone or has no workspaces left, `resolveWorkspaceNavigationSelection` returns `null` and the index loader leaves Welcome up, with the first-available-anywhere fallback reserved for a launch with nothing stored yet. `useArchiveProjectAction` drops its sibling-project search and navigates with `replace`, so the back button cannot return to a dead workspace URL. Welcome deliberately stays up on later cold launches, because the persisted selection keeps naming the archived project — clearing that key would send the user into an unrelated project instead.

- **Ask-Question Option Descriptions Shown in Full** (`982eae5`, #252): An option's description is where an agent puts the recommendation the choice turns on, and `truncate` clipped every one to a single line. The clamp is gone, and the two things that made it look necessary are bounded instead: the description caps at 400 characters in the shared schema — trimmed rather than rejected, the way the header already is — and the row list scrolls past `max-h-96` so the question above and the footer below stay on screen. Row focus is virtual, so the effect that pulls DOM focus back to the shell now walks the capped list to the focused row itself. The ask-question timeline row also drops its detail key, titling itself "Asking you a question" rather than a sentence cut to a title's length.

- **Dock Empty States Held to the Terminal Palette in Light Mode** (`14ba2f0`, #262): The four dock empty states set `bg-terminal text-terminal-foreground` on their wrapper, which coloured the panel but left every shadcn primitive inside reading the window's palette — in light mode an `outline` Button resolved to a white chip carrying near-white terminal ink, so its label disappeared. `.terminal-surface` re-points the component tokens for its subtree, and `@custom-variant dark` widens to match inside it so a primitive's `dark:` branch fires there; the token list mirrors the `:root` block one for one, because a token left out silently keeps following the window rather than falling back to something neutral. `--destructive` and `--ring` need the dark cut of a two-cut palette token, which is unreachable once a space toggle has collapsed to one value, so those cuts are named `--ensemblr-ring-on-dark` and `--ensemblr-status-danger-on-dark` and read by both the app tokens and the new surface. Contrast against the terminal panel, light/dark before → after: primary chip 1.19/11.97 → 13.62, destructive ink 4.16/6.36 → 6.36 (4.16 was under the 4.5:1 AA floor for its own label), focus ring 5.31/6.90 → 6.90.

- **Composer Drafts Stay in Their Tab** (`4e17e97`, #259): The editor alone carried the per-chat key, so switching chats remounted the editor but left `useComposerState` alive — and it seeds the draft once per mount, which meant tab A's text was seeded back into every chat opened after it. `ComposerPanel` now keys its own body rather than asking the call site to, so the isolation holds for anything reaching the panel through the concern barrel.

- **Timeline No Longer Refolds the Whole Transcript on Every Token** (`bf5a3d6`, #243): Every token of a streaming turn re-mapped the entire event branch into UI messages and handed back fresh objects, so each delta re-rendered every earlier turn — long transcripts blew the frame budget mid-stream and the timeline visibly flickered. `createTimelineProjector` folds only the events that arrived since its last call, keeping a cursor of the exact run it already folded; the resume check compares every reference in the folded prefix rather than sampling its ends, because TanStack Query's structural sharing keeps unchanged rows identical, so a replaced row surfaces as a new object and forces a full refold rather than a stale transcript. The whole-transcript finalize passes run through per-projector `WeakMap` caches so settled rows keep their identity, and `TimelineMessage` is memoized to take advantage of it. Also drops the event-cache invalidation fired on a context-usage broadcast, which both re-mapped the transcript mid-stream and clobbered deltas that landed while the read was in flight. `useWorkbenchLayoutModel` and `useWorkbenchNavigation` now memoize their context values — they built them inline, so any poll or agent broadcast re-rendered the entire shell.

- **Control Tool Calls Named From Either Runtime** (`42507c8`, #242): The two runtimes disagree about what to call the same control tool — Pi loads the extension in-process and reports `ensemblr_set_name`, while Claude Code reaches the control server over MCP, where the SDK namespaces every tool by its server and reports `mcp__ensemblr__ensemblr_set_name`. The timeline matched only the bare form, so every call from the second runtime was titled with its wire name, marked with the generic wrench, and — for the bookkeeping tools — shown at all rather than hidden. `canonicalEnsemblrToolName` resolves both shapes by taking the last `ensemblr_` segment and checking it against the registry, so a tool that merely carries the prefix resolves to nothing rather than borrowing a label; a parity test holds the timeline's labels against `TOOL_DEFS`. Detail keys now use the canonical argument names from `arg-naming.ts` and may step into a batch (`comments.0.filePath`). A failed control call keeps its name in the title, shorn of the MCP namespacing. Two rows that painted nothing also go: a reasoning block whose runtime redacted the prose projects to `null` rather than an inert "Thought" row opening onto an empty body, and a `read` of an image is recognised on both paths rather than rendering a line-numbered body and a "Read N lines" title that would both be fiction. In the same pass, the right-sidebar PR header pills all pull to `/35` border alpha with a `dark:` duplicate each (the pills render as a `variant='outline'` button whose `dark:border-input` outranks an unprefixed border class), and the merged-PR purple moves out of `[data-pr-tone="merged"]` into the theme block — an unresolved custom property makes a colour declaration invalid at computed value time, so `border-color` was falling back to `currentcolor` and painting a bright border rather than none.

- **Claude Reasoning Prose Streams Instead of Empty Thinking Blocks** (`56998df`, #239): Every SDK session is non-interactive, and the CLI forces `display: 'omitted'` on a non-interactive session that names no display mode itself, so thinking blocks reached the timeline as a signature with no prose and the `thinking_delta` frames behind them carried zero characters. Sessions now open with an explicit `{ type: 'adaptive', display: 'summarized' }` thinking config. That option becomes a `--thinking` flag on the CLI's argv and is sticky for the life of the process, so `off` can no longer be expressed by opening the session `disabled` — a chat that opened that way could never turn reasoning back on. `steerClaudeThinking` expresses a level in both directions instead: `applyFlagSettings({ effortLevel })` for how hard to think, `setMaxThinkingTokens` for whether to at all. A chat opened at `off` is switched off right after the open, and the prompt queue gains a `held` mode so the runtime cannot read a first turn before that steer lands.

- **A Chat's First Prompt Echoed Before Its Session Opens** (`84c3523`, #240): A chat's first prompt is submitted before an agent session exists, and opening one costs a runtime spawn — seconds on a cold Claude start. The timeline branched on `agentSessionId` alone, so it rendered the empty state for that whole window and the prompt the user just sent appeared to have gone nowhere. It now branches on a pending optimistic prompt as well, which is safe because a prompt retires against a persisted event: `agentSessionId` is already true for every prompt the flag drops, so the branch never narrows underneath a timeline that still has something to render. `useHasPendingPrompts` derives the per-tab flag through an atom family, so the conversation panel re-renders when it flips rather than on every push and remove in every tab.

- **Claude Tool Results Rendered as Cards, Not JSON** (`3432054`, #233): Claude tool results arrived with the raw content-block array on `output`, which `normalizeToolOutput` rejects, so every result fell through to `JSON.stringify` and each card showed the protocol instead of the output. Results are now wrapped in the `{ content, details }` envelope the Pi runtime already uses, so both runtimes land on one shape. Edits and overwrites project the SDK's `structuredPatch` into a unified patch on `details.patch` so the row renders a diff instead of the prose confirmation the tool writes back to the model, and reads strip the `cat -n` gutter Claude Code bakes into the result so the card's own gutter does not paint a second column of numbers. Details attach only to a lone result, since one message reports one tool's structured output however many results it batches.

- **Spawned Child Pinned to Its Caller's Agent Runtime** (`fbc39a8`, #236): A delegated child could land on the wrong runtime. The spawn path guarded the model choice by comparing "provider" fields, but the codebase spelled two different axes the same way — the *inference vendor* a model is served by (`anthropic`, `openai`, `claude-code`) and the *agent runtime* that drives the chat (`pi` | `claude`) — so a Claude Code orchestrator could spawn children as Pi sessions, and the open request passed no provider at all. The vendor axis is renamed `vendor` and branded as `ModelVendorId` so it can no longer be compared against an `AgentProviderId` without a type error, and the decision moved into one `spawn-model-resolver` beside the model catalog, shared with the renderer's own open request. Resolution order: an explicit `model` is honoured only when it belongs to the caller's runtime and is refused by name otherwise, never substituted; else the caller's own model, live value first and persisted session row second; else the catalog's default for that runtime. A refusal is a modelled `{ ok: false, reason }` outcome that consumes no tab, session, or spawn-guardrail slot. `ensemblr_list_models` is cut to the caller's runtime, and thinking level follows the same rule, so `max` never lands on a Pi chat. A terminal harness has no runtime the app can name and must pass `model` outright.

- **Chat Tab Bound to Its Own Agent Session** (`9d401d1`, #231): A chat tab could end up steering a session it did not own, and one session could end up rendered by two surfaces at once. In main, `bindAgentSession` detaches whichever open tab held the session inside one transaction, `restoreChatTab` comes back detached when another open tab has since claimed it, and `getChatTabByAgentSessionId` prefers the open, newest row — an archived tab keeps its history link either way. In the renderer, everything that identifies a turn (target tab, model, thinking level, Plan Mode) is snapshotted when the user fires it and rides in the mutation variables, so switching tabs while a runtime spawns can no longer re-stamp the request that lands after the await; pending sessions and in-flight turns are keyed by tab and by session instead of living in single slots the whole route shares. The composer auto-submit queue names the tab each chore was queued for, discards chores whose tab closes, and reports whether a chore was accepted. A routed tab the list has not loaded yet resolves to itself with nothing attached and refuses to submit, rather than borrowing a neighbour's session.

- **Branch Naming Gated on the Branch, Not the Workspace Title** (`7a7be33`, #229): Two things kept a branch from ever being named. Claude shipped holding `ensemblr_set_branch_name` but was told to follow a per-turn reminder that never arrived, which the new `resolveTurnPreamble` path fixes. The gate itself keyed off the workspace's display name, so titling a workspace retired the agent's one-shot for a branch nobody had named; `metadata.branchNamed` now records that someone picked the branch's name and `isBranchNameable` falls back to the display-name gate only for rows predating the flag, so a workspace the user has titled keeps that title while its branch still moves. An adopted branch is refused outright, `git.renameWorkspaceOnBranch` still overrides everything, and `userRequested: true` is the escape hatch for the one case the gate cannot see. `RenameWorkspaceResult.changed` distinguishes a real rename from a request whose target state already held, and `joinBranchName`/`composeRenamedBranch` moved to `src/shared/branch-name.ts` so a rename that only changes the display name no longer strips the `prefix/` segment.

- **Slash-Command Menu** (`7a7be33`, #229): A runtime can report the same command many times — Claude Code resolves a skill once per discovery root, so `/code-review` arrived four times — which collided repeats onto one React key and stopped the highlight tracking the pointer. `normalizeSlashCommands` sorts by menu group, then by how much each entry says about itself, and keeps one entry per command name. Three menu bugs went with it: rows claimed the highlight on `mouseenter`, which arrow-key scrolling fires under a resting pointer, and now use `mousemove`; a catalogue refetch could shrink the list under a stored `activeIndex`, stranding the highlight and making Enter a silent no-op, so the index is clamped before stepping and before selecting; and the empty menu read "No matching commands" while discovery was still in flight, and now reads "Loading commands…" until the runtime answers.

- **Git Status Section Kept While Local Work Is Unsent** (`960075e`, #221): A ready-to-merge PR hid the commit action and a merged or closed PR hid the whole section, stranding uncommitted, unpublished, or unpushed work with no way out of the worktree. `resolveGitStatusSection` now decides the section's two actions from the git status as well as the PR state: unsent work keeps the row and its action alive, a clean worktree drops the action, and only a closed or merged PR loses "Update PR".

- **Run Script Editor Reseeding** (`960075e`, #221): The dialog reset its draft in an effect keyed on the open flag and the script, so an abandoned edit could survive into the next open. Draft state now lives in a form component keyed by the script being edited, letting React discard it on switch, with a dedicated key for the add case so a new script cannot inherit a previous edit.

- **Merge-Conflict Probe Skipped for Settled Pull Requests** (`d87062e`, #218): A merged or closed pull request will never be merged again, so running `git merge-tree` against a base that has since moved on produced noise nobody can or needs to resolve. The trial merge is skipped once GitHub reports either state, and any result cached while the PR was still open is dropped.

- **Composer Scrollbar and Image-Read Presentation** (`a3222a3`, #217): The composer textarea gets a sleek scrollbar, and an image read is presented with a plain file badge and an image glyph — the read tool never returns a numbered file body for an image, only a one-line placeholder, so the code presenter had been falling back to a fictional "Read N lines" title.

- **Custom Text Scales Kept Out of tailwind-merge's Colour Group** (`239f507`, #228): tailwind-merge only knows Tailwind's own scale, so the repo's `--text-xxs` and `--text-code-body` fell into the text-colour group and `cn('text-xxs', 'text-status-warning')` dropped the size, leaving labels rendering at whatever they inherited. Both scales are registered through `extendTailwindMerge` so they land in the font-size group.

- **Transcript Stays Still When a Timeline Row Unfolds** (`dd160ce`, #206): Opening a tool row, a settled turn, or a stack trace grew the transcript, which the stick-to-bottom lock read as new output and answered by scrolling to the newest message — sliding the row the user just clicked off the top of the screen. A row now captures its top edge before it toggles and the conversation pins it there.

- **Terminal Links Open in the Default Browser** (`31b2ca2`, #210): xterm's built-in handlers call `window.open()` with no URL, so the window-open guard saw `about:blank`, refused to open it externally, and the click silently did nothing; the OSC 8 path additionally prompted with a native `confirm()` first. Both `WebLinksAddon` regex links and OSC 8 hyperlinks now route through the `openExternal` IPC channel, which validates the protocol against an http/https allowlist before handing the URL to the OS.

- **Duplicate Claude Terminal Tabs After Restart** (`3c3bc6f`, #173): A restart could leave several open terminal tabs bound to one captured session id, each of which would `--resume` and thrash a shared session log. Open tabs after the first sharing an `agentSessionId` are detected and archived so the strip converges to one live tab per conversation. `markTabAsSubAgent` runs after a spawn's session is opened, and a transient storage read error used to propagate and abort the already-started spawn; the tab-tint DB work is now wrapped so a best-effort contract behaves like one.

- **`@electron/node-gyp` Resolved From the npm Registry** (`42e2d8d`, #175): The lockfile pinned `@electron/node-gyp` to a `git+ssh` source, which breaks `npm ci` in sandboxed environments without SSH access. An `overrides` entry pins it to `10.2.0-electron.1` so npm resolves the published registry tarball, and the workspace setup command switched to `npm ci --allow-remote=all`.

- **Workspace Setup Under The Wrong Node**: The `setup`/`run` scripts execute in a non-interactive shell, which never sources the mise/nvm hooks, so `npm ci` ran under Homebrew's Node 26 and died in the `preinstall` guard. Both scripts now go through `scripts/with-pinned-node.sh`, which resolves the `.nvmrc` Node via mise → nvm → `node@24` before handing the command over, and falls through untouched when no version manager exists.

- **App Single-Instance Hardening** (`4dc992a`, #163; `74125bf`, #164): Prevent duplicate app instances during shell-environment loading; harden the single-instance lock and quit on last window.

- **Pi RPC Startup & Workbench Recovery** (`496a6b4`, #160): Harden Pi RPC startup and workbench recovery paths.

- **Startup Model Catalog** (`bd5a85c`, #158): Stabilize the model catalog on startup so the picker stays populated.

- **Workspace Worktree Creation** (`69459c1`, #157; `d989259`, #141): Harden worktree creation and prevent workspace-creation race failures.

- **Exclusive Script Launches** (`4e09b4a`, #156): Serialize exclusive script launches so setup/run cannot overlap.

- **Transcript Picker Summaries** (`661decf`, #159): Fix unavailable summaries in the transcript picker.

- **Install Scripts Audit** (`f84a661`, #161): Audit install scripts and remove desktop activation.

- **PR Action Contrast & Layout Polish** (`7ba8f85`, #142; `034d12b`, #144; `ed3f094`, #136): Improve PR action color contrast, suppress layout animation when removing workspaces, and fix the dock tab close overlay border overlap.

- **Session Tab Interaction Polish** (`4a8801b`, #123; `ae163fe`, #124): Close controls are easier to hit, drag overlays no longer interfere with tab controls, and active session selection stays stable after drag reorder.

- **Workspace Dashboard Edge Cases** (`48e6b2f`, #131; `7da4597`, #132; `ed1461f`, #133): Placeholder workspace names avoid reuse collisions, collapsed sidebar triggers render again, and the Dashboard remains accessible when the last workspace is archived/deleted.

- **Base Branch Synced Before Workspace Creation** (`67cf369`, #98): Remote-backed base branches are fetched and fast-forwarded before a workspace is created, so new workspaces start from the latest `master`/`main` when online. The sync is best-effort, so offline workspace creation still works (`src/main/repository/create-workspace.ts`, `src/main/repository/git-ops.ts`; new `tests/main/create-workspace.test.ts`).

- **Chat Close No Longer Blocked by a Running Session** (`1de8f4f`, #97): Closing a chat tab now stops its running Pi session without blocking the close (`src/main/pi-agent/pi-session-lifecycle.ts`, `src/renderer/state/workspace/close-running-chat-guard.ts`; new `tests/main/pi-session-service.test.ts`).

- **Dependency Bumps** (`ec6c93a`, #167; #195, #199–#203; `3432054`, #233): dompurify 3.4.11 → 3.4.12 → 3.4.13, plus a Dependabot batch — ip-address 10.2.0 → 10.4.0, brace-expansion 5.0.7 → 5.0.9 and 1.1.16 → 1.1.18, fast-uri 3.1.4 → 3.1.5, hono 4.12.31 → 4.13.0, postcss 8.5.16 → 8.5.25, and undici (dev) 7.28.0 → 7.29.0.

- **Dependency Security Patches** (`3a373b3`, #93): Forced patched transitive dependencies via npm `overrides` to clear 10 Dependabot alerts — `linkify-it` 3.0.3 → 5.0.2 (ReDoS), `tar` 6.2.1 → 7.5.19 (path traversal), `tmp` 0.0.33 → 0.2.7 (path traversal). `npm audit` now reports 0 vulnerabilities.

- **Stray Second Dock Instance / Dock Flash** (ADR 0031): The packaged app no longer flashes a second Dock icon — or boots a whole second instance — when a spawned child touches macOS Launch Services (a terminal running `open`, a git/`gh` credential helper, an editor launch, a Pi extension child):
  - New `src/main/environment/launch-env.ts` exports a pure `stripLaunchContextEnv` that removes the macOS/Electron launch markers (`__CFBundleIdentifier`, `XPC_SERVICE_NAME`, `XPC_FLAGS`, `LaunchInstanceID`, `ELECTRON_RUN_AS_NODE`, `ELECTRON_NO_ATTACH_CONSOLE`, `ELECTRON_NO_ASAR`) — and nothing else, so the user's login-shell environment (ADR 0003) is preserved
  - Applied at every child-spawn boundary: once at the shared `createLocalCommandService` base env (covering the login-shell probe and the Pi RPC readiness smoke), explicitly at each direct `process.env` spawn (git checkpoints, clone, git probe, keychain `security`, `pmset`, open-in-editor), and again at the final boundary for the terminal PTY, the generic command spawner, and both the real (`buildSpawnEnv`) and smoke Pi spawns
  - `src/main/main.ts` now holds a single-instance lock (packaged only; dev is excluded because dev builds share one `Ensemblr (DEV)` userData across dogfooding workspaces). A blocked relaunch folds into the running instance via a `second-instance` handler that focuses the existing window; the lock keys on userData so it also catches direct-exec relaunches that bypass Launch Services
  - New test: `tests/main/launch-env.test.ts`

- **Dock Flash on Workspace Creation — Bundle-Identity Collision** (ADR 0032): After the ADR 0031 env-strip closed the child-spawn relaunch path, a stray Dock tile could still flash on new-workspace creation. `lsregister -dump` showed the cause: several packaged bundles (a release-style build, an `Ensemblr-canary.app`, an `Ensemblr-dev.app`, plus a dangling registration whose bundle was deleted) all registered under the one hardcoded `dev.ensemblr.app`. macOS treats those as interchangeable, so resolving the id can relaunch a *sibling* build, which then hits the running instance's single-instance lock and quits — the flash. The lock makes it brief; only a unique identity prevents it.
  - `forge.config.ts` now scopes `appBundleId` **and** product name to a build channel read from `ENSEMBLR_BUILD_CHANNEL` (default `release`): `release` → `dev.ensemblr.app` / `Ensemblr`, `canary` → `dev.ensemblr.app.canary` / `Ensemblr Canary`, `dev` → `dev.ensemblr.app.dev` / `Ensemblr Dev`. `npm run make`/`package` are unchanged (release); dogfood builds use the new `make:canary` / `make:dev` / `package:dev` scripts so they never claim the release identity
  - `src/main/main.ts` no longer clobbers the packaged product name to `'Ensemblr'`; it applies the `(DEV)` suffix only to the unpackaged dev build, so a packaged `canary`/`dev` build keeps its channel name — and thus its own userData and single-instance lock
  - New `scripts/diagnose-dock-flash.mjs` (`npm run diagnose:dock-flash`) lists every `dev.ensemblr.app*` LaunchServices registration, flags id collisions and dangling entries, and with `--fix` unregisters dangling ones (live sibling builds are left alone)

- **Preload Bundle Deprecation Warning**: `vite.preload.config.mts` now suppresses only the `inlineDynamicImports` Rollup deprecation that `@electron-forge/plugin-vite@7.11.2` forces on the single-file preload bundle (the plugin merges config last and `mergeConfig` cannot delete the key it set), while forwarding every other warning. Remove once the plugin migrates off `inlineDynamicImports`.

---

## Versioning Note

Ensemblr follows a pre-1.0 semantic versioning approach where:

- `MAJOR` version (currently 0) remains 0 until stable v1 release
- `MINOR` version increments with significant feature additions
- `PATCH` version increments with bug fixes and small improvements

---

## Commit References

| Commit | Date | Feature |
| -------- | ------ | --------- |
| `5cf92de` | 2026-08-12 | feat(menu): drive the native menu bar from a renderer command bus (#264) |
| `2b55290` | 2026-08-12 | feat(theme): lift dark surfaces off black and sharpen the light palette (#263) |
| `14ba2f0` | 2026-08-12 | fix(workbench): keep dock empty states on the terminal palette in light mode (#262) |
| `cd4ff13` | 2026-08-12 | feat(composer): attach review comments as chips instead of pasted context (#261) |
| `a73d16f` | 2026-08-12 | feat: redesign the prompt queue, make agent-control terminal reads legible (#260) |
| `4e17e97` | 2026-08-12 | feat(composer): visual pass over composer chrome and markdown previews (#259) |
| `0d48d19` | 2026-08-11 | feat(composer): hold follow-ups in a queue the user can see and edit (#258) |
| `36464ec` | 2026-08-11 | feat(composer): put attachment chips inline in the draft (#257) |
| `75da912` | 2026-08-11 | feat(composer): attach files, issues, and directories inline (#256) |
| `41eb972` | 2026-08-11 | feat(unread): track unread chats per tab, not per workspace (#255) |
| `4015695` | 2026-08-11 | feat(workspace-names): add Greek and Cypriot composers to the name pool (#254) |
| `fd97a13` | 2026-08-11 | feat(timeline): nest a subagent's work inside the call that spawned it (#253) |
| `982eae5` | 2026-08-11 | fix(ask-question): show option descriptions in full (#252) |
| `f82c0eb` | 2026-08-11 | fix(navigation): hold Welcome when the last workspace or project goes away (#251) |
| `5ba397f` | 2026-08-09 | feat(i18n): translate every user-facing surface the audit found (#250) |
| `685a438` | 2026-08-09 | feat(i18n): localize the untitled chat tab placeholder (#249) |
| `b68621e` | 2026-08-09 | feat(settings): restructure the settings screens and localize diagnostics (#248) |
| `7ddd7d7` | 2026-08-09 | feat(onboarding): gate first run behind a setup wizard (#247) |
| `e7ab199` | 2026-08-09 | feat(i18n): render the app — and its agents — in English, Russian, and Greek (#246) |
| `a49d627` | 2026-08-08 | feat(timeline): name skill rows and pin control-tool files as chips (#245) |
| `973a3d1` | 2026-08-08 | feat(agent-control): give agents gated Linear reads and writes (#244) |
| `bf5a3d6` | 2026-08-08 | fix: stop the agent timeline refolding the whole transcript on every token (#243) |
| `42507c8` | 2026-08-08 | fix: name control tool calls from either runtime, soften the PR header pills (#242) |
| `d28e249` | 2026-08-08 | feat(composer): cache the slash catalogue and rank the menu by use (#241) |
| `84c3523` | 2026-08-08 | feat(composer): echo a chat's first prompt before its session opens (#240) |
| `56998df` | 2026-08-08 | fix(claude-agent): stream reasoning prose instead of empty thinking blocks (#239) |
| `f45a22b` | 2026-08-08 | docs: audit every documentation surface against the code (#238) |
| `4fbeb65` | 2026-08-08 | feat(claude-agent): persist redacted reasoning and open turns on prompt (#237) |
| `fbc39a8` | 2026-08-08 | fix(agent-control): pin a spawned child to its caller's agent runtime (#236) |
| `3c096ce` | 2026-08-08 | feat(agent-runtime): give the context gauge a window before the first turn ends (#235) |
| `5a00d04` | 2026-08-08 | feat(checks-panel): strike resolved comments through, and bulk-add only unresolved ones (#234) |
| `3432054` | 2026-08-08 | fix(agent-timeline): render Claude tool results as cards, not JSON (#233) |
| `9b1766d` | 2026-08-08 | feat(conversation): show a spawned sub-agent's runtime, pin thinking level to its session (#232) |
| `9d401d1` | 2026-08-07 | fix(chat-tabs): keep a chat tab bound to its own agent session (#231) |
| `dd53296` | 2026-08-07 | fix(agent-runtime): measure Claude context usage from the live thread (#230) |
| `7a7be33` | 2026-08-07 | feat(agent-runtime): gate branch naming on the branch, fix the slash-command menu (#229) |
| `239f507` | 2026-08-07 | feat(agent-runtime): Claude Code slash commands, MCP roster, and model catalogue (#228) |
| `069cd0b` | 2026-08-07 | feat(agent-runtime): add Claude Code as a second first-class agent runtime (#226) |
| `b0eeba5` | 2026-08-06 | Let a workspace take over an existing branch instead of always forking (#225) |
| `27f7b5b` | 2026-08-06 | feat(agent-control): unbounded ask_user_question and canonical arg names (#224) |
| `b1f73fa` | 2026-08-06 | feat(agent-control): let agents start a run script by name (#223) |
| `c7b5387` | 2026-08-05 | feat(settings): add named run scripts for dev, playground, and unsigned (#222) |
| `960075e` | 2026-08-05 | Fit the PR header pills in a narrow sidebar, plus three workbench fixes (#221) |
| `5e28b06` | 2026-08-05 | feat(scripts): support multiple named run scripts per repository (#220) |
| `d87062e` | 2026-08-05 | Render the plan review bar as the composer header (#218) |
| `a3222a3` | 2026-08-05 | Add markdown preview toggle, fix composer scrollbar and image-read presentation (#217) |
| `915f017` | 2026-08-05 | feat(workbench): add a target-branch selector for workspaces (#216) |
| `e8b2fe2` | 2026-08-05 | feat(workbench): surface merge conflicts, hold the PR header to one control height (#215) |
| `0f5f4b1` | 2026-08-04 | refactor: clear fallow duplication and complexity findings codebase-wide (#214) |
| `b704c2d` | 2026-08-04 | Pin Node for workspace setup scripts, refresh shadcn, hit react-doctor 100 (#213) |
| `cbed051` | 2026-08-04 | fix: route code-surface styling through design tokens, pin Node 24 at install (#212) |
| `d2cacbb` | 2026-08-04 | feat: unify the file and diff viewers behind one code surface (#211) |
| `31b2ca2` | 2026-08-04 | fix(terminal): open clicked links in the default browser (#210) |
| `df016b8` | 2026-08-04 | feat: show what a PR comment actually says (#209) |
| `6771607` | 2026-08-04 | fix: keep a PR comment tab open on double click (#208) |
| `552f6a9` | 2026-08-04 | feat: reuse one ephemeral preview tab when browsing files and diffs (#207) |
| `dd160ce` | 2026-08-04 | feat: keep the transcript still when a timeline row unfolds (#206) |
| `377b46c` | 2026-08-04 | feat: preview a changed image instead of its binary diff (#205) |
| `74c11f6` | 2026-08-04 | refactor: clear three react-doctor findings (#204) |
| `6744ef2` | 2026-08-04 | feat: continue a workspace past its merged pull request (#198) |
| `b6f148e` | 2026-08-04 | feat: tint the sidebar preview pill from the pull request header tone (#197) |
| `6ff6a98` | 2026-08-04 | feat: link the sidebar preview button to the deployed build (#196) |
| `7839987` | 2026-07-31 | feat: audit a sub-agent's transcript, cascade stops, boot-scan placeholder (#194) |
| `84f4b03` | 2026-07-30 | feat: let agents read the workspace diff and file review comments (#193) |
| `bebf10e` | 2026-07-30 | feat: narrow the sub-agent control surface by durable role (#192) |
| `4773a7d` | 2026-07-30 | feat: inherit plan mode in spawned sub-agents (#191) |
| `39063d8` | 2026-07-30 | feat: open spawned tabs right of the active tab (#190) |
| `f57d933` | 2026-07-29 | feat: keep the active tab in view, land on the last visited tab on close (#189) |
| `e36b3f1` | 2026-07-29 | feat: give harnesses their own playbook, title bash tool rows by action (#188) |
| `5e1e175` | 2026-07-29 | feat: collapse skill invocations and rebuild session naming (#187) |
| `b87280b` | 2026-07-29 | feat: rebuild the chat timeline around tool presentation descriptors (#186) |
| `b7cf808` | 2026-07-28 | refactor: reach react-doctor 100 by removing effect anti-patterns (#185) |
| `c44bd8f` | 2026-07-28 | feat: plan mode for Pi conversations (#184) |
| `a644a77` | 2026-07-28 | fix: stop long paths overflowing lifecycle dialogs (#183) |
| `613749d` | 2026-07-28 | feat: ask_user_question agent-control tool (#182) |
| `c9df7a7` | 2026-07-28 | refactor: align module, type, and doc organization with the AGENTS rules (#181) |
| `5661b83` | 2026-07-28 | feat: prettier workbench error and empty states (#180) |
| `e1fb889` | 2026-07-28 | Recover finished child's last message; untruncated tab-title tooltips (#179) |
| `42e2d8d` | 2026-07-23 | fix: resolve @electron/node-gyp from npm registry instead of git (#175) |
| `1309cf1` | 2026-07-23 | chore: quiet fallow barrel noise and drop dead exports (#174) |
| `3c3bc6f` | 2026-07-23 | fix: converge duplicate Claude terminal tabs after restart (#173) |
| `ec6c93a` | 2026-07-22 | build(deps): bump dompurify to 3.4.12 (#167) |
| `d4a4855` | 2026-07-22 | feat(agent-control): subagent naming and status sync (#169) |
| `fd71174` | 2026-07-21 | feat(agent-control): role-aware orchestration guidance (#168) |
| `2d6503f` | 2026-07-21 | Add agent-to-app control layer (#166) |
| `432c0f0` | 2026-07-21 | fix(terminal): restore dock terminal sessions across restart (#165) |
| `74125bf` | 2026-07-21 | fix(main): harden single-instance lock, quit on last window (#164) |
| `4dc992a` | 2026-07-21 | Prevent duplicate app instances during shell env loading (#163) |
| `f88554c` | 2026-07-21 | Preserve resumable agent sessions, improve tab switching (#162) |
| `f84a661` | 2026-07-21 | Audit install scripts and remove desktop activation (#161) |
| `496a6b4` | 2026-07-21 | Harden Pi RPC startup and workbench recovery (#160) |
| `661decf` | 2026-07-21 | Fix unavailable summaries in transcript picker (#159) |
| `bd5a85c` | 2026-07-20 | fix(models): stabilize startup catalog (#158) |
| `69459c1` | 2026-07-20 | fix(repository): harden workspace worktree creation (#157) |
| `4e09b4a` | 2026-07-20 | fix(scripts): serialize exclusive script launches (#156) |
| `923b86f` | 2026-07-20 | Restore agent terminal tabs (#155) |
| `2cd2140` | 2026-07-20 | feat(workbench): session tab keyboard shortcuts (#154) |
| `d9acabd` | 2026-07-20 | feat(agents): derive Codex/Vibe conversation titles (#153) |
| `ab8304e` | 2026-07-20 | feat(agents): harness launch and session tabs (#152) |
| `fc7c610` | 2026-07-20 | Rich diff viewer with inline review comments (#151) |
| `611525c` | 2026-07-20 | Consolidate session naming, preserve stopped chat tabs (#149) |
| `289946d` | 2026-07-19 | feat(build): sign and notarize macOS DMG builds (#148) |
| `a512e95` | 2026-07-19 | feat(renderer): preserve per-chat model, remove Help nav (#147) |
| `8860cbe` | 2026-07-19 | refactor(renderer): extract OpenInTargetsSubmenu, PanelMessage (#146) |
| `890beb3` | 2026-07-19 | feat(settings): settings persistence and live config reload (#145) |
| `034d12b` | 2026-07-19 | fix(renderer): suppress layout animation on workspace removal (#144) |
| `455536e` | 2026-07-19 | Refine workspace services and renderer state handling (#143) |
| `7ba8f85` | 2026-07-19 | fix(renderer): improve PR action color contrast (#142) |
| `d989259` | 2026-07-19 | fix(workspaces): prevent creation race failures (#141) |
| `3f75d47` | 2026-07-19 | Remove inactive workspace dead ends, stabilize tabs (#140) |
| `dfebc6b` | 2026-07-19 | Improve pull request editing and collapsed header actions (#139) |
| `7725421` | 2026-07-19 | Persist action prompts, preserve app detection cache (#138) |
| `daae03b` | 2026-07-18 | feat: show pull request check status list (#137) |
| `ed3f094` | 2026-07-18 | Fix dock tab close overlay border overlap (#136) |
| `3f2f69b` | 2026-07-18 | Add runtime-aware workspace setup state (#135) |
| `ed1461f` | 2026-07-18 | Keep dashboard accessible when no workspaces remain (#133) |
| `7da4597` | 2026-07-18 | fix: restore collapsed sidebar triggers (#132) |
| `48e6b2f` | 2026-07-18 | fix(workspace): avoid reused placeholder names (#131) |
| `eee3e6f` | 2026-07-18 | Add dashboard workspace card action menus (#128) |
| `c73ced6` | 2026-07-18 | feat(workspace): add draggable dashboard board (#125) |
| `ae163fe` | 2026-07-18 | Fix session tab selection after drag reorder (#124) |
| `4a8801b` | 2026-07-18 | fix(session-tabs): improve tab close controls (#123) |
| `d2220aa` | 2026-07-17 | Show setup status and bundle terminal font (#122) |
| `b9bdd09` | 2026-07-17 | fix(environment): use workspace toolchain PATH (#121) |
| `4695229` | 2026-07-17 | fix(terminal): inherit shell-derived env for setup and run scripts (#120) |
| `1cbf07c` | 2026-07-10 | feat(composer): support pasted image attachments (#99) |
| `67cf369` | 2026-07-10 | fix(repository): sync base before workspace creation (#98) |
| `1de8f4f` | 2026-07-10 | Use workspace settings for setup scripts and unblock chat closes (#97) |
| `3a373b3` | 2026-07-10 | fix(deps): patch tar, tmp, linkify-it via npm overrides (#93) |
| `e502d2c` | 2026-07-10 | feat(icon): shrink wordmark "E" 20% and add social avatar generator (#92) |
| `70f86b2` | 2026-07-08 | feat(welcome): add repo search to the clone GitHub dialog |
| `695de4f` | 2026-06-16 | feat(window): context-aware ⌘/Ctrl+W close action (#69) |
| `6ef81a7` | 2026-06-16 13:47:27 +0300 | feat(workspace): gitignore .context and serve files as lazy live tree |
| `d2158d5` | 2026-06-16 11:14:09 +0300 | feat(review-files): organize all-files screen as file tree with live watch |
| `d61d93e` | 2026-06-16 07:17:24 +0300 | feat(git-settings): user-scope git defaults and auto branch-naming |
| `957a71d` | 2026-06-15 23:23:28 +0300 | feat(wordmark): fire first glitch burst immediately on mount |
| `a7c7b56` | 2026-06-15 23:16:16 +0300 | feat(setup-diagnostics): rework panel with remediation actions |
| `dd2baf4` | 2026-06-15 23:45:03 +0300 | docs(doctor-config): correct overstated rule-suppression rationale |

---

## Documentation Updates

The following documentation files were updated to reflect these changes:

- `README.md` - Updated the current feature list, tool versions, macOS SQLite path, and ADR count.
- `docs/product/current-shell-inventory.md` - Updated dashboard, shell-provider, Changes tab, setup/run script, terminal environment, settings, and resolved-unknowns guidance.
- `docs/product/implementation-roadmap.md` - Added current implementation deltas since `de46de5` and removed stale settings decisions.
- `docs/product/open-decisions.md` - Removed stale AI-certainty/experimental-flag decisions and marked board status/unread/review semantics resolved.
- `docs/product/settings-inventory.md` - Reflected the actual Appearance schema and bundled default terminal font.
- `docs/product/docs-consistency-audit.md` - Recorded the 2026-07-18 docs refresh audit.

### 2026-07-22 documentation refresh (#135–#169)

Brought the docs current with the agent-control, multi-harness, review, settings, and build work
merged since the 2026-07-18 refresh (PR#134):

- `README.md` - Reframed the intro (multi-agent, first-party Pi + harnesses + Ensemblr Control); added an "Agent runtimes" section and a new "Ensemblr Control & orchestration" section; added rich-diff, PR-check, dock-restore, and settings-persistence bullets; replaced the build block with the sign/notarize/channel matrix; fixed the ADR count (38 → 40); refreshed the tech-stack, project-structure, architecture, and Documentation sections.
- `CHANGELOG.md` - This catch-up (#135–#169).
- `CONTEXT.md` - Dropped the single-runtime "Pi-native" framing; added the Harness, Ensemblr Control, and Orchestrator / Sub-agent terms.
- `docs/agent-control.md` - New: Ensemblr Control guide (permission model, guardrails, tool families, orchestration).
- `docs/harnesses.md` - New: Claude Code / Codex / Vibe harness guide.
- `docs/build-and-release.md` - New: packaging, signing, notarization, and build channels.
- `docs/README.md` - New: documentation index.
- `docs/adr/0040-use-loopback-control-server-for-agent-app-control.md` - New: the control-layer architecture decision.
- `docs/considerations/agent-control-layer.md`, `agent-orchestration-playbook.md` - Reconciled to shipped state (transport row, role variants, spawn-depth = 1, board-status tools).
- `docs/product/scaffold-audit-2026-06-04.md`, `docs/pi/rpc-protocol.md` - Annotated the remaining stale Bun references as historical.
- `LICENSE` - New: MIT license file (previously declared only in `package.json`/README).

### 2026-08-08 documentation refresh (#170–#237)

A full claim-by-claim audit of every documentation surface against the code as of `4fbeb65`, driven by the
Claude Code runtime, named run scripts, plan mode, branch takeover, and agent-control work merged since the
2026-07-22 refresh. 31 files changed; no source touched.

- `CHANGELOG.md` - Backfilled the `[Unreleased]` section from #170 through #237; the previous pass stopped at #169, leaving a 40-PR hole.
- `CONTEXT.md` - Renamed **Pi Session** to **Agent Session** (the tables are `agent_*` since migration `014_agent_session_vocabulary`); reframed the intro around two first-class runtimes; added **Agent Runtime**, **Plan Mode**, **Base Branch**, and **Run Script**.
- `README.md` - Corrected the Pi-only runtime framing, the missing Node 24 prerequisite, the `typecheck` project count, the IPC contract count (30 → 34), the `src/main` folder list, and the single-run-script claim; recorded that react-doctor is the *only* CI job.
- `docs/README.md`, `docs/onboarding.md` - Reframed `harnesses.md`; added the `.claude/rules/` pointer; documented the asymmetric setup gating (Pi checks are blocking, Claude Code has no setup check) and the fallow `entry` registration step for a new concern barrel.
- `docs/build-and-release.md` - Added the "What ships inside the `.app`" section covering `PACKAGE_KEEP_*`, the unbundled `node-pty` and `@anthropic-ai/claude-agent-sdk`, and the deliberately dropped `claude-agent-sdk-<platform>` siblings.
- `docs/agent-control.md` - Replaced the prose tool-families list with all 34 tools enumerated from `TOOL_DEFS`, each with argument names, types, requiredness, gate, and withholding. Corrected `SUBAGENT_UNUSABLE_OPS` (three ops, not two), the missing `scriptName` on `start_terminal`, the four review ops, the per-*session* origin model, `CHAT_TAB_ONLY_OPS`, and the read/write gate classification.
- `docs/harnesses.md` - Distinguished Claude Code the terminal harness from Claude Code the agent runtime.
- `docs/considerations/agent-control-layer.md`, `agent-orchestration-playbook.md` - Superseded the "no cascade" and per-workspace-identity decisions; fixed `roleForDepth` → `resolveAgentRole` and `MAX_REPORT_CHARS` → `MAX_AGENT_PAYLOAD_CHARS`.
- `docs/pi/rpc-protocol.md` - Corrected the "`get_state` is never sent" claim, added `set_session_name`, and fixed five paths merged into `pi-cli-rpc-adapter.ts`.
- `docs/architecture-map.md` - Added the missing `agents/` and `pi-ipc/` concerns, corrected the `plan-mode/` and `review/` responsibilities, filled in the renderer concern folders, and refreshed the module and test counts.
- `AGENTS.md`, `src/{main,renderer,preload,shared}/AGENTS.md` - Completed the `src/main` concern list (15 of 30 folders were named), fixed `types/workbench.ts` → `types/workbench/`, `src/renderer/mocks/` → `fixtures/`, and `contracts.ts` → `contracts/`; recorded the "new runtime = sibling adapter folder" rule.
- `.claude/rules/stack.md`, `patterns.md` - Removed the false "vendored `ui/**` is excluded from Biome" claim; added the missing dependencies; corrected which barrels `.fallowrc.jsonc` actually registers.
- `docs/product/*` - Corrected the "there is no Providers screen" claim in `settings-inventory.md` and `ux-conventions.md` (the route exists); closed 11 resolved items in `open-decisions.md`; reconciled roadmap, milestone, and parity status against shipped work; recorded this pass in `docs-consistency-audit.md`.

The audit surfaced four gaps that were then filled:

- `docs/adr/0043-adopt-an-existing-branch-instead-of-always-forking.md` - New. Records the `branchPlan` adopt/create union and base branch as merge target (#225).
- `docs/adr/0044-enforce-plan-mode-fail-closed-at-the-control-channel.md` - New. Records the one-classifier, fail-closed-at-the-channel enforcement stance (#184, #191, #218).
- `docs/adr/0045-unify-the-viewers-behind-one-code-surface.md` - New. Records the consolidation of four viewers and the move onto design tokens (#211, #212).
- `docs/claude/README.md`, `docs/claude/sdk-surface.md` - New. The Claude Code runtime guide and SDK-surface reference, mirroring `docs/pi/`; the runtime previously had no written record outside ADR 0042 and the source.
- `docs/product/archive/` - New. `dependency-map.md` and `mvp-sequencing.md` moved here with archive banners; both recorded `ENS-*`-era planning structure that shipped work has overtaken, and `implementation-roadmap.md` carries their live content.

### 2026-08-12 documentation refresh (#238–#264)

Brought the docs current with the 27 PRs merged since the 2026-08-08 audit — the three-language release, the
first-run wizard, the settings restructure, the composer attachment model, the follow-up queue, per-chat
unread, gated Linear ops, and the menu command bus. 15 files changed; no source touched.

- `CHANGELOG.md` - Backfilled `[Unreleased]` from #238 through #264; the previous pass stopped at #237, and #239–#245 had never been recorded at all. Added 27 rows to the commit-reference table.
- `README.md` - Added the composer-attachment, linked-directory, follow-up-queue, and per-chat-unread features; a new "First run & language" section and a "Menus & window" section; Lexical and i18next in the tech stack; the `i18n:*` scripts in the workflow. Corrected the settings pane list (**Advanced** is gone; Shortcuts and repo Security are new), the IPC contract count (34 → 35), the `src/main` folder list, and the ADR count (45 → 47).
- `CONTEXT.md` - Added **Attachment**, **Linked Directory**, **Follow-Up Queue**, **Unread Mark**, **Menu Command**, and **App Language**.
- `docs/architecture-map.md` - Added the `linked-directories/` concern and the menu-command-bus request path (two paths → three); corrected every module and test count (28 → 30 handlers, 34 → 35 contracts, 23 → 26 shared root modules, 137/193/28 → 154/244/31 test files); filled in the renderer buckets that had gone missing (`menu-commands/`, `unread/`, `slash-commands/`, `onboarding/`, `tool-approval/`, `i18n/`, and the three code→`t()` mappers) and dropped the deleted `close-action/`; added the attachment store and `localStorage`-backed rows to the persistence table.
- `docs/onboarding.md` - Added the i18n workflow and the localization rule to the house style, `npm run i18n:status` to the pre-push list, and menu-item and user-facing-string rows to the quick reference. Fixed a direct contradiction with `.claude/rules/patterns.md`: a new **main**-process barrel is deliberately *not* registered in `.fallowrc.jsonc`.
- `docs/README.md` - Added the i18n glossary and audit under Reference; ADR count 45 → 47.
- `.claude/rules/i18n.md` - Replaced the "165 keys empty in `ru`, 163 in `el`" backlog with the measured state: **100% in both**, 2,054 keys, 8 namespaces. Corrected `lib/setup-check-text.ts` to the directory it became and named its two sibling mappers.
- `.claude/rules/stack.md`, `patterns.md` - Added Lexical with its confinement rule; corrected the main concern count (30 → 31); added the menu-command-bus pattern and the rule that agent-control policy lives in the port, not the handler.
- `src/main/AGENTS.md`, `src/renderer/AGENTS.md` - Added `linked-directories/`, described the split `menu/`, recorded that main returns locale-neutral codes (with `menu-strings.ts` as the one exception), and confined Lexical to the composer editor folder.
- `docs/product/*` - Rewrote the settings inventory around the removal of **Advanced** (rows rehomed to General, Appearance, and Providers) plus the new Shortcuts and repo Security pages; refreshed the composer and ⌘W rows in `current-shell-inventory.md`; corrected the settings pane list in `ux-conventions.md`; closed the onboarding-sequence item in `open-decisions.md`; added a *Completed since 2026-08-09* table to `implementation-roadmap.md`; recorded this pass in `docs-consistency-audit.md`.

Two gaps were filled with new ADRs:

- `docs/adr/0046-drive-the-native-menu-bar-from-a-renderer-command-bus.md` - New. Records the shared command table, the per-command handler stack, the equality-gated rebuild, and why a menu accelerator can have only one owner on macOS.
- `docs/adr/0047-model-composer-attachments-as-one-ordered-list-in-a-lexical-draft.md` - New. Records the collapse of three atom families into one ordered list, the Lexical boundary, the content-addressed attachment store, and why a linked directory is a grant rather than an attachment.

`docs/agent-control.md` needed no correction: `tests/main/agent-control-doc-parity.test.ts` holds its tables
against `TOOL_DEFS`, so #244's five Linear ops could not land without the doc being updated with them.
- `tests/main/agent-control-doc-parity.test.ts`, `tests/main/support/agent-control-doc.ts` - New. Parses the tool tables out of `docs/agent-control.md` and asserts them against `TOOL_DEFS`, the Zod schemas, and the withholding policy, so the reference cannot drift silently a fourth time.
