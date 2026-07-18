# Open Decisions

Date: 2026-07-18

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

- None blocking from the current shell refresh. Workspace-row **Set status** is a local dashboard board status, **Mark unread/read** is a local workspace-attention marker, and the Changes tab **Review** button starts the repository `review` agent action.

## Needs Product Working Session

- `ENS-075` Agent chat pane polish session, now that the basic Pi composer/timeline integration is implemented.
- `ENS-076` App settings polish session, now that the main settings sections and persistence model are implemented.

## Needs Implementation Discovery

- Pi CLI/RPC hooks available for permission brokering.
- Pi CLI/RPC APIs for session tree navigation/forking beyond the current chat-tab model, retry-in-new-chat behavior, and compaction UI.
- Pi CLI/RPC APIs for permission brokering, browser control, and context usage display. Model listing and model/thinking selection are already wired.
- How to represent Pi sessions when a workspace is adopted from Conductor.
- Exact review-thread/comment mutation coverage through first-class `gh` and authenticated `gh api`; any gaps should be documented as unsupported or limited rather than solved with an app-owned GitHub auth layer.
- Linear archive/delete schema and permission support. Create/read/update/comment and workspace-from-issue are resolved v1 scope, but field-level SDK/GraphQL mapping, pagination, filtering, labels, cycles, and metadata caching still need implementation discovery.
- Whether `gh` exposes enough data for add-all-comments-to-chat and review-thread resolution.
- Conductor checkpoint git refs, if any, and whether they can be safely detected without relying on private app DB.
- Whether a `.conductor` folder exists in any real repositories and whether it has a documented/public meaning for workspace adoption (Ensemblr no longer reads it for repository config; see ADR 0030).
- How to detect preview URLs from run/setup output robustly.
- How to safely implement spotlight testing without overwriting root changes.
- Which current command/menu placeholders should be keyboard-shortcut/global-command entries before their backing services exist.

## Resolved Since Screenshot Review

- AI-certainty phrase soften setting (ENS-069): removed from v1. It had no functional consumer, so Ensemblr does not expose or persist this as a user setting; Pi output should not be silently post-processed.
- Experimental settings v1 scope (ENS-068): the implemented Experimental page has exactly Developer Mode (`localStorage`) and Auto-run after setup (`config.json`, `app.experimental.autoRunAfterSetup`). The earlier dashboard/sidebar/browser/resource flags are not present in code. Big-terminal mode is satisfied by the terminal dock. Tab-freak mode, Voice, Graphite, cloud SSH, production React profiler, and chat-tab limit remain resolved by ADR 0020/0021/0022.
- Root directory changes: switch root and reindex/adopt by default; migration/delete are explicit actions.
- Secret storage: use macOS Keychain from the start; SQLite stores metadata only.
- Ensemblr account model: defer app account/sign-in for v1; local-first with external auth.
- Pi runtime: use selected Pi-compatible CLI executable with `--mode rpc` for v1; keep SDK sidecar as fallback if RPC lacks needed capabilities.
- Linear integration: first-class v1 OAuth login, issue CRUD, and workspace creation from issues.
- Voice mode, Graphite support, and cloud/remote SSH settings: defer until after core completion.
- React profiler/developer diagnostics: development/internal diagnostics only, not a normal v1 production setting.
- Many-tab mode: allow five open chat tabs per workspace; document/file previews do not count.
- Merge confirmation: prominent ready action when checks pass, then explicit confirmation/final merge/archive flow.
- Hosted deployment preview URLs: derive from GitHub data through `gh` for v1, preferring deployment status `environment_url`/`target_url`, then check links, then provider bot PR comments. Do not require Vercel or Netlify login for the right PR header preview link.
- GitHub integration model: `gh` and `gh api` are the GitHub integration path. Ensemblr does not build or store credentials for an app-owned GitHub OAuth/API layer.
- Renderer routing: file-based TanStack routing with loader-driven data and redirects. Workspace and chat identity are URL path params, `dock`/`review` are search params, and per-workspace dock/review/chat selection is persisted. See `docs/adr/0026-use-file-based-tanstack-routing.md`.
- Workspace lifecycle settings: branch naming, archive/merge behavior now configured via Settings → Git (`app.git` in `~/.config/ensemblr/config.json`), feeding repository resolution as `user-default` source.
- Wordmark animation: glitch burst now fires immediately on mount (`welcome-wordmark.tsx:155`) with periodic bursts continuing on 9-17s interval.
- Dashboard board: shipped as local board state with Backlog, In progress, In review, Done, and Canceled columns; workspace status/unread context-menu ambiguity is resolved as local app state.
- Review action: the Changes/All files Review affordance starts the repository `review` agent action; inline line comments remain future review polish.
- Setup/run/terminal environment: workspace processes now inherit sanitized shell-derived environment, workspace toolchain `PATH`, workspace overlays, and `ENSEMBLR_*` variables.

## Deferred

- Packaging and signing.
- Auto-update.
- SDK sidecar.
- Managed/bundled Pi runtime installer.
- Full visual polish after workflow parity is implemented.
- Voice mode.
- Graphite stack support.
- Cloud or remote workspace SSH settings.
- Production React profiler controls.
