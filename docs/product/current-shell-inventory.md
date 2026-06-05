# Current Shell Inventory

Date: 2026-06-05

This inventory describes the implemented shell in `src/renderer/App.tsx`,
`src/components/workbench-shell.tsx`, `src/components/workbench-shell/`,
`src/renderer/state/workbench-shell.ts`,
`src/renderer/types/workbench-shell.ts`,
`src/renderer/workbench/workbench-model.ts`, `src/renderer/styles.css`,
`src/components/shadix-ui/`, and `src/components/ui/`.
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

- `src/components/workbench-shell.tsx` is the public component entrypoint and
  should stay focused on shell orchestration.
- Private shell components and local shell hooks live under
  `src/components/workbench-shell/`.
- Durable renderer UI state that crosses shell modules lives in Jotai atoms under
  `src/renderer/state/workbench-shell.ts`.
- Shared exported shell types live under
  `src/renderer/types/workbench-shell.ts`.
- Ephemeral animation and timer state can remain in component hooks when it is
  owned by one rendered surface.

## Inventory

| Surface | Product capability implied | Status | Implementation notes |
| --- | --- | --- | --- |
| Electron workbench frame | A compact macOS desktop workbench with native-window spacing, persistent side navigation, and resizable panes. | Locked product direction | Renderer layout uses `SidebarProvider`, horizontal and vertical `ResizablePanelGroup`s, and Piductor-owned design tokens. |
| Left primary navigation | Global History and Settings are reachable without leaving workspace context. | Implemented behavior | `History` and `Settings` buttons navigate to route-backed shell views. `Dashboard` exists as a route state but is not a visible sidebar item in the current shell. |
| Sidebar project groups | Repositories/projects contain workspace rows, can collapse, and can be reordered. | Implemented behavior | Project collapse and renderer-local reorder state are live. Persistence and SQLite-backed records are future work. |
| Pinned workspace group | Users can pin workspaces above their project groups for fast access. | Implemented behavior | Pin/unpin is renderer-local and removes pinned rows from the normal project group. Persistence is future work. |
| Workspace rows | Workspace status, branch, change counts, selection, and archive affordance. | Locked product direction | Status icons cover blocked, ready-to-merge, working, checking, and neutral branch states. Row selection is implemented; archive is a placeholder action. |
| Workspace context menu | Mark unread, pin, set status, rename, and archive actions. | Visual placeholder for planned behavior | Pin is implemented. Mark unread, rename, archive, and status changes have visible affordances but no durable behavior. The status target needs confirmation before implementation. |
| Project add menu | Add/open projects from local path, GitHub, quick start, and recent local paths. | Locked product direction | The currently visible menu does not include a Linear issue entry. Linear remains v1 scope through its own issue browsing/workspace creation flow. |
| Project context menu | Create workspace, create from source, repository settings, and remove repository. | Visual placeholder for planned behavior | Repository settings routes to the settings shell. Create/remove behavior is future work and must preserve destructive-action guardrails. |
| Header breadcrumb | Active project, branch, path, and current workspace launcher. | Implemented behavior | Header reflects active fixture model and route-selected workspace. Live repository/workspace data will replace fixtures. |
| Open workspace launcher | Open the workspace in Finder, editors, terminals, source-control apps, or copy path. | Locked product direction | Visible targets are Finder, VS Code, Zed, Xcode, Ghostty, Warp, Terminal, GitHub Desktop, and Copy path. Button behavior is future external-open work. |
| Right sidebar visibility control | Users can collapse and reopen the review sidebar. | Implemented behavior | Collapse/expand uses resizable panel handles and header icon state. |
| Right PR header | PR number, working/checking/blocked/ready states, Create PR, Merge, and overflow affordances. | Locked product direction | States are fixture-backed. `Create PR`, `Merge`, external PR, and overflow actions are future GitHub/gh behavior. |
| Chat/session tabs | Multiple Pi sessions per workspace with active tab, close, restore, and new-chat affordances. | Implemented shell behavior | Route-backed active session and renderer-local close/restore are implemented. New chat and five-tab enforcement remain future Pi/session work. |
| Center chat timeline | Agent conversation, tool activity, setup warning, and status continuity while side panels remain visible. | Visual placeholder for planned behavior | Current messages are mock data. Structured Pi RPC timeline, runtime errors, retry/fork behavior, and real session history remain deferred to Pi runtime tickets. |
| Composer | Prompt text area, model/thinking badges, setup-disabled reason, attach, and send controls. | Visual placeholder for planned behavior | Setup diagnostics can disable the composer today. Prompt submit, stop, attachments, and model controls are deferred to Pi integration. Do not redesign or finalize this area before Pi work. |
| Setup diagnostics banner | Setup blockers keep the shell visible while app readiness status stays in the left sidebar footer. | Implemented behavior | App setup diagnostics may disable the composer but must not render in, or force-select, the lower Setup dock. |
| Review panel tabs | Right panel has All files, Changes, and Checks tabs with route/search state. | Implemented shell behavior | Tab selection is route-backed. Data is fixture-backed until file/git/GitHub services land. |
| All files tab | Browse and search repository files. | Visual placeholder for planned behavior | File rows and the command-style search dialog are implemented against fixture data. Opening previews is future work. |
| Changes tab | Changed-file list/tree with folder grouping, collapse, status labels, line counts, review action, and history/filter menu. | Implemented shell behavior | List/tree toggle and folder collapse work against fixture data. Full diff body, search, review mode, comments, and commit filtering are future review work. |
| Checks tab | PR title/description, git status, checks, comments, todos, no-PR state, and ready-to-merge flow. | Visual placeholder for planned behavior | Sections and state shapes are visible. Live `gh` metadata, polling, comments, todos, context-to-Pi, and merge confirmation are future work. |
| Dock tabs | Bottom-right Setup, Run, and Terminal tabs stay visible with review/timeline context. | Implemented shell behavior | Dock tab state is route-backed and the dock is collapsible/resizable. Process-backed content is future work. The Setup tab is only for workspace/project setup command output, such as dependency install logs. |
| Dock script actions | Script-state-aware actions: Setup Scripts, Run setup script, Run, Open :PORT, and Stop. | Locked product direction | Actions render from fixture script status. Process execution and PTY lifecycle are future terminal/script work. |
| Terminal tab | Generic manual terminal panel and plus button for new terminal tabs. | Visual placeholder for planned behavior | Terminal content explicitly states interactive PTY rendering is deferred to `PID-037`. |
| Sidebar health footer | App health, setup readiness, and app diagnostics remain visible in the shell. | Implemented behavior | Health and setup diagnostics use TanStack Query over the typed preload bridge. This footer is the only current-shell place for app diagnostics; do not place app diagnostics in the Setup/Run/Terminal dock. |
| Settings shell entry | Settings remains part of global navigation. | Implemented shell behavior | Current route still renders the workbench shell with Settings active. Full settings forms are future work. |
| Command surfaces | File search dialog and Create PR command popover use command primitives. | Visual placeholder for planned behavior | These establish command UI patterns. A global command palette remains a later settings/polish ticket. |

## Current Unknowns

- `WorkspaceContextMenuContent` status actions: confirm whether these change a local workspace lifecycle state, a linked Linear issue status, both, or another status model.
- `Mark as unread`: confirm whether this is a local workspace attention marker, chat unread state, or linked external issue state.
- `Dashboard` route: confirm whether the Dashboard route should get a visible sidebar entry later or remain hidden while History/Settings are the only top-level visible entries.
- `Review` button in the Changes tab: confirm whether this opens review mode for local diff comments, starts an agent review workflow, or toggles filtered review state.
