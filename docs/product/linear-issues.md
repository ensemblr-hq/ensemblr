# Linear Issues

Date: 2026-06-04

These issue templates are ready to copy into Linear. `PID-*` IDs are local planning IDs for dependencies and can be replaced by Linear issue keys after import.

## PID-001 Electron App Shell Scaffold

Milestone: 1. Foundation
Type: Cross-cutting
Priority: P0
Dependencies: None

Summary:
Create the initial Electron + React + TypeScript application skeleton with typed main/renderer boundaries.

Scope:
- Configure Electron main process, preload, React renderer, TypeScript, Tailwind, and development scripts.
- Add typed IPC scaffolding for future app services.
- Add TanStack Router and TanStack Query providers for renderer navigation and backend/preload snapshots.
- Add the typed route tree for dashboard, history, settings, and workspace routes.

Out of scope:
- Full visual design and app feature implementation.
- Live repository/workspace, terminal, file, diff, or checks services.
- Packaging, signing, notarization, or auto-update.

Acceptance criteria:
- The app starts in development with main and renderer processes.
- Renderer can call a typed no-op IPC health endpoint.
- Renderer has Router and Query providers available without relying on Jotai route state.
- Main process owns native lifecycle hooks and menu placeholder wiring.
- Development build and typecheck pass.

Verification:
- Run app in development and confirm renderer loads.
- Run typecheck/build command.
- Add a smoke test for the IPC health endpoint if test harness exists.

Source:
- `docs/adr/0001-electron-react-shadcn.md`
- `docs/product/mvp-sequencing.md`
- `docs/product/ux-parity.md`

Implementation notes:
- Keep native capabilities in Electron main, not the renderer.
- Leave clear service boundaries for storage, config, root, Pi, terminal, GitHub, and Linear.

## PID-002 Piductor Design System Foundation

Milestone: 1. Foundation
Type: Frontend
Priority: P0
Dependencies: PID-001

Summary:
Define the initial Piductor-owned visual system using shadcn/ui source, Tailwind, and product-specific tokens.

Scope:
- Add shadcn/ui component foundation as owned source.
- Define color, spacing, typography, radius, pane, code, diff, and terminal tokens.
- Build the Conductor-style shell scaffold: project/workspace sidebar, project/branch header, chat tabs, center timeline/composer, right All files/Changes/Checks panel, and lower Setup/Run/Terminal dock.
- Build compact shell primitives for sidebar, tabs, panels, dock, forms, dialogs, banners, and status badges.
- Use fixture/local renderer models only for scaffold data; live services wire in later tickets.

Out of scope:
- Pixel-copying Conductor visuals.
- Final appearance settings UI.

Acceptance criteria:
- Core shell components render from Piductor-owned tokens.
- The style direction is distinct from Conductor and not stock shadcn defaults.
- Setup-blocked state disables the composer while keeping the workbench visible and selecting the setup dock.
- Components support light/dark or theme token switching if the app foundation already exposes it.

Verification:
- Component render tests or Storybook-like local previews if available.
- Manual visual check of app shell placeholders.

Source:
- `docs/adr/0001-electron-react-shadcn.md`
- `docs/product/ux-parity.md`
- `docs/product/settings-inventory.md`

Implementation notes:
- Keep tokens centralized so appearance settings can later bind to them.
- Preserve accessibility basics for keyboard focus and color contrast.

## PID-003 SQLite Database and Migrations

Milestone: 1. Foundation
Type: Database
Priority: P0
Dependencies: PID-001

Summary:
Add the local SQLite persistence layer for mutable Piductor app metadata.

Scope:
- Create database open/close service under the macOS app-support path.
- Add migration runner and schema version table.
- Add initial tables for repositories, workspaces, settings, sessions, terminal sessions, checkpoints, comments, todos, integration metadata, and process records.
- Add test database support.

Out of scope:
- Full final schema for every later feature.
- Secret value storage.

Acceptance criteria:
- Database opens at `~/Library/Application Support/com.piductor.app/piductor.db` in normal mode.
- Migrations run idempotently.
- Tests can use an isolated temporary database.
- Raw secrets are not represented as persistent values in SQLite.

Verification:
- Unit tests for migration idempotency and basic CRUD fixtures.
- Manual check that the app creates the database path without crashing.

Source:
- `docs/adr/0008-use-sqlite-with-declarative-user-config.md`
- `docs/product/conductor-parity.md`
- `docs/product/settings-inventory.md`

Implementation notes:
- SQLite stores mutable Piductor metadata and cache only.
- Git, Linear, GitHub, and Pi remain their respective sources of truth.

## PID-004 Keychain Secret Store

Milestone: 1. Foundation
Type: Backend/main-process
Priority: P0
Dependencies: PID-001, PID-003

Summary:
Implement a macOS Keychain-backed secret-store abstraction with a test mock.

Scope:
- Add main-process secret-store interface for create, read, update, delete, list metadata, and mask display.
- Store secret values in macOS Keychain.
- Store only secret references, scope, key name, and masked metadata in SQLite.
- Add a mock implementation for automated tests.

Out of scope:
- Linear OAuth implementation.
- Direct GitHub token support for v1.

Acceptance criteria:
- Secret values are never written to JSON or SQLite by default.
- Keychain failures return actionable typed errors.
- Renderer receives only masked metadata unless a deliberate reveal path is implemented.

Verification:
- Unit tests against mock store.
- Integration smoke test for storing and deleting a test item where safe.
- Inspect SQLite fixture to confirm no raw secret values are persisted.

Source:
- `docs/adr/0018-use-keychain-for-secrets.md`
- `docs/product/settings-inventory.md`

Implementation notes:
- Pi-owned provider secrets remain in the Pi user environment.
- Use service names/account names that can be migrated later.

## PID-005 Declarative Config Loader and JSON Schema Stub

Milestone: 1. Foundation
Type: Backend/main-process
Priority: P0
Dependencies: PID-001

Summary:
Load and validate declarative user configuration from `~/.config/piductor/config.json`.

Scope:
- Add config path resolution for `~/.config/piductor/config.json`.
- Parse strict JSON and report validation errors with file location context where practical.
- Add a versioned schema stub for app preferences, repository defaults, repository matching rules, environment policy, security preferences, and UI defaults.
- Expose config status to the renderer.

Out of scope:
- Full UI for editing config files.
- JSONC or comments support.

Acceptance criteria:
- Missing config file is treated as empty config.
- Invalid JSON/config blocks readiness only when a locked or required managed setting cannot be trusted.
- Schema version is recorded and surfaced.
- No raw secret values are accepted as the default secret storage path.

Verification:
- Unit tests for missing, valid, invalid, and unsupported-version configs.
- Manual check that config errors show in diagnostics without crashing the app.

Source:
- `docs/adr/0008-use-sqlite-with-declarative-user-config.md`
- `docs/adr/0009-use-json-for-declarative-config.md`
- `docs/product/settings-inventory.md`

Implementation notes:
- Prefer standard JSON parsing and explicit schema validation.
- Keep high-churn runtime state out of config.

## PID-006 Configuration Resolution Engine

Milestone: 1. Foundation
Type: Cross-cutting
Priority: P0
Dependencies: PID-003, PID-005

Summary:
Implement source precedence and diagnostics for app-wide and repository settings.

Scope:
- Resolve app settings from managed config, SQLite user settings, config defaults, and built-in defaults.
- Resolve repository behavior from personal SQLite settings, `piductor.json`, `conductor.json`, and built-in defaults.
- Track which source won per field.
- Expose source diagnostics to settings and setup workflows.

Out of scope:
- Parsing actual repository config files, covered by `PID-015`.
- Full settings UI, covered by later tickets.

Acceptance criteria:
- Resolution is deterministic and covered by tests.
- The winning source can be displayed per setting.
- Locked/managed settings cannot be overridden by SQLite user settings.
- Pi user environment remains the source of truth for Pi-specific auth and resources.

Verification:
- Unit tests for precedence matrix and conflict cases.
- Snapshot or fixture tests for source diagnostics payloads.

Source:
- `docs/adr/0007-support-conductor-compatible-repository-config.md`
- `docs/adr/0008-use-sqlite-with-declarative-user-config.md`
- `docs/product/settings-inventory.md`

Implementation notes:
- Make this a reusable service instead of duplicating precedence logic in UI screens.

## PID-007 Root Directory Service

Milestone: 1. Foundation
Type: Backend/main-process
Priority: P0
Dependencies: PID-003, PID-006

Summary:
Create the Piductor root-directory service and managed subdirectory layout.

Scope:
- Default root to `~/Piductor` unless config/settings override it.
- Create and validate `repos/`, `workspaces/`, and `archived-contexts/`.
- Persist current root metadata in SQLite and expose absolute paths.
- Detect missing, unwritable, non-empty, or shared-looking roots.

Out of scope:
- Root switch UX and reindex/adopt flow, covered by `PID-016`.
- Workspace adoption, covered by `PID-024`.

Acceptance criteria:
- Root and managed subdirectories are created when allowed.
- Root path is configurable and source-diagnostic aware.
- The service never deletes old roots or unknown content automatically.
- Errors distinguish permissions, missing path, invalid layout, and unsafe content.

Verification:
- Unit tests with temporary directories.
- Manual smoke test for default root creation in a safe temporary profile.

Source:
- `docs/adr/0010-use-conductor-style-root-directory.md`
- `docs/adr/0017-reindex-root-changes-with-explicit-migration.md`

Implementation notes:
- Workspace records should store absolute paths so future root changes remain explicit.

## PID-008 Local Command Environment Service

Milestone: 1. Foundation
Type: Backend/main-process
Priority: P0
Dependencies: PID-001, PID-007

Summary:
Add a main-process service for launching local commands with the expected shell-derived environment.

Scope:
- Resolve user shell environment and PATH for Electron-launched commands.
- Provide typed command execution for setup checks and later Git/Pi/gh/script services.
- Capture stdout, stderr, exit code, signal, duration, and sanitized logs.
- Add cancellation and timeout support for non-PTY commands.

Out of scope:
- Interactive PTY support, covered by `PID-036`.
- GitHub, Pi, or script domain logic.

Acceptance criteria:
- Commands run with a predictable environment from Electron main.
- Logs avoid printing secrets by default.
- Failures return typed errors suitable for setup remediation.
- Cancellation and timeout paths are covered.

Verification:
- Unit tests with simple shell commands and fake environment injection.
- Manual check that `git --version` can be executed from the service when git is installed.

Source:
- `docs/adr/0001-electron-react-shadcn.md`
- `docs/adr/0014-use-conductor-style-setup-gate.md`
- `docs/adr/0025-use-pi-cli-rpc-with-executable-discovery.md`

Implementation notes:
- This service is the base for git, `gh`, Pi discovery, and setup diagnostics.

## PID-009 Setup Gate Diagnostics UI and Model

Milestone: 2. Setup Gate and Configuration
Type: Cross-cutting
Priority: P0
Dependencies: PID-003, PID-007, PID-008

Summary:
Build the Conductor-style setup gate model and UI for required Piductor readiness checks.

Scope:
- Define stable check IDs, statuses, remediation actions, log references, and retry behavior.
- Implement first-run setup gate screen and reusable diagnostics surface.
- Include checks for git, `gh`, Pi executable/RPC, provider/model readiness, SQLite, root, managed directories, and shell/process launch.
- Offer Linear sign-in as optional unless a Linear workflow is selected.

Out of scope:
- Implementing each check's domain logic where covered by separate tickets.
- Exact visual parity with missing onboarding screenshots.

Acceptance criteria:
- The app blocks core workflows while required checks fail.
- Every failed check shows a concrete remediation path and retry action.
- Linear status is visible but does not block local/GitHub-only flows.
- Logs avoid exposing secrets or private account identifiers by default.

Verification:
- Component tests for success, failure, loading, retrying, and optional Linear states.
- Integration tests with fake check providers.

Source:
- `docs/adr/0014-use-conductor-style-setup-gate.md`
- `docs/product/onboarding-flow.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- Treat setup checks as reusable diagnostics after first launch.

## PID-010 Git and gh Readiness Checks

Milestone: 2. Setup Gate and Configuration
Type: Integration
Priority: P0
Dependencies: PID-008, PID-009

Summary:
Implement setup checks for git and authenticated GitHub CLI.

Scope:
- Detect git executable and runnable version.
- Detect `gh` executable.
- Require successful `gh auth status` for v1 readiness.
- Provide remediation for missing git, missing `gh`, and unauthenticated or insufficient `gh` auth.

Out of scope:
- PR/check workflow implementation.
- Direct GitHub OAuth/API.

Acceptance criteria:
- Setup gate reports git version on success.
- Setup gate reports `gh` auth success without printing tokens.
- Missing or failed `gh auth status` blocks v1 ready state.
- Remediation points to install `gh` or run `gh auth login`.

Verification:
- Tests with fake `git` and `gh` executables.
- Manual run against the user's actual environment if safe.

Source:
- `docs/adr/0013-use-gh-cli-for-v1-github-integration.md`
- `docs/adr/0014-use-conductor-style-setup-gate.md`
- `docs/product/onboarding-flow.md`

Implementation notes:
- Prefer `gh` JSON output where available for future workflows.

## PID-011 Pi Executable Discovery and Override

Milestone: 2. Setup Gate and Configuration
Type: Backend/main-process
Priority: P0
Dependencies: PID-005, PID-006, PID-008, PID-009

Summary:
Discover the Pi-compatible executable and support explicit user overrides.

Scope:
- Resolve explicit executable path from app settings or `~/.config/piductor/config.json`.
- Discover `pi` from shell environment and PATH.
- Check common local binary locations when shell discovery fails.
- Allow manual selection of executable or wrapper script.
- Show selected executable, version/help status where supported, and source diagnostics.

Out of scope:
- Managed/bundled Pi runtime installation.
- Full RPC process supervisor.

Acceptance criteria:
- Override can point to `pi`, wrapper scripts, or alternate launchers such as `oh-my-pi`.
- Invalid or non-executable overrides fail with remediation.
- Discovery never changes `PI_CODING_AGENT_DIR` by default.
- The selected path is persisted without storing secrets.

Verification:
- Unit tests with fake PATH and fixture executables.
- Manual check selecting a harmless wrapper that prints help/version.

Source:
- `docs/adr/0003-preserve-pi-user-environment.md`
- `docs/adr/0025-use-pi-cli-rpc-with-executable-discovery.md`
- `docs/product/onboarding-flow.md`

Implementation notes:
- Keep executable discovery separate from RPC readiness so users can diagnose each layer.

## PID-012 Pi RPC and Provider Readiness Smoke Checks

Milestone: 2. Setup Gate and Configuration
Type: Integration
Priority: P0
Dependencies: PID-008, PID-009, PID-011

Summary:
Verify that the selected Pi-compatible executable can start in RPC mode and reach usable provider/model readiness.

Scope:
- Launch selected executable with `--mode rpc` from a test workspace.
- Validate LF-delimited JSONL RPC behavior enough for setup readiness.
- Verify provider/model readiness through Pi-compatible commands or safe RPC smoke test where practical.
- Verify Pi agent directory resolves without redirecting it by default.
- Surface stdout/stderr and failures as sanitized setup diagnostics.

Out of scope:
- Full runtime supervisor and timeline rendering.
- Parsing every Pi RPC event type.

Acceptance criteria:
- Setup gate passes only when RPC smoke behavior is valid.
- No Pi disabling flags are passed by default.
- Process `cwd` is a workspace/test-workspace path.
- Provider/model failures are actionable without exposing secrets.

Verification:
- Fake RPC process tests for valid JSONL, invalid JSONL, crash, timeout, stderr, and missing provider states.
- Manual smoke test against a real selected Pi-compatible executable when available.

Source:
- `docs/adr/0003-preserve-pi-user-environment.md`
- `docs/adr/0014-use-conductor-style-setup-gate.md`
- `docs/adr/0025-use-pi-cli-rpc-with-executable-discovery.md`

Implementation notes:
- Reuse lower-level launch code later in `PiAgentClient`, but keep setup tests short and safe.

## PID-013 Workspace Trust and Permission-Mode Baseline

Milestone: 2. Setup Gate and Configuration
Type: Cross-cutting
Priority: P0
Dependencies: PID-006, PID-009

Summary:
Model Piductor's local execution trust posture and permission modes.

Scope:
- Add permission modes: `workspace-trusted`, `approval-required`, and `read-only`.
- Show first-run local-execution notice.
- Add approval/warning boundaries for outside-workspace writes, root changes, archive/delete, repository removal, merge, app settings, and Pi global config modifications.
- Persist app/repository mode settings with source diagnostics.

Out of scope:
- Full Pi permission brokering, covered by discovery in `PID-035`.
- Enterprise policy management beyond settings storage.

Acceptance criteria:
- Default mode is `workspace-trusted`.
- Users are told agents, scripts, terminals, and tools run locally with their macOS account permissions.
- High-impact actions have a confirmation model or warning boundary.
- Read-only/approval-required modes can be selected even if some enforcement awaits Pi capability discovery.

Verification:
- Unit tests for mode resolution and action classification.
- UI tests for local-execution notice and confirmation boundaries.

Source:
- `docs/adr/0016-use-workspace-trusted-local-execution.md`
- `docs/product/onboarding-flow.md`
- `docs/product/settings-inventory.md`

Implementation notes:
- Do not weaken Pi environment compatibility by disabling tools by default.

## PID-014 Environment Variable Catalog and Secret Metadata

Milestone: 2. Setup Gate and Configuration
Type: Cross-cutting
Priority: P1
Dependencies: PID-004, PID-006, PID-013

Summary:
Implement the global environment variable catalog and safe storage metadata for secret and non-secret variables.

Scope:
- Add built-in Pi-relevant and generic variable catalog entries.
- Store non-secret variable values in SQLite or config defaults as appropriate.
- Store secret values through Keychain and metadata in SQLite.
- Expose set/unset/masked status to settings and process environment builders.

Out of scope:
- Full app settings UI, covered by `PID-062`.
- Workspace env var injection, covered by `PID-039`.

Acceptance criteria:
- Secret values are masked and never persisted as raw JSON/SQLite values by default.
- Variables can be scoped globally and prepared for later repository overrides.
- Setup and diagnostics can report missing required variables without printing values.

Verification:
- Unit tests for catalog lookup, masking, metadata, and environment assembly inputs.
- Inspect SQLite fixtures for absence of raw secret values.

Source:
- `docs/adr/0018-use-keychain-for-secrets.md`
- `docs/product/settings-inventory.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- Do not duplicate Pi-owned provider secrets unless explicitly configured as Piductor-specific secrets.

## PID-015 Repository Config Parser for piductor.json, conductor.json, and .worktreeinclude

Milestone: 2. Setup Gate and Configuration
Type: Backend/main-process
Priority: P0
Dependencies: PID-006, PID-008

Summary:
Parse repository configuration files and `.worktreeinclude` with Conductor-compatible precedence and diagnostics.

Scope:
- Parse `piductor.json` and `conductor.json` from repository roots.
- Support shared script fields: `scripts.setup`, `scripts.run`, `scripts.archive`, and `runScriptMode`.
- Support `enterpriseDataPrivacy` and other compatible fields where accepted.
- Parse `.worktreeinclude` gitignore-style patterns.
- Report ignored/unsupported Conductor-specific fields safely.

Out of scope:
- Repository settings UI.
- Executing scripts or copying files.

Acceptance criteria:
- Personal settings can override `piductor.json`, then `conductor.json`, then defaults.
- `.worktreeinclude` wins over personal files-to-copy settings when present.
- Unsupported fields do not crash parsing and are visible in diagnostics.
- `CONDUCTOR_*` compatibility eligibility can be derived.

Verification:
- Fixture tests for config precedence, invalid JSON, unsupported fields, and `.worktreeinclude` patterns.

Source:
- `docs/adr/0007-support-conductor-compatible-repository-config.md`
- `docs/product/conductor-parity.md`
- `docs/product/settings-inventory.md`

Implementation notes:
- Keep Piductor-specific fields in `piductor.json`; do not overload `conductor.json` with Pi-only semantics.

## PID-016 Root Switch Reindex/Adopt Flow

Milestone: 2. Setup Gate and Configuration
Type: Cross-cutting
Priority: P0
Dependencies: PID-007, PID-009, PID-013

Summary:
Implement root-directory change behavior that switches root and reindexes/adopts by default.

Scope:
- Add confirmation UX for changing root.
- Explain switch, reindex/adopt, explicit migration, and explicit delete as separate actions.
- Detect shared/non-empty roots and show warnings.
- Trigger reconciliation after root changes.
- Preserve old root contents unless user explicitly chooses a separate destructive action.

Out of scope:
- Full shared-root workspace adoption logic, covered by `PID-024`.
- Moving repositories/workspaces between roots.

Acceptance criteria:
- Changing root never deletes old root contents automatically.
- New root is validated for writable managed layout.
- Reconciliation is invoked and errors are surfaced.
- Shared Conductor root language is clear about filesystem/git/config continuity only.

Verification:
- Integration tests with temporary old and new roots.
- UI tests for confirmation and warning copy.

Source:
- `docs/adr/0010-use-conductor-style-root-directory.md`
- `docs/adr/0011-support-conductor-root-interoperability.md`
- `docs/adr/0017-reindex-root-changes-with-explicit-migration.md`

Implementation notes:
- Never read or write Conductor's private SQLite database.

## PID-017 Project Add Menu and Recents

Milestone: 3. Repository and Workspace Core
Type: Frontend
Priority: P0
Dependencies: PID-020

Summary:
Build the project add menu with local open, GitHub clone/open, Linear issue entry, quick start placeholder, and local recents.

Scope:
- Add sidebar add-project popover.
- Show Open local project, Open GitHub project, Open Linear issue, Quick start, and recent local paths.
- Persist recents locally.
- Hide or disable entries when setup requirements are missing.

Out of scope:
- Full clone, local registration, Linear browse, or quick-start implementations.

Acceptance criteria:
- Add menu is reachable while a workspace is open.
- Recents are local-only and avoid telemetry.
- Disabled entries explain missing prerequisites.
- Entry selections route to the relevant flow.

Verification:
- Component tests for menu states.
- Manual navigation through each entry point.

Source:
- `docs/product/screen-inventory.md`
- `docs/product/conductor-parity.md`
- `docs/product/onboarding-flow.md`

Implementation notes:
- Treat project and workspace actions as distinct in menu state.

## PID-018 Local Repository Registration

Milestone: 3. Repository and Workspace Core
Type: Backend/main-process
Priority: P0
Dependencies: PID-007, PID-015, PID-020

Summary:
Register an existing local git repository as a Piductor project.

Scope:
- Validate selected local path is a git repository.
- Read remote, default branch where possible, repository name, and config files.
- Create repository record in SQLite.
- Decide whether to adopt in-place or copy/clone into managed root according to existing product guidance.
- Add clear errors for non-git paths, missing permissions, and unsupported repository state.

Out of scope:
- Exact local-project UX if future screenshots alter it.
- Workspace creation.

Acceptance criteria:
- Valid local repositories appear in the sidebar with settings source diagnostics.
- Invalid selections fail without modifying files.
- Repository records preserve absolute paths.
- Pi project `.pi` and context files are not imported or rewritten.

Verification:
- Fixture tests with git and non-git directories.
- Manual register a temporary repository.

Source:
- `docs/product/open-decisions.md`
- `docs/product/conductor-parity.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- The exact local-project open flow is a screenshot gap; keep the implementation conservative and documented.

## PID-019 GitHub Clone Flow with Progress and Errors

Milestone: 3. Repository and Workspace Core
Type: Integration
Priority: P0
Dependencies: PID-007, PID-008, PID-010, PID-015, PID-020

Summary:
Implement the GitHub clone modal and progress lifecycle for adding managed repositories.

Scope:
- Modal with repository URL, recent GitHub entries where available, managed location, browse action, validation, and submit.
- Execute clone through git/`gh`-compatible command path.
- Stream clone output into modal progress log.
- Handle auth, network, path-exists, invalid URL, and permission failures.
- Create repository record after successful clone.

Out of scope:
- Direct GitHub API/OAuth.
- Full first workspace creation after clone, covered by `PID-021` and `PID-023`.

Acceptance criteria:
- Clone button is disabled until required input is valid.
- Duplicate submission is blocked while clone runs.
- Progress and failure logs are visible and sanitized.
- Successful clone lands the user in the next workspace creation/landing path.

Verification:
- Tests with fake clone command success and failures.
- Manual clone of a safe test repository if credentials permit.

Source:
- `docs/product/screen-inventory.md`
- `docs/product/conductor-parity.md`
- `docs/adr/0013-use-gh-cli-for-v1-github-integration.md`

Implementation notes:
- Error states were not captured in screenshots; make each failure actionable rather than visually exact.

## PID-020 Sidebar Repository/Workspace Navigation

Milestone: 3. Repository and Workspace Core
Type: Frontend
Priority: P0
Dependencies: PID-002, PID-003

Summary:
Wire the persistent app shell navigation to live repository and workspace records.

Scope:
- Replace fixture project/workspace sidebar rows with SQLite-backed repository and workspace records.
- Keep the existing Dashboard, History, settings/help footer, chat-tab strip, right panel, and dock regions.
- Repository context menu for create workspace, create from issue/PR placeholders, settings, hide, and remove.
- Persist selected repository/workspace defaults where route/search state is not enough.

Out of scope:
- Full dashboard/history implementations.
- Rebuilding the structural shell regions already established by the Foundation UI pass.
- Full files/checks/terminal contents.

Acceptance criteria:
- Repository and workspace records render from SQLite state.
- Workspace selection updates center/right/dock context.
- Hide/remove actions are gated or placeholder-confirmed without deleting files.
- Empty state guides users to add a project after setup passes.

Verification:
- Component tests with fixture repository/workspace records.
- Manual navigation across multiple fixture records.

Source:
- `docs/product/ux-parity.md`
- `docs/product/screen-inventory.md`
- `docs/product/conductor-parity.md`

Implementation notes:
- Keep Piductor labels and identity distinct while preserving Conductor-like information architecture.

## PID-021 Git Worktree Workspace Creation

Milestone: 3. Repository and Workspace Core
Type: Backend/main-process
Priority: P0
Dependencies: PID-007, PID-010, PID-015, PID-020

Summary:
Create isolated git worktree workspaces under the managed root.

Scope:
- Create workspace path under `<root>/workspaces/<repo-slug>/<workspace-slug>`.
- Branch from configured default branch/source.
- Apply branch naming preferences and placeholder workspace names.
- Store workspace metadata, branch, paths, source repo, and lifecycle state in SQLite.
- Create `.context/` in each workspace.

Out of scope:
- Files-to-copy implementation, covered by `PID-022`.
- Pi session start, covered by runtime tickets.

Acceptance criteria:
- Workspace creation produces a valid git worktree on a new branch.
- Workspace is isolated from the repository root and other workspaces.
- Workspace metadata is persisted with absolute paths.
- Failures do not leave half-created SQLite records without repair information.

Verification:
- Integration tests with fixture repositories.
- Manual `git worktree list --porcelain` check after workspace creation.

Source:
- `docs/adr/0006-target-conductor-feature-parity.md`
- `docs/adr/0010-use-conductor-style-root-directory.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- Keep one workspace per shippable stream of work as the default model.

## PID-022 Files-to-Copy Implementation

Milestone: 3. Repository and Workspace Core
Type: Backend/main-process
Priority: P0
Dependencies: PID-015, PID-021

Summary:
Copy eligible gitignored files into new workspaces using `.worktreeinclude`, repository settings, or defaults.

Scope:
- Resolve files-to-copy source and patterns.
- Support gitignore-style pattern semantics.
- Only copy eligible gitignored files.
- Default to useful `.env*` behavior where no more specific source applies.
- Report copied count and skipped/invalid entries.

Out of scope:
- UI for editing files-to-copy settings.
- Copying tracked files that already exist in git.

Acceptance criteria:
- `.worktreeinclude` wins when present.
- Tracked files are never duplicated through this mechanism.
- Copy results are recorded for workspace landing summary.
- Errors are non-destructive and actionable.

Verification:
- Fixture tests with tracked files, ignored files, nested patterns, missing files, and `.worktreeinclude` precedence.

Source:
- `docs/adr/0007-support-conductor-compatible-repository-config.md`
- `docs/product/conductor-parity.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- Preserve Conductor-compatible behavior without relying on Conductor private state.

## PID-023 Workspace Landing Summary and First Composer Surface

Milestone: 3. Repository and Workspace Core
Type: Frontend
Priority: P0
Dependencies: PID-020, PID-021, PID-022

Summary:
Wire live new-workspace landing data into the existing workbench shell.

Scope:
- Render landing state after workspace creation inside the existing center timeline/composer region.
- Show branch source, copied-file count, setup-script guidance, and linked issue metadata when present.
- Populate existing empty file/checks and dock regions with workspace-specific placeholder state.
- Keep the composer shell ready to start a Pi session after runtime tickets land.

Out of scope:
- Actual Pi prompt submission.
- Full terminal, files, or checks implementation.

Acceptance criteria:
- New workspace opens immediately after creation or clone flow.
- Landing summary matches stored workspace creation data.
- Setup script guidance is visible when configured or missing.
- Composer is ready visually but disabled/explained if Pi runtime is not ready.

Verification:
- Component tests for local, clone, and Linear-linked landing variants.
- Manual create workspace and inspect landing state.

Source:
- `docs/product/screen-inventory.md`
- `docs/product/ux-parity.md`
- `docs/product/onboarding-flow.md`

Implementation notes:
- Do not copy Conductor placeholder naming style if it is distinctive.

## PID-024 Shared-Root Workspace Adoption and Reconciliation

Milestone: 3. Repository and Workspace Core
Type: Backend/main-process
Priority: P0
Dependencies: PID-007, PID-015, PID-016, PID-021

Summary:
Discover and adopt repositories/workspaces from a shared Conductor-style root using filesystem and git metadata only.

Scope:
- Scan `<root>/repos/<repo-slug>` and `<root>/workspaces/<repo-slug>/<workspace-slug>`.
- Inspect git metadata, worktree relationship, branch, remote, default branch, and PR state where available.
- Create missing Piductor SQLite records for valid discovered items.
- Mark adopted workspaces and explain origin in UI.
- Detect possible active workspace collisions.

Out of scope:
- Reading/writing Conductor private SQLite database.
- Importing Claude/Codex sessions, Conductor local comments, or private terminal state.

Acceptance criteria:
- Valid Conductor-created worktrees can appear in Piductor.
- Unknown files/directories are left untouched.
- Adoption is idempotent and repairs stale SQLite records where safe.
- The UI can distinguish created vs adopted workspaces.

Verification:
- Fixture tests with shared root, valid worktrees, invalid directories, deleted worktrees, and stale SQLite rows.
- Manual adoption of a temporary Conductor-shaped root.

Source:
- `docs/adr/0011-support-conductor-root-interoperability.md`
- `docs/adr/0015-adopt-conductor-workspaces-from-shared-root.md`
- `docs/product/conductor-parity.md`

Implementation notes:
- Do not require or interpret a `.conductor` folder for v1.

## PID-025 Workspace Archive and Context Lifecycle

Milestone: 3. Repository and Workspace Core
Type: Cross-cutting
Priority: P1
Dependencies: PID-013, PID-021

Summary:
Implement safe workspace archive lifecycle, `.context` preservation, and archived-context records.

Scope:
- Record archive intent and prepare the lifecycle hook that `PID-038` uses to run archive scripts.
- Move or record archived workspace context under `<root>/archived-contexts/` according to product behavior.
- Support explicit branch cleanup settings with confirmation.
- Preserve `.context/` handoff files and archive metadata.
- Distinguish archive, hide, remove from app, and delete files.

Out of scope:
- Archive script execution, covered by `PID-038`.
- Archive-after-merge, covered by `PID-060`.
- Destructive root cleanup or migration.

Acceptance criteria:
- Archive never silently deletes unknown content.
- Archive records preserve enough state for the later script lifecycle and after-merge flow.
- Archived state is visible in workspace/repository records.
- Delete/cleanup actions require explicit confirmation.

Verification:
- Integration tests for archive state transitions without requiring script execution.
- Fixture tests for `.context` preservation and branch cleanup settings.

Source:
- `docs/product/conductor-parity.md`
- `docs/adr/0010-use-conductor-style-root-directory.md`
- `docs/adr/0016-use-workspace-trusted-local-execution.md`

Implementation notes:
- Archive is a lifecycle action, not a filesystem shortcut.

## PID-026 PiAgentClient RPC Boundary

Milestone: 4. Pi CLI RPC Runtime and Agent Timeline
Type: Backend/main-process
Priority: P0
Dependencies: PID-011, PID-012, PID-021

Summary:
Define the `PiAgentClient` interface for CLI RPC sessions and future runtime pivots.

Scope:
- Define session creation, prompt submit, abort, event stream, metadata, error, and shutdown APIs.
- Model the selected executable, workspace `cwd`, environment, and Pi user environment preservation.
- Add adapter contract for CLI RPC implementation.
- Keep boundary compatible with possible future SDK sidecar fallback.

Out of scope:
- Full supervisor implementation.
- Renderer timeline UI.

Acceptance criteria:
- Runtime consumers use `PiAgentClient`, not raw child processes.
- The interface does not require setting `PI_CODING_AGENT_DIR` by default.
- The contract can represent model/thinking metadata and session IDs where available.
- Unit tests cover interface-level fake client behavior.

Verification:
- Typecheck and unit tests with fake client.
- Architecture review of service boundaries.

Source:
- `docs/adr/0001-electron-react-shadcn.md`
- `docs/adr/0003-preserve-pi-user-environment.md`
- `docs/adr/0025-use-pi-cli-rpc-with-executable-discovery.md`

Implementation notes:
- Keep terminal panes separate from Pi RPC.

## PID-027 RPC Process Supervisor and JSONL Stream Handling

Milestone: 4. Pi CLI RPC Runtime and Agent Timeline
Type: Backend/main-process
Priority: P0
Dependencies: PID-008, PID-026

Summary:
Implement the CLI RPC process supervisor for Pi sessions.

Scope:
- Launch selected executable with `--mode rpc` from workspace `cwd`.
- Parse LF-delimited JSONL stdout into typed events.
- Capture stderr separately.
- Handle start, stop, abort, restart, crash, timeout, backpressure, invalid JSON, and process cleanup.
- Persist runtime process/session state needed for recovery.

Out of scope:
- Full event rendering.
- Discovery of missing RPC capabilities.

Acceptance criteria:
- No Pi disabling flags are passed by default.
- Crashes and invalid protocol data produce runtime error events.
- Stop/abort behavior is deterministic and reported to the renderer.
- Supervisor can be tested with fake RPC processes.

Verification:
- Automated tests with fake JSONL process for success, stderr, invalid JSON, slow output, crash, and abort.
- Manual smoke test with a real Pi-compatible executable where available.

Source:
- `docs/adr/0003-preserve-pi-user-environment.md`
- `docs/adr/0025-use-pi-cli-rpc-with-executable-discovery.md`
- `docs/product/ux-parity.md`

Implementation notes:
- Keep stderr and protocol events distinct in storage and UI.

## PID-028 Pi Session Metadata Mapping

Milestone: 4. Pi CLI RPC Runtime and Agent Timeline
Type: Database
Priority: P0
Dependencies: PID-003, PID-026, PID-027

Summary:
Persist Piductor mappings between workspaces, Pi sessions, local tabs, turns, events, and runtime state.

Scope:
- Add/update tables for Pi sessions, session branches, events, turns, tab state, runtime state, and workspace links.
- Store external Pi session identifiers when available.
- Preserve Pi session history as Pi-owned state.
- Model adopted-workspace session mapping as nullable/unknown.

Out of scope:
- Mutating Pi session files.
- Full retry/fork semantics, covered by discovery.

Acceptance criteria:
- Piductor can reopen known workspace sessions from local metadata.
- Adopted workspaces can exist without imported Pi sessions.
- Event history is queryable by workspace and session.
- Schema supports checkpoint mapping by turn.

Verification:
- Migration tests and CRUD tests for sessions/events/turns/tabs.
- Fixture test for adopted workspace without Pi session mapping.

Source:
- `docs/adr/0003-preserve-pi-user-environment.md`
- `docs/adr/0008-use-sqlite-with-declarative-user-config.md`
- `docs/adr/0012-use-git-backed-checkpoints-for-pi-turns.md`

Implementation notes:
- Conversation history and file checkpoints are related but separate concepts.

## PID-029 Pi Composer Submit, Stop, and Model Controls

Milestone: 4. Pi CLI RPC Runtime and Agent Timeline
Type: Frontend
Priority: P0
Dependencies: PID-023, PID-026, PID-027, PID-028

Summary:
Connect the composer shell to Pi session creation, prompt submission, stop controls, and available model/thinking settings.

Scope:
- Submit first and follow-up prompts to Pi RPC sessions.
- Support stop/abort control.
- Render model and thinking-level controls from resolved settings and discovered capabilities where available.
- Support attachments/context references as structured placeholders for later review/file integrations.

Out of scope:
- Voice input.
- Full slash/run command system.

Acceptance criteria:
- First prompt creates or attaches to a Pi session from workspace `cwd`.
- Stop control aborts current work and updates UI state.
- Model/thinking controls degrade gracefully when capability discovery is incomplete.
- Submit is blocked with remediation if Pi runtime readiness fails.

Verification:
- Component/integration tests with fake `PiAgentClient`.
- Manual prompt through fake or real Pi RPC process.

Source:
- `docs/product/ux-parity.md`
- `docs/product/screen-inventory.md`
- `docs/adr/0025-use-pi-cli-rpc-with-executable-discovery.md`

Implementation notes:
- Preserve Pi `cwd` resource behavior for project `.pi`, context files, and AGENTS/CLAUDE files.

## PID-030 Structured Pi Timeline Rendering

Milestone: 4. Pi CLI RPC Runtime and Agent Timeline
Type: Frontend
Priority: P0
Dependencies: PID-027, PID-028, PID-029

Summary:
Render Pi RPC events as a structured workspace timeline.

Scope:
- Render user messages, assistant messages, status/thinking sections, tool calls, tool results, stdout/stderr cards, elapsed time, and completion state.
- Render runtime error cards with remediation affordances.
- Keep right panel and terminal dock visible during timeline work.
- Persist and rehydrate timeline from SQLite event history.

Out of scope:
- Complete retry/fork behavior until discovery lands.
- Review/check context injection.

Acceptance criteria:
- Timeline handles streaming and persisted events.
- Tool calls can expand/collapse according to settings.
- Runtime errors do not lose workspace context.
- Timeline remains usable with long sessions.

Verification:
- Component tests with event fixtures.
- Manual stream test with fake RPC events.

Source:
- `docs/product/ux-parity.md`
- `docs/product/screen-inventory.md`
- `docs/product/conductor-parity.md`

Implementation notes:
- Do not treat Pi RPC as a terminal transcript; keep the event model structured.

## PID-031 Runtime Error Retry and Session-Fork Discovery

Milestone: 4. Pi CLI RPC Runtime and Agent Timeline
Type: Docs
Priority: P0
Dependencies: PID-026, PID-027, PID-035

Summary:
Discover how Pi CLI/RPC supports retry, retry-in-new-chat, session tree navigation, continuation, fork behavior, and compaction UI.

Scope:
- Identify available Pi CLI/RPC commands/events for session branching and continuation.
- Determine how to map Conductor-style retry and retry-in-new-chat actions to Pi session tree behavior.
- Determine how checkpoint restore should interact with continuation state.
- Document gaps and fallback behavior.

Out of scope:
- Building retry/fork UI beyond placeholders.
- Mutating Pi session files directly.

Acceptance criteria:
- Discovery note states supported, unsupported, and risky behaviors.
- Recommended implementation does not corrupt Pi session history.
- If product behavior needs a decision, a Decision Needed item is added.
- Follow-up build tickets can be created or refined.

Verification:
- Run safe Pi CLI/RPC probes or inspect current Pi docs/API where available.
- Record commands, observations, and limitations in a doc.

Source:
- `docs/adr/0012-use-git-backed-checkpoints-for-pi-turns.md`
- `docs/product/open-decisions.md`
- `docs/product/ux-parity.md`

Implementation notes:
- Piductor-visible continuation can diverge from underlying Pi session history in v1 if clearly explained.

## PID-032 Git-Backed Checkpoint Capture

Milestone: 4. Pi CLI RPC Runtime and Agent Timeline
Type: Backend/main-process
Priority: P0
Dependencies: PID-021, PID-028

Summary:
Capture private git checkpoints before each Pi user prompt executes.

Scope:
- Create private refs under `refs/piductor/checkpoints/<workspace-id>/<turn-id>`.
- Associate checkpoint metadata with workspace, Pi session, turn, and git ref in SQLite.
- Capture file state before prompt execution.
- Handle dirty workspaces, untracked files policy, and checkpoint errors safely.

Out of scope:
- Restore UI and turn diff UI.
- Reusing Conductor checkpoint refs.

Acceptance criteria:
- A checkpoint is recorded before each supported Pi user prompt.
- Checkpoint refs are local/private and do not alter branch history.
- Failed checkpoint capture blocks or warns according to defined safety policy before Pi changes files.
- Metadata is queryable for turn diff and restore.

Verification:
- Fixture repo tests for clean, dirty, and untracked states.
- Manual inspect `git show-ref refs/piductor/checkpoints/...` in a temporary workspace.

Source:
- `docs/adr/0012-use-git-backed-checkpoints-for-pi-turns.md`
- `docs/product/conductor-parity.md`

Implementation notes:
- Avoid destructive git operations and do not touch unrelated refs.

## PID-033 Checkpoint Restore and Turn Diff

Milestone: 4. Pi CLI RPC Runtime and Agent Timeline
Type: Cross-cutting
Priority: P0
Dependencies: PID-030, PID-032

Summary:
Implement checkpoint turn diff and restore behavior for workspace file state.

Scope:
- Show diff between checkpoint ref and post-turn workspace state.
- Restore workspace files to selected checkpoint state.
- Hide or invalidate later Piductor-visible messages/events after restore.
- Warn when same-workspace multi-session state may conflict.
- Do not destructively edit Pi session files.

Out of scope:
- Full Conductor checkpoint-ref interoperability.
- Pi session-history mutation.

Acceptance criteria:
- Users can inspect code changes by turn.
- Restore affects workspace files and Piductor-visible continuation state only.
- Restore requires confirmation and explains Pi session-history implications.
- Restore does not delete unrelated user changes outside selected scope.

Verification:
- Fixture tests for turn diff and restore.
- Manual restore in a temporary git worktree and inspect status.

Source:
- `docs/adr/0012-use-git-backed-checkpoints-for-pi-turns.md`
- `docs/product/conductor-parity.md`
- `docs/product/docs-consistency-audit.md`

Implementation notes:
- Same-workspace multi-session restore must be conservative.

## PID-034 Chat Tab Limit and Session Tab Model

Milestone: 4. Pi CLI RPC Runtime and Agent Timeline
Type: Cross-cutting
Priority: P1
Dependencies: PID-028, PID-030

Summary:
Model chat tabs, preview tabs, and the five-open-chat-tab limit per workspace.

Scope:
- Distinguish Pi chat/session tabs from file, diff, document, and preview tabs.
- Enforce at most five open chat tabs per workspace.
- Allow more saved Pi sessions in history than currently open tabs.
- Explain limit when opening a sixth chat tab.

Out of scope:
- Full History screen.
- Document preview implementation.

Acceptance criteria:
- Five chat tabs can be open per workspace.
- Opening a sixth chat tab is blocked with clear guidance.
- Preview/file/diff tabs do not count against the chat-tab limit.
- Closed sessions can be reopened after another chat tab is closed.

Verification:
- Unit tests for tab limit logic.
- Component tests for blocked-state UI.

Source:
- `docs/adr/0022-limit-open-chat-tabs-to-five.md`
- `docs/product/open-decisions.md`

Implementation notes:
- The active Pi session history can contain more sessions than the tab strip.

## PID-035 Pi Capability Discovery for Modes, Context, Browser, and Permissions

Milestone: 4. Pi CLI RPC Runtime and Agent Timeline
Type: Docs
Priority: P0
Dependencies: PID-011, PID-012, PID-026

Summary:
Discover current Pi CLI/RPC support for model listing, review model separation, plan mode, fast mode, browser control, context usage, compaction, and permission brokering.

Scope:
- Probe or document APIs for model listing and thinking-level controls.
- Determine support for separate review model, plan mode, fast mode, browser control, and context usage display.
- Determine available tool allowlist/exclusion behavior for `approval-required` and `read-only` modes.
- Recommend which settings are enabled, disabled, or deferred.

Out of scope:
- Building the settings or permission UI.
- Changing product decisions without explicit decision record.

Acceptance criteria:
- Discovery output maps each capability to supported, unsupported, partially supported, or unknown.
- Follow-up implementation recommendations preserve Pi environment compatibility.
- Any missing capability needed for v1 is escalated as a risk or Decision Needed item.

Verification:
- Run safe CLI/RPC probes where available.
- Record tested executable/version and observed protocol behavior.

Source:
- `docs/product/open-decisions.md`
- `docs/product/settings-inventory.md`
- `docs/adr/0016-use-workspace-trusted-local-execution.md`
- `docs/adr/0025-use-pi-cli-rpc-with-executable-discovery.md`

Implementation notes:
- Do not pass disabling flags by default while probing.

## PID-036 Main-Process PTY Service

Milestone: 5. Terminal, Scripts, and Processes
Type: Backend/main-process
Priority: P0
Dependencies: PID-008, PID-021

Summary:
Add the main-process PTY service used by terminal tabs and interactive script output.

Scope:
- Create, resize, write to, read from, and terminate PTY sessions.
- Launch PTYs from workspace `cwd` with resolved environment.
- Persist terminal session metadata and lifecycle state.
- Implement safe process cleanup with SIGHUP then SIGKILL fallback where practical.

Out of scope:
- xterm.js renderer integration.
- Non-PTY command setup checks.

Acceptance criteria:
- PTY sessions can run shell commands inside a workspace.
- Resize and input/output streams work over typed IPC.
- Termination and cleanup are reliable.
- Metadata is stored without long raw buffers unless intentionally configured.

Verification:
- Integration tests for shell command output, resize, input, and termination.
- Manual test with shell, `less`, and long-running command if practical.

Source:
- `docs/adr/0002-xterm-terminal-renderer.md`
- `docs/product/conductor-parity.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- Main process owns PTY supervision; renderer only renders terminal data.

## PID-037 xterm.js Terminal Adapter and Dock UI

Milestone: 5. Terminal, Scripts, and Processes
Type: Frontend
Priority: P0
Dependencies: PID-002, PID-036

Summary:
Replace the setup/run/terminal dock placeholder with the xterm.js renderer adapter.

Scope:
- Integrate xterm.js behind a terminal adapter.
- Wire Setup, Run, and named terminal tabs in the existing lower-right dock.
- Support fit/resize, scrollback, copy/paste, links where available, and status badges.
- Keep dock visible alongside timeline and right panel.

Out of scope:
- Big terminal mode, covered by polish/discovery.
- Script lifecycle domain logic.

Acceptance criteria:
- xterm.js renders PTY output and accepts input.
- Dock can switch between setup, run, and named terminals.
- Terminal sessions show running, exited, failed, and stopped states.
- Renderer can be swapped later through adapter boundary.

Verification:
- Component/integration tests with fake PTY stream.
- Manual terminal smoke test in a temporary workspace.

Source:
- `docs/adr/0002-xterm-terminal-renderer.md`
- `docs/product/ux-parity.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- Keep Pi RPC timeline separate from manual/raw terminal sessions.

## PID-038 Setup, Run, and Archive Script Lifecycle

Milestone: 5. Terminal, Scripts, and Processes
Type: Integration
Priority: P0
Dependencies: PID-015, PID-021, PID-036, PID-037

Summary:
Run repository setup, run, and archive scripts inside workspace context with visible output and controls.

Scope:
- Execute `scripts.setup` on workspace creation or manual rerun.
- Execute `scripts.run` from Run tab/button.
- Execute `scripts.archive` before archive lifecycle.
- Show output in terminal dock with rerun, stop, success, and failure states.
- Store process metadata and logs as appropriate.

Out of scope:
- Run mode concurrency details, covered by `PID-040`.
- Full archive lifecycle, covered by `PID-025`.

Acceptance criteria:
- Scripts run from workspace directory.
- Script source and command are visible without exposing secrets.
- Setup output remains visible while user works elsewhere.
- Failures are actionable and do not leave process state stuck.

Verification:
- Fixture tests with configured scripts that pass, fail, hang, and write output.
- Manual run setup/rerun/stop in a temporary workspace.

Source:
- `docs/adr/0007-support-conductor-compatible-repository-config.md`
- `docs/product/conductor-parity.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- Scripts must use resolved repository config and environment variables.

## PID-039 Workspace Environment Variables and Port Allocation

Milestone: 5. Terminal, Scripts, and Processes
Type: Cross-cutting
Priority: P0
Dependencies: PID-006, PID-014, PID-021, PID-038

Summary:
Inject native and Conductor-compatible workspace environment variables into scripts, terminals, and Pi sessions as appropriate.

Scope:
- Define `PIDUCTOR_WORKSPACE_NAME`, `PIDUCTOR_WORKSPACE_PATH`, `PIDUCTOR_ROOT_PATH`, `PIDUCTOR_DEFAULT_BRANCH`, `PIDUCTOR_PORT`, and related variables.
- Expose matching `CONDUCTOR_*` variables for Conductor-compatible repositories or explicit opt-in.
- Allocate stable workspace port ranges.
- Include configured environment variables and secrets safely.

Out of scope:
- Provider-specific Pi secrets not owned by Piductor.
- Preview URL detection.

Acceptance criteria:
- Scripts receive native variables in all workspaces.
- Compatibility variables map to the same values when enabled.
- Port allocation avoids obvious collisions across active workspaces.
- Secret values are injected only into intended process environments and never logged by default.

Verification:
- Unit tests for environment assembly and compatibility mapping.
- Integration test script prints non-secret expected variables in a fixture workspace.

Source:
- `docs/adr/0007-support-conductor-compatible-repository-config.md`
- `docs/product/conductor-parity.md`
- `docs/product/settings-inventory.md`

Implementation notes:
- Environment construction should be reusable by terminal, script, Pi, and GitHub workflows.

## PID-040 Run Script Concurrency and Process Controls

Milestone: 5. Terminal, Scripts, and Processes
Type: Integration
Priority: P1
Dependencies: PID-038, PID-039

Summary:
Implement `concurrent` and `nonconcurrent` run script modes and reliable run controls.

Scope:
- Respect `runScriptMode` from resolved repository config.
- In nonconcurrent mode, prevent duplicate active run processes unless user explicitly restarts.
- In concurrent mode, allow multiple named run sessions where UI supports it.
- Add stop, restart, rerun, and stale-process recovery behavior.

Out of scope:
- Big terminal layout.
- Spotlight testing.

Acceptance criteria:
- Run mode behavior matches resolved config.
- Users cannot accidentally start duplicate nonconcurrent runs.
- Stop and restart actions clean up process state.
- UI explains active process conflicts.

Verification:
- Integration tests for concurrent and nonconcurrent modes.
- Manual run/start/stop/restart in a fixture workspace.

Source:
- `docs/adr/0007-support-conductor-compatible-repository-config.md`
- `docs/product/conductor-parity.md`

Implementation notes:
- Store enough process metadata to recover after app reload.

## PID-041 Preview URL Detection Discovery

Milestone: 5. Terminal, Scripts, and Processes
Type: Docs
Priority: P1
Dependencies: PID-038, PID-039

Summary:
Discover safe preview URL detection from setup/run output and repository preview URL templates.

Scope:
- Evaluate log parsing patterns for localhost/server URLs.
- Determine how preview templates should expand `PIDUCTOR_*` and compatibility variables.
- Identify false positive and privacy risks.
- Recommend build scope for automatic detection versus explicit template configuration.

Out of scope:
- Building automatic preview URL detection.
- External deployment provider integration.

Acceptance criteria:
- Discovery note describes reliable patterns and unsafe patterns.
- Recommendation preserves user privacy and avoids exposing private paths unnecessarily.
- Follow-up build ticket is created if automatic detection is accepted for v1.

Verification:
- Test sample logs from common dev servers if available.
- Document limitations and examples.

Source:
- `docs/product/open-decisions.md`
- `docs/product/settings-inventory.md`
- `docs/product/conductor-parity.md`

Implementation notes:
- Explicit repository preview URL templates are safer than aggressive log scraping.

## PID-042 Spotlight Testing Discovery

Milestone: 5. Terminal, Scripts, and Processes
Type: Docs
Priority: P1
Dependencies: PID-021, PID-038

Summary:
Discover how to implement spotlight testing without overwriting root changes or violating workspace isolation.

Scope:
- Define candidate sync strategies between workspace changes and root-running app behavior.
- Identify conflict detection requirements for root changes.
- Define rollback and confirmation requirements.
- Recommend whether spotlight testing is v1 build scope or post-core.

Out of scope:
- Building spotlight testing.
- Altering root/workspace lifecycle decisions.

Acceptance criteria:
- Discovery note explains risks, safe minimum behavior, and unresolved product decisions.
- The recommendation never silently overwrites root changes.
- Follow-up build ticket or deferred note is created.

Verification:
- Evaluate fixture repositories with root changes and workspace changes.
- Document failure modes and safe guards.

Source:
- `docs/product/open-decisions.md`
- `docs/product/settings-inventory.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- Treat this as high-risk until conflict behavior is proven.

## PID-043 Linear OAuth PKCE and Token Lifecycle

Milestone: 6. Linear Integration
Type: Integration
Priority: P0
Dependencies: PID-004, PID-009

Summary:
Implement Linear OAuth login, callback handling, token refresh, disconnect, and Keychain storage.

Scope:
- OAuth2 with PKCE where practical for desktop login.
- Validate state and callback parameters.
- Store access and refresh tokens in Keychain.
- Store non-secret connection metadata in SQLite.
- Support refresh, disconnect, revoke/remediation where available.

Out of scope:
- Issue CRUD UI.
- Linear archive/delete operations.

Acceptance criteria:
- Users can connect and disconnect Linear.
- Tokens are never persisted in SQLite or JSON.
- Expired tokens refresh or produce actionable reconnect states.
- Linear connection status appears in setup/settings without blocking non-Linear workflows.

Verification:
- Unit tests for PKCE/state validation and token metadata.
- Mock OAuth callback integration test.
- Manual OAuth test against a development Linear app if configured.

Source:
- `docs/adr/0024-use-linear-oauth-for-v1-issue-integration.md`
- `docs/adr/0018-use-keychain-for-secrets.md`
- `docs/product/onboarding-flow.md`

Implementation notes:
- If desktop PKCE constraints require a variation, document it before merging.

## PID-044 Linear API Schema and Capability Discovery

Milestone: 6. Linear Integration
Type: Docs
Priority: P0
Dependencies: PID-043

Summary:
Discover current Linear SDK/GraphQL schema coverage, permissions, pagination, filtering, and archive/delete support.

Scope:
- Validate fields needed for teams, projects, cycles, labels, statuses, assignees, priority, comments, and due dates.
- Determine SDK vs direct GraphQL query shapes.
- Determine pagination, filtering, rate limit, and permission-error handling.
- Verify archive/delete schema and permission support before any destructive UI is planned.

Out of scope:
- Implementing issue CRUD.
- Creating actual Linear issues during discovery unless using a safe test workspace and explicitly approved.

Acceptance criteria:
- Discovery note maps required v1 operations to SDK or GraphQL implementation paths.
- Archive/delete remains discovery-only unless support and permission behavior are verified.
- Cache metadata requirements are documented.

Verification:
- Use mocked schema or safe development Linear workspace if available.
- Record tested SDK/API version and relevant query shapes.

Source:
- `docs/adr/0024-use-linear-oauth-for-v1-issue-integration.md`
- `docs/product/open-decisions.md`

Implementation notes:
- Do not use the Linear connector for this planning task; app implementation will use Linear APIs/SDK.

## PID-045 Linear Cache and Sync Service

Milestone: 6. Linear Integration
Type: Database
Priority: P0
Dependencies: PID-003, PID-043, PID-044

Summary:
Implement Linear API client, sync, and SQLite cache for issue and metadata responsiveness.

Scope:
- Add `LinearService` boundary using `@linear/sdk` where practical and direct GraphQL where needed.
- Cache issues, teams, projects, statuses, labels, cycles, assignees, comments, and connection metadata.
- Treat Linear as source of truth and cache as refreshable.
- Handle pagination, rate limits, token refresh, and permission errors.

Out of scope:
- Full issue UI.
- Archive/delete build unless discovery permits it.

Acceptance criteria:
- Service can list/search/read issues through authenticated Linear connection.
- Cache updates are idempotent and scoped to connected user/workspace.
- Permission and rate-limit errors surface typed remediation.
- No tokens are cached in SQLite.

Verification:
- Unit tests with mocked Linear client and paginated responses.
- Integration test with fixture API responses for cache refresh.

Source:
- `docs/adr/0024-use-linear-oauth-for-v1-issue-integration.md`
- `docs/adr/0008-use-sqlite-with-declarative-user-config.md`

Implementation notes:
- Keep remote IDs, identifiers, URLs, team, and title available for workspace linking.

## PID-046 Linear Issue Browse, Search, and Read UI

Milestone: 6. Linear Integration
Type: Frontend
Priority: P0
Dependencies: PID-043, PID-045

Summary:
Build the Linear issue browsing, searching, and read-detail UI.

Scope:
- List/search issues visible to the connected user.
- Show issue detail with comments, team, project, cycle, labels, assignee, priority, status, due date, URL, and metadata.
- Add loading, empty, disconnected, permission, and rate-limit states.
- Provide entry point from project add menu and settings/integration status.

Out of scope:
- Creating/updating/commenting on issues.
- Workspace creation from issue.

Acceptance criteria:
- Connected users can find and open Linear issues.
- Disconnected users see sign-in remediation.
- Metadata is refreshed from Linear while using cache for responsiveness.
- Private issue content is not logged unnecessarily.

Verification:
- Component tests with fixture issue data and error states.
- Integration tests with mocked `LinearService`.

Source:
- `docs/adr/0024-use-linear-oauth-for-v1-issue-integration.md`
- `docs/product/conductor-parity.md`
- `docs/product/onboarding-flow.md`

Implementation notes:
- Keep workspace creation action visible but disabled until `PID-048` lands.

## PID-047 Linear Issue Create, Update, and Comment UI

Milestone: 6. Linear Integration
Type: Integration
Priority: P1
Dependencies: PID-045, PID-046

Summary:
Implement first-class Linear issue create, update, and comment actions.

Scope:
- Create issues with title, description, team, project, labels, priority, status, cycle, assignee, due date where permissions allow.
- Update supported issue fields.
- Add comments to issues.
- Show validation, permission, optimistic/pending, and failure states.

Out of scope:
- Archive/delete issue support unless discovery explicitly validates safe implementation.
- Creating actual Linear issues outside user-confirmed UI actions.

Acceptance criteria:
- Users can create issues where they have permission.
- Users can update supported fields and see refreshed source-of-truth state.
- Users can comment on issues and see comment sync.
- Unsupported fields or permission failures are clear and non-destructive.

Verification:
- Tests with mocked create/update/comment success and errors.
- Manual test in a safe Linear team if available.

Source:
- `docs/adr/0024-use-linear-oauth-for-v1-issue-integration.md`
- `docs/product/conductor-parity.md`

Implementation notes:
- Treat field-level support as capability-dependent and schema-driven.

## PID-048 Workspace Creation from Linear Issue

Milestone: 6. Linear Integration
Type: Cross-cutting
Priority: P0
Dependencies: PID-021, PID-023, PID-045, PID-046

Summary:
Create a Piductor workspace from a selected Linear issue and seed workspace context from issue metadata.

Scope:
- Add create-workspace action on Linear issue detail/list.
- Seed workspace name, branch name, initial Pi prompt, and PR metadata from issue identifier/title/context.
- Store Linear issue ID, identifier, URL, team, and title on the workspace record.
- Open workspace landing with linked Linear context visible.

Out of scope:
- Silent Linear status changes.
- Full Pi prompt execution beyond existing composer/runtime behavior.

Acceptance criteria:
- User can choose a Linear issue and create a git worktree workspace.
- Workspace record links to Linear issue metadata.
- Initial composer/timeline can include issue context for Pi.
- Any Linear status update is explicit, not silent.

Verification:
- Integration test with mocked Linear issue and fixture repository.
- Manual flow from Linear issue to workspace landing.

Source:
- `docs/adr/0024-use-linear-oauth-for-v1-issue-integration.md`
- `docs/product/onboarding-flow.md`
- `docs/product/conductor-parity.md`

Implementation notes:
- Use same worktree creation path as local/GitHub workspace creation.

## PID-049 Linear Issue Status Linking and Remediation

Milestone: 6. Linear Integration
Type: Integration
Priority: P1
Dependencies: PID-045, PID-047, PID-048

Summary:
Expose linked Linear issue status on workspaces and support explicit status updates/remediation.

Scope:
- Show linked Linear issue status in workspace and settings surfaces.
- Allow explicit status update actions where permissions allow.
- Handle stale, missing, disconnected, permission-denied, and archived issue states.
- Add refresh/reconnect remediation.

Out of scope:
- Silent automatic status changes.
- Archive/delete mutations unless discovery validates them.

Acceptance criteria:
- Linked workspaces show current issue status and URL.
- Status changes require clear user action or configured repository behavior with UI indication.
- Permission failures do not break local workspace usage.
- Stale cache can be refreshed.

Verification:
- Mocked service tests for status updates and error states.
- Component tests for linked issue banners/cards.

Source:
- `docs/adr/0024-use-linear-oauth-for-v1-issue-integration.md`
- `docs/product/conductor-parity.md`

Implementation notes:
- Linear remains source of truth for issue state.

## PID-050 Git File Status and All-Files Tree

Milestone: 7. GitHub, Review, Checks, and Merge
Type: Backend/main-process
Priority: P0
Dependencies: PID-021, PID-008

Summary:
Implement workspace file status and all-files tree services.

Scope:
- Query repository file tree and workspace git status.
- Report tracked, modified, added, deleted, renamed, untracked, and ignored states where relevant.
- Replace fixture rows in the existing All files tab with the workspace tree.
- Cache only derived UI metadata as needed.

Out of scope:
- Unified diff body and comments.
- GitHub PR metadata.

Acceptance criteria:
- All-files tab can render a workspace tree.
- Git status is accurate for fixture repositories.
- Service handles large repositories with reasonable performance.
- Errors are surfaced without corrupting workspace state.

Verification:
- Fixture repo tests for file states.
- Manual inspect status versus `git status --short`.

Source:
- `docs/product/conductor-parity.md`
- `docs/product/ux-parity.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- Git/worktree state is source of truth for files and diffs.

## PID-051 Changes Tree and Unified Diff Viewer

Milestone: 7. GitHub, Review, Checks, and Merge
Type: Cross-cutting
Priority: P0
Dependencies: PID-050

Summary:
Wire the existing Changes panel to grouped file status and unified diffs.

Scope:
- Replace fixture change rows with a folder-grouped changed-file tree with status badges and line counts.
- Search/filter and list/tree display controls.
- Unified diff viewer with code theme support.
- Commit filtering support where practical.

Out of scope:
- Local line comments.
- Turn diff from checkpoints, covered by `PID-033` and UI reuse.

Acceptance criteria:
- Changes tree reflects current git status.
- Selecting a file displays a unified diff.
- Empty and error states are implemented.
- UI can stay visible while timeline/terminal work continues.

Verification:
- Component tests with diff fixtures.
- Integration test against fixture repository changes.

Source:
- `docs/product/screen-inventory.md`
- `docs/product/conductor-parity.md`
- `docs/product/ux-parity.md`

Implementation notes:
- The screenshot set lacks full line-comment details, so keep diff viewer extensible.

## PID-052 Local Diff Comments and Todos

Milestone: 7. GitHub, Review, Checks, and Merge
Type: Database
Priority: P1
Dependencies: PID-003, PID-051

Summary:
Implement local review comments and todos stored in SQLite.

Scope:
- Add line comments on diffs.
- Add workspace review todos from checks/review context.
- Store comments/todos with workspace, file, line/range where applicable, author/local timestamp, status, and source.
- Support edit/delete/resolve local items.

Out of scope:
- GitHub review-thread mutation.
- Sending context to Pi, covered by `PID-053`.

Acceptance criteria:
- Users can add local comments to diff lines.
- Users can add and resolve todos in review/checks context.
- Comments/todos persist across app reload.
- Local comments are clearly distinguished from GitHub comments.

Verification:
- CRUD tests for comments/todos.
- Component tests for add/edit/resolve flows.

Source:
- `docs/product/conductor-parity.md`
- `docs/product/screen-inventory.md`
- `docs/adr/0008-use-sqlite-with-declarative-user-config.md`

Implementation notes:
- Prefer GitHub-visible state for cross-app continuity when available; local comments are Piductor-specific.

## PID-053 Send Review/Check Context to Pi

Milestone: 7. GitHub, Review, Checks, and Merge
Type: Cross-cutting
Priority: P0
Dependencies: PID-029, PID-051, PID-052, PID-057

Summary:
Allow selected files, diffs, comments, todos, check failures, and review context to be added to Pi chat context.

Scope:
- Create context payloads for selected files, diffs, local comments, GitHub comments, check failures, and todos.
- Insert context into composer or directly submit to Pi with user confirmation.
- Preserve source references for traceability.
- Avoid exceeding practical context limits where Pi reports usage.

Out of scope:
- Automatically sending all data without user action.
- Voice or attachment features beyond text/context references.

Acceptance criteria:
- User can add selected review items to Pi context.
- Context payload identifies source and workspace state.
- Large context is summarized or blocked with explanation where needed.
- Pi submission uses existing session/composer path.

Verification:
- Unit tests for context payload serialization.
- UI tests for adding file/diff/comment/check context to composer.

Source:
- `docs/product/conductor-parity.md`
- `docs/product/ux-parity.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- If Pi context usage is unavailable, use conservative size limits until `PID-035` clarifies capability.

## PID-054 gh Commit, Push, and PR-Create Service

Milestone: 7. GitHub, Review, Checks, and Merge
Type: Integration
Priority: P0
Dependencies: PID-010, PID-021, PID-050

Summary:
Implement service operations for committing, pushing, and creating pull requests through git and `gh`.

Scope:
- Stage only intended workspace changes.
- Commit with user-confirmed or agent-generated message.
- Push branch and set upstream according to settings.
- Create PR through `gh pr create` with title/body/base/head metadata.
- Surface auth, permission, remote, merge-base, and dirty-state errors.

Out of scope:
- Direct GitHub API/OAuth.
- Full agent-assisted PR workflow UI, covered by `PID-059`.

Acceptance criteria:
- PR creation uses workspace branch and repository remote context.
- Service avoids committing unrelated files by default.
- `gh` failures are shown with remediation and no hidden retry loop.
- Output parsing prefers JSON or structured data where available.

Verification:
- Tests with mocked git/gh commands.
- Manual dry-run or test repository PR flow where safe.

Source:
- `docs/adr/0013-use-gh-cli-for-v1-github-integration.md`
- `docs/product/screen-inventory.md`
- `docs/product/conductor-parity.md`

Implementation notes:
- Keep a `GitHubService` boundary so direct API can be added later.

## PID-055 gh PR/Check Metadata Service

Milestone: 7. GitHub, Review, Checks, and Merge
Type: Integration
Priority: P0
Dependencies: PID-010, PID-054

Summary:
Fetch and cache PR metadata and check status through authenticated `gh`.

Scope:
- Use `gh pr view`, `gh pr checks`, and related commands where practical.
- Cache PR number, title, body, URL, branch, status, checks, deployments where exposed, and mergeability signals in SQLite.
- Treat GitHub as source of truth and refresh on demand/polling.
- Surface missing PR, uncommitted, pending, failing, passed, and permissions states.

Out of scope:
- Comment/review-thread detail discovery, covered by `PID-056`.
- Merge action, covered by `PID-058`.

Acceptance criteria:
- Service can detect no-PR and existing-PR states.
- Checks are parsed into stable status models.
- Cache refresh is idempotent.
- `gh` parse failures are visible and do not crash checks panel.

Verification:
- Fixture tests with mocked `gh` JSON/output for common states.
- Manual check against a safe PR if available.

Source:
- `docs/adr/0013-use-gh-cli-for-v1-github-integration.md`
- `docs/product/conductor-parity.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- Use direct API only as deferred follow-up if `gh` coverage is insufficient.

## PID-056 GitHub Comments and Deployments Discovery

Milestone: 7. GitHub, Review, Checks, and Merge
Type: Docs
Priority: P0
Dependencies: PID-055

Summary:
Discover whether `gh` exposes enough detail for review comments, review threads, deployments, add-all-comments-to-chat, and failed-check remediation.

Scope:
- Evaluate `gh` commands and JSON fields for PR comments, review threads, checks, annotations, deployments, and preview URLs.
- Determine whether comments can be resolved or responded to through `gh` for v1.
- Identify gaps requiring direct GitHub API post-core.
- Recommend minimum v1 checks-panel comment behavior.

Out of scope:
- Implementing direct GitHub API.
- Building comment mutation UI.

Acceptance criteria:
- Discovery note maps each needed capability to `gh`, unavailable, or deferred API path.
- Add-all-comments-to-chat feasibility is documented.
- Failed-check remediation data availability is documented.

Verification:
- Probe `gh` against safe public/test PRs or use captured fixtures.
- Record command versions and observed fields.

Source:
- `docs/product/open-decisions.md`
- `docs/adr/0013-use-gh-cli-for-v1-github-integration.md`
- `docs/product/docs-consistency-audit.md`

Implementation notes:
- Do not promote direct GitHub API into v1 unless product scope changes.

## PID-057 Checks Panel States and Polling

Milestone: 7. GitHub, Review, Checks, and Merge
Type: Cross-cutting
Priority: P0
Dependencies: PID-052, PID-055, PID-056

Summary:
Wire the existing Checks panel to GitHub PR metadata, checks, comments, todos, deployments, and blockers.

Scope:
- Replace fixture checks with no-PR, uncommitted, pending/failing, and ready-to-merge state shells.
- Show PR metadata, external PR link, git status, checks, deployments where available, comments/review threads where available, and todos.
- Poll/refresh metadata through service with manual refresh.
- Show add-to-Pi-context actions for supported items.

Out of scope:
- Merge confirmation.
- Direct API-only comments if discovery defers them.

Acceptance criteria:
- Each documented checks state has a distinct UI.
- Pending/failing states show blockers.
- Ready state only appears when policy signals are satisfied.
- Data source and refresh errors are visible.

Verification:
- Component tests with fixture state payloads.
- Integration tests with mocked GitHub service.

Source:
- `docs/product/screen-inventory.md`
- `docs/product/ux-parity.md`
- `docs/product/conductor-parity.md`

Implementation notes:
- Keep merge action disabled or hidden until `PID-058` lands.

## PID-058 Merge Readiness and Confirmation Flow

Milestone: 7. GitHub, Review, Checks, and Merge
Type: Integration
Priority: P0
Dependencies: PID-013, PID-055, PID-057

Summary:
Implement Conductor-style ready-to-merge action and explicit final merge confirmation through `gh pr merge`.

Scope:
- Compute merge readiness from PR/check/comment/todo/blocker state.
- Show prominent ready action only when required checks pass and no unresolved blockers remain.
- Confirmation summarizes branch, PR, check state, unresolved comments/todos, and archive behavior.
- Execute final merge through `gh pr merge` where permissions allow.
- Expose warning override only if GitHub/repo policy allows and user explicitly confirms.

Out of scope:
- Automerge beyond explicit supported action.
- Direct GitHub API merge.

Acceptance criteria:
- Merge never happens on the first click.
- Failing required checks block merge by default.
- `gh` failures are shown clearly with no hidden retry loops.
- Successful merge updates workspace/PR state.

Verification:
- Tests with mocked PR states and `gh pr merge` success/failure.
- Manual test in safe repository if available.

Source:
- `docs/adr/0023-use-conductor-style-merge-confirmation.md`
- `docs/adr/0013-use-gh-cli-for-v1-github-integration.md`
- `docs/product/screen-inventory.md`

Implementation notes:
- Merge is externally visible and should be treated as irreversible/high-impact.

## PID-059 Agent-Assisted Review, PR, and Fix Action Templates

Milestone: 7. GitHub, Review, Checks, and Merge
Type: Cross-cutting
Priority: P1
Dependencies: PID-029, PID-053, PID-054, PID-057, PID-063

Summary:
Implement repository action preferences and agent-assisted workflows for review, create PR, fix errors, resolve conflicts, branch rename, and general Pi instructions.

Scope:
- Load action-specific instruction templates from personal settings and repository config where safe.
- Provide actions for code review, create PR, fix check errors, resolve conflicts, branch naming, and general chat defaults.
- Route actions through Pi composer/session with relevant context.
- Show action progress in timeline and side panels.

Out of scope:
- New model capability discovery.
- Fully automatic PR creation without user confirmation.

Acceptance criteria:
- Action preferences are resolved with source diagnostics.
- Agent-assisted actions include relevant workspace/PR/check context.
- Users can inspect or edit generated prompts before irreversible actions.
- Actions avoid committing or merging without explicit user confirmation.

Verification:
- Unit tests for template resolution.
- Component/integration tests using fake Pi client and fake GitHub service.

Source:
- `docs/product/settings-inventory.md`
- `docs/product/screen-inventory.md`
- `docs/product/conductor-parity.md`

Implementation notes:
- Store Pi-specific shared templates in `piductor.json` when shared config is appropriate.

## PID-060 Archive-After-Merge and Branch Cleanup

Milestone: 7. GitHub, Review, Checks, and Merge
Type: Cross-cutting
Priority: P1
Dependencies: PID-025, PID-058

Summary:
Apply archive-after-merge and local branch cleanup settings after successful merge.

Scope:
- Read archive-on-merge and delete-local-branch-on-archive settings.
- Offer or run archive after successful merge according to policy.
- Delete local branch only with explicit setting and safe state.
- Show confirmation for destructive cleanup.

Out of scope:
- Remote branch deletion settings not documented as v1 app behavior.
- Graphite stack cleanup.

Acceptance criteria:
- Successful merge leads to correct archive offer/action.
- Branch deletion never runs without explicit setting and confirmation where required.
- Cleanup failures do not hide successful merge state.
- Workspace lifecycle updates are persisted.

Verification:
- Integration tests with mocked merge and fixture branches.
- Manual safe test in temporary repository.

Source:
- `docs/adr/0023-use-conductor-style-merge-confirmation.md`
- `docs/product/settings-inventory.md`

Implementation notes:
- Keep archive behavior consistent whether triggered manually or after merge.

## PID-061 Settings Shell with App and Repository Sections

Milestone: 8. Settings and Parity Polish
Type: Frontend
Priority: P0
Dependencies: PID-002, PID-003, PID-020

Summary:
Build the full-window settings shell with app-wide sections and local repository sections.

Scope:
- Settings route/window with Back to app action.
- Sidebar sections for General, Models, Providers, Environment, Appearance, Git, Account/Integrations, Experimental, Advanced.
- Repository settings entries below app-wide sections.
- Narrow centered forms with inline controls and source-diagnostics slots.

Out of scope:
- Implementing every settings form field.
- Piductor account/sign-in.

Acceptance criteria:
- Settings shell can switch app and repository sections.
- Back to app returns to prior workspace context.
- Repository settings list reflects known repositories.
- Empty/loading/error states exist.

Verification:
- Component tests for navigation and section switching.
- Manual navigation from app shell to settings and back.

Source:
- `docs/product/settings-inventory.md`
- `docs/product/screen-inventory.md`
- `docs/product/ux-parity.md`

Implementation notes:
- Do not expose deferred account/cloud features as active v1 settings.

## PID-062 App Settings Sections for General, Models, Providers, Integrations, and Security

Milestone: 8. Settings and Parity Polish
Type: Frontend
Priority: P0
Dependencies: PID-006, PID-009, PID-013, PID-014, PID-035, PID-043, PID-061

Summary:
Implement app-wide settings forms for core behavior, Pi model/provider readiness, environment, GitHub CLI, Linear, privacy, and permission modes.

Scope:
- General settings for send shortcut, follow-up behavior, notifications, sound, context/tool-call visibility, and caffeinate behavior where supported.
- Models/providers settings using Pi capability discovery and readiness state.
- Environment variable UI using safe secret metadata.
- Account/integrations surface focused on `gh` CLI status, Linear OAuth status, enterprise data privacy, and permission mode.
- Advanced settings for root and Pi executable paths.

Out of scope:
- Piductor account sign-in.
- Direct GitHub token field for v1.
- Voice, Graphite, cloud SSH, and production React profiler controls.

Acceptance criteria:
- Settings reflect real resolved sources and statuses.
- Unsupported Pi capabilities are disabled with explanation, not guessed.
- Secrets are masked and managed through Keychain-backed paths.
- Security settings map to permission-mode baseline.

Verification:
- Component tests for each settings section and status state.
- Unit tests for settings save/resolve behavior.

Source:
- `docs/product/settings-inventory.md`
- `docs/product/screen-inventory.md`
- `docs/adr/0019-defer-piductor-account-for-v1.md`
- `docs/adr/0024-use-linear-oauth-for-v1-issue-integration.md`

Implementation notes:
- Direct GitHub API/OAuth remains post-core; v1 uses authenticated `gh`.

## PID-063 Repository Settings Source Diagnostics

Milestone: 8. Settings and Parity Polish
Type: Cross-cutting
Priority: P0
Dependencies: PID-006, PID-015, PID-038, PID-059, PID-061

Summary:
Implement repository settings forms and source diagnostics for paths, branch, remote, preview, files-to-copy, scripts, spotlight, action preferences, and removal.

Scope:
- Repository identity/path, branch source, remote origin, branch naming, preview template, files-to-copy, scripts, run mode, create shared config file, spotlight flag, action preferences, hide/remove actions.
- Show which source won per field.
- Write personal overrides to SQLite and shared team config to `piductor.json` where explicitly requested.
- Preserve `conductor.json` compatibility and diagnostics.

Out of scope:
- Building spotlight behavior before discovery.
- Destructive repository file deletion without explicit confirmation path.

Acceptance criteria:
- Users can inspect and edit repository overrides.
- Source precedence is visible and correct.
- Creating shared config writes `piductor.json` first.
- Remove repository distinguishes app record removal from deleting files.

Verification:
- Component tests with source-diagnostics fixtures.
- Integration tests for writing personal overrides and `piductor.json`.

Source:
- `docs/product/settings-inventory.md`
- `docs/product/screen-inventory.md`
- `docs/adr/0007-support-conductor-compatible-repository-config.md`

Implementation notes:
- Never move/delete repository or workspace directories from normal settings edits.

## PID-064 Appearance Settings and Previews

Milestone: 8. Settings and Parity Polish
Type: Frontend
Priority: P1
Dependencies: PID-002, PID-037, PID-051, PID-061

Summary:
Implement appearance settings for themes, accessibility, code/diff rendering, markdown, and terminal typography with live previews.

Scope:
- Theme, colored sidebar diffs, accessible colors, code theme, monospace font, ligatures, markdown style, terminal font, and terminal font size.
- Preview blocks for code, markdown, diff, and terminal output.
- Persist preferences in SQLite with optional config defaults.

Out of scope:
- Copying Conductor color palette or typography.
- Production React profiler controls.

Acceptance criteria:
- Preferences update previews immediately.
- Settings persist and apply to relevant surfaces.
- Defaults use Piductor visual identity and tokens.
- Accessibility variants maintain readable contrast.

Verification:
- Component tests for controls and previews.
- Manual visual check across app shell, diff, markdown, and terminal.

Source:
- `docs/product/settings-inventory.md`
- `docs/product/screen-inventory.md`
- `docs/adr/0001-electron-react-shadcn.md`

Implementation notes:
- Avoid generic stock shadcn dashboard aesthetics.

## PID-065 Command Palette and Keyboard Shortcuts

Milestone: 8. Settings and Parity Polish
Type: Frontend
Priority: P1
Dependencies: PID-020, PID-023, PID-037, PID-057, PID-061

Summary:
Implement global command palette and keyboard shortcuts for core Piductor workflows.

Scope:
- Command palette with project, workspace, chat, review, Git, terminal, settings, and navigation actions.
- Keyboard shortcuts with settings-visible labels.
- User/default keybinding source support through config/settings.
- Disabled states and explanations when prerequisites are missing.

Out of scope:
- Plugin-command marketplace or remote command systems.
- Full menu-bar customization.

Acceptance criteria:
- Core actions are discoverable from command palette.
- Shortcuts work in appropriate focus contexts.
- Conflicts are detected or prevented.
- Settings can display and update supported keybindings.

Verification:
- Component tests for command search and action execution.
- Keyboard interaction tests for key workflows.

Source:
- `docs/product/conductor-parity.md`
- `docs/product/ux-parity.md`
- `docs/product/settings-inventory.md`

Implementation notes:
- Use Piductor-specific labels while preserving workflow semantics.

## PID-066 Deep Links and External-Open Actions

Milestone: 8. Settings and Parity Polish
Type: Cross-cutting
Priority: P1
Dependencies: PID-020, PID-021, PID-046, PID-057

Summary:
Implement Piductor URL scheme/deep links and external-open actions for workspaces, repositories, files, PRs, Linear issues, and local folders.

Scope:
- Register and handle Piductor deep-link scheme in development/runtime where supported.
- Open app to repository, workspace, Linear issue link, PR/checks state, or file selection.
- External-open actions for GitHub PR, Linear issue, preview URL, workspace folder, repository folder, and editor/IDE paths.
- Validate inputs and avoid unsafe path traversal.

Out of scope:
- Production packaging registration.
- Cloud workspace links.

Acceptance criteria:
- Deep links route to existing local records or show not-found remediation.
- External-open actions use native shell APIs safely.
- Invalid or stale links do not crash the app.
- Links do not leak secrets in logs.

Verification:
- Unit tests for URL parsing and route resolution.
- Manual dev deep-link test if supported by Electron configuration.

Source:
- `docs/product/conductor-parity.md`
- `docs/product/ux-parity.md`

Implementation notes:
- Production URL scheme registration may need packaging follow-up but local handler logic can be built now.

## PID-067 Error, Empty, Loading, and Diagnostics Logs

Milestone: 8. Settings and Parity Polish
Type: Cross-cutting
Priority: P0
Dependencies: PID-009, PID-027, PID-038, PID-045, PID-055, PID-061

Summary:
Add consistent error, empty, loading, retry, and diagnostics log patterns across core workflows.

Scope:
- Shared components for empty states, loading states, inline errors, banners, retry actions, and log reveal panels.
- Diagnostics surfaces for setup checks, Pi runtime, scripts, Linear, GitHub, database, and config resolution.
- Sanitization rules for secrets, tokens, private account identifiers, and paths unless expanded intentionally.
- Export/copy diagnostics bundle if safe.

Out of scope:
- Cloud telemetry or hosted support upload.
- Production React profiler controls.

Acceptance criteria:
- Core workflows have non-blank failure and empty states.
- Retry actions are available where safe.
- Logs are sanitized by default.
- Diagnostics include enough context to troubleshoot without exposing secrets.

Verification:
- Component tests for shared states.
- Integration tests for representative failures in setup, Pi, script, Linear, and `gh` workflows.

Source:
- `docs/product/onboarding-flow.md`
- `docs/product/screen-inventory.md`
- `docs/product/docs-consistency-audit.md`

Implementation notes:
- Piductor can ask users to use Help/Feedback later, but logs should be locally useful first.

## PID-068 Resource Usage, Sidebar, and Experimental Flag Discovery

Milestone: 8. Settings and Parity Polish
Type: Docs
Priority: P1
Dependencies: PID-036, PID-061

Summary:
Decide and document which non-deferred experimental settings are v1 scope, especially dashboard/sidebar visibility and sidebar resource usage.

Scope:
- Evaluate dashboard/sidebar visibility flags.
- Evaluate resource usage display for workspace processes and Pi sessions.
- Decide whether big terminal mode needs additional build work beyond terminal dock.
- Confirm voice, Graphite, cloud SSH, production profiler, and chat-tab limit remain resolved by ADRs.

Out of scope:
- Implementing resource usage UI unless follow-up build ticket is created.
- Revisiting already deferred features.

Acceptance criteria:
- Discovery note classifies each non-deferred experimental setting as v1, post-core, or omit.
- Any v1 build work is converted into follow-up tickets.
- Decisions do not contradict ADR 0020, 0021, or 0022.

Verification:
- Review settings inventory and product docs.
- Document accepted outcome in roadmap/open-decisions docs.

Source:
- `docs/product/open-decisions.md`
- `docs/product/settings-inventory.md`
- `docs/adr/0020-defer-voice-graphite-and-cloud-ssh.md`
- `docs/adr/0021-defer-react-profiler-to-development-only.md`
- `docs/adr/0022-limit-open-chat-tabs-to-five.md`

Implementation notes:
- This is a product/discovery issue; do not silently implement ambiguous flags.

## PID-069 Product Decision for AI Certainty Phrase Setting

Milestone: 8. Settings and Parity Polish
Type: Docs
Priority: P2
Dependencies: PID-030, PID-062

Summary:
Decide whether Piductor should support Conductor's remove/soften AI-certainty phrase setting.

Scope:
- Evaluate whether the setting makes sense for Pi output.
- If supported, choose between Pi output post-processing, prompt preset, repository/user instruction, or another mechanism.
- If omitted, document why it is not part of Piductor v1.
- Update settings inventory/open decisions after decision.

Out of scope:
- Implementing the setting before the decision is made.
- Changing Pi runtime behavior without user-visible configuration.

Acceptance criteria:
- Decision is recorded clearly.
- Follow-up build ticket is created if supported.
- Settings docs no longer list the item as unresolved after the decision.

Verification:
- Product review of decision note.
- Docs updated consistently.

Source:
- `docs/product/open-decisions.md`
- `docs/product/settings-inventory.md`

Implementation notes:
- Avoid hidden post-processing that changes agent output without user awareness.

## PID-070 Post-Core Packaging, Signing, Notarization, and Auto-Update

Milestone: 9. Deferred / Post-Core
Type: Cross-cutting
Priority: Post-core
Dependencies: Core product completion

Summary:
Track packaging, signing, notarization, and auto-update as post-core work.

Scope:
- Document distribution requirements and release pipeline needs.
- Evaluate Electron packaging, code signing, notarization, and update mechanism.
- Create future implementation tickets after core workflows are stable.

Out of scope:
- Blocking v1 core implementation.
- Shipping production auto-update during core milestones.

Acceptance criteria:
- Deferred scope is documented.
- Future packaging requirements are listed without being part of core milestone exit criteria.

Verification:
- Docs review only.

Source:
- `docs/product/mvp-sequencing.md`
- `docs/product/open-decisions.md`

Implementation notes:
- This ticket exists to prevent accidental scope creep.

## PID-071 Post-Core Direct GitHub API and OAuth

Milestone: 9. Deferred / Post-Core
Type: Integration
Priority: Post-core
Dependencies: PID-056, core GitHub flow completion

Summary:
Track direct GitHub API/OAuth as deferred follow-up after `gh`-based v1 workflows are proven.

Scope:
- Use `PID-056` discoveries to identify `gh` gaps.
- Define OAuth scopes, token storage, API rate-limit, and security requirements.
- Plan direct REST/GraphQL implementation behind `GitHubService` boundary.

Out of scope:
- Replacing required `gh` in v1.
- Storing GitHub tokens during core milestones.

Acceptance criteria:
- Deferred status is explicit.
- No core v1 issue depends on direct GitHub API/OAuth.

Verification:
- Docs review only.

Source:
- `docs/adr/0013-use-gh-cli-for-v1-github-integration.md`
- `docs/product/open-decisions.md`

Implementation notes:
- If `gh` cannot support a critical v1 path, raise a product decision instead of silently expanding scope.

## PID-072 Post-Core SDK Sidecar Fallback

Milestone: 9. Deferred / Post-Core
Type: Backend/main-process
Priority: Post-core
Dependencies: PID-035, core Pi runtime completion

Summary:
Track SDK sidecar runtime fallback as deferred work if CLI RPC lacks needed capabilities.

Scope:
- Evaluate gaps found during Pi capability discovery.
- Define sidecar process/protocol, isolation model, packaging implications, and compatibility with `~/.pi/agent`.
- Preserve `PiAgentClient` boundary.

Out of scope:
- Embedding Pi SDK in Electron main for v1.
- Shipping sidecar before CLI RPC is proven insufficient.

Acceptance criteria:
- Deferred sidecar path is documented.
- Runtime boundaries remain sidecar-ready.

Verification:
- Architecture review after `PID-035`.

Source:
- `docs/adr/0005-use-embedded-pi-sdk-for-v1.md`
- `docs/adr/0025-use-pi-cli-rpc-with-executable-discovery.md`

Implementation notes:
- Sidecar must preserve Pi user environment compatibility if it becomes necessary.

## PID-073 Post-Core Managed Pi Runtime Installer

Milestone: 9. Deferred / Post-Core
Type: Integration
Priority: Post-core
Dependencies: core setup and Pi runtime completion

Summary:
Track managed or bundled Pi runtime installer as deferred work.

Scope:
- Evaluate user demand and compatibility tradeoffs after executable discovery ships.
- Define install/update ownership, version selection, wrapper support, and fallback behavior.
- Preserve user override support for system Pi and wrappers.

Out of scope:
- Bundling Pi as the only v1 runtime.
- Blocking setup gate implementation.

Acceptance criteria:
- Deferred status is explicit.
- Core runtime continues to support selected system/wrapper executable.

Verification:
- Docs review only.

Source:
- `docs/adr/0004-use-system-pi-with-guided-install.md`
- `docs/adr/0025-use-pi-cli-rpc-with-executable-discovery.md`
- `docs/product/open-decisions.md`

Implementation notes:
- Managed runtime adds update and compatibility burden; keep it post-core.

## PID-074 Post-Core Voice, Graphite, Cloud SSH, and Production Profiler

Milestone: 9. Deferred / Post-Core
Type: Cross-cutting
Priority: Post-core
Dependencies: Core product completion

Summary:
Track explicitly deferred parity surfaces: voice mode, Graphite stack support, cloud/remote SSH, and production React profiler controls.

Scope:
- Keep deferred items visible in roadmap without adding v1 build scope.
- Revisit screenshot/product requirements after core workflows ship.
- Split into separate future tickets when activated.

Out of scope:
- Any core milestone implementation of these features.
- Hidden production profiler controls in v1.

Acceptance criteria:
- Deferred items are not exposed as active v1 settings.
- Docs remain aligned with accepted ADRs.

Verification:
- Docs/settings review to confirm deferred features are not presented as active v1 scope.

Source:
- `docs/adr/0020-defer-voice-graphite-and-cloud-ssh.md`
- `docs/adr/0021-defer-react-profiler-to-development-only.md`
- `docs/product/open-decisions.md`

Implementation notes:
- The five-chat-tab limit is not deferred; it is handled by `PID-034`.
