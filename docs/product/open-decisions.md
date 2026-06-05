# Open Decisions

Date: 2026-06-04

## Screenshot Gaps Remaining

- Exact onboarding screen sequence. No onboarding PNGs were captured; `docs/product/onboarding-flow.md` is inferred.
- Exact workspace creation form/modal. Screenshots show the success landing state, not the create form.
- Exact local-project open flow and quick-start flow. Screenshots show the add menu and GitHub clone modal only.
- Clone/auth/path failure states. Screenshots show form and progress, not failures.
- Full diff body and line-comment interaction. Screenshots show the changes tree, not unified diff details or inline comments.
- Provider disconnected/failed-auth states. Screenshots show a connected provider state only.
- PR comment/review-thread detail and failed-check remediation. Screenshots show comments/checks at a summary level.
- Settings confirmation modals for destructive actions such as root changes, repository removal, archive, and merge.

## Screenshot-Resolved Items

- Settings hierarchy: app settings sections plus local repository settings in the same settings shell.
- Repository settings surface: paths, branch source, remote, preview URL, files-to-copy, scripts, spotlight testing, action-specific agent preferences, and remove repository.
- Main workspace layout: sidebar, center agent timeline, right files/changes/checks panel, lower setup/run/terminal dock.
- Current implemented shell contract: project/workspace sidebar with pinning/collapse/reorder, project add menu, workspace header/open-target launcher, chat/session tabs, right PR header, All files/Changes/Checks tabs, and lower Setup/Run/Terminal dock.
- Agent error state: inline runtime error cards with retry and retry-in-new-chat actions.
- Terminal setup output state: setup output appears in the dock with rerun control.
- Checks/PR states: no PR, uncommitted changes, pending/failing checks, deployments/checks/comments/todos, and ready-to-merge state.
- Add repository entry points: open local project, open GitHub project, quick start, and recents.

## Needs Product Decision

- Whether to support Conductor's remove/soften AI-certainty phrase setting in Ensemble. If supported, decide whether it is Pi output post-processing, a prompt preset, or a settings omission.
- Which non-deferred experimental settings are v1 scope versus post-core flags, especially dashboard/sidebar visibility and sidebar resource usage. Voice, Graphite, cloud/remote SSH, production React profiler, and the chat-tab limit are already resolved by ADRs.
- Whether the current workspace-row status context menu should change local workspace lifecycle state, linked Linear issue status, both, or another status model.
- Whether the current workspace-row Mark as unread action represents local workspace attention, chat unread state, or linked external issue state.
- Whether the Dashboard route should become a visible sidebar entry later or remain hidden behind other navigation.
- Whether the Changes tab Review action opens local diff-comment review mode, starts an agent review workflow, or toggles a review filter/state.

## Needs Implementation Discovery

- Pi CLI/RPC hooks available for permission brokering.
- Pi CLI/RPC APIs for session tree navigation/forking, retry-in-new-chat behavior, and compaction UI.
- Pi CLI/RPC APIs for model listing, review-model separation, plan mode, fast mode, browser control, and context usage display.
- How to represent Pi sessions when a workspace is adopted from Conductor.
- Best way to parse GitHub review comments, deployments, and check details through `gh`; direct API may be needed later.
- Linear archive/delete schema and permission support. Create/read/update/comment and workspace-from-issue are resolved v1 scope, but field-level SDK/GraphQL mapping, pagination, filtering, labels, cycles, and metadata caching still need implementation discovery.
- Whether `gh` exposes enough data for add-all-comments-to-chat and review-thread resolution.
- Conductor checkpoint git refs, if any, and whether they can be safely detected without relying on private app DB.
- Whether a `.conductor` folder exists in any real repositories and whether it has a documented/public meaning.
- How to detect preview URLs from run/setup output robustly.
- How to safely implement spotlight testing without overwriting root changes.
- Which current command/menu placeholders should be keyboard-shortcut/global-command entries before their backing services exist.

## Resolved Since Screenshot Review

- Root directory changes: switch root and reindex/adopt by default; migration/delete are explicit actions.
- Secret storage: use macOS Keychain from the start; SQLite stores metadata only.
- Ensemble account model: defer app account/sign-in for v1; local-first with external auth.
- Pi runtime: use selected Pi-compatible CLI executable with `--mode rpc` for v1; keep SDK sidecar as fallback if RPC lacks needed capabilities.
- Linear integration: first-class v1 OAuth login, issue CRUD, and workspace creation from issues.
- Voice mode, Graphite support, and cloud/remote SSH settings: defer until after core completion.
- React profiler/developer diagnostics: development/internal diagnostics only, not a normal v1 production setting.
- Many-tab mode: allow five open chat tabs per workspace; document/file previews do not count.
- Merge confirmation: prominent ready action when checks pass, then explicit confirmation/final merge/archive flow.

## Deferred

- Packaging and signing.
- Auto-update.
- Direct GitHub OAuth/API.
- SDK sidecar.
- Managed/bundled Pi runtime installer.
- Full visual polish after workflow parity is implemented.
- Voice mode.
- Graphite stack support.
- Cloud or remote workspace SSH settings.
- Production React profiler controls.
