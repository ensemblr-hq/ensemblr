# Conductor Parity Matrix

Date: 2026-06-16

Ensemble targets feature parity with Conductor's publicly observable and documented workflows, adapted for Pi. This matrix is a living checklist, not a copied product spec.

Sources checked:

- Conductor Docs: https://www.conductor.build/docs
- Isolated workspaces: https://www.conductor.build/docs/concepts/workspaces-and-branches
- Workflow: https://www.conductor.build/docs/concepts/workflow
- Parallel agents: https://www.conductor.build/docs/concepts/parallel-agents
- Agent behavior: https://www.conductor.build/docs/reference/agent-behavior
- Scripts: https://www.conductor.build/docs/reference/scripts
- conductor.json: https://www.conductor.build/docs/reference/conductor-json
- Files to copy: https://www.conductor.build/docs/reference/files-to-copy
- Environment variables: https://www.conductor.build/docs/reference/environment-variables
- Diff viewer: https://www.conductor.build/docs/reference/diff-viewer
- Checks: https://www.conductor.build/docs/reference/checks
- Checkpoints: https://www.conductor.build/docs/reference/checkpoints
- MCP: https://www.conductor.build/docs/reference/mcp
- Keyboard shortcuts: https://www.conductor.build/docs/reference/keyboard-shortcuts
- User-provided screenshot inventory: `.context/conductor-screens/`, summarized in `docs/product/screen-inventory.md`
- Implemented Ensemble shell inventory: `docs/product/current-shell-inventory.md`

## Implemented Shell Direction

The current React workbench shell is now a product contract, not a disposable
mockup. It establishes the sidebar/project/workspace hierarchy, active
workspace header, open-workspace launcher, chat/session tab strip, center
timeline and composer placement, right All files / Changes / Checks panel,
right PR-state header, and lower Setup / Run / Terminal dock.

Future parity work should replace fixture/local renderer data with live
services through TanStack Query, typed IPC, and app services. It should not
recreate the same shell surfaces from scratch. Chat transcript content and
prompt-composer behavior remain deferred until Pi runtime integration.
The current shell is the intended closest match to Conductor's own shell, even
if original screenshot evidence is unavailable.

## Product Model

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Project | One app entry for a codebase with repository settings and workspaces. | Same model, with Pi-specific repository settings. |
| Repository | Git codebase from a local folder, GitHub project, or starter flow. | Same target. |
| Project add flow | Sidebar add menu supports local projects, GitHub projects, quick starts, and recents. | Same target, with local-only recents and `gh`/git-backed clone flow. |
| Workspace | Isolated git-backed copy for one task, issue, experiment, or PR. | Same target; primary workspace type is a git worktree. |
| Branch | One workspace maps to one branch and review path. | Same target. |
| Running environment | Scripts, terminals, servers, tests, and watchers run inside the workspace. | Same target, implemented with Electron process/PTY services. |

## Workspace And Parallel Work

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Independent tasks | Multiple workspaces for independently mergeable streams. | Same target. |
| Shared work | Multiple agents in one workspace when they share branch/context. | Same target, represented as multiple Pi sessions in one workspace. |
| Workspace creation | New workspace from branch, PR, issue, or Linear issue. | Same target; Linear issue workspaces are v1 scope and GitHub issue/PR entry points use `gh` where practical. |
| Workspace landing | New workspaces show branch source, copied-file count, and setup-script guidance before the first prompt. | Same target with Pi composer ready on first prompt. |
| Archive | Archive finished/discarded workspaces and run archive script first. | Lifecycle state in SQLite (`workspaces.archived_at` + `archive_records`) with `.context/` preserved under `archived-contexts/` and a hook surface for `ENS-038`'s archive script and `ENS-060`'s after-merge cleanup; branch cleanup is opt-in. See ADR 0027. |
| Unarchive | Implicit through "restore" affordances on archived workspaces. | Repository context menu's **Browse archive…** entry opens a dialog listing archived workspaces. Restore NULLs `archived_at`, restores the preserved `.context/`, and recreates the worktree from the recorded base branch when archive ran with branch cleanup. |
| Delete vs archive | Single destructive action. | Distinct intents: archive keeps state and context, delete drops the worktree + branch + row and writes the `.ensemble-archived` sentinel. Both require explicit confirmation. Destructive repository delete also wipes `<root>/archived-contexts/<repo-slug>/`. |
| Workspace context | `.context` folder for uncommitted handoff files. | Same target; preserved verbatim into `archived-contexts/<repo>/<workspace>-<timestamp>/.context/` on archive, with a sibling `archive-metadata.json` snapshot. |

## Pi Agent Runtime

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Agent types | Claude Code and Codex. | Pi only for v1. |
| Session controls | Plan mode, fast mode, reasoning, personality, checkpoints. | Adapt to Pi capabilities: model, thinking level, session tree, compaction, steering/follow-up, checkpoints. |
| Instructions | Repository instructions, instruction files, skills. | Preserve Pi user environment and Pi resource loading from `~/.pi/agent`, project `.pi`, and context files. |
| Timeline | Show agent messages, tool calls, output, status, and review context. | Structured Pi RPC event timeline. |
| Runtime errors | Inline provider/runtime error cards with retry and retry-in-new-chat actions. | Pi CLI/RPC runtime error cards with retry, fork, or continuation behavior mapped to Pi session history. |
| Composer | Prompt box supports model/reasoning controls, file/PR references, slash/run commands, attachments, optional voice input, and stop/submit controls. | Pi composer with Pi model/thinking controls, Pi attachments/context, and stop/submit controls. Voice input is deferred until after core completion. |
| Terminal mode | Big terminal mode and terminal panels. | xterm.js terminal panes for shells/scripts/logs. The primary Pi agent runtime is CLI RPC, not terminal scraping; optional raw interactive Pi terminals can be separate manual terminals. |

## Scripts And Local Runtime

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Setup script | Runs when workspace is created. | Same target. |
| Run script | Runs from Run button inside workspace. | Same target. |
| Archive script | Runs before workspace archive. | Same target via the lifecycle hook registry from ADR 0027; `ENS-038` registers a `pre-archive-workspace` subscriber that runs the configured archive script and can veto archive on failure. |
| Run script mode | `concurrent` or `nonconcurrent`. | Same target. |
| Terminal dock | Fixed read-only Setup and Run output tabs plus default and user-spawned terminal tabs stay visible beside chat/files/checks. | Same target with xterm.js and Electron process supervision; user terminals are independent IDE-style terminal sessions. |
| Spotlight testing | Syncs workspace changes back to repo root for root-only projects. | Same target after core workspace flow. |
| Process shutdown | Stop sends SIGHUP, then SIGKILL if still running. | Match behavior where practical. |

## Files To Copy

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Purpose | Copy selected gitignored local files into new workspaces. | Same target. |
| Resolution order | `.worktreeinclude`, repo settings, default `.env*`. | Same target; `.worktreeinclude` wins when present. |
| Pattern syntax | Gitignore-style patterns. | Same target. |
| Constraints | Only gitignored files are eligible; tracked files already exist. | Same target. |

## Repository Configuration

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Shared file | `conductor.json` at repo root. | The committed `.ensemble/settings.toml` is the sole repository config file (see ADR 0030). |
| Fields | `scripts.setup`, `scripts.run`, `scripts.archive`, `runScriptMode`, `enterpriseDataPrivacy`. | Same functional fields where applicable; Pi-specific fields belong in `.ensemble/settings.toml`. |
| Preview URL | Repository settings can define a preview URL template using workspace environment variables. | Same target with `ENSEMBLE_*` variables. |
| Action preferences | Repository settings include per-action agent instructions for review, PR creation, fixing errors, conflict resolution, branch naming, and general chats. | Same target as Pi instruction templates with personal and shared sources. |
| Precedence | Personal repository settings override shared config. | Reversed for Ensemble: the committed `.ensemble/settings.toml` overrides personal SQLite settings per key (see ADR 0030). |
| Shell | Scripts run from workspace directory with workspace env vars. | Same target. |

## Environment Variables

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Workspace name | `CONDUCTOR_WORKSPACE_NAME`. | Expose `ENSEMBLE_WORKSPACE_NAME`. |
| Workspace path | `CONDUCTOR_WORKSPACE_PATH`. | Expose `ENSEMBLE_WORKSPACE_PATH`. |
| Root path | `CONDUCTOR_ROOT_PATH`. | Expose `ENSEMBLE_ROOT_PATH`. |
| Default branch | `CONDUCTOR_DEFAULT_BRANCH`. | Expose `ENSEMBLE_DEFAULT_BRANCH`. |
| Port range | `CONDUCTOR_PORT` plus allocated nearby ports. | Expose `ENSEMBLE_PORT`. |

## Review Flow

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Diff viewer | Changed file list, unified diff, commit filtering. | Same target. |
| Changes tree | Folder-grouped changed-file tree with status badges, addition/deletion counts, search, and display controls. | Same target. |
| Comments | Local line comments sent back to agent; GitHub review comments visible. | Same target. |
| Comments to chat | GitHub/check comments can be added to the agent context. | Same target, adding selected comments to Pi chat context. |
| PR actions | Create PR, respond to feedback, fix checks, merge. | Same target. |
| Checks tab | Git status, PR metadata, CI/status checks, deployments, comments/review threads, todos. | Same target. |
| PR readiness states | No-PR, uncommitted, pending/failing checks, and ready-to-merge states have distinct UI. | Same target with `gh`/git state cached in SQLite. |
| Deployments | Deployment/preview status appears with external links. | Same target, deriving preview URLs from GitHub deployment/status, check, or bot-comment data through `gh` for v1 without Vercel/Netlify login; direct provider APIs are deferred unless GitHub data proves insufficient. |
| Todos | Users can add local review todos in checks/review context. | Same target, stored in SQLite and optionally sent to Pi. |
| Blockers | Discourage/block merge when unresolved work exists. | Same target. |

## Checkpoints

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Snapshot timing | Captures state before supported agent responses. | Same target around Pi turns. |
| Storage | Private local refs separate from branch history. | Same target. |
| Restore | Revert code and delete later chat state. | Same target with Pi session-tree implications resolved later. |

## Integrations

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| GitHub | Issues, PRs, checks, comments, merge flow. | Same target. |
| Linear | Workspace creation from Linear issues. | First-class v1 integration: OAuth login, issue CRUD, and workspace creation from issues. |
| Graphite | Optional stack-aware git workflow support appears as an experimental feature. | Deferred until after core completion. |
| MCP | Project-level and user-level MCP inherited by agents. | Preserve Pi MCP/package behavior first; add UI parity later. |
| IDEs | Open workspaces in Cursor/VS Code/default apps. | Same target. |

## App Shell And UX

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Command palette | Global command palette. | Same target. |
| Open in… launcher | Header split button launches the workspace in Finder, an editor, a terminal, a source-control GUI, or copies the path. | Implemented (macOS). Curated bundle-id registry probed via Launch Services (`mdfind`); real `.app` icons via `nativeImage.createThumbnailFromPath`; cached to disk and shipped through the preload initial-shell snapshot so the menu paints with real icons on first frame. Shortcuts: `1`..`9` while open, `⌘O` primary editor, `⌘⇧C` copy. See ADR 0028. |
| Keyboard shortcuts | Navigation, workspace, chat, review, Git, terminal actions. | Same target with Ensemble-specific labels. |
| Pane layout | Sidebar, center agent timeline, right files/changes/checks panel, and lower terminal dock remain visible during work. | Same target with Ensemble-specific styling. The current implemented shell locks this pane layout. |
| Settings | App settings and repository settings. | Same target with sections inventoried in `docs/product/settings-inventory.md`. Git settings (branch prefix, lifecycle) implemented in Settings → Git. |
| Feature flags | Experimental settings expose big terminal, many tabs, dashboard visibility, voice, resource usage, Graphite, and React profiler controls. | Same target where useful; voice, Graphite, cloud SSH, and production React profiler controls are deferred or hidden for v1. |
| Deep links | App URL scheme that opens/acts on workspace state. | Same target with Ensemble scheme. |
| Privacy/security | Local execution, permissions controls, privacy settings. | Same target adapted to Pi. |

## Local Storage And Declarative Config

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| App database | Local app-support SQLite database for repositories, workspaces, sessions, messages, terminals, settings, comments, attachments, env vars, and related metadata. | Same storage class using `~/Library/Application Support/com.ensemble.app/ensemble.db`. |
| Declarative config | Not documented as a primary Conductor feature. | Support `~/.config/ensemble/` for dotfile-managed preferences and policy-like settings. |
| User git defaults | Configurable per-user git settings. | Implemented via `app.git` in `~/.config/ensemble/config.json`, feeding repository resolution as `user-default` source. Supports branch prefix (github-username/custom/none), auto-rename workspace on branch, delete local branch on archive, archive after merge, set upstream on push. |
| Secrets | Environment/provider tokens are masked in settings. | Store secret values in macOS Keychain, with SQLite metadata only. |
| Runtime state | Mutable local app metadata. | Stored in SQLite, not declarative config files. |
| Pi state | Not applicable to Conductor. | `~/.pi/agent` remains source of truth for Pi auth, models, settings, resources, and Pi sessions. |

## Root Directory And Workspace Layout

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Root directory | User-configurable root directory for managed repositories and workspaces. | Same target, defaulting to `~/Ensemble`. |
| Repository storage | Managed under the Conductor root. | Store under `<ensemble-root>/repos/<repo-slug>`. |
| Workspace storage | Managed under the Conductor root. | Store under `<ensemble-root>/workspaces/<repo-slug>/<workspace-slug>`. |
| Archived context | Local archived context under the Conductor root. | Store under `<ensemble-root>/archived-contexts/`. |
| Root override | Configurable from app settings. | Configurable from app settings and `~/.config/ensemble/config.json`; may point at the same root as Conductor for filesystem/worktree/config interoperability. |


## Conductor Interoperability

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Shared root | Conductor stores managed repos and workspaces under a configurable root. | Ensemble can point at the same root and use the same `repos/`, `workspaces/`, and `archived-contexts/` layout. |
| Existing workspaces | Conductor workspaces are git worktrees. | Discover and adopt existing git worktree workspaces from the shared root when possible. |
| Shared config | `conductor.json` and `.worktreeinclude` configure repo behavior. | Read the committed `.ensemble/settings.toml` and `.worktreeinclude`; `conductor.json` is no longer read (see ADR 0030). |
| Private app DB | Conductor stores private app metadata in its own SQLite DB. | Do not read/write Conductor's private DB as a source of truth. Store Ensemble metadata separately. |
| Cross-app continuity | Conductor can continue its own sessions. | Guarantee filesystem/git/config continuity where possible; Pi session continuity remains Ensemble-specific. |

## Checkpoint Implementation

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Snapshot storage | Private local Git refs. | Store private refs under `refs/ensemble/checkpoints/<workspace-id>/<turn-id>`. |
| Snapshot timing | Before supported agent response. | Before each Pi user prompt executes. |
| Turn diff | Show code changes by turn. | Diff checkpoint ref against post-turn workspace state. |
| Restore | Revert code and later chat state. | Revert files and invalidate later Ensemble-visible continuation state without destructively editing Pi session files in v1. |
| Shared-root compatibility | Conductor refs may exist privately. | Do not depend on Conductor checkpoint refs for v1. |

## GitHub Integration Implementation

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Auth | Requires GitHub authentication in the terminal environment; users verify with `gh auth status`. | Require authenticated `gh` CLI during setup for v1. |
| API access | Uses the user's GitHub-connected environment. | Use first-class `gh` commands where available and authenticated `gh api` for REST/GraphQL gaps; do not store GitHub tokens in Ensemble. |
| PR create/view | Create and inspect pull requests. | Use `gh pr create` and `gh pr view` from Electron main. |
| Checks | Show CI/status checks. | Use `gh pr checks`; use `gh api` for deeper annotations only when needed; cache results in SQLite. |
| Comments/reviews | Show and respond to GitHub comments where available. | Use `gh pr view --comments`, REST through authenticated `gh api`, and GraphQL through `gh api graphql` for review threads where practical. |
| Merge | Merge ready PRs. | Use `gh pr merge` where permissions allow. |
| Missing integration | Conductor setup checks guide users through missing GitHub auth. | Block full readiness and show `gh` install/auth guidance. |

## Security And Permissions Implementation

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Local execution | Agents run locally with the user's Mac permissions. | Same target. |
| Workspace trust | Workspaces are isolated task environments. | Default to `workspace-trusted`: broad agent freedom inside the workspace. |
| Approvals | Some actions may ask for approval before continuing. | Ask for approval mainly outside workspace boundaries, for destructive app/root operations, or in stricter modes. |
| Read-only mode | Permission controls can restrict behavior. | Support read-only Pi sessions using Pi tool restrictions where available. |
| Enterprise privacy | User/repo-level privacy control. | Support equivalent user/repo-level `enterpriseDataPrivacy`. |


## MVP Sequencing

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Product scope | Full app workflows across setup, workspaces, agents, review, checks, settings. | Build every major Conductor workflow adapted for Pi; sequence as thin vertical slices rather than reducing final scope. |
| Packaging | Native macOS app distribution. | Deferred until after core product completion. |
| Screenshots | Not applicable. | Use user-provided Conductor screenshots as UX inventory, not pixel-copy source. |


## Remaining Product Decisions Resolved

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Chat tab limit | Allows multiple open chat tabs; user observation indicates five open chat tabs. | Allow five open chat tabs per workspace; document/file previews do not count. |
| Merge flow | Ready-to-merge action when checks pass, followed by final merge/archive flow. | Require merge confirmation; default block merge with failing required checks; archive after merge according to setting. |
| React profiler | Developer/diagnostic setting observed. | Development/internal diagnostics only for v1, not a normal production setting. |
| Deferred integrations | Voice, Graphite, and cloud/remote SSH settings appear in screenshots. | Defer these until after core completion. |


## Linear Integration Implementation

| Area | Conductor Behavior | Ensemble Target |
| --- | --- | --- |
| Login | Connected Linear integration enables issue workflows. | Linear OAuth login with PKCE where practical; tokens in macOS Keychain. |
| Issue browsing | Select issues for workspace creation. | List/search/read issues, teams, projects, statuses, labels, cycles, assignees. |
| Issue CRUD | Manage issue state through Linear. | Create, read, update, and comment in v1; archive/delete only after schema/permission discovery and explicit confirmation. |
| Workspace from issue | Create a workspace from a Linear issue. | Seed workspace name, branch, initial Pi prompt, and workspace metadata from issue identifier/title/context. |
| Source of truth | Linear remains the remote issue system. | Cache in SQLite for UI; refresh from Linear as source of truth. |
