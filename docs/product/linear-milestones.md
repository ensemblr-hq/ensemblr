# Linear Milestones

Date: 2026-06-04

These milestones are intended to be copied into Linear as project milestones. Issue IDs refer to the local planning IDs in `docs/product/linear-issues.md`.

## 1. Foundation

Goal:
Establish the application shell, Router/Query renderer boundary, persistence, secret, configuration, root-directory, and command-execution foundations needed by every later workflow.

Included issues:

- `PID-001` Electron app shell scaffold
- `PID-002` Piductor design system foundation
- `PID-003` SQLite database and migrations
- `PID-004` Keychain secret store
- `PID-005` Declarative config loader and JSON schema stub
- `PID-006` Configuration resolution engine
- `PID-007` Root directory service
- `PID-008` Local command environment service

Exit criteria:

- Electron main and React renderer can start in development.
- Renderer uses TanStack Router for durable navigation/search state and TanStack Query for preload/backend snapshots.
- The Conductor-style shell scaffold exists with fixture project/workspace rows, chat tabs, right review panel tabs, and setup/run/terminal dock regions.
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

- `PID-009` Setup gate diagnostics UI and model
- `PID-010` Git and gh readiness checks
- `PID-011` Pi executable discovery and override
- `PID-012` Pi RPC and provider readiness smoke checks
- `PID-013` Workspace trust and permission-mode baseline
- `PID-014` Environment variable catalog and secret metadata
- `PID-015` Repository config parser for `piductor.json`, `conductor.json`, and `.worktreeinclude`
- `PID-016` Root switch reindex/adopt flow

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

- `PID-017` Project add menu and recents
- `PID-018` Local repository registration
- `PID-019` GitHub clone flow with progress and errors
- `PID-020` Sidebar repository/workspace navigation
- `PID-021` Git worktree workspace creation
- `PID-022` Files-to-copy implementation
- `PID-023` Workspace landing summary and first composer surface
- `PID-024` Shared-root workspace adoption and reconciliation
- `PID-025` Workspace archive and context lifecycle

Exit criteria:

- Users can add or clone a project into the managed root.
- Existing shell regions render live repository/workspace records instead of fixture shell data.
- Users can create a git worktree workspace from the configured branch source.
- `.context/` exists for workspace handoff files.
- Eligible gitignored files are copied through `.worktreeinclude`, repository settings, or defaults.
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

- `PID-026` PiAgentClient RPC boundary
- `PID-027` RPC process supervisor and JSONL stream handling
- `PID-028` Pi session metadata mapping
- `PID-029` Pi composer submit, stop, and model controls
- `PID-030` Structured Pi timeline rendering
- `PID-031` Runtime error retry and session-fork discovery
- `PID-032` Git-backed checkpoint capture
- `PID-033` Checkpoint restore and turn diff
- `PID-034` Chat tab limit and session tab model
- `PID-035` Pi capability discovery for modes, context, browser, and permissions

Exit criteria:

- Pi sessions launch from workspace `cwd` with normal Pi resource discovery enabled.
- RPC stdout/stderr, JSONL events, crashes, aborts, and retries are surfaced clearly.
- Timeline events show messages, tool calls, output, runtime errors, and status.
- Checkpoints are captured before Pi user prompts and mapped to workspace/session/turn metadata.
- Users can inspect turn diffs and restore files without mutating Pi session files.
- At most five chat tabs can be open per workspace; preview tabs do not count.

Primary source:

- ADR 0002, 0003, 0012, 0016, 0022, 0025
- `docs/product/open-decisions.md`
- `docs/product/ux-parity.md`

## 5. Terminal, Scripts, and Processes

Goal:
Deliver the terminal dock and local process lifecycle for setup, run, archive, manual shells, environment variables, and preview-related discovery.

Included issues:

- `PID-036` Main-process PTY service
- `PID-037` xterm.js terminal adapter and dock UI
- `PID-038` Setup, run, and archive script lifecycle
- `PID-039` Workspace environment variables and port allocation
- `PID-040` Run script concurrency and process controls
- `PID-041` Preview URL detection discovery
- `PID-042` Spotlight testing discovery

Exit criteria:

- Setup, run, archive, and named terminal sessions execute from workspace directories.
- xterm.js replaces the existing dock placeholder and can render output, handle resize, copy/paste, scrollback, and process termination states.
- Scripts receive native `PIDUCTOR_*` variables and compatibility `CONDUCTOR_*` variables when appropriate.
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

- `PID-043` Linear OAuth PKCE and token lifecycle
- `PID-044` Linear API schema and capability discovery
- `PID-045` Linear cache and sync service
- `PID-046` Linear issue browse, search, and read UI
- `PID-047` Linear issue create, update, and comment UI
- `PID-048` Workspace creation from Linear issue
- `PID-049` Linear issue status linking and remediation

Exit criteria:

- Users can connect, refresh, and disconnect Linear safely.
- Linear tokens are stored in Keychain and never in JSON or SQLite.
- Issue/team/project/status/label/cycle/assignee metadata is cached for UI responsiveness.
- Users can browse, read, create, update, and comment on issues where permissions allow.
- Users can create a Piductor workspace from a Linear issue, with issue metadata linked to the workspace.
- Archive/delete support is not implemented until schema/permission discovery confirms safe behavior.

Primary source:

- ADR 0018, 0024
- `docs/product/conductor-parity.md`
- `docs/product/open-decisions.md`

## 7. GitHub, Review, Checks, and Merge

Goal:
Implement the review flow: file status, diffs, local comments, todos, context-to-Pi, PR creation, check/comment metadata, and merge confirmation through `gh`.

Included issues:

- `PID-050` Git file status and all-files tree
- `PID-051` Changes tree and unified diff viewer
- `PID-052` Local diff comments and todos
- `PID-053` Send review/check context to Pi
- `PID-054` gh commit, push, and PR-create service
- `PID-055` gh PR/check metadata service
- `PID-056` GitHub comments and deployments discovery
- `PID-057` Checks panel states and polling
- `PID-058` Merge readiness and confirmation flow
- `PID-059` Agent-assisted review, PR, and fix action templates
- `PID-060` Archive-after-merge and branch cleanup

Exit criteria:

- Users can inspect all files, changed files, unified diffs, and local comments/todos.
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

- `PID-061` Settings shell with app and repository sections
- `PID-062` App settings sections for general, models, providers, integrations, and security
- `PID-063` Repository settings source diagnostics
- `PID-064` Appearance settings and previews
- `PID-065` Command palette and keyboard shortcuts
- `PID-066` Deep links and external-open actions
- `PID-067` Error, empty, loading, and diagnostics logs
- `PID-068` Resource usage, sidebar, and experimental flag discovery
- `PID-069` Product decision for AI certainty phrase setting

Exit criteria:

- Settings contain app-wide and repository-specific sections in one shell.
- Source precedence is visible for app and repository configuration.
- Security, permissions, Linear, `gh`, Pi readiness, and enterprise privacy are inspectable.
- Appearance controls affect code, markdown, and terminal previews.
- Command palette, shortcuts, deep links, and external-open actions cover core workflows.
- Remaining non-deferred settings decisions are recorded explicitly.

Primary source:

- ADR 0016, 0018, 0019, 0020, 0021, 0022, 0025
- `docs/product/settings-inventory.md`
- `docs/product/open-decisions.md`

## 9. Deferred / Post-Core

Goal:
Track known post-core work without letting it block v1 implementation.

Included issues:

- `PID-070` Post-core packaging, signing, notarization, and auto-update
- `PID-071` Post-core direct GitHub API and OAuth
- `PID-072` Post-core SDK sidecar fallback
- `PID-073` Post-core managed Pi runtime installer
- `PID-074` Post-core voice, Graphite, cloud SSH, and production profiler

Exit criteria:

- Deferred items are documented as future scope.
- No v1 milestone depends on these tickets.
- Each deferred ticket lists the ADRs and product docs that explain why it is out of core scope.

Primary source:

- ADR 0019, 0020, 0021, 0025
- `docs/product/open-decisions.md`
- `docs/product/docs-consistency-audit.md`
