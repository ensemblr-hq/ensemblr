# UX Parity

Date: 2026-08-08

Ensemblr should match Conductor's observable workflows and information architecture where practical, while using distinct Ensemblr visual design, copy, branding, icons, and runtime-specific agent behavior.

> **Status (2026-08-08):** Ensemblr is no longer a single-runtime app. ADR 0042
> added Claude Code as a second first-class agent runtime alongside Pi (#226–#237),
> so "Pi" below should be read as "the chat's agent runtime" wherever the
> statement is not genuinely Pi-specific. A chat is pinned to one provider; the
> shared surface lives in `src/main/agent-runtime/`, with `pi-agent/` and
> `claude-agent/` as sibling adapters.

## Current Shell Contract

As of 2026-08-08, the implemented workbench shell is the product source of
truth for layout and visible affordances. See
`docs/product/current-shell-inventory.md`.

The shell is composed from file-based TanStack routes under
`src/renderer/routing/routes/` (see
`docs/adr/0026-use-file-based-tanstack-routing.md`), with shell composition in
`src/renderer/components/workbench-shell/route-layout/`, the `WorkbenchFrame`
chrome in `src/renderer/components/workbench-shell/frame.tsx`,
`WorkspaceWorkbenchContent` in
`src/renderer/components/workbench-shell/workspace-content.tsx`, the
no-project shell in `src/renderer/components/workbench-empty-state.tsx`, the
welcome landing in `src/renderer/components/welcome.tsx` plus
`src/renderer/components/welcome/`, the dashboard board in
`src/renderer/components/workbench-shell/dashboard/`, private feature modules
under `src/renderer/components/workbench-shell/<feature>/`, cross-cutting shell
contexts in `src/renderer/components/workbench-shell/shell-contexts.tsx`, shared
Jotai atoms in `src/renderer/state/workspace`, and shared exported shell types
in `src/renderer/types/workbench-shell/`.

Live repository, workspace, Pi, terminal, file, diff, GitHub, Linear, settings,
and diagnostics services are now wired into the existing shell regions. Future
work should deepen those services rather than redesigning the shell or moving
major surfaces unless a later product decision explicitly supersedes the
implemented direction.

The current shell is the intended closest match to Conductor's own shell. Lost
or unavailable screenshot evidence should not cause agents to reopen settled
shell layout decisions.

The visible chat transcript and prompt composer are backed by a live agent
runtime — Pi or Claude Code, pinned per chat. Prompt submission, stop,
attachments, model/thinking controls, plan mode, slash commands, and runtime
event rendering have landed; preserve their current placement and setup-gated
behavior. Remaining polish, such as the full session-tree fork UX, is ongoing.

## Major Screen Patterns

### App Shell

- Persistent macOS desktop window with native menu bar support.
- Left sidebar with visible Dashboard, History, Settings, and Help entries.
- Dashboard board for workspace triage across Backlog, In progress, In review, Done, and Canceled.
- Projects grouped in the sidebar, each containing one or more workspaces.
- Workspace rows show the current task/branch plus compact change statistics.
- Sidebar footer exposes app health/readiness status and app diagnostics.
- Center pane is the active workspace surface, usually a tabbed agent timeline.
- Right pane switches between All files, Changes, and Checks.
- Lower-right dock switches between Setup, Run, and terminal tabs. The Setup
  tab is for workspace/project setup command output only, not app diagnostics.

Ensemblr equivalent:

- Use Electron native menu APIs for macOS menus.
- Use file-based TanStack Router for durable app navigation. The selected workspace and chat tab are URL path params (`/projects/$projectId/workspaces/$workspaceId/chats/$chatId`); review and dock tabs are validated search params. Per-workspace dock, review, and last-chat selections are persisted so switching workspaces restores them.
- Use TanStack Query for backend/preload snapshots such as health, setup diagnostics, repository/workspace records, file status, terminal metadata, and PR/check state.
- Use Jotai atoms in `src/renderer/state/` for durable renderer-only UI state
  that crosses shell modules, such as pinned workspace IDs, collapsed project
  IDs, project order, dashboard board status/order, unread workspace IDs, and
  closed session tab IDs.
- Use an Ensemblr-specific React/shadcn visual language, not Conductor's visual identity.
- Preserve the same pane hierarchy so Conductor users can transfer workflows.
- Keep app diagnostics in the left sidebar footer/status area. Do not render app
  setup diagnostics in the lower Setup dock.
- Treat the current shell as locked product direction. Later service tickets should deepen live services inside the existing sidebar, dashboard, timeline, review panel, and dock regions instead of creating new regions.

### Settings Shell

- Settings is a separate full-window settings view with a Back to app action.
- Settings sidebar has app-wide sections first and local project sections below.
- Main settings forms are narrow, centered, row-based, and mostly inline-editable.
- App settings cover General, Models, Providers, Environment, Git, Appearance, Integrations, and (under "More") Diagnostics, Experimental, and Advanced. Providers was removed in the 2026-07-19 single-runtime pass and reinstated by #226 as the agent-runtime surface: one tab per first-class runtime (Pi, then Claude Code) with its executable, readiness, accounts, and settings-file location. The aggregate setup gate still lives in Diagnostics, and Ensemblr stores no provider tokens.
- Repository settings are selected from the same sidebar and expose path, branch, remote, preview, copy, script, spotlight, instruction, and removal controls.

Ensemblr equivalent:

- Keep app settings and repository settings in one settings shell.
- Store high-churn mutable settings in SQLite, declarative defaults in `~/.config/ensemblr/config.json`, shared repository behavior in the committed `.ensemblr/settings.toml`, and secrets outside plain config files.

### First-Run Onboarding

Ensemblr equivalent:

- A first launch opens the setup wizard at `/onboarding` rather than the workbench: a welcome moment, then one screen per gate — agent CLI, GitHub CLI, Linear — and a terminal screen that names whatever is still unresolved.
- The wizard is the first-run surface only. Settings → Diagnostics owns the recurring case and remains the full gate; the wizard shows the five checks a first run can act on and reads them from the same `setupDiagnostics` probe.
- The agent-CLI gate is either-or: a working Pi *or* a working Claude Code satisfies it, so a machine carrying one runtime reads as ready and the runtime the user skipped dims instead of turning red. Linear is a soft gate that always leaves a way forward.
- The same either-or rule governs the diagnostics rollup, not just the wizard, and both read the one `AGENT_RUNTIME_CHECK_GROUPS` table in `src/shared/setup-checks.ts` — Pi's four checks, Claude's one. `setupDiagnostics` resolves it onto each check's `blocking` flag before computing `blocked`: with one runtime working the others demote to optional, and with none working every runtime check is promoted to required, because either would fix it. The wizard resolves the same groups into one card per runtime, so a Pi whose executable resolved but whose RPC handshake failed reads as the blocked runtime it is instead of a green card over a workbench the app considers blocked. Ensemblr needs *an* agent runtime, never a particular one and never both.
- `warning` counts as a pass wherever the question is "can the app use this" — `isPassingSetupStatus`, shared by both gates, so a Pi binary whose version probe is flaky never blocks a machine the rest of the app calls ready. The Linear step is the deliberate exception: `linear-oauth` reports `warning` for "not connected", so that step demands an outright `success` rather than drawing itself as done.
- Both exits — finishing and skipping — record `app.onboarding.completedAt` in `~/.config/ensemblr/config.json`, so the wizard never nags. Clearing that field re-runs it.
- The guard sits on the workbench shell route, not on `/_workbench`, so `/settings/*` stays reachable while onboarding is outstanding.

### Workspace Landing

- New workspaces land in an empty chat with a summary card.
- The summary shows that a new isolated copy was created, the branch source, copied-file count, and optional setup-script guidance.
- Composer, file tree, checks, and run controls are immediately available.

Ensemblr equivalent:

- Create a git worktree workspace, show branch/copy/setup status, and open the Pi composer immediately.
- Auto-generated placeholder names are acceptable, but Ensemblr should not copy Conductor's naming style if it is distinctive.

### Agent Timeline

- Agent sessions are tabbed per workspace.
- Timeline includes assistant messages, thinking/status sections, tool calls, elapsed time, errors, and retry affordances.
- Composer supports text prompt, file/PR references, slash/run commands, attachments, voice input when enabled, model selection, reasoning/thinking level, and submit/stop controls.
- Runtime errors are inline cards with retry actions.

Ensemblr equivalent:

- Keep the implemented chat tab strip, center timeline location, and bottom composer location as the app-shell contract.
- Chat and prompt input behavior are wired to a live agent runtime. The transcript, attach button, send/stop button, and model/thinking badges are implemented, not placeholders.
- Render structured runtime events as timeline items. Claude tool results render as cards, not raw JSON (#233).
- Map model/reasoning controls to the pinned runtime's concepts. A chat is pinned to one provider for its lifetime (ADR 0042, decision 5), and a chat's thinking level is pinned to its session (#232).
- Preserve session tree/fork behavior when retrying or continuing in a new chat.
- Plan mode is a per-chat toggle (⌥⇧P) with an Approve / Refine / Hand off review bar rendered as the composer header (#184, #218).
- A spawned sub-agent shows its runtime in the tab (#232) and inherits its caller's runtime (#236).
- The composer supports a markdown preview toggle (#217) and a context-usage gauge that has a window before the first turn ends (#230, #235).

### Right-Side Workspace Panel

- All files tab shows a repository tree.
- Changes tab shows changed files grouped by folder with status and line-count summaries.
- Checks tab shows PR metadata, git status, checks, deployments, comments/review threads, todos, and merge readiness.
- The panel remains visible while the agent works or terminals run.

Ensemblr equivalent:

- Keep the implemented All files / Changes / Checks tab order and right-sidebar location.
- Treat file/diff/checks state as workspace metadata synchronized from git and GitHub/`gh`.
- Selected files, diffs, comments, and check failures can be added to chat context; bulk-add sends only unresolved comments (#234). Agents can also read the workspace diff and file review comments through the control layer (#193).
- Workspaces expose a target-branch selector, and the panel surfaces merge conflicts against that target (#215, #216).

### Terminal and Run Dock

- Bottom-right dock provides fixed Setup and Run script-output tabs plus user-spawned terminal tabs.
- Setup is a read-only output tab for the workspace/project setup command, for example dependency install logs.
- Run is a read-only output tab for the workspace run command, for example a dev server process.
- Each workspace starts with one default Terminal tab. Users can spawn additional named terminal tabs when they need more manual shells.
- User-spawned terminal tabs are regular IDE-style interactive terminals backed by terminal session IDs.
- Setup/run output remains visible while the user reviews chat, files, or checks.
- Dock actions are script-state aware: show Setup Scripts when no scripts are configured, Run setup script before setup has run, Run when the dev server is stopped, and Open :PORT plus Stop when the dev server is running.
- The new-terminal action creates another terminal session. It never creates additional Setup or Run tabs.
- Pi RPC transcripts, app setup diagnostics, app health logs, and workspace setup/run script output must not be merged into user-spawned terminal sessions.
- No separate big-terminal or many-tabs setting is implemented; the terminal dock covers big-terminal v1, and chat tabs are unlimited per ADR 0039 (superseding the five-chat-tab ADR 0022).

Ensemblr equivalent:

- Keep the implemented lower-right dock placement, tab names, collapse behavior, and script-state action affordances.
- User-spawned interactive terminals are implemented on xterm.js behind a terminal adapter, backed by live node-pty sessions.
- The main process owns PTY/process supervision.
- `ENSEMBLR_*` variables are exposed to workspace processes.
- Scripts and terminal sessions inherit the sanitized shell-derived environment and workspace toolchain `PATH`.

### PR and Merge Flow

- Create PR is available from workspace controls and becomes an agent-assisted workflow.
- Checks panel has explicit states: no PR, uncommitted changes, PR pending/failing, and ready to merge.
- Ready state uses a prominent status banner, external PR/preview links, passed deployments/checks, comments, todos, and merge action.
- Failing or pending states show blockers and may expose a warning merge path.

Ensemblr equivalent:

- Use `gh` CLI for v1 PR creation, metadata, checks, comments where possible, and merge.
- Cache PR/check/comment data in SQLite but treat GitHub as source of truth.
- Merge actions need confirmation and repository policy checks.

## Pi-Specific Changes

| Conductor concept | Ensemblr equivalent |
| --- | --- |
| Claude Code and Codex providers | Two first-class agent runtimes: **Claude Code** (in-process `@anthropic-ai/claude-agent-sdk`) and **Pi** (CLI RPC). Both are siblings under `src/main/agent-runtime/`; Settings → Providers is the per-runtime readiness surface. Codex remains a terminal harness only, not an agent provider. See ADR 0042. |
| Claude/Codex model defaults | App-wide default model and thinking level on Settings → Models, resolved per chat against the pinned runtime's own catalogue. |
| Claude/Codex config sync | Each runtime keeps its own user environment: Pi discovers `~/.pi/agent`, project `.pi`, skills, prompts, themes, and context files; Claude Code uses the user's own `claude` configuration, slash commands, and MCP roster (#228). Ensemblr duplicates neither. |
| Claude tool approvals | Workspace permission modes, enforced in-app for Claude (ADR 0042, decision 7) and mapped to Pi tool restrictions where available. Plan mode (#184) is a separate per-chat hold: Claude uses its native plan mode, Pi is gated through the shipped extension's `tool_call` hook. |
| Retry in new chat | Agent session tree fork/continuation behavior plus file checkpoint policy. Ensemblr does not enable the Claude SDK's own file checkpointing (ADR 0042, decision 6). |
| Review/create-PR/fix prompt templates | Repository action templates stored per user/repository with source precedence. |
| Provider environment catalog | Runtime-relevant provider/env catalog plus generic environment variables. |
| Conductor root path labels | Ensemblr root directory, with optional Conductor-compatible shared root support. |
| `CONDUCTOR_*` environment variables | Native `ENSEMBLR_*` variables. |

## Prioritized Implementation Checklist

1. Maintain the implemented app shell contract: sidebar projects/workspaces, center tabbed workspace, right panel tabs, terminal dock, file-based route state (path-based workspace/chat selection plus `dock`/`review` search params), and Query-backed setup/health snapshots.
2. Build settings shell: app settings sections plus repository settings from the screenshot inventory.
3. Implement setup gate: git, `gh`, Pi executable/RPC/provider, root directory, SQLite, and process environment checks.
4. Implement repository add/open/clone: add menu, clone modal, clone progress log, post-clone workspace landing.
5. Implement workspace core: worktree creation, default branch/remote, copied files, setup script, placeholder naming, context folder.
6. **Complete.** Implement Pi timeline: session creation, event rendering, tool calls, runtime errors, retry/fork actions, composer controls.
7. **Complete.** Wire terminal dock: replace dock placeholder logs with setup/run output, named terminals, rerun/stop/run controls, PTY lifecycle.
8. **Complete.** Wire file/diff panel: all-files tree, changes tree, diff body, source filtering, discard controls, and search are live. Inline local line comments shipped with the rich diff viewer (THE-152, #151, `diff-viewer/diff-comment-thread.tsx`); #211 unified the file preview, turn diff, and workspace file diff behind one code surface.
9. **Complete.** Wire PR/checks panel: no-PR state, uncommitted state, PR metadata, CI/deployments, comments, todos, ready-to-merge state, and merge confirmation are live. PR comment bodies are readable in-app (#209) and open as their own tab (#207, #208); the deployed-build preview link is wired (#196, #197); merge conflicts surface in the panel with a "Resolve" action that hands the conflict to the agent (#215); resolved review comments render struck through and bulk-add sends only the unresolved ones (#234).
10. Implement repository action preferences: review, create PR, fix errors, resolve conflicts, branch rename, and general agent instructions.
11. Add polish/settings parity: appearance previews, keyboard shortcuts, command palette, diagnostics, and source-status polish. Voice remains post-core deferred.
12. Revisit advanced integrations: Graphite stack support and cloud/remote workspace SSH behavior. Linear issue workflows are v1 scope, and GitHub workflows stay on `gh`/`gh api`.
