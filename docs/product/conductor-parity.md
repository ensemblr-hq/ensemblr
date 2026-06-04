# Conductor Parity Matrix

Date: 2026-06-04

Piductor targets feature parity with Conductor's publicly observable and documented workflows, adapted for Pi. This matrix is a living checklist, not a copied product spec.

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

## Product Model

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Project | One app entry for a codebase with repository settings and workspaces. | Same model, with Pi-specific repository settings. |
| Repository | Git codebase from a local folder, GitHub project, or starter flow. | Same target. |
| Project add flow | Sidebar add menu supports local projects, GitHub projects, quick starts, and recents. | Same target, with local-only recents and `gh`/git-backed clone flow. |
| Workspace | Isolated git-backed copy for one task, issue, experiment, or PR. | Same target; primary workspace type is a git worktree. |
| Branch | One workspace maps to one branch and review path. | Same target. |
| Running environment | Scripts, terminals, servers, tests, and watchers run inside the workspace. | Same target, implemented with Electron process/PTY services. |

## Workspace And Parallel Work

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Independent tasks | Multiple workspaces for independently mergeable streams. | Same target. |
| Shared work | Multiple agents in one workspace when they share branch/context. | Same target, represented as multiple Pi sessions in one workspace. |
| Workspace creation | New workspace from branch, PR, issue, or Linear issue. | Same target; Linear issue workspaces are v1 scope and GitHub issue/PR entry points use `gh` where practical. |
| Workspace landing | New workspaces show branch source, copied-file count, and setup-script guidance before the first prompt. | Same target with Pi composer ready on first prompt. |
| Archive | Archive finished/discarded workspaces and run archive script first. | Same target. |
| Workspace context | `.context` folder for uncommitted handoff files. | Same target. |

## Pi Agent Runtime

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Agent types | Claude Code and Codex. | Pi only for v1. |
| Session controls | Plan mode, fast mode, reasoning, personality, checkpoints. | Adapt to Pi capabilities: model, thinking level, session tree, compaction, steering/follow-up, checkpoints. |
| Instructions | Repository instructions, instruction files, skills. | Preserve Pi user environment and Pi resource loading from `~/.pi/agent`, project `.pi`, and context files. |
| Timeline | Show agent messages, tool calls, output, status, and review context. | Structured Pi RPC event timeline. |
| Runtime errors | Inline provider/runtime error cards with retry and retry-in-new-chat actions. | Pi CLI/RPC runtime error cards with retry, fork, or continuation behavior mapped to Pi session history. |
| Composer | Prompt box supports model/reasoning controls, file/PR references, slash/run commands, attachments, optional voice input, and stop/submit controls. | Pi composer with Pi model/thinking controls, Pi attachments/context, and stop/submit controls. Voice input is deferred until after core completion. |
| Terminal mode | Big terminal mode and terminal panels. | xterm.js terminal panes for shells/scripts/logs. The primary Pi agent runtime is CLI RPC, not terminal scraping; optional raw interactive Pi terminals can be separate manual terminals. |

## Scripts And Local Runtime

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Setup script | Runs when workspace is created. | Same target. |
| Run script | Runs from Run button inside workspace. | Same target. |
| Archive script | Runs before workspace archive. | Same target. |
| Run script mode | `concurrent` or `nonconcurrent`. | Same target. |
| Terminal dock | Setup, Run, and named terminal tabs stay visible beside chat/files/checks. | Same target with xterm.js and Electron process supervision. |
| Spotlight testing | Syncs workspace changes back to repo root for root-only projects. | Same target after core workspace flow. |
| Process shutdown | Stop sends SIGHUP, then SIGKILL if still running. | Match behavior where practical. |

## Files To Copy

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Purpose | Copy selected gitignored local files into new workspaces. | Same target. |
| Resolution order | `.worktreeinclude`, repo settings, default `.env*`. | Same target; `.worktreeinclude` wins when present. |
| Pattern syntax | Gitignore-style patterns. | Same target. |
| Constraints | Only gitignored files are eligible; tracked files already exist. | Same target. |

## Repository Configuration

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Shared file | `conductor.json` at repo root. | Support `piductor.json` first, then `conductor.json` for migration and tool-switching compatibility. |
| Fields | `scripts.setup`, `scripts.run`, `scripts.archive`, `runScriptMode`, `enterpriseDataPrivacy`. | Same functional fields where applicable; Pi-specific fields belong in `piductor.json`. |
| Preview URL | Repository settings can define a preview URL template using workspace environment variables. | Same target with `PIDUCTOR_*` variables and `CONDUCTOR_*` compatibility for Conductor-compatible repos or explicit opt-in. |
| Action preferences | Repository settings include per-action agent instructions for review, PR creation, fixing errors, conflict resolution, branch naming, and general chats. | Same target as Pi instruction templates with personal and shared sources. |
| Precedence | Personal repository settings override shared config. | Same target. |
| Shell | Scripts run from workspace directory with workspace env vars. | Same target. |

## Environment Variables

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Workspace name | `CONDUCTOR_WORKSPACE_NAME`. | Expose `PIDUCTOR_WORKSPACE_NAME`; expose `CONDUCTOR_WORKSPACE_NAME` for compatibility. |
| Workspace path | `CONDUCTOR_WORKSPACE_PATH`. | Expose `PIDUCTOR_WORKSPACE_PATH`; expose `CONDUCTOR_WORKSPACE_PATH` for compatibility. |
| Root path | `CONDUCTOR_ROOT_PATH`. | Expose `PIDUCTOR_ROOT_PATH`; expose `CONDUCTOR_ROOT_PATH` for compatibility. |
| Default branch | `CONDUCTOR_DEFAULT_BRANCH`. | Expose `PIDUCTOR_DEFAULT_BRANCH`; expose `CONDUCTOR_DEFAULT_BRANCH` for compatibility. |
| Port range | `CONDUCTOR_PORT` plus allocated nearby ports. | Expose `PIDUCTOR_PORT`; expose `CONDUCTOR_PORT` for compatibility. |

## Review Flow

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Diff viewer | Changed file list, unified diff, commit filtering. | Same target. |
| Changes tree | Folder-grouped changed-file tree with status badges, addition/deletion counts, search, and display controls. | Same target. |
| Comments | Local line comments sent back to agent; GitHub review comments visible. | Same target. |
| Comments to chat | GitHub/check comments can be added to the agent context. | Same target, adding selected comments to Pi chat context. |
| PR actions | Create PR, respond to feedback, fix checks, merge. | Same target. |
| Checks tab | Git status, PR metadata, CI/status checks, deployments, comments/review threads, todos. | Same target. |
| PR readiness states | No-PR, uncommitted, pending/failing checks, and ready-to-merge states have distinct UI. | Same target with `gh`/git state cached in SQLite. |
| Deployments | Deployment/preview status appears with external links. | Same target where `gh`/provider data exposes it; direct API may be needed later. |
| Todos | Users can add local review todos in checks/review context. | Same target, stored in SQLite and optionally sent to Pi. |
| Blockers | Discourage/block merge when unresolved work exists. | Same target. |

## Checkpoints

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Snapshot timing | Captures state before supported agent responses. | Same target around Pi turns. |
| Storage | Private local refs separate from branch history. | Same target. |
| Restore | Revert code and delete later chat state. | Same target with Pi session-tree implications resolved later. |

## Integrations

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| GitHub | Issues, PRs, checks, comments, merge flow. | Same target. |
| Linear | Workspace creation from Linear issues. | First-class v1 integration: OAuth login, issue CRUD, and workspace creation from issues. |
| Graphite | Optional stack-aware git workflow support appears as an experimental feature. | Deferred until after core completion. |
| MCP | Project-level and user-level MCP inherited by agents. | Preserve Pi MCP/package behavior first; add UI parity later. |
| IDEs | Open workspaces in Cursor/VS Code/default apps. | Same target. |

## App Shell And UX

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Command palette | Global command palette. | Same target. |
| Keyboard shortcuts | Navigation, workspace, chat, review, Git, terminal actions. | Same target with Piductor-specific labels. |
| Pane layout | Sidebar, center agent timeline, right files/changes/checks panel, and lower terminal dock remain visible during work. | Same target with Piductor-specific styling. |
| Settings | App settings and repository settings. | Same target with sections inventoried in `docs/product/settings-inventory.md`. |
| Feature flags | Experimental settings expose big terminal, many tabs, dashboard visibility, voice, resource usage, Graphite, and React profiler controls. | Same target where useful; voice, Graphite, cloud SSH, and production React profiler controls are deferred or hidden for v1. |
| Deep links | App URL scheme that opens/acts on workspace state. | Same target with Piductor scheme. |
| Privacy/security | Local execution, permissions controls, privacy settings. | Same target adapted to Pi. |

## Local Storage And Declarative Config

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| App database | Local app-support SQLite database for repositories, workspaces, sessions, messages, terminals, settings, comments, attachments, env vars, and related metadata. | Same storage class using `~/Library/Application Support/com.piductor.app/piductor.db`. |
| Declarative config | Not documented as a primary Conductor feature. | Support `~/.config/piductor/` for dotfile-managed preferences and policy-like settings. |
| Secrets | Environment/provider tokens are masked in settings. | Store secret values in macOS Keychain, with SQLite metadata only. |
| Runtime state | Mutable local app metadata. | Stored in SQLite, not declarative config files. |
| Pi state | Not applicable to Conductor. | `~/.pi/agent` remains source of truth for Pi auth, models, settings, resources, and Pi sessions. |

## Root Directory And Workspace Layout

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Root directory | User-configurable root directory for managed repositories and workspaces. | Same target, defaulting to `~/Piductor`. |
| Repository storage | Managed under the Conductor root. | Store under `<piductor-root>/repos/<repo-slug>`. |
| Workspace storage | Managed under the Conductor root. | Store under `<piductor-root>/workspaces/<repo-slug>/<workspace-slug>`. |
| Archived context | Local archived context under the Conductor root. | Store under `<piductor-root>/archived-contexts/`. |
| Root override | Configurable from app settings. | Configurable from app settings and `~/.config/piductor/config.json`; may point at the same root as Conductor for filesystem/worktree/config interoperability. |


## Conductor Interoperability

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Shared root | Conductor stores managed repos and workspaces under a configurable root. | Piductor can point at the same root and use the same `repos/`, `workspaces/`, and `archived-contexts/` layout. |
| Existing workspaces | Conductor workspaces are git worktrees. | Discover and adopt existing git worktree workspaces from the shared root when possible. |
| Shared config | `conductor.json` and `.worktreeinclude` configure repo behavior. | Support both files for migration and switching between apps. |
| Private app DB | Conductor stores private app metadata in its own SQLite DB. | Do not read/write Conductor's private DB as a source of truth. Store Piductor metadata separately. |
| Cross-app continuity | Conductor can continue its own sessions. | Guarantee filesystem/git/config continuity where possible; Pi session continuity remains Piductor-specific. |

## Checkpoint Implementation

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Snapshot storage | Private local Git refs. | Store private refs under `refs/piductor/checkpoints/<workspace-id>/<turn-id>`. |
| Snapshot timing | Before supported agent response. | Before each Pi user prompt executes. |
| Turn diff | Show code changes by turn. | Diff checkpoint ref against post-turn workspace state. |
| Restore | Revert code and later chat state. | Revert files and invalidate later Piductor-visible continuation state without destructively editing Pi session files in v1. |
| Shared-root compatibility | Conductor refs may exist privately. | Do not depend on Conductor checkpoint refs for v1. |

## GitHub Integration Implementation

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Auth | Requires GitHub authentication in the terminal environment; users verify with `gh auth status`. | Require authenticated `gh` CLI during setup for v1. |
| PR create/view | Create and inspect pull requests. | Use `gh pr create` and `gh pr view` from Electron main. |
| Checks | Show CI/status checks. | Use `gh pr checks` and cache results in SQLite. |
| Comments/reviews | Show and respond to GitHub comments where available. | Use `gh` JSON output where practical; defer direct API if needed. |
| Merge | Merge ready PRs. | Use `gh pr merge` where permissions allow. |
| Missing integration | Conductor setup checks guide users through missing GitHub auth. | Block full readiness and show `gh` install/auth guidance. |

## Security And Permissions Implementation

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Local execution | Agents run locally with the user's Mac permissions. | Same target. |
| Workspace trust | Workspaces are isolated task environments. | Default to `workspace-trusted`: broad agent freedom inside the workspace. |
| Approvals | Some actions may ask for approval before continuing. | Ask for approval mainly outside workspace boundaries, for destructive app/root operations, or in stricter modes. |
| Read-only mode | Permission controls can restrict behavior. | Support read-only Pi sessions using Pi tool restrictions where available. |
| Enterprise privacy | User/repo-level privacy control. | Support equivalent user/repo-level `enterpriseDataPrivacy`. |


## MVP Sequencing

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Product scope | Full app workflows across setup, workspaces, agents, review, checks, settings. | Build every major Conductor workflow adapted for Pi; sequence as thin vertical slices rather than reducing final scope. |
| Packaging | Native macOS app distribution. | Deferred until after core product completion. |
| Screenshots | Not applicable. | Use user-provided Conductor screenshots as UX inventory, not pixel-copy source. |


## Remaining Product Decisions Resolved

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Chat tab limit | Allows multiple open chat tabs; user observation indicates five open chat tabs. | Allow five open chat tabs per workspace; document/file previews do not count. |
| Merge flow | Ready-to-merge action when checks pass, followed by final merge/archive flow. | Require merge confirmation; default block merge with failing required checks; archive after merge according to setting. |
| React profiler | Developer/diagnostic setting observed. | Development/internal diagnostics only for v1, not a normal production setting. |
| Deferred integrations | Voice, Graphite, and cloud/remote SSH settings appear in screenshots. | Defer these until after core completion. |


## Linear Integration Implementation

| Area | Conductor Behavior | Piductor Target |
| --- | --- | --- |
| Login | Connected Linear integration enables issue workflows. | Linear OAuth login with PKCE where practical; tokens in macOS Keychain. |
| Issue browsing | Select issues for workspace creation. | List/search/read issues, teams, projects, statuses, labels, cycles, assignees. |
| Issue CRUD | Manage issue state through Linear. | Create, read, update, and comment in v1; archive/delete only after schema/permission discovery and explicit confirmation. |
| Workspace from issue | Create a workspace from a Linear issue. | Seed workspace name, branch, initial Pi prompt, and workspace metadata from issue identifier/title/context. |
| Source of truth | Linear remains the remote issue system. | Cache in SQLite for UI; refresh from Linear as source of truth. |
