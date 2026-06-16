# Current Shell Inventory

Date: 2026-06-16

This inventory describes the implemented shell. Navigation is file-based
(TanStack Router): `src/renderer/components/app.tsx` is now only the router
`<Outlet />` host, route files live in `src/renderer/routing/routes/` (compiled
to the generated `src/renderer/routing/routeTree.gen.ts`), and shell composition
lives in `src/renderer/components/workbench-shell/route-layout/`. Supporting
shell code is in `src/renderer/components/workbench-shell/`
(`frame.tsx` for the chrome, `workspace-content.tsx` for the active-workspace
content, plus private feature folders),
`src/renderer/components/workbench-empty-state.tsx` for the no-project shell,
`src/renderer/components/welcome.tsx` plus
`src/renderer/components/welcome/` for the welcome landing view,
`src/renderer/state/workspace`,
`src/renderer/types/workbench-shell/` (barrel `index.ts`),
`src/renderer/mocks/workbench/`, `src/renderer/styles/index.css`,
`src/renderer/components/shadix-ui/`, and `src/renderer/components/ui/`. See
`docs/adr/0026-use-file-based-tanstack-routing.md` for the routing architecture.
Treat this shell as the product source of truth for app layout and visible
affordances. Future tickets should wire live services into these regions instead
of redesigning the shell.

The prior screenshot evidence may not be available in future workspaces. The
implemented shell should be treated as the closest intended match to
Conductor's own shell, and future agents should not reopen settled shell parity
decisions unless a direct product contradiction appears.

Chat transcript rendering and the prompt composer are intentionally visible but
not behaviorally finalized. They remain deferred until Pi integration work.

## Implementation Boundaries

- Navigation is file-based TanStack routing. Route files live under
  `src/renderer/routing/routes/` and compile to the generated
  `src/renderer/routing/routeTree.gen.ts`, which is never hand-edited. See
  `docs/adr/0026-use-file-based-tanstack-routing.md`.
- Route loaders own data loading and redirects. The pathless `_workbench` route
  loads shared shell data through TanStack Query, `_workbench/_shell` re-exposes it
  to descendants and renders the chrome, and Settings is a full-window route
  outside `_shell`. The active workspace and chat are URL path params; `dock` and
  `review` are validated search params.
- `src/renderer/components/workbench-shell/route-layout/` composes the shell
  from route data and renders the frame, workspace content, placeholder pages,
  and route boundaries. Public exports come through `route-layout/index.ts`.
- `src/renderer/components/workbench-shell/frame.tsx` exports the
  `WorkbenchFrame` chrome; `workspace-content.tsx` exports
  `WorkspaceWorkbenchContent`. Private feature modules live under
  `src/renderer/components/workbench-shell/<feature>/` (e.g. `checks-panel/`,
  `conversation-panel/`, `dock-panel/`, `navigation-sidebar/`,
  `project-sidebar/`, `review-files/`, `right-sidebar-header/`,
  `workspace-sidebar-item/`).
- Cross-cutting shell state (layout flags, setup diagnostics, navigation
  link rendering) is provided through React contexts under
  `src/renderer/components/workbench-shell/contexts/`
  (`WorkbenchLayoutProvider`, `SetupDiagnosticsProvider`, `NavigationProvider`).
- `src/renderer/components/workbench-empty-state.tsx` wraps `WorkbenchFrame`
  for the no-project / empty navigation state.
- `src/renderer/components/welcome.tsx` renders the no-project
  welcome landing (wordmark + Open project / Open GitHub project / Quick start
  cards + clone-github modal stub) and is mounted from the `_workbench/_shell/`
  index route.
- Durable renderer UI state that crosses shell modules lives in Jotai atoms under
  `src/renderer/state/workspace`, including per-workspace dock, review, and chat
  tab selection.
- Shared exported shell types live under
  `src/renderer/types/workbench-shell/` (re-exported via `index.ts`).
- Ephemeral animation and timer state can remain in component hooks when it is
  owned by one rendered surface.

## Inventory

| Surface | Product capability implied | Status | Implementation notes |
| --- | --- | --- | --- |
| Electron workbench frame | A compact macOS desktop workbench with native-window spacing, persistent side navigation, and resizable panes. | Locked product direction | Renderer layout uses `SidebarProvider`, horizontal and vertical `ResizablePanelGroup`s, and Ensemble-owned design tokens. |
| Welcome landing view | First-run / no-project state shows the Ensemble wordmark and the three add-project actions inline on the main canvas. | Implemented shell behavior | `Welcome` renders Open project, Open GitHub project (mounts `CloneGithubDialog` UI-only stub), and Quick start cards from `mocks/workbench`. Clone/open IPC wiring is future work. Mounted at the `_workbench/_shell/` index route. |
| Left primary navigation | Dashboard, History, Help, and Settings are visible from the primary sidebar. | Implemented behavior | `Dashboard` routes to a `WorkbenchPlaceholderPage` reserved for the future kanban board. `History` and `Help` navigate to route-backed shell placeholders. `Settings` opens the separate full-window settings route with a Back to app action. |
| Sidebar project groups | Repositories/projects contain workspace rows, can collapse, and can be reordered. | Implemented behavior | Project collapse and renderer-local reorder state are live. Persistence and SQLite-backed records are future work. |
| Pinned workspace group | Users can pin workspaces above their project groups for fast access. | Implemented behavior | Pin/unpin is renderer-local and removes pinned rows from the normal project group. Persistence is future work. |
| Workspace rows | Workspace status, branch, change counts, selection, and archive affordance. | Locked product direction | Status icons follow the documented workspace sidebar state contract. Row selection is implemented; archive is a placeholder action. |
| Workspace context menu | Mark unread, pin, set status, rename, and archive actions. | Visual placeholder for planned behavior | Pin is implemented. Mark unread, rename, archive, and status changes have visible affordances but no durable behavior. The status target needs confirmation before implementation. |
| Project add menu | Add/open projects from local path, GitHub, quick start, and recent local paths. | Locked product direction | The currently visible menu does not include a Linear issue entry. Linear remains v1 scope through its own issue browsing/workspace creation flow. |
| Project context menu | Create workspace, create from source, repository settings, and remove repository. | Visual placeholder for planned behavior | Repository settings routes to the settings shell. Create/remove behavior is future work and must preserve destructive-action guardrails. |
| Header breadcrumb | Active project, branch, path, and current workspace launcher. | Implemented behavior | Header reflects active fixture model and route-selected workspace. Live repository/workspace data will replace fixtures. |
| Open workspace launcher | Open the workspace in Finder, editors, terminals, source-control apps, or copy path. | Implemented behavior | Targets are detected via Launch Services (`mdfind` over a curated bundle-id registry); only installed apps appear. Click handlers and keyboard shortcuts (`1`..`9`, `⌘O` primary, `⌘⇧C` copy) dispatch through `open -b/-a`, `shell.showItemInFolder`, or the clipboard. Real macOS icons come from `nativeImage.createThumbnailFromPath`, cached to disk and replayed via the preload `initial-shell-snapshot` so subsequent launches paint with real icons on first frame. See ADR 0028. |
| Right sidebar visibility control | Users can collapse and reopen the review sidebar. | Implemented behavior | Collapse/expand uses resizable panel handles and header icon state. |
| Right PR header | PR number, working/checking/blocked/ready states, Create PR, Merge, and overflow affordances. | Locked product direction | States are fixture-backed. `Create PR`, `Merge`, external PR, and overflow actions are future GitHub/gh behavior. |
| Chat/session tabs | Multiple Pi sessions per workspace with active tab, close, restore, and new-chat affordances. | Implemented shell behavior | The active session is a URL path param (`/chats/$chatId`) remembered per workspace, so switching workspaces restores the last open chat; renderer-local close/restore are implemented. Context-aware ⌘/Ctrl+W close action: in workspace view, closes the active tab (with smart behavior: close, no-op for empty sole tab, or reset sole chat tab); in Settings, returns to the previous screen; on other screens, falls back to closing the window. See `src/renderer/state/close-action.tsx` and `src/renderer/state/workspace/session-tab-close.ts`. New chat and five-tab enforcement remain future Pi/session work. |
| Center chat timeline | Agent conversation, tool activity, setup warning, and status continuity while side panels remain visible. | Visual placeholder for planned behavior | Current messages are mock data. Structured Pi RPC timeline, runtime errors, retry/fork behavior, and real session history remain deferred to Pi runtime tickets. |
| Composer | Prompt text area, model/thinking badges, setup-disabled reason, attach, and send controls. | Visual placeholder for planned behavior | Setup diagnostics can disable the composer today. Prompt submit, stop, attachments, and model controls are deferred to Pi integration. Do not redesign or finalize this area before Pi work. |
| Setup diagnostics banner | Setup blockers keep the shell visible while app readiness status stays in the left sidebar footer. | Implemented behavior | App setup diagnostics may disable the composer but must not render in, or force-select, the lower Setup dock. |
| Review panel tabs | Right panel has All files, Changes, and Checks tabs with route/search state. | Implemented shell behavior | Tab selection is route-backed. Data is fixture-backed until file/git/GitHub services land. |
| All files tab | Browse and search repository files. | Implemented behavior | Collapsible folder tree with lazy loading for git-ignored directories (`.context/`, `node_modules/`). File rows and command-style search dialog implemented with live data via `listWorkspaceFiles` IPC. Virtualized rendering via `@tanstack/react-virtual`. Opening previews remains future work. |
| Changes tab | Changed-file list/tree with folder grouping, collapse, status labels, line counts, review action, and history/filter menu. | Implemented shell behavior | List/tree toggle and folder collapse work against fixture data. Full diff body, search, review mode, comments, and commit filtering are future review work. |
| Checks tab | PR title/description, git status, checks, comments, todos, no-PR state, and ready-to-merge flow. | Visual placeholder for planned behavior | Sections and state shapes are visible. Live `gh` metadata, polling, comments, todos, context-to-Pi, and merge confirmation are future work. |
| Dock tabs | Bottom-right fixed Setup and Run script-output tabs plus terminal session tabs stay visible with review/timeline context. | Implemented shell behavior | Dock tab state is route-backed and the dock is collapsible/resizable. Process-backed content is future work. Setup and Run are read-only output tabs for their respective configured commands. |
| Dock script actions | Script-state-aware actions: Setup Scripts, Run setup script, Run, Open :PORT, and Stop. | Locked product direction | Actions render from fixture script status. Process execution and PTY lifecycle are future terminal/script work. Script actions must target the fixed Setup/Run panes, not user-spawned terminals. |
| Terminal tabs | One default generic manual terminal panel plus a plus button for additional terminal tabs. | Visual placeholder for planned behavior | Terminal content explicitly states interactive PTY rendering is deferred to `ENS-037`. User-spawned terminals are regular IDE-style interactive terminals backed by stable terminal session IDs. |
| Sidebar health footer | App health, setup readiness, and app diagnostics remain visible in the shell. | Implemented behavior | Health and setup diagnostics use TanStack Query over the typed preload bridge. This footer is the only current-shell place for app diagnostics; do not place app diagnostics in the Setup/Run/Terminal dock. |
| Settings shell entry | Settings remains part of global navigation. | Implemented shell behavior | Settings opens a separate full-window route (`/settings`) rendered outside the workbench chrome, with a Back to app action. The Back button and ⌘/Ctrl+W close action both return to the screen Settings was opened from (tracked via `settingsReturnToAtom`), falling back to the workbench root if no prior screen was recorded. Full settings forms are future work. |
| Settings → Git | Per-repository git defaults and lifecycle behavior. | Implemented behavior | Branch prefix source (github-username/custom/none), custom prefix, auto-rename workspace on branch, delete local branch on archive, archive after merge, set upstream on push. Stored in `~/.config/ensemble/config.json` under `app.git`, feeds repository resolution as `user-default` source. |
| Command surfaces | File search dialog and Create PR command popover use command primitives. | Visual placeholder for planned behavior | These establish command UI patterns. A global command palette remains a later settings/polish ticket. |

## Workspace Sidebar State Contract

The workspace row icon derives one compact status from `workspace.pullRequest`,
`workspace.status`, and `workspace.checks`. When a PR number exists, PR state
owns the sidebar icon so the row aligns with the right PR header. Broader
workspace health only fills no-PR rows, where the right PR header is quiet or
showing the create-PR action.

| State | Model condition | Icon behavior |
| --- | --- | --- |
| PR ready | PR number exists and status is `ready-to-merge` | Green pull-request-ready icon |
| PR checking | PR number exists and status is `checking` | Warning pending icon |
| PR blocked | PR number exists and status is `blocked` | Danger conflict icon |
| PR working | PR number exists and status is `agent-working` | Muted spinning activity icon |
| PR open | PR number exists and status is `idle` or another non-active open state | Muted pull request icon |
| Workspace blocked | No PR number and `workspace.checks.status` is `blocked` | Danger conflict icon |
| Workspace working | No PR number and `workspace.status` is `working` | Muted spinning activity icon |
| Workspace checking | No PR number and `workspace.checks.status` is `pending` | Warning pending icon |
| Branch | No PR number and no workspace health/activity signal | Muted branch icon |

`pullRequest.status` is treated as PR state only when `pullRequest.number`
exists. No-PR local changes remain visible through row diff stats and the right
PR header's create-PR affordance rather than by overloading the row icon.

## Right PR Header State Contract

The right PR header derives one render state from `workspace.pullRequest` and
`workspace.changeSummary`.

| State | Model condition | Header label | Left affordance | Right action | Tone |
| --- | --- | --- | --- | --- | --- |
| Empty | No PR number and no changed files | None | None | None | Neutral |
| Create PR | No PR number and changed files exist | None | None | `Create PR` split button | Neutral |
| PR working | PR number exists and status is `agent-working` | `Working...` | PR number external/open button | Spinner | Neutral |
| PR checking | PR number exists and status is `checking` | PR status label | PR number external/open button | Spinner | Pending |
| PR blocked | PR number exists and status is `blocked` | PR status label | PR number external/open button | Overflow/remediation menu | Blocked |
| PR ready | PR number exists and status is `ready-to-merge` | PR status label, usually `Ready to merge` | PR number external/open button | `Merge` | Ready |
| PR open | PR number exists and status is `idle` or another non-active open state | PR label, PR title, or PR number fallback | PR number external/open button | Overflow menu | Neutral |

`Working...` is reserved for `agent-working`; an idle/open PR must not display
working affordances. No-PR/no-change workspaces stay visually quiet in this
header because workspace and agent activity are already represented in the
sidebar, chat tabs, and timeline.

If `pullRequest.previewDeployment` is present while a PR number exists, render a
`Preview` external-link button immediately beside the PR number. The v1 data
source must be GitHub-derived through `gh`, without requiring a Vercel or Netlify
login: prefer GitHub deployment statuses filtered by branch/ref and use
`environment_url` before `target_url`; fall back to `gh pr checks` links when the
provider publishes a usable preview URL there; parse provider bot PR comments
only if GitHub deployment/status data is unavailable.

## Checks Panel State Contract

The Checks panel derives its own render state from the same
`workspace.pullRequest` and `workspace.changeSummary` inputs, but it owns the
evidence body rather than the compact header action.

| State | Model condition | Body behavior |
| --- | --- | --- |
| Empty | No PR number and no changed files | Quiet no-PR summary, no create/commit action, todos section only. |
| Uncommitted | No PR number and changed files exist | Show changed count, `Create PR`, and `Commit and push` rows. |
| PR working | PR number exists and status is `agent-working` | Show PR metadata, current git/check evidence, comments, and todos without ready/blocker framing. |
| PR checking | PR number exists and status is `checking` | Show pending summary, check rows, comments, todos, and refresh/polling affordance when live data lands. |
| PR blocked | PR number exists and status is `blocked` | Surface blocker summary, failed checks/comments, todos, and add-to-chat/fix-context affordances. |
| PR ready | PR number exists and status is `ready-to-merge` | Show readiness evidence, passed checks, deployments, comments, and todos. Merge remains owned by the right PR header confirmation flow. |
| PR open | PR number exists and status is `idle` or another non-active open state | Show PR identity and metadata without `Working...`, spinner, or fake check rows. |

Empty checks, comments, descriptions, and todos must render explicit empty text
instead of blank sections. Check rows should render an external link only when
the model includes a check URL. Preview deployments should appear in a
Deployments section as well as beside the PR number in the header.

## GitHub PR Data Source Contract

V1 PR/check data must come through the authenticated GitHub CLI, including
`gh api` for REST/GraphQL endpoints. This keeps v1 aligned with the setup gate:
users authenticate once with `gh auth login`, Ensemble verifies with
`gh auth status`, and Ensemble does not store GitHub tokens itself.

| `pullRequest` surface | Primary source | Notes |
| --- | --- | --- |
| PR number, title, body/description, URL, branch refs, draft/open state, mergeability, review decision, status rollup | `gh pr view --json number,title,body,url,state,headRefName,baseRefName,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup` | Prefer branch argument when resolving the current workspace PR. |
| Check rows and check links | `gh pr checks --json bucket,completedAt,description,event,link,name,startedAt,state,workflow` | Normalize `state`/`bucket` into ready, pending, or blocked panel states. |
| Deployment/preview URLs | `gh api -X GET repos/{owner}/{repo}/deployments -f ref="$branch" -F latest=true`, then `gh api repos/{owner}/{repo}/deployments/{id}/statuses` | Prefer deployment status `environment_url`, then `target_url`, then check links, then provider bot PR comments. |
| PR comments | `gh pr view --comments --json comments` first, then `gh api repos/{owner}/{repo}/issues/{number}/comments --paginate` when structured paging is needed | Treat bot comments as a fallback source for preview URLs. |
| Review comments | `gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate` | Use for file/path/line-level review context. |
| Review threads and resolved state | `gh api graphql` using the authenticated CLI token | Required when thread resolution state is needed; first-class `gh pr` commands are not enough. |
| Local changed/uncommitted state | `git status --porcelain=v1`, diff stats, and local branch metadata | Local git remains the source for no-PR and uncommitted panel states. |
| Local todos | Ensemble SQLite | Todos are app-owned review context, not GitHub-owned state. |

When adding query parameters to a GET request with `gh api`, pass `-X GET`
explicitly because `-f` and `-F` fields otherwise switch the request to POST.
Use `{owner}` and `{repo}` placeholders where possible so `gh` resolves the
current repository context. Provider-specific APIs such as Vercel or Netlify are
deferred unless GitHub-derived deployment/status/check/comment data proves
insufficient.

## Current Unknowns

- `WorkspaceContextMenuContent` status actions: confirm whether these change a local workspace lifecycle state, a linked Linear issue status, both, or another status model.
- `Mark as unread`: confirm whether this is a local workspace attention marker, chat unread state, or linked external issue state.
- `Review` button in the Changes tab: confirm whether this opens review mode for local diff comments, starts an agent review workflow, or toggles filtered review state.

**Note:** Workspace lifecycle settings (branch naming, archive/merge behavior) are now configured via Settings → Git. See the "Settings → Git" row above for details.
