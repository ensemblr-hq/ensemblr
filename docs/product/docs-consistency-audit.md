# Docs Consistency Audit

Date: 2026-08-08

This file is append-only: each pass adds a dated section rather than rewriting
the ones above it. Earlier sections describe what was true when they were
written. Read the newest section first.

## Summary

The generated planning docs are broadly consistent with the latest accepted ADRs. No duplicate ADR numbers or conflicting active ADR titles were found. The main stale guidance was older v1 runtime wording in superseded ADR 0004, deferred experimental features appearing as v1 polish, and product docs still treating resolved account/root/tab decisions as open.

## Files Reviewed

- `CONTEXT.md`
- `docs/adr/*.md`
- `docs/product/archive/mvp-sequencing.md` (archived)
- `docs/product/onboarding-flow.md`
- `docs/product/open-decisions.md`
- `docs/product/settings-inventory.md`
- `docs/product/ux-conventions.md`

## Fixes Applied

- Marked ADR 0004 and ADR 0005 runtime choices as historical/superseded and pointed current guidance to ADR 0025.
- Removed active v1 wording for voice mode, Graphite, cloud/remote SSH, production React profiler, embedded Pi SDK, and direct GitHub token/API paths.
- Aligned Linear guidance with ADR 0024: OAuth and create/read/update/comment/workspace-from-issue are v1 scope; archive/delete remains schema/permission discovery.
- Aligned GitHub guidance with ADR 0013: authenticated `gh` is required; authenticated `gh api` is allowed for REST/GraphQL gaps; app-owned GitHub API/OAuth is not planned.
- Aligned root-change guidance with ADR 0017: switching roots reindexes/adopts by default; migration/delete are explicit separate actions.
- Aligned secret storage wording with ADR 0018: macOS Keychain stores secrets; SQLite stores metadata only.
- Moved unresolved settings/product questions into `docs/product/open-decisions.md`.

## Remaining Ambiguities

- Whether to support a remove/soften AI-certainty phrase setting in Ensemblr.
- Which non-deferred experimental settings belong in v1, especially workspace/sidebar visibility and sidebar resource usage.
- Exact Pi CLI/RPC capabilities for permission brokering, session tree navigation/forking, compaction UI, model listing, plan/fast modes, browser control, and context usage.
- Exact `gh` coverage for review comments, deployments, add-all-comments-to-chat, and review-thread resolution.
- Linear archive/delete schema and permission support.
- Safe spotlight-testing behavior without overwriting root changes.

## Implementation Risks

- Pi CLI RPC runtime v1 preserves `~/.pi/agent` compatibility and keeps Pi execution in a subprocess, but Ensemblr still launches local tools with the user's account permissions; keep the `PiAgentClient` boundary ready for SDK sidecar migration if RPC lacks needed capabilities.
- Shared-root adoption must never read/write another workspace manager's private SQLite database and must avoid deleting or renaming unknown filesystem content.
- Checkpoint restore must revert file state without destructively editing Pi session files.
- `gh` output parsing may not expose every PR comment/check/deployment detail needed for full parity.
- Linear OAuth token refresh, pagination, rate limits, and permission failures need explicit handling.

## 2026-06-07 File-Based Routing Alignment

The renderer moved from hand-defined routes and effect-based redirects to
file-based TanStack routing. Docs were realigned to that reality.

### Added

- `docs/adr/0026-use-file-based-tanstack-routing.md` records the file-based
  routing decision, URL contract, loader-driven redirects, pathless
  `_workbench`/`_shell` layouts, and the development-only route/IPC profiler.

### Updated

- `docs/adr/0021-defer-react-profiler-to-development-only.md`: noted the profiler
  is implemented as the dev-gated route/IPC navigation profiler.
- `docs/product/current-shell-inventory.md`: `app.tsx` is now the router outlet
  host; shell composition lives in `workbench-shell/route-layout.tsx`; added the
  routing boundaries; corrected the Settings entry (full-window route outside the
  shell) and the chat-tab row (path param remembered per workspace).
- `docs/product/ux-conventions.md`: clarified path vs search route state and
  per-workspace dock/review/chat persistence.
- `docs/product/open-decisions.md`: added renderer routing to resolved decisions.
- `docs/product/archive/dependency-map.md` (archived): noted file-based routing for the shell regions.
- `docs/product/linear-issues.md`: aligned the shell-scaffold (ENS-001) and
  sidebar-navigation (ENS-020) ticket text with the routing reality.

### Not done

- Live Linear tickets were not updated. The connected Linear workspace is
  `boundaryla`, not the Ensemblr "The Swiss Cheese" workspace, so `THE-*` issues
  are unreachable from this session. The in-repo `linear-issues.md` mirror is the
  aligned source to sync once the correct workspace is connected.

## 2026-06-07 Workbench Decomposition + Welcome Screen Alignment

The composition refactor landed (commit `6fddcf5 refactor(renderer): decompose
workbench shell modules`) and the welcome screen plus clone dialog landed
(commit `caf02c3 feat(renderer): add welcome screen + clone dialog`). Several
docs still referenced the pre-refactor entrypoints. Docs were realigned to the
shipped structure.

### Path drift fixed

- `src/renderer/components/workbench-shell.tsx` no longer exists. Its public
  exports moved to `src/renderer/components/workbench-shell/frame.tsx`
  (`WorkbenchFrame`) and `src/renderer/components/workbench-shell/workspace-content.tsx`
  (`WorkspaceWorkbenchContent`).
- `src/renderer/components/workbench-shell/route-layout.tsx` is now the
  `route-layout/` folder with `index.ts` as the barrel.
- `src/renderer/types/workbench-shell.ts` is now the
  `src/renderer/types/workbench-shell/` folder with `index.ts` as the barrel.
- Cross-cutting layout / setup-diagnostics / navigation flags moved out of
  prop-drilling into `src/renderer/components/workbench-shell/contexts/`.

### Added structure (no prior docs)

- `src/renderer/components/welcome.tsx` + `welcome/`:
  welcome wordmark, three add-project cards, and a UI-only
  `CloneGithubDialog`. Mounted at the `_workbench/_shell/` index route.
- `src/renderer/components/workbench-empty-state.tsx`: full shell rendered
  when no workspace is selectable.
- The `_workbench/_shell/dashboard.tsx` route now renders a
  `WorkbenchPlaceholderPage` reserved for the future kanban board (it is no
  longer the implicit landing).

### Updated

- `docs/product/current-shell-inventory.md`: path block, implementation
  boundaries, and a new Welcome landing row added; dashboard row updated to
  reflect the placeholder state.
- `docs/product/ux-conventions.md`: shell-contract paths updated.
- `docs/product/implementation-roadmap.md`: scope-baseline shell summary
  updated.
- `docs/product/linear-issues.md`: current-shell-alignment preamble and the
  `ENS-002` shell-split implementation note updated.
- `docs/product/onboarding-flow.md`: 2026-06-07 implementation-status block
  added describing the live welcome view, clone-dialog stub, and add-project
  menu parity.
- `docs/adr/0026-use-file-based-tanstack-routing.md`: shell-composition
  paragraph updated for the new frame / workspace-content split, the
  no-project shell, and the welcome landing.
- `docs/refactor/composition-refactor-plan.md`: marked Landed with the
  shipped outcomes summary.
- `src/renderer/AGENTS.md`: components-section example updated to use
  `welcome` for the small case and the workbench-shell named
  entrypoints for the large case.

### Not done

- `AGENTS.md` (repo root) was not edited in this pass; its current language
  references scoped sub-`AGENTS.md` files generically and does not name
  shell paths.
- The connected Linear workspace mismatch noted in the 2026-06-07 routing
  alignment is still unresolved; live `THE-*` tickets were not synced.

## 2026-07-18 Current Docs Refresh

The last substantive product-doc update before this refresh was `de46de5`
(`docs: record shipped parity and runtime ADRs`, 2026-07-15). `README.md` and
`CHANGELOG.md` were last touched by `c94b502` on 2026-07-10; roadmap and open-
decision docs were last substantively aligned before the Ensemblr rename pass
(`078b38e`, 2026-07-10).

### Changes reviewed since `de46de5`

- `4695229` and `b9bdd09`: setup/run scripts and terminal sessions now inherit
  the shell-derived environment and workspace toolchain `PATH`.
- `d2220aa`: setup status is visible in the shell, and JetBrains Mono Nerd Font
  assets are bundled for terminal/code typography.
- `4a8801b` and `ae163fe`: chat/session tab close controls and drag-reorder
  selection behavior were tightened.
- `c73ced6`, `eee3e6f`, and `2f4aeb7`: the Dashboard route is now a draggable
  workspace board with board-status columns and workspace card action menus.
- `a9ce1b9`, `7da4597`, and `ed1461f`: dashboard/collapsed-sidebar empty states
  stay reachable when setup is blocked or no workspaces remain.
- `48e6b2f`: placeholder workspace names avoid reuse collisions.

### Fixes applied

- Updated `README.md` for the dashboard board, bundled terminal font, current
  tool versions, macOS SQLite path, and current ADR count.
- Updated `docs/product/current-shell-inventory.md` for the live dashboard board,
  shell-provider path, Git-backed Changes tab, setup/run script execution,
  terminal env inheritance, settings state, and resolved context-menu semantics.
- Updated `docs/product/implementation-roadmap.md` with the shipped
  board/script/env work and current implementation deltas.
- Updated `docs/product/open-decisions.md` to remove stale AI-certainty and
  experimental-flag decisions, and to mark workspace board status, unread/read,
  and Review action semantics as resolved.
- Updated `docs/product/settings-inventory.md` to reflect the actual Appearance
  schema and bundled default terminal font.

### Remaining ambiguities

- Inline line-comment UX and add-review-context-to-Pi flows remain future review
  polish.
- Live Linear `THE-*` ticket syncing was not attempted in this refresh.

## 2026-08-08 Product And Decision Docs Refresh

Scope: `docs/product/**`, `docs/adr/**`, `docs/refactor/**` only. The root
`README.md`, `CHANGELOG.md`, `docs/architecture-map.md`, the `AGENTS.md` family,
and the agent-control/harness docs were out of scope for this pass and were not
inspected.

### Classification

Only **living** docs were edited.

| Class | Files |
| --- | --- |
| Living | `current-shell-inventory.md`, `settings-inventory.md`, `ux-conventions.md`, `open-decisions.md`, `implementation-roadmap.md`, `linear-milestones.md`, `linear-issues.md`, `docs-consistency-audit.md` |
| Historical record | all 42 ADRs; `scaffold-audit-2026-06-04.md`, `settings-wiring-review-2026-07-14.md` (dated snapshots); `discovery-preview-url-detection.md`, `discovery-spotlight-testing.md`, `github-gh-discovery.md`, `linear-api-discovery.md` (closed discovery notes); `docs/refactor/composition-refactor-plan.md` (marked Landed 2026-06-07) |
| Archived | `mvp-sequencing.md` and `dependency-map.md`, moved to `docs/product/archive/` on 2026-08-08 — both were living but spent, and the retirement recommendation below was acted on. |
| Obsolete | none outright. |

### Changes reviewed since `166b0e2` (2026-07-18)

- `2d6503f` … `27f7b5b` (#166–#194, #224): the agent-control layer — loopback MCP
  plus Pi `POST /invoke`, role-aware orchestration, sub-agent naming/status,
  durable role scoping, transcript audit, cascade stops, `ask_user_question`.
  Recorded as ADR 0040.
- `c44bd8f`, `4773a7d`, `d87062e` (#184, #191, #218): plan mode for conversations.
- `b87280b`, `5e1e175`, `e36b3f1` (#185–#188): timeline rebuilt around tool
  presentation descriptors; session naming rebuilt.
- `6ff6a98` … `df016b8` (#196, #197, #207–#209): PR comment reading, ephemeral
  preview tab reuse, preview link to the deployed build.
- `d2cacbb`, `cbed051` (#211, #212): one code surface behind file preview, turn
  diff, workspace diff, and PR diff.
- `e8b2fe2`, `915f017` (#215, #216): merge-conflict surfacing and a per-workspace
  target-branch selector.
- `5e28b06`, `c7b5387`, `b1f73fa` (#220, #222, #223): named run scripts per
  repository. Recorded as ADR 0041.
- `b0eeba5` (#225): a workspace takes over an existing branch instead of always
  forking.
- `069cd0b` … `4fbeb65` (#226–#237): Claude Code as a second first-class agent
  runtime. Recorded as ADR 0042.

### Fixes applied

- `settings-inventory.md`: corrected the **"There is no Providers screen
  (removed)"** claim — `/settings/providers` exists again as the agent-runtime
  surface (#226). Rewrote the Providers section, added the plan-mode and
  Providers entries to Open Settings Questions, and moved the date to 2026-08-08.
- `ux-conventions.md`: same Providers correction; added a multi-runtime status banner;
  rewrote the "Pi-Specific Changes" table so its rows describe two runtimes;
  marked checklist items 8 and 9 complete (inline line comments and
  add-review-context shipped); added plan mode, the target-branch selector, and
  merge-conflict surfacing to the panel and timeline contracts.
- `open-decisions.md`: added a **Resolved Since 2026-07-21** section closing
  eleven decisions (second runtime, Providers, plan mode, branch takeover, target
  branch, inline comments, add-review-context, named run scripts, preview URLs,
  spotlight testing, unified code surface); pruned the discovery list to what is
  genuinely open; promoted the two real product decisions (spotlight dirty-root
  override, loopback log parsing) into **Needs Product Decision**.
- `current-shell-inventory.md`: replaced the Pi-only composer paragraph with the
  two-runtime contract; emptied **Current Unknowns** of the inline-comment item.
- `implementation-roadmap.md`: added a **Completed since 2026-07-18** table with
  twelve rows and PR/commit evidence; added the Claude runtime to the scope
  baseline; replaced `PiAgentClient` with `AgentClient` in the workstream rules;
  annotated `ENS-035`/`ENS-041`/`ENS-042`/`ENS-056` as answered or mostly
  answered; rewrote **Decision Needed**.
- `dependency-map.md`: added a banner explaining that the Mermaid graph predates
  the agent-control layer and the second runtime and is not being redrawn; listed
  the six shipped items that have no `ENS-*` node; resolved the three shell
  uncertainties.
- `linear-milestones.md`: added a milestone-by-milestone status banner; renamed
  milestone 4 to **Agent Runtime and Timeline**; annotated exit criteria in
  milestones 3, 4, 5, 7, and 8.
- `mvp-sequencing.md`: added a status banner marking milestones 0–4 complete and
  naming the two overtaken lines.
- `linear-issues.md`: two targeted edits only (a status banner and the stale
  "deferred until Pi runtime integration" bullet). The 2,900+ ticket templates
  were left untouched.

### ADR gaps identified (no ADRs written)

Three shipped decisions are architecturally significant and have no ADR: the
workspace `branchPlan` adopt/create model (#225), plan mode's layered
fail-closed enforcement (#184), and the unified code surface (#211). ADR 0041
was checked and *does* cover the multi-script `[scripts.run.<name>]` model, so
named run scripts are **not** a gap. ADR 0022 already carries its
`Superseded by 0039` note. No existing ADR was edited.

### Not done

- No new ADRs were written; the gaps above are reported for a decision on
  whether to record them.
- Live Linear `THE-*` tickets were not touched, and no `THE-` key was invented.
  The keys present in commit history are `THE-102`, `THE-105`–`THE-110`,
  `THE-113`, `THE-115`–`THE-130`, `THE-135`, `THE-136`, `THE-141`–`THE-150`,
  `THE-152`, `THE-158`, and `THE-175`.
- Docs outside `docs/product/`, `docs/adr/`, and `docs/refactor/` were not read
  or edited.

### Remaining ambiguities

- ~~Whether `mvp-sequencing.md` and `dependency-map.md` should be retired rather
  than carried as living docs — both are now mostly planning history.~~
  **Resolved 2026-08-08:** both were moved to `docs/product/archive/` with
  archive banners; see `docs/product/archive/README.md`.
- Whether `linear-issues.md` should keep per-ticket text at all now that the
  roadmap tracks completion.
- Browser control and compaction UI remain the only unanswered parts of
  `ENS-035`.
- Review-thread and comment *mutation* coverage through `gh`/`gh api` is still
  unverified (`ENS-056`).

## 2026-08-12 Documentation Refresh (#238–#264)

Scope: every documentation surface, root files included. Driven by the 27 commits
merged between the 2026-08-08 audit (`f45a22b`, #238) and `5cf92de` (#264) —
248 source files, +12,558/−2,858 lines. No source was touched by this pass.

### What had drifted

The file dates again suggested currency: `.claude/rules/i18n.md`,
`docs/product/ux-conventions.md`, and `docs/agent-control.md` were all edited within
three days of this pass. The claims underneath them were not.

| Doc | Stale claim | Reality |
| --- | --- | --- |
| `CHANGELOG.md` | `[Unreleased]` ended at #237 | 27 PRs unrecorded, including the three-language release, the setup wizard, the composer attachment model, and the menu command bus |
| `docs/architecture-map.md` | 28 IPC handlers, 34 contracts, 23 shared root modules, 30 main concerns, 137/193/28 test files | 30, 35, 26, 31, 154/244/31; `linked-directories/` missing entirely; `state/close-action/` listed after deletion; `menu-commands/`, `unread/`, `slash-commands/`, `onboarding/`, `tool-approval/`, and the three code→`t()` mapper folders all missing |
| `.claude/rules/i18n.md` | "165 keys empty in `ru`, 163 in `el` — inherited debt" | Both locales at **100%**, 2,054 keys, 8 namespaces. Also pointed at `lib/setup-check-text.ts`, now a directory with two sibling mappers |
| `.claude/rules/patterns.md` | "all 30 main concerns" | 31; no mention of the menu command bus or of policy living in the agent-control port |
| `.claude/rules/stack.md` | no Lexical | `lexical` + `@lexical/react` 0.49 arrived with #257 |
| `README.md` | no localization, no onboarding wizard, no attachments/queue/unread; Settings listed an **Advanced** pane | Advanced was removed by #248; Shortcuts and repo Security are new |
| `docs/product/settings-inventory.md` | Advanced page documented in full; "repo scope has five pages" | Advanced gone, its rows rehomed; six repo pages |
| `docs/product/ux-conventions.md` | app settings "(under More) Diagnostics, Experimental, and Advanced" | Diagnostics, Shortcuts, Experimental |
| `docs/product/current-shell-inventory.md` | composer as a text area with three atom families; cited `src/renderer/state/close-action.tsx` | Lexical editor with one ordered attachment list; that state concern was deleted by #264 |
| `docs/onboarding.md` | "two request paths"; told contributors to register a new **main** concern barrel in `.fallowrc.jsonc` | Three paths. `.fallowrc.jsonc` deliberately omits main barrels — they are reachable from `main.ts` — which `.claude/rules/patterns.md` already said, so the two files contradicted each other |
| `docs/product/open-decisions.md` | "exact onboarding screen sequence" open | Ensemblr shipped its own wizard (#247) |

`docs/agent-control.md` was the one surface that had **not** drifted:
`tests/main/agent-control-doc-parity.test.ts`, added by the previous audit,
parses its tables and asserts them against `TOOL_DEFS`, so #244's five Linear ops
could not land without the doc. That test is the model — a doc held by a test
does not need an audit.

### Gaps filled

- `docs/adr/0046-drive-the-native-menu-bar-from-a-renderer-command-bus.md` —
  new. Records the command table in `shared/`, the per-command handler stack, the
  equality-gated rebuild, and why an accelerator can belong to only one owner on
  macOS (AppKit matches a key equivalent before the web contents sees it, and
  `registerAccelerator: false` is Windows/Linux only).
- `docs/adr/0047-model-composer-attachments-as-one-ordered-list-in-a-lexical-draft.md` —
  new. Records the collapse of three atom families into one ordered list, the
  Lexical boundary, the content-addressed store, why a referenced thing is
  written out as a document rather than summarized, and why a linked directory
  is a grant rather than an attachment.

### Not done

- `.fallowrc.jsonc` does not list `src/shared/agent-control.ts` under `entry`,
  though `plan-mode.ts`, `scripts.ts`, and `terminal.ts` are all there and
  `.claude/rules/patterns.md` names all four as the same form. Reported rather
  than changed — this pass touched no config.
- `src/renderer/AGENTS.md` says shared exported renderer types do not live in
  component folders, but
  `.../composer/editor/index.ts` exports `ComposerDraftChange` and
  `ComposerEditorHandle`, consumed by four hooks outside the folder. Either the
  types move to `types/` or the rule gains an explicit carve-out for a
  third-party-integration boundary; that is a policy call, so only the Lexical
  confinement rule was added.
- Light-mode status badges still miss WCAG AA on their own fill (ok 3.45,
  warning 3.11, danger 4.27), recorded as open by #263 and unresolved here.
- The app-settings shape is recorded in `ux-conventions.md` and
  `settings-inventory.md`, which are the surviving record after the screenshot
  inventory was retired.
