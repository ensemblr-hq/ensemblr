# Open Decisions

Date: 2026-08-12 (last full pass 2026-08-08)

## Screenshot Gaps Remaining

- ~~Exact onboarding screen sequence. No onboarding PNGs were captured; `docs/product/onboarding-flow.md` is inferred.~~ **Resolved 2026-08-09 (#247):** Ensemblr shipped its own wizard at `/onboarding` — a welcome moment, a language picker, one screen per gate (agent CLI, GitHub CLI, Linear), and a terminal screen. The agent-CLI gate is either-or. `docs/product/ux-conventions.md` §First-Run Onboarding describes what shipped.
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

- **Spotlight testing dirty-root override.** Whether spotlight testing may ever proceed with a dirty repository root under explicit user override. Blocks any spotlight implementation; recommendation in `discovery-spotlight-testing.md` is *not allowed*. Nothing else depends on it.
- **Loopback-only preview-URL log parsing.** Whether opt-in log parsing ships post-core at all, given template expansion already covers the deterministic case. Recommendation in `discovery-preview-url-detection.md` is to defer.
- Nothing blocking from the current shell. Workspace-row **Set status** is a local dashboard board status, **Mark unread/read** is a local workspace-attention marker, and the Changes tab **Review** button starts the repository `review` agent action.

## Needs Product Working Session

- `ENS-075` Agent chat pane polish session, now that the basic Pi composer/timeline integration is implemented.
- `ENS-076` App settings polish session, now that the main settings sections and persistence model are implemented.

## Needs Implementation Discovery

- Pi CLI/RPC APIs for session tree navigation/forking beyond the current chat-tab model, retry-in-new-chat behavior, and compaction UI.
- Pi CLI/RPC API for browser control. Model listing, model/thinking selection, permission brokering, plan mode, and context usage are all wired.
- How to represent agent sessions when a workspace is adopted from a shared root another workspace manager created.
- Exact review-thread/comment mutation coverage through first-class `gh` and authenticated `gh api`; any gaps should be documented as unsupported or limited rather than solved with an app-owned GitHub auth layer.
- Linear archive/delete schema and permission support. Create/read/update/comment and workspace-from-issue are resolved v1 scope, but field-level SDK/GraphQL mapping, pagination, filtering, labels, cycles, and metadata caching still need implementation discovery.
- Whether another workspace manager's checkpoint git refs, if any, can be safely detected without relying on its private app DB.
- Which current command/menu placeholders should be keyboard-shortcut/global-command entries before their backing services exist.

## Resolved Since Screenshot Review

- AI-certainty phrase soften setting (ENS-069): removed from v1. It had no functional consumer, so Ensemblr does not expose or persist this as a user setting; Pi output should not be silently post-processed.
- Experimental settings v1 scope (ENS-068): the implemented Experimental page has exactly Developer Mode (`localStorage`) and Auto-run after setup (`config.json`, `app.experimental.autoRunAfterSetup`). The earlier dashboard/sidebar/browser/resource flags are not present in code. Big-terminal mode is satisfied by the terminal dock. Tab-freak mode, Voice, Graphite, cloud SSH, and production React profiler remain resolved by ADR 0020/0021. The chat-tab limit (ADR 0022) was removed by ADR 0039; chat tabs are now unlimited.
- Root directory changes: switch root and reindex/adopt by default; migration/delete are explicit actions.
- Secret storage: use macOS Keychain from the start; SQLite stores metadata only.
- Ensemblr account model: defer app account/sign-in for v1; local-first with external auth.
- Pi runtime: use selected Pi-compatible CLI executable with `--mode rpc` for v1; keep SDK sidecar as fallback if RPC lacks needed capabilities.
- Linear integration: first-class v1 OAuth login, issue CRUD, and workspace creation from issues.
- Voice mode, Graphite support, and cloud/remote SSH settings: defer until after core completion.
- React profiler/developer diagnostics: development/internal diagnostics only, not a normal v1 production setting.
- Many-tab mode: unlimited open chat tabs per workspace (ADR 0039 removed the former five-tab cap); document/file previews re-focus rather than duplicate.
- Merge confirmation: prominent ready action when checks pass, then explicit confirmation/final merge/archive flow.
- Hosted deployment preview URLs: derive from GitHub data through `gh` for v1, preferring deployment status `environment_url`/`target_url`, then check links, then provider bot PR comments. Do not require Vercel or Netlify login for the right PR header preview link.
- GitHub integration model: `gh` and `gh api` are the GitHub integration path. Ensemblr does not build or store credentials for an app-owned GitHub OAuth/API layer.
- Renderer routing: file-based TanStack routing with loader-driven data and redirects. Workspace and chat identity are URL path params, `dock`/`review` are search params, and per-workspace dock/review/chat selection is persisted. See `docs/adr/0026-use-file-based-tanstack-routing.md`.
- Workspace lifecycle settings: branch naming, archive/merge behavior now configured via Settings → Git (`app.git` in `~/.config/ensemblr/config.json`), feeding repository resolution as `user-default` source.
- Wordmark animation: glitch burst now fires immediately on mount (`welcome-wordmark.tsx:155`) with periodic bursts continuing on 9-17s interval.
- Dashboard board: shipped as local board state with Backlog, In progress, In review, Done, and Canceled columns; workspace status/unread context-menu ambiguity is resolved as local app state.
- Review action: the Changes/All files Review affordance starts the repository `review` agent action; inline line comments remain future review polish.
- Setup/run/terminal environment: workspace processes now inherit sanitized shell-derived environment, workspace toolchain `PATH`, workspace overlays, and `ENSEMBLR_*` variables.

## Resolved Since 2026-07-21

- **Second agent runtime (ADR 0042, #226–#237, 2026-08-07).** Claude Code is a first-class runtime alongside Pi, driven in-process through `@anthropic-ai/claude-agent-sdk` against the user's own `claude` binary. Pi and Claude are siblings under `src/main/agent-runtime/`, not a translation layer. A chat is pinned to one provider for its lifetime; a spawned sub-agent inherits its caller's runtime (#236). Ensemblr does not enable the SDK's file checkpointing, and the workspace permission mode is enforced in-app for Claude.
- **Providers settings screen (#226).** Reinstated after its 2026-07-19 removal, now scoped to agent runtimes rather than model providers: one tab per registered runtime with its executable, readiness, accounts, and settings-file location. Ensemblr still stores no provider tokens. This supersedes the "no Providers screen (removed)" line the settings docs carried.
- **Plan mode (#184, 2026-07-28).** A per-chat toggle (⌥⇧P), not a setting. Enforcement is layered and fails closed: Pi's shipped extension intercepts `bash`/`edit`/`write` through the `tool_call` hook and asks the app, which answers from one classifier in `src/shared/plan-mode/`; agent-control also gates terminals, harnesses, follow-ups, and new conversations, since a spawned conversation would otherwise run unrestricted. `ensemblr_exit_plan_mode` writes the plan to `.context/plans/` and surfaces Approve / Refine / Hand off above the composer (rendered as the composer header since #218). Claude Code uses its own native plan mode instead (ADR 0042, decision 3).
- **Branch takeover vs forking (#225, 2026-08-06).** A workspace is created from a `branchPlan`: `adopt` checks out and owns an existing branch, `create` cuts a fresh branch at a fork point. Base branch keeps its separate meaning as the merge target, defaulting to the PR's own base. Adopting a branch another worktree holds, or one that exists nowhere, fails up front with a named diagnostic; rollback never deletes a branch the creation did not cut. This closes the "review panel diffs the branch against itself" behavior. **No ADR yet — see the gap list in `docs-consistency-audit.md`.**
- **Target branch and merge conflicts (#215, #216).** Workspaces expose a target-branch selector, and the checks panel surfaces merge conflicts against that target with a Resolve action that hands the conflict to the agent.
- **Inline line-comment UX.** Shipped with the rich diff viewer (THE-152, #151) and completed by #234: resolved comments render struck through, and bulk-add sends only the unresolved ones. This was the last "review polish" item; it is no longer open.
- **Add-review-context-to-agent.** Shipped. Comments and diffs reach chat context from the checks panel, PR comment bodies are readable in-app (#209), and agents can read the workspace diff and file review comments through the control layer (#193).
- **Named run scripts per repository (#220, #222, #223; ADR 0041).** A repository defines any number of `[scripts.run.<name>]` tables with `command`, `icon`, `default`, and `available_in`. The Scripts settings screen writes the committed `.ensemblr/settings.toml` directly, agents can start a run script by name, and a legacy `run = "..."` string still resolves as one implicit script.
- **Preview URL detection.** Resolved as template-first per `discovery-preview-url-detection.md`: expand `previewUrlTemplate` against the injected `ENSEMBLR_*` variables, never parse run/setup logs. The right-header preview link separately resolves the deployed build from GitHub data (#196, #197). Loopback-only log parsing stays deferred and opt-in if ever accepted.
- **Spotlight testing.** Resolved as **deferred to post-core** per `discovery-spotlight-testing.md`. The safe minimum is patch-based apply with a persisted reverse patch and hard refusal on any dirty intersecting file; it never silently overwrites root changes and never auto-starts. One product decision remains before any code: whether spotlight may proceed with a dirty root under user override (recommendation: not allowed).
- **Unified code surface (#211, #212).** File preview, turn diff, workspace file diff, and the PR diff render through one code surface split into panel/lines/header/hunk-gap/style parts, with gutter and container measurements named as design tokens. **No ADR — see the gap list.**

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
