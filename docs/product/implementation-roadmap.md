# Implementation Roadmap

Date: 2026-06-04

This roadmap converts the accepted ADRs and product parity docs into a Linear-ready implementation plan. It is an implementation roadmap, not a product-decision source. Accepted ADRs remain the source of truth when there is a conflict.

## Scope Baseline

V1 builds a Pi-focused Electron desktop app with Conductor-style local workspace, agent, terminal, review, GitHub, Linear, and settings workflows.

In scope for v1:

- Electron main process, React/TypeScript renderer, TanStack Router, TanStack Query, shadcn/ui, Tailwind, and Piductor-owned design tokens.
- Local SQLite database for mutable app metadata and UI/review state.
- macOS Keychain for secret values, with SQLite storing metadata only.
- Declarative user config at `~/.config/piductor/config.json` with JSON schema validation.
- Default Piductor root at `~/Piductor`, with configurable root and shared-root interoperability.
- Repository config precedence: personal SQLite settings, `piductor.json`, `conductor.json`, built-in defaults.
- `.worktreeinclude` support and Conductor-compatible script/env behavior.
- Setup gate requiring git, authenticated `gh`, Pi executable/RPC readiness, root, SQLite, and process environment checks.
- Pi runtime through selected CLI-compatible executable launched as `--mode rpc` from workspace `cwd`.
- Preservation of the Pi user environment, including `~/.pi/agent`, project `.pi`, context files, sessions, skills, extensions, prompts, themes, tools, and provider/model configuration.
- Git worktree workspace creation, workspace adoption from shared Conductor roots, `.context` folder support, and archive lifecycle.
- xterm.js terminal dock backed by main-process PTY/process supervision.
- Git-backed checkpoints under `refs/piductor/checkpoints/<workspace-id>/<turn-id>`.
- First-class Linear OAuth integration with issue create/read/update/comment and workspace creation from issues.
- GitHub PR/check/comment/merge workflows through authenticated `gh` CLI where practical.
- Settings shell, repository settings, keyboard shortcuts, command palette, deep links, diagnostics, and non-deferred polish.
- Implemented Conductor-style workbench shell contract for the sidebar, workspace chat tabs, right review panel, PR-state header, and setup/run/terminal dock. The shell uses `src/components/workbench-shell.tsx` as the public entrypoint, private modules under `src/components/workbench-shell/`, Jotai atoms in `src/renderer/state/workbench-shell.ts`, and shared shell types in `src/renderer/types/workbench-shell.ts`. Live repository/workspace, terminal, file, diff, checks, Linear, GitHub, and Pi services remain in their milestone tickets and should wire into those regions.

Explicitly deferred until post-core:

- Packaging, signing, notarization, and auto-update.
- Direct GitHub OAuth/API.
- SDK sidecar runtime fallback.
- Managed or bundled Pi runtime installer.
- Full Conductor checkpoint-ref interoperability.
- Voice mode.
- Graphite stack support.
- Cloud or remote workspace SSH settings.
- Production React profiler controls.
- Piductor account, cloud sync, hosted team features, billing, or app-owned backend services.

## Roadmap Sequence

| Milestone | Focus | Exit criteria |
| --- | --- | --- |
| 1. Foundation | App shell, storage, config, root, Keychain, process boundary. | The app can boot into the implemented Conductor-style shell contract, persist metadata, load config, resolve settings, create managed directories, and run local commands through main-process services. |
| 2. Setup Gate and Configuration | First-run diagnostics, `gh` requirement, Pi executable discovery, root warnings, env/secrets, repo config parsing. | Users cannot enter core workflows until required checks pass; each failure has remediation; Linear is offered but only blocks Linear workflows. |
| 3. Repository and Workspace Core | Add/open/clone repositories, worktree workspace creation, files-to-copy, landing state, adoption, archive context. | A user can register or clone a project, create/adopt a workspace, see it in the sidebar, and land in a ready workspace shell. |
| 4. Pi CLI RPC Runtime and Agent Timeline | RPC client, process supervision, Pi sessions, composer, timeline, checkpoints, capability discovery. | A user can start a Pi session in a workspace and see structured events, errors, controls, and checkpoint-backed turn state. |
| 5. Terminal, Scripts, and Processes | PTY, xterm.js, setup/run/archive scripts, env vars, ports, run modes, preview and spotlight discovery. | Setup/run/archive commands execute inside workspaces with visible output, controls, env vars, and terminal tabs. |
| 6. Linear Integration | OAuth, token lifecycle, schema discovery, sync/cache, issue UI, workspace-from-issue. | A user can sign in to Linear, browse issues, edit/comment, and create a workspace seeded from an issue. |
| 7. GitHub, Review, Checks, and Merge | File/diff review, comments/todos, context-to-Pi, PR create, checks, comments discovery, merge confirmation. | A user can review changes, create a PR through `gh`, track checks/comments, send context to Pi, and merge only through confirmation. |
| 8. Settings and Parity Polish | Settings shell, app/repo settings, source diagnostics, appearance, shortcuts, deep links, diagnostics, remaining decisions. | The app exposes parity settings and non-deferred polish needed to operate and troubleshoot the completed core workflows. |
| 9. Deferred / Post-Core | Document deferred implementation tracks. | Deferred items are tracked without blocking core completion. |

## Workstream Rules

- Build tasks implement accepted decisions.
- Discovery tasks answer known implementation uncertainties without forcing a product decision.
- Product-decision tasks are separate and should not block unrelated engineering work.
- Each ticket should fit one agent/workspace when practical.
- Treat the current workbench shell as the structural UI contract. Later tickets should replace fixture/local renderer data through TanStack Query and IPC-backed services rather than rebuilding navigation, review, PR header, chat tab, composer placement, or dock regions.
- Keep durable renderer-only UI state in feature-owned Jotai atom modules under `src/renderer/state/`, and keep shared exported renderer types under `src/renderer/types/`.
- Treat the current shell as the closest intended Conductor-shell match. Lost or unavailable screenshots are not a reason to restart shell parity design.
- Preserve the explicit Pi deferral: chat transcript content and prompt/composer behavior are not final until Pi runtime work wires structured sessions, model/thinking controls, attachments, stop/submit, and retry/fork behavior.
- Prefer boundaries that preserve future pivots: `PiAgentClient`, `GitHubService`, `LinearService`, `ConfigService`, `SecretStore`, `TerminalService`, and `WorkspaceService`.
- Do not read or write Conductor's private SQLite database.
- Do not pass Pi disabling flags by default.
- Do not store raw secrets in JSON or SQLite.
- Do not silently delete, rewrite, or rename shared-root content.
- Do not create actual Linear issues until explicitly asked.

## Milestone Dependencies

1. Foundation must land before setup gate, repository workflows, Pi runtime, Linear, or GitHub review flows.
2. Setup gate and configuration must land before first workspace creation is treated as ready.
3. Repository and workspace core must land before Pi sessions, terminal scripts, Linear workspace-from-issue, or PR review workflows.
4. Pi runtime must land before agent-assisted review, PR creation, retry/fork behavior, and context-to-Pi flows.
5. Terminal/script support can start after workspace core, but full script parity depends on repo config parsing and env var injection.
6. Linear issue browsing can build after Keychain and SQLite; workspace-from-issue depends on workspace core.
7. GitHub review/checks/merge depends on `gh` setup checks, workspace core, git status services, and enough Pi runtime to send feedback to agents.
8. Settings/polish depends on underlying services so settings can show real source diagnostics and status.

## Implementation Discovery Tickets

Discovery tickets are intentionally separate from build tickets:

- `PID-031` - Runtime error retry and session-fork discovery.
- `PID-035` - Pi capability discovery for model listing, review model, plan mode, fast mode, browser control, context usage, compaction, and permission restrictions.
- `PID-041` - Preview URL detection discovery from setup/run output.
- `PID-042` - Spotlight testing discovery for safe root/workspace synchronization.
- `PID-044` - Linear schema and permission discovery, including archive/delete support, pagination, filtering, labels, cycles, and cache metadata.
- `PID-056` - GitHub comments, review threads, deployments, and add-all-comments coverage through `gh`.
- `PID-068` - Non-deferred experimental feature discovery for dashboard/sidebar visibility and resource usage.
- Current shell uncertainty to resolve before implementing related behavior: workspace-row status actions, mark-unread semantics, Dashboard visibility, and the Changes tab Review action. See `docs/product/current-shell-inventory.md`.

Discovery outputs should be short design notes committed with the ticket, or appended to the source product docs if they change planning guidance.

## Decision Needed

These are product decisions, not implementation guesses:

- `PID-069` - Decide whether to support Conductor's remove/soften AI-certainty phrase setting in Piductor. If supported, decide whether it is Pi output post-processing, a prompt preset, or a settings omission.
- `PID-068` - Decide which non-deferred experimental settings are v1 scope versus post-core flags, especially dashboard/sidebar visibility and sidebar resource usage. Voice, Graphite, cloud/remote SSH, production React profiler, and the five-chat-tab limit are already resolved by ADRs.

If another ticket encounters ambiguity that would alter behavior, create a new Decision Needed item instead of guessing.

## Verification Strategy

- Foundation: unit tests for config resolution, migrations, root path handling, secret-store mock behavior, and command environment construction.
- Setup gate: integration tests with fake tool binaries and failing `gh`/Pi cases; renderer tests for remediation states.
- Workspace core: fixture repositories for worktree creation, `.worktreeinclude`, config precedence, root changes, and shared-root adoption.
- Pi runtime: fake JSONL RPC process for protocol tests; manual smoke test against a real selected Pi-compatible executable when available.
- Terminal/scripts: PTY integration tests for stdout/stderr, resize, cancellation, SIGHUP/SIGKILL escalation, env injection, and run-mode behavior.
- Linear: mocked API/SDK tests for OAuth state, token refresh, pagination, permission errors, issue CRUD, and workspace-from-issue metadata.
- GitHub/review: fixture repositories and mocked `gh` JSON outputs for PR metadata, checks, comments, merge states, and errors.
- UI: component tests for core states plus one local end-to-end flow from setup-ready to workspace creation to Pi prompt to PR/check state where practical.

## Source Docs

- `CONTEXT.md`
- `docs/adr/*.md`
- `docs/product/conductor-parity.md`
- `docs/product/current-shell-inventory.md`
- `docs/product/mvp-sequencing.md`
- `docs/product/ux-parity.md`
- `docs/product/onboarding-flow.md`
- `docs/product/settings-inventory.md`
- `docs/product/screen-inventory.md`
- `docs/product/open-decisions.md`
- `docs/product/docs-consistency-audit.md`
