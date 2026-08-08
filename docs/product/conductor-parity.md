# Conductor Parity Matrix

Date: 2026-08-08

Ensemblr targets feature parity with Conductor's publicly observable and documented workflows. This matrix is a living checklist, not a copied product spec.

> **Status (2026-08-08):** The Pi runtime, live `gh`-backed PR/checks, live node-pty/xterm terminals, setup/run script execution, drag-order session tabs, optimistic workspace creation, the dashboard board, and the archive lifecycle have all shipped since this doc's parity targets were written. Rows framed below as future or aspirational are largely implemented; treat the "Ensemblr Target" wording as the intended contract and read the inline "Implemented" annotations for current state.
>
> **Runtime parity closed (2026-08-07, ADR 0042):** this matrix was written when the answer to "Claude Code and Codex" was "Pi only". Claude Code is now a first-class agent runtime alongside Pi, driven in-process through `@anthropic-ai/claude-agent-sdk` against the user's own `claude` binary, with its own chat tabs, timeline, plan mode, slash commands, MCP roster, and model catalogue (#226–#237). Read "Pi" below as "the chat's agent runtime" wherever the row is not genuinely Pi-specific.

Sources checked:

- Conductor Docs: <https://www.conductor.build/docs>
- Isolated workspaces: <https://www.conductor.build/docs/concepts/workspaces-and-branches>
- Workflow: <https://www.conductor.build/docs/concepts/workflow>
- Parallel agents: <https://www.conductor.build/docs/concepts/parallel-agents>
- Agent behavior: <https://www.conductor.build/docs/reference/agent-behavior>
- Scripts: <https://www.conductor.build/docs/reference/scripts>
- conductor.json: <https://www.conductor.build/docs/reference/conductor-json>
- Files to copy: <https://www.conductor.build/docs/reference/files-to-copy>
- Environment variables: <https://www.conductor.build/docs/reference/environment-variables>
- Diff viewer: <https://www.conductor.build/docs/reference/diff-viewer>
- Checks: <https://www.conductor.build/docs/reference/checks>
- Checkpoints: <https://www.conductor.build/docs/reference/checkpoints>
- MCP: <https://www.conductor.build/docs/reference/mcp>
- Keyboard shortcuts: <https://www.conductor.build/docs/reference/keyboard-shortcuts>
- User-provided screenshot inventory: `.context/conductor-screens/`, summarized in `docs/product/screen-inventory.md`
- Implemented Ensemblr shell inventory: `docs/product/current-shell-inventory.md`

## Implemented Shell Direction

The current React workbench shell is now a product contract, not a disposable
mockup. It establishes the sidebar/project/workspace hierarchy, active
workspace header, dashboard board, open-workspace launcher, chat/session tab
strip, center timeline and composer placement, right All files / Changes /
Checks panel, right PR-state header, and lower Setup / Run / Terminal dock.

Future parity work should replace fixture/local renderer data with live
services through TanStack Query, typed IPC, and app services. It should not
recreate the same shell surfaces from scratch. Chat transcript content and
prompt-composer behavior have since landed via the Pi runtime: the structured
RPC event timeline, composer submit/stop, model/thinking-level controls, and
attachments are implemented. Setup/run scripts and terminal sessions now share
the sanitized shell-derived environment plus workspace toolchain `PATH`.
The current shell is the intended closest match to Conductor's own shell, even
if original screenshot evidence is unavailable.

## Product Model

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Project | One app entry for a codebase with repository settings and workspaces. | Same model, with Pi-specific repository settings. |
| Repository | Git codebase from a local folder, GitHub project, or starter flow. | Same target. |
| Project add flow | Sidebar add menu supports local projects, GitHub projects, quick starts, and recents. | Same target, with local-only recents and `gh`/git-backed clone flow. |
| Workspace | Isolated git-backed copy for one task, issue, experiment, or PR. | Same target; primary workspace type is a git worktree. |
| Branch | One workspace maps to one branch and review path. | Same target. |
| Running environment | Scripts, terminals, servers, tests, and watchers run inside the workspace. | Same target, implemented with Electron process/PTY services. |

## Workspace And Parallel Work

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Independent tasks | Multiple workspaces for independently mergeable streams. | Same target. |
| Shared work | Multiple agents in one workspace when they share branch/context. | Same target, represented as multiple Pi sessions in one workspace. |
| Workspace creation | New workspace from branch, PR, issue, or Linear issue. | **Implemented.** Linear issue workspaces are v1 scope and GitHub issue/PR entry points use `gh`. Since #225 creation carries a `branchPlan`: `adopt` checks out and owns an existing branch (so its commits show in review and pushes land on the PR it backs), `create` cuts a fresh branch at a fork point. The base branch is a separate merge target, defaulting to the PR's own base, and is selectable per workspace (#216). |
| Workspace landing | New workspaces show branch source, copied-file count, and setup-script guidance before the first prompt. | Same target with the composer ready on first prompt. |
| Archive | Archive finished/discarded workspaces and run archive script first. | Lifecycle state in SQLite (`workspaces.archived_at` + `archive_records`) with `.context/` preserved under `archived-contexts/` and a hook surface for `ENS-038`'s archive script and `ENS-060`'s after-merge cleanup; branch cleanup is opt-in. See ADR 0027. |
| Unarchive | Implicit through "restore" affordances on archived workspaces. | Repository context menu's **Browse archive…** entry opens a dialog listing archived workspaces. Restore NULLs `archived_at`, restores the preserved `.context/`, and recreates the worktree from the recorded base branch when archive ran with branch cleanup. |
| Delete vs archive | Single destructive action. | Distinct intents: archive keeps state and context, delete drops the worktree + branch + row and writes the `.ensemblr-archived` sentinel. Both require explicit confirmation. Destructive repository delete also wipes `<root>/archived-contexts/<repo-slug>/`. |
| Workspace context | `.context` folder for uncommitted handoff files. | Same target; preserved verbatim into `archived-contexts/<repo>/<workspace>-<timestamp>/.context/` on archive, with a sibling `archive-metadata.json` snapshot. |

## Agent Runtime

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Agent types | Claude Code and Codex. | **Implemented (2026-08-07, ADR 0042).** Two first-class runtimes: Claude Code (in-process SDK) and Pi (CLI RPC), as siblings under `src/main/agent-runtime/`. A chat is pinned to one provider; a spawned sub-agent inherits its caller's. Codex stays a terminal harness, not an agent provider. |
| Session controls | Plan mode, fast mode, reasoning, personality, checkpoints. | **Implemented.** Model, thinking level, session tree, compaction, steering/follow-up, checkpoints, plus a per-chat plan mode (#184) — Claude's native one, Pi's through the shipped extension's `tool_call` hook. Fast mode and personality have no runtime concept and are not exposed. |
| Instructions | Repository instructions, instruction files, skills. | Each runtime keeps its own user environment: Pi loads `~/.pi/agent`, project `.pi`, and context files; Claude Code uses the user's own configuration, slash commands, and MCP roster (#228). Ensemblr duplicates neither. |
| Timeline | Show agent messages, tool calls, output, status, and review context. | **Implemented.** One structured timeline over a provider-neutral event vocabulary; Claude tool results render as cards, not raw JSON (#233). |
| Runtime errors | Inline provider/runtime error cards with retry and retry-in-new-chat actions. | Runtime error cards with retry, fork, or continuation behavior mapped to the pinned runtime's session history. |
| Composer | Prompt box supports model/reasoning controls, file/PR references, slash/run commands, attachments, optional voice input, and stop/submit controls. | **Implemented** (except voice). Pi composer with Pi model/thinking controls, Pi attachments/context, and stop/submit controls. Voice input is deferred until after core completion. |
| Terminal mode | Big terminal mode and terminal panels. | **Implemented.** Live node-pty/xterm.js terminal panes for shells/scripts/logs. The primary Pi agent runtime is CLI RPC, not terminal scraping; optional raw interactive Pi terminals can be separate manual terminals. |

## Scripts And Local Runtime

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Setup script | Runs when workspace is created or manually rerun. | **Implemented.** Runs in the fixed Setup dock pane through the terminal service, with visible status/output, stop control, shell-derived env, workspace toolchain `PATH`, and `ENSEMBLR_*` vars. |
| Run script | Named run scripts (`[scripts.run.<name>]` with `command`, `icon`, `default`, `available_in`) picked from a split Run button. | **Implemented.** Same target: split Run button whose dropdown lists every configured script plus a Configure shortcut, editable as a list on the repo Scripts settings screen with an icon picker. Runs in the fixed Run dock pane with run/stop, ⌘/Ctrl+R on the last-used script, preview-url open action when detected, shell-derived env, workspace toolchain `PATH`, and `ENSEMBLR_*` vars. A legacy `run = "..."` string still resolves as one implicit script. |
| Archive script | Runs before workspace archive. | Same target via the lifecycle hook registry from ADR 0027; `ENS-038` registers a `pre-archive-workspace` subscriber that runs the configured archive script and can veto archive on failure. |
| Run script mode | `concurrent` or `nonconcurrent`. | **Implemented** across workspaces: `nonconcurrent` stops run scripts in the repository's other workspaces before starting. Within one workspace only one run script ever runs, in either mode. |
| Terminal dock | Fixed read-only Setup and Run output tabs plus default and user-spawned terminal tabs stay visible beside chat/files/checks. | **Implemented.** Same target with live node-pty/xterm.js and Electron process supervision; user terminals are independent IDE-style terminal sessions. |
| Spotlight testing | Syncs workspace changes back to repo root for root-only projects. | Same target after core workspace flow. |
| Process shutdown | Stop sends SIGHUP, then SIGKILL if still running. | Match behavior where practical. |

## Files To Copy

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Purpose | Copy selected gitignored local files into new workspaces. | Same target. |
| Resolution order | `.worktreeinclude`, repo settings, default `.env*`. | Same target; `.worktreeinclude` wins when present. |
| Pattern syntax | Gitignore-style patterns. | Same target. |
| Constraints | Only gitignored files are eligible; tracked files already exist. | Same target. |

## Repository Configuration

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Shared file | `conductor.json` at repo root. | The committed `.ensemblr/settings.toml` is the sole repository config file (see ADR 0030). |
| Writing the shared file | Conductor writes its `settings.toml` from the app, migrating a legacy `scripts.run` string into `[scripts.run.<id>]` when it rewrites. | **Matched for scripts** (ADR 0041): the Scripts settings screen rewrites the repository root's `.ensemblr/settings.toml` and performs the same legacy upgrade. Comments are not preserved. Other sections stay hand-authored. |
| Fields | `scripts.setup`, `scripts.run`, `scripts.archive`, `runScriptMode`, `enterpriseDataPrivacy`. | Same functional fields where applicable; Pi-specific fields belong in `.ensemblr/settings.toml`. Ensemblr adds `[scripts] auto_run_after_setup`, which Conductor has no equivalent for. |
| Preview URL | Repository settings can define a preview URL template using workspace environment variables. | Same target with `ENSEMBLR_*` variables. |
| Action preferences | Repository settings include per-action agent instructions for review, PR creation, fixing errors, conflict resolution, branch naming, and general chats. | Same target as Pi instruction templates with personal and shared sources. |
| Precedence | Personal repository settings override shared config. | Reversed for Ensemblr: the committed `.ensemblr/settings.toml` overrides personal SQLite settings per key (see ADR 0030). Script settings have no personal layer at all — the committed file is their only store (see ADR 0041). |
| Shell | Scripts run from workspace directory with workspace env vars. | **Implemented.** Script/terminal processes run from the workspace directory, strip macOS launch-context env, inherit the user's shell-derived environment and workspace toolchain `PATH`, then merge workspace env overlays and `ENSEMBLR_*` vars. |

## Environment Variables

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Workspace name | `CONDUCTOR_WORKSPACE_NAME`. | Expose `ENSEMBLR_WORKSPACE_NAME`. |
| Workspace path | `CONDUCTOR_WORKSPACE_PATH`. | Expose `ENSEMBLR_WORKSPACE_PATH`. |
| Root path | `CONDUCTOR_ROOT_PATH`. | Expose `ENSEMBLR_ROOT_PATH`. |
| Default branch | `CONDUCTOR_DEFAULT_BRANCH`. | Expose `ENSEMBLR_DEFAULT_BRANCH`. |
| Port range | `CONDUCTOR_PORT` plus allocated nearby ports. | Expose `ENSEMBLR_PORT`. |

## Review Flow

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Diff viewer | Changed file list, unified diff, commit filtering. | **Implemented.** Since #211 the file preview, turn diff, workspace file diff, and PR diff all render through one code surface. |
| Changes tree | Folder-grouped changed-file tree with status badges, addition/deletion counts, search, and display controls. | Same target. |
| Comments | Local line comments sent back to agent; GitHub review comments visible. | **Implemented** (THE-152, #151). Resolved comments render struck through (#234), and PR comment bodies are readable in-app (#209). |
| Comments to chat | GitHub/check comments can be added to the agent context. | **Implemented.** Bulk-add sends only unresolved comments (#234); agents can also read the workspace diff and file review comments through the control layer (#193). |
| PR actions | Create PR, respond to feedback, fix checks, merge. | Same target. |
| Checks tab | Git status, PR metadata, CI/status checks, deployments, comments/review threads, todos. | Same target. |
| PR readiness states | No-PR, uncommitted, pending/failing checks, and ready-to-merge states have distinct UI. | **Implemented.** Same target with live `gh`/git state cached in SQLite. |
| Deployments | Deployment/preview status appears with external links. | **Implemented.** Same target, deriving preview URLs from GitHub deployment/status, check, or bot-comment data through `gh` for v1 without Vercel/Netlify login; direct provider APIs are deferred unless GitHub data proves insufficient. |
| Todos | Users can add local review todos in checks/review context. | Same target, stored in SQLite and optionally sent to Pi. |
| Blockers | Discourage/block merge when unresolved work exists. | Same target. |

## Checkpoints

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Snapshot timing | Captures state before supported agent responses. | Same target around Pi turns. |
| Storage | Private local refs separate from branch history. | Same target. |
| Restore | Revert code and delete later chat state. | Same target with Pi session-tree implications resolved later. |

## Integrations

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| GitHub | Issues, PRs, checks, comments, merge flow. | Same target. |
| Linear | Workspace creation from Linear issues. | First-class v1 integration: OAuth login, issue CRUD, and workspace creation from issues. |
| Graphite | Optional stack-aware git workflow support appears as an experimental feature. | Deferred until after core completion. |
| MCP | Project-level and user-level MCP inherited by agents. | Preserve Pi MCP/package behavior first; add UI parity later. |
| IDEs | Open workspaces in Cursor/VS Code/default apps. | Same target. |

## App Shell And UX

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Command palette | Global command palette. | Same target. |
| Dashboard board | Workspace overview / task triage surface. | **Implemented.** Dashboard shows Backlog, In progress, In review, Done, and Canceled columns, supports drag/drop ordering, local persisted board status, unread markers, and workspace card action menus. |
| Open in… launcher | Header split button launches the workspace in Finder, an editor, a terminal, a source-control GUI, or copies the path. | Implemented (macOS). Curated bundle-id registry probed via Launch Services (`mdfind`); real `.app` icons via `nativeImage.createThumbnailFromPath`; cached to disk and shipped through the preload initial-shell snapshot so the menu paints with real icons on first frame. Shortcuts: `1`..`9` while open, `⌘O` primary editor, `⌘⇧C` copy. See ADR 0028. |
| Keyboard shortcuts | Navigation, workspace, chat, review, Git, terminal actions. | Same target with Ensemblr-specific labels. |
| Pane layout | Sidebar, center agent timeline, right files/changes/checks panel, and lower terminal dock remain visible during work. | Same target with Ensemblr-specific styling. The current implemented shell locks this pane layout. |
| Settings | App settings and repository settings. | Same target with sections inventoried in `docs/product/settings-inventory.md`. General, Models, Git, Appearance, Diagnostics, Environment, Integrations, Experimental, Advanced, and repository settings have implemented storage boundaries; Git settings and Appearance persist through `config.json`. |
| Feature flags | Experimental settings expose big terminal, many tabs, dashboard visibility, voice, resource usage, Graphite, and React profiler controls. | Ensemblr currently exposes Developer Mode and Auto-run after setup only. Big-terminal behavior is satisfied by the dock; dashboard/sidebar/browser/resource toggles are not present in code; voice, Graphite, cloud SSH, and production React profiler controls are deferred or hidden for v1. |
| Deep links | App URL scheme that opens/acts on workspace state. | Same target with Ensemblr scheme. |
| Privacy/security | Local execution, permissions controls, privacy settings. | Same target adapted to Pi. |

## Local Storage And Declarative Config

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| App database | Local app-support SQLite database for repositories, workspaces, sessions, messages, terminals, settings, comments, attachments, env vars, and related metadata. | Same storage class using `~/Library/Application Support/dev.ensemblr.app/ensemblr.db`. |
| Declarative config | Not documented as a primary Conductor feature. | Support `~/.config/ensemblr/` for dotfile-managed preferences and policy-like settings. |
| User git defaults | Configurable per-user git settings. | Implemented via `app.git` in `~/.config/ensemblr/config.json`, feeding repository resolution as `user-default` source. Supports branch prefix (github-username/custom/none), auto-rename workspace on branch, delete local branch on archive, archive after merge, set upstream on push. |
| Secrets | Environment/provider tokens are masked in settings. | Store secret values in macOS Keychain, with SQLite metadata only. |
| Runtime state | Mutable local app metadata. | Stored in SQLite, not declarative config files. |
| Pi state | Not applicable to Conductor. | `~/.pi/agent` remains source of truth for Pi auth, models, settings, resources, and Pi sessions. |

## Root Directory And Workspace Layout

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Root directory | User-configurable root directory for managed repositories and workspaces. | Same target, defaulting to `~/Ensemblr`. |
| Repository storage | Managed under the Conductor root. | Store under `<ensemblr-root>/repos/<repo-slug>`. |
| Workspace storage | Managed under the Conductor root. | Store under `<ensemblr-root>/workspaces/<repo-slug>/<workspace-slug>`. |
| Archived context | Local archived context under the Conductor root. | Store under `<ensemblr-root>/archived-contexts/`. |
| Root override | Configurable from app settings. | Configurable from app settings and `~/.config/ensemblr/config.json`; may point at the same root as Conductor for filesystem/worktree/config interoperability. |

## Conductor Interoperability

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Shared root | Conductor stores managed repos and workspaces under a configurable root. | Ensemblr can point at the same root and use the same `repos/`, `workspaces/`, and `archived-contexts/` layout. |
| Existing workspaces | Conductor workspaces are git worktrees. | Discover and adopt existing git worktree workspaces from the shared root when possible. |
| Shared config | `conductor.json` and `.worktreeinclude` configure repo behavior. | Read the committed `.ensemblr/settings.toml` and `.worktreeinclude`; `conductor.json` is no longer read (see ADR 0030). |
| Private app DB | Conductor stores private app metadata in its own SQLite DB. | Do not read/write Conductor's private DB as a source of truth. Store Ensemblr metadata separately. |
| Cross-app continuity | Conductor can continue its own sessions. | Guarantee filesystem/git/config continuity where possible; Pi session continuity remains Ensemblr-specific. |

## Checkpoint Implementation

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Snapshot storage | Private local Git refs. | Store private refs under `refs/ensemblr/checkpoints/<workspace-id>/<turn-id>`. |
| Snapshot timing | Before supported agent response. | Before each Pi user prompt executes. |
| Turn diff | Show code changes by turn. | Diff checkpoint ref against post-turn workspace state. |
| Restore | Revert code and later chat state. | Revert files and invalidate later Ensemblr-visible continuation state without destructively editing Pi session files in v1. |
| Shared-root compatibility | Conductor refs may exist privately. | Do not depend on Conductor checkpoint refs for v1. |

## GitHub Integration Implementation

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Auth | Requires GitHub authentication in the terminal environment; users verify with `gh auth status`. | Require authenticated `gh` CLI during setup for v1. |
| API access | Uses the user's GitHub-connected environment. | Use first-class `gh` commands where available and authenticated `gh api` for REST/GraphQL gaps; do not store GitHub tokens in Ensemblr. |
| PR create/view | Create and inspect pull requests. | Use `gh pr create` and `gh pr view` from Electron main. |
| Checks | Show CI/status checks. | Use `gh pr checks`; use `gh api` for deeper annotations only when needed; cache results in SQLite. |
| Comments/reviews | Show and respond to GitHub comments where available. | Use `gh pr view --comments`, REST through authenticated `gh api`, and GraphQL through `gh api graphql` for review threads where practical. |
| Merge | Merge ready PRs. | Use `gh pr merge` where permissions allow. |
| Missing integration | Conductor setup checks guide users through missing GitHub auth. | Block full readiness and show `gh` install/auth guidance. |

## Security And Permissions Implementation

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Local execution | Agents run locally with the user's Mac permissions. | Same target. |
| Workspace trust | Workspaces are isolated task environments. | Default to `workspace-trusted`: broad agent freedom inside the workspace. |
| Approvals | Some actions may ask for approval before continuing. | Ask for approval mainly outside workspace boundaries, for destructive app/root operations, or in stricter modes. |
| Read-only mode | Permission controls can restrict behavior. | Support read-only Pi sessions using Pi tool restrictions where available. |
| Enterprise privacy | User/repo-level privacy control. | Support equivalent user/repo-level `enterpriseDataPrivacy`. |

## MVP Sequencing

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Product scope | Full app workflows across setup, workspaces, agents, review, checks, settings. | Build every major Conductor workflow adapted for Pi; sequence as thin vertical slices rather than reducing final scope. |
| Packaging | Native macOS app distribution. | Deferred until after core product completion. |
| Screenshots | Not applicable. | Use user-provided Conductor screenshots as UX inventory, not pixel-copy source. |

## Remaining Product Decisions Resolved

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Chat tab limit | Allows multiple open chat tabs; user observation indicates five open chat tabs. | Intentional divergence (ADR 0039): unlimited open chat tabs per workspace. The former five-tab cap (ADR 0022) was removed; document/file previews still re-focus rather than duplicate. |
| Merge flow | Ready-to-merge action when checks pass, followed by final merge/archive flow. | Require merge confirmation; default block merge with failing required checks; archive after merge according to setting. |
| React profiler | Developer/diagnostic setting observed. | Development/internal diagnostics only for v1, not a normal production setting. |
| Deferred integrations | Voice, Graphite, and cloud/remote SSH settings appear in screenshots. | Defer these until after core completion. |

## Linear Integration Implementation

| Area | Conductor Behavior | Ensemblr Target |
| --- | --- | --- |
| Login | Connected Linear integration enables issue workflows. | Linear OAuth login with PKCE where practical; tokens in macOS Keychain. |
| Issue browsing | Select issues for workspace creation. | List/search/read issues, teams, projects, statuses, labels, cycles, assignees. |
| Issue CRUD | Manage issue state through Linear. | Create, read, update, and comment in v1; archive/delete only after schema/permission discovery and explicit confirmation. |
| Workspace from issue | Create a workspace from a Linear issue. | Seed workspace name, branch, initial Pi prompt, and workspace metadata from issue identifier/title/context. |
| Source of truth | Linear remains the remote issue system. | Cache in SQLite for UI; refresh from Linear as source of truth. |
