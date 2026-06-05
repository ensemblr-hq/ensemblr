# UX Parity

Date: 2026-06-04

Piductor should match Conductor's observable workflows and information architecture where practical, while using distinct Piductor visual design, copy, branding, icons, and Pi-specific runtime behavior.

## Current Shell Contract

As of 2026-06-05, the implemented workbench shell is the product source of
truth for layout and visible affordances. See
`docs/product/current-shell-inventory.md`.

Future work should wire live repository, workspace, Pi, terminal, file, diff,
GitHub, Linear, settings, and diagnostics services into the existing shell
regions. Do not redesign the shell or move major surfaces unless a later product
decision explicitly supersedes the implemented direction.

The current shell is the intended closest match to Conductor's own shell. Lost
or unavailable screenshot evidence should not cause agents to reopen settled
shell layout decisions.

The visible chat transcript and prompt composer are a Pi-integration contract,
not finalized chat behavior. Preserve their current placement and setup-gated
behavior, but defer prompt submission, stop, attachments, model controls,
runtime event rendering, and session tree behavior to Pi runtime tickets.

## Major Screen Patterns

### App Shell

- Persistent macOS desktop window with native menu bar support.
- Left sidebar with visible History and Settings entries. The Dashboard route
  exists in the renderer but is not a visible current-shell sidebar item.
- Projects grouped in the sidebar, each containing one or more workspaces.
- Workspace rows show the current task/branch plus compact change statistics.
- Sidebar footer exposes app health/readiness status.
- Center pane is the active workspace surface, usually a tabbed agent timeline.
- Right pane switches between All files, Changes, and Checks.
- Lower-right dock switches between Setup, Run, and terminal tabs.

Piductor equivalent:

- Use Electron native menu APIs for macOS menus.
- Use TanStack Router for durable app navigation and workspace/search state such as selected workspace, chat tab, review tab, and dock tab.
- Use TanStack Query for backend/preload snapshots such as health, setup diagnostics, repository/workspace records, file status, terminal metadata, and PR/check state.
- Use a Piductor-specific React/shadcn visual language, not Conductor's visual identity.
- Preserve the same pane hierarchy so Conductor users can transfer workflows.
- Treat the current shell as locked product direction. Later service tickets should replace fixture data inside the existing sidebar, timeline, review panel, and dock regions instead of creating new regions.

### Settings Shell

- Settings is a separate full-window settings view with a Back to app action.
- Settings sidebar has app-wide sections first and local project sections below.
- Main settings forms are narrow, centered, row-based, and mostly inline-editable.
- App settings cover General, Models, Providers, Environment, Appearance, Git, Account, Experimental, and Advanced.
- Repository settings are selected from the same sidebar and expose path, branch, remote, preview, copy, script, spotlight, instruction, and removal controls.

Piductor equivalent:

- Keep app settings and repository settings in one settings shell.
- Store high-churn mutable settings in SQLite, declarative defaults in `~/.config/piductor/config.json`, shared repository behavior in `piductor.json`/`conductor.json`, and secrets outside plain config files.

### Workspace Landing

- New workspaces land in an empty chat with a summary card.
- The summary shows that a new isolated copy was created, the branch source, copied-file count, and optional setup-script guidance.
- Composer, file tree, checks, and run controls are immediately available.

Piductor equivalent:

- Create a git worktree workspace, show branch/copy/setup status, and open the Pi composer immediately.
- Auto-generated placeholder names are acceptable, but Piductor should not copy Conductor's naming style if it is distinctive.

### Agent Timeline

- Agent sessions are tabbed per workspace.
- Timeline includes assistant messages, thinking/status sections, tool calls, elapsed time, errors, and retry affordances.
- Composer supports text prompt, file/PR references, slash/run commands, attachments, voice input when enabled, model selection, reasoning/thinking level, and submit/stop controls.
- Runtime errors are inline cards with retry actions.

Piductor equivalent:

- Keep the implemented chat tab strip, center timeline location, and bottom composer location as the app-shell contract.
- Keep chat and prompt input behavior deferred until Pi integration. The current mock transcript, attach button, send button, and model/thinking badges should not be treated as final behavior.
- Render structured Pi RPC events as timeline items.
- Map model/reasoning controls to Pi concepts.
- Preserve Pi session tree/fork behavior when retrying or continuing in a new chat.

### Right-Side Workspace Panel

- All files tab shows a repository tree.
- Changes tab shows changed files grouped by folder with status and line-count summaries.
- Checks tab shows PR metadata, git status, checks, deployments, comments/review threads, todos, and merge readiness.
- The panel remains visible while the agent works or terminals run.

Piductor equivalent:

- Keep the implemented All files / Changes / Checks tab order and right-sidebar location.
- Treat file/diff/checks state as workspace metadata synchronized from git and GitHub/`gh`.
- Allow selected files, diffs, comments, and check failures to be added to Pi chat context.

### Terminal and Run Dock

- Bottom-right dock provides Setup, Run, and named terminal tabs.
- Setup displays setup script terminal output, for example dependency install logs.
- Run displays run command terminal output, for example a dev server process.
- Terminal and subsequently spawned terminal tabs are generic manual terminal panels.
- Setup/run output remains visible while the user reviews chat, files, or checks.
- Dock actions are script-state aware: show Setup Scripts when no scripts are configured, Run setup script before setup has run, Run when the dev server is stopped, and Open :PORT plus Stop when the dev server is running.
- Experimental settings can enable a bigger terminal-centric layout and more tabs.

Piductor equivalent:

- Keep the implemented lower-right dock placement, tab names, collapse behavior, and script-state action affordances.
- Use xterm.js behind a terminal adapter.
- Main process owns PTY/process supervision.
- Expose `PIDUCTOR_*` variables and compatible `CONDUCTOR_*` variables for Conductor-compatible repositories or explicit opt-in.

### PR and Merge Flow

- Create PR is available from workspace controls and becomes an agent-assisted workflow.
- Checks panel has explicit states: no PR, uncommitted changes, PR pending/failing, and ready to merge.
- Ready state uses a prominent status banner, external PR/preview links, passed deployments/checks, comments, todos, and merge action.
- Failing or pending states show blockers and may expose a warning merge path.

Piductor equivalent:

- Use `gh` CLI for v1 PR creation, metadata, checks, comments where possible, and merge.
- Cache PR/check/comment data in SQLite but treat GitHub as source of truth.
- Merge actions need confirmation and repository policy checks.

## Pi-Specific Changes

| Conductor concept | Piductor equivalent |
| --- | --- |
| Claude Code and Codex providers | Selected Pi CLI RPC runtime and Pi provider/model readiness. |
| Claude/Codex model defaults | Pi model defaults and thinking-level controls. |
| Claude/Codex config sync | Pi resource/config discovery from `~/.pi/agent`, project `.pi`, skills, prompts, themes, and context files. |
| Claude tool approvals | Piductor permission modes mapped to Pi tool restrictions where available. |
| Retry in new chat | Pi session tree fork/continuation behavior plus file checkpoint policy. |
| Review/create-PR/fix prompt templates | Pi instruction templates stored per user/repository with source precedence. |
| Provider environment catalog | Pi-relevant provider/env catalog plus generic environment variables. |
| Conductor root path labels | Piductor root directory, with optional Conductor-compatible shared root support. |
| `CONDUCTOR_*` environment variables | Native `PIDUCTOR_*` plus compatibility `CONDUCTOR_*` for Conductor-compatible repositories or explicit opt-in. |

## Prioritized Implementation Checklist

1. Maintain the implemented app shell contract: sidebar projects/workspaces, center tabbed workspace, right panel tabs, terminal dock, Router search state, and Query-backed setup/health snapshots.
2. Build settings shell: app settings sections plus repository settings from the screenshot inventory.
3. Implement setup gate: git, `gh`, Pi executable/RPC/provider, root directory, SQLite, and process environment checks.
4. Implement repository add/open/clone: add menu, clone modal, clone progress log, post-clone workspace landing.
5. Implement workspace core: worktree creation, default branch/remote, copied files, setup script, placeholder naming, context folder.
6. Implement Pi timeline: session creation, event rendering, tool calls, runtime errors, retry/fork actions, composer controls.
7. Wire terminal dock: replace dock placeholder logs with setup/run output, named terminals, rerun/stop/run controls, PTY lifecycle.
8. Wire file/diff panel: replace fixture rows with all-files tree, changes tree, diff body, search, review mode, local comments.
9. Wire PR/checks panel: replace fixture checks with no-PR state, uncommitted state, PR metadata, CI/deployments, comments, todos, ready-to-merge state.
10. Implement repository action preferences: review, create PR, fix errors, resolve conflicts, branch rename, and general Pi instructions.
11. Add polish/settings parity: appearance previews, keyboard shortcuts, command palette, non-deferred feature flags, resource usage, and big terminal mode. Voice remains post-core deferred.
12. Revisit advanced integrations: Graphite stack support, direct GitHub API, cloud/remote workspace SSH behavior. Linear issue workflows are v1 scope.
