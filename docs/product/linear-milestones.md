# Linear Milestones

Date: 2026-07-18

These milestones were intended to be copied into Linear as project milestones. Issue IDs refer to the local planning IDs in `docs/product/linear-issues.md`; several exit criteria are now shipped and preserved here as planning history. Use `docs/product/implementation-roadmap.md` for current completion status.

## 1. Foundation

Goal:
Establish the implemented workbench shell contract, Router/Query renderer boundary, persistence, secret, configuration, root-directory, and command-execution foundations needed by every later workflow.

Included issues:

- `ENS-001` Electron app shell scaffold
- `ENS-002` Ensemblr design system foundation
- `ENS-003` SQLite database and migrations
- `ENS-004` Keychain secret store
- `ENS-005` Declarative config loader and JSON schema stub
- `ENS-006` Configuration resolution engine
- `ENS-007` Root directory service
- `ENS-008` Local command environment service

Exit criteria:

- Electron main and React renderer can start in development.
- Renderer uses TanStack Router for durable navigation/search state and TanStack Query for preload/backend snapshots.
- The Conductor-style shell contract exists with live project/workspace rows, chat tabs, dashboard board, right review panel tabs, PR-state header, and setup/run/terminal dock regions.
- Live services are wired into the locked shell layout through TanStack Query, typed IPC, and app services rather than by rebuilding shell regions.
- Main-process services expose typed IPC boundaries for storage, config, root, secrets, and local commands.
- SQLite migrations run against a local app-support database and test database.
- Secrets can be stored through a Keychain abstraction and mocked in tests.
- App and repository settings can be resolved from known sources without touching Pi or Conductor private state.
- The managed root layout can be created or inspected safely.

Primary source:

- ADR 0001, 0008, 0009, 0010, 0018
- `docs/product/mvp-sequencing.md`
- `docs/product/settings-inventory.md`

## 2. Setup Gate and Configuration

Goal:
Make first launch and readiness checks explicit, actionable, and aligned with Conductor-style prerequisites while adapting to Pi CLI RPC.

Included issues:

- `ENS-009` Setup gate diagnostics UI and model
- `ENS-010` Git and gh readiness checks
- `ENS-011` Pi executable discovery and override
- `ENS-012` Pi RPC and provider readiness smoke checks
- `ENS-013` Workspace trust and permission-mode baseline
- `ENS-014` Environment variable catalog and secret metadata
- `ENS-015` Repository config parser for the committed `.ensemblr/settings.toml` and `.worktreeinclude`
- `ENS-016` Root switch reindex/adopt flow

Exit criteria:

- Required checks block core app readiness until they pass.
- `gh auth status` is required for v1 readiness and has concrete remediation.
- Users can select or override a Pi-compatible executable, including wrappers such as `oh-my-pi`.
- Pi RPC readiness is validated without disabling normal Pi resource discovery.
- Root changes default to switch and reindex/adopt, not delete.
- Environment variables and secrets have a safe storage model.
- Repository config precedence and source diagnostics are implemented.

Primary source:

- ADR 0003, 0007, 0013, 0014, 0016, 0017, 0018, 0025
- `docs/product/onboarding-flow.md`
- `docs/product/settings-inventory.md`

## 3. Repository and Workspace Core

Goal:
Provide the local project and git-worktree operating model: add/open/clone repositories, create workspaces, copy eligible files, adopt existing workspaces, and archive safely.

Included issues:

- `ENS-017` Project add menu and recents
- `ENS-018` Local repository registration
- `ENS-019` GitHub clone flow with progress and errors
- `ENS-020` Sidebar repository/workspace navigation
- `ENS-021` Git worktree workspace creation
- `ENS-022` Files-to-copy implementation
- `ENS-023` Workspace landing summary and first composer surface
- `ENS-024` Shared-root workspace adoption and reconciliation
- `ENS-025` Workspace archive and context lifecycle

Exit criteria:

- Users can add or clone a project into the managed root.
- Existing shell regions render live repository/workspace records instead of fixture shell data.
- Project/workspace navigation preserves the current sidebar, pinning, collapse/reorder, context-menu, header, and open-workspace launcher affordances.
- Users can create a git worktree workspace from the configured branch source.
- `.context/` exists for workspace handoff files.
- Eligible gitignored files are copied through `.worktreeinclude`, the committed `.ensemblr/settings.toml`, or defaults.
- Workspaces under a shared Conductor root can be adopted through filesystem/git metadata only.
- Archive behavior is explicit, preserves unknown content, and prepares archive-script execution for the scripts milestone.

Primary source:

- ADR 0006, 0007, 0010, 0011, 0015, 0017
- `docs/product/conductor-parity.md`
- `docs/product/screen-inventory.md`
- `docs/product/ux-parity.md`

## 4. Pi CLI RPC Runtime and Agent Timeline

Goal:
Run Pi through a selected CLI RPC executable, preserve the Pi user environment, render structured sessions, and provide checkpoint-backed agent workflow controls.

Included issues:

- `ENS-026` PiAgentClient RPC boundary
- `ENS-027` RPC process supervisor and JSONL stream handling
- `ENS-028` Pi session metadata mapping
- `ENS-029` Pi composer submit, stop, and model controls
- `ENS-030` Structured Pi timeline rendering
- `ENS-075` Agent chat pane UX/UI working session
- `ENS-031` Runtime error retry and session-fork discovery
- `ENS-032` Git-backed checkpoint capture
- `ENS-033` Checkpoint restore and turn diff
- `ENS-034` Chat tab limit and session tab model
- `ENS-035` Pi capability discovery for modes, context, browser, and permissions

Exit criteria:

- Pi sessions launch from workspace `cwd` with normal Pi resource discovery enabled.
- RPC stdout/stderr, JSONL events, crashes, aborts, and retries are surfaced clearly.
- Timeline events show messages, tool calls, output, runtime errors, and status.
- Agent chat pane UX/UI decisions are recorded after realistic Pi composer/timeline behavior exists.
- Checkpoints are captured before Pi user prompts and mapped to workspace/session/turn metadata.
- Users can inspect turn diffs and restore files without mutating Pi session files.
- Any number of chat tabs can be open per workspace (the five-tab cap was removed by ADR 0039); preview tabs re-focus rather than duplicate.

Primary source:

- ADR 0002, 0003, 0012, 0016, 0022, 0025
- `docs/product/open-decisions.md`
- `docs/product/ux-parity.md`

## 5. Terminal, Scripts, and Processes

Goal:
Deliver the terminal dock and local process lifecycle for setup, run, archive, manual shells, environment variables, and preview-related discovery.

Included issues:

- `ENS-036` Main-process PTY service
- `ENS-037` xterm.js terminal adapter and dock UI
- `ENS-038` Setup, run, and archive script lifecycle
- `ENS-039` Workspace environment variables and port allocation
- `ENS-040` Run script concurrency and process controls
- `ENS-041` Preview URL detection discovery
- `ENS-042` Spotlight testing discovery

Exit criteria:

- Setup, run, archive, and named terminal sessions execute from workspace directories.
- xterm.js replaces the existing dock placeholder in place and can render output, handle resize, copy/paste, scrollback, and process termination states.
- Scripts receive native `ENSEMBLR_*` variables.
- Run script modes support concurrent and nonconcurrent behavior.
- Preview URL and spotlight testing uncertainties are documented before build work proceeds.

Primary source:

- ADR 0002, 0007, 0016
- `docs/product/conductor-parity.md`
- `docs/product/screen-inventory.md`
- `docs/product/settings-inventory.md`

## 6. Linear Integration

Goal:
Provide first-class Linear issue workflows through OAuth, Keychain token storage, SQLite metadata/cache, issue CRUD, comments, and workspace creation from issues.

Included issues:

- `ENS-043` Linear OAuth PKCE and token lifecycle
- `ENS-044` Linear API schema and capability discovery
- `ENS-045` Linear cache and sync service
- `ENS-046` Linear issue browse, search, and read UI
- `ENS-047` Linear issue create, update, and comment UI
- `ENS-048` Workspace creation from Linear issue
- `ENS-049` Linear issue status linking and remediation

Exit criteria:

- Users can connect, refresh, and disconnect Linear safely.
- Linear tokens are stored in Keychain and never in JSON or SQLite.
- Issue/team/project/status/label/cycle/assignee metadata is cached for UI responsiveness.
- Users can browse, read, create, update, and comment on issues where permissions allow.
- Users can create an Ensemblr workspace from a Linear issue, with issue metadata linked to the workspace.
- Linear issue workflows use dedicated issue browse/read/workspace-from-issue surfaces unless a later decision adds Linear to the current project-add menu.
- Archive/delete support is not implemented until schema/permission discovery confirms safe behavior.

Primary source:

- ADR 0018, 0024
- `docs/product/conductor-parity.md`
- `docs/product/open-decisions.md`

## 7. GitHub, Review, Checks, and Merge

Goal:
Implement the review flow: file status, diffs, local comments, todos, context-to-Pi, PR creation, check/comment metadata, and merge confirmation through `gh`.

Included issues:

- `ENS-050` Git file status and all-files tree
- `ENS-051` Changes tree and unified diff viewer
- `ENS-052` Local diff comments and todos
- `ENS-053` Send review/check context to Pi
- `ENS-054` gh commit, push, and PR-create service
- `ENS-055` gh PR/check metadata service
- `ENS-056` GitHub comments and deployments discovery
- `ENS-057` Checks panel states and polling
- `ENS-058` Merge readiness and confirmation flow
- `ENS-059` Agent-assisted review, PR, and fix action templates
- `ENS-060` Archive-after-merge and branch cleanup

Exit criteria:

- Users can inspect all files, changed files, unified diffs, and local comments/todos.
- Review work wires live file, diff, PR, check, comment, todo, and merge data into the existing All files / Changes / Checks tabs and right PR header.
- Selected files, diffs, comments, and check failures can be added to Pi context.
- Users can commit/push/create a PR through `gh` with clear failures.
- Checks panel shows no-PR, uncommitted, pending/failing, and ready-to-merge states.
- Merge requires confirmation and respects blockers/check state by default.
- Archive-after-merge and branch cleanup obey explicit settings and confirmations.

Primary source:

- ADR 0012, 0013, 0023
- `docs/product/conductor-parity.md`
- `docs/product/screen-inventory.md`
- `docs/product/ux-parity.md`

## 8. Settings and Parity Polish

Goal:
Expose the settings, diagnostics, and interaction polish needed to operate the completed core product and resolve remaining non-deferred ambiguity.

Included issues:

- `ENS-076` App settings screen UX/UI working session
- `ENS-061` Settings shell with app and repository sections
- `ENS-062` App settings sections for general, models, environment, integrations, and security
- `ENS-063` Repository settings source diagnostics
- `ENS-064` Appearance settings and previews
- `ENS-065` Command palette and keyboard shortcuts
- `ENS-066` Deep links and external-open actions
- `ENS-067` Error, empty, loading, and diagnostics logs
- `ENS-068` Resource usage, sidebar, and experimental flag discovery
- `ENS-069` Product decision for AI certainty phrase setting

Exit criteria:

- Settings contain app-wide and repository-specific sections in one shell, starting from the current visible Settings entry and shell route.
- App settings screen UX/UI decisions are recorded as polish follow-up now that the main settings shell and forms are implemented.
- Source precedence is visible for app and repository configuration.
- Security, permissions, Linear, `gh`, Pi readiness, and enterprise privacy are inspectable.
- Appearance controls affect code, markdown, and terminal previews.
- Command palette, shortcuts, deep links, and external-open actions cover core workflows.
- Remaining non-deferred settings decisions are recorded explicitly; the 2026-07-18 refresh leaves no active settings product question.

Primary source:

- ADR 0016, 0018, 0019, 0020, 0021, 0022, 0025
- `docs/product/settings-inventory.md`
- `docs/product/open-decisions.md`

## 9. Deferred / Post-Core

Goal:
Track known post-core work without letting it block v1 implementation.

Included issues:

- `ENS-070` Post-core packaging, signing, notarization, and auto-update
- `ENS-071` Post-core GitHub CLI capability gap review
- `ENS-072` Post-core SDK sidecar fallback
- `ENS-073` Post-core managed Pi runtime installer
- `ENS-074` Post-core voice, Graphite, cloud SSH, and production profiler

Exit criteria:

- Deferred items are documented as future scope.
- No v1 milestone depends on these tickets.
- Each deferred ticket lists the ADRs and product docs that explain why it is out of core scope.

Primary source:

- ADR 0019, 0020, 0021, 0025
- `docs/product/open-decisions.md`
- `docs/product/docs-consistency-audit.md`
