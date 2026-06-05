# Screen Inventory

Date: 2026-06-04

This inventory summarizes Conductor screenshots as UX evidence for Ensemble implementation. It intentionally avoids copying Conductor branding, visual identity, private repository names, account data, tokens, issue text, PR text, and chat content. Exact file paths are included only for the screenshot evidence files.

The original screenshot files may be unavailable in later workspaces. This
document is historical parity evidence, not the current shell source of truth.
Use `docs/product/current-shell-inventory.md` and the implemented renderer shell
when planning app-shell work.

## Evidence Notes

- `.context/conductor-screens/manifest.json` still contains only a placeholder entry, so this inventory was built from the PNG files directly.
- `01-onboarding` contains no screenshots. Its local note says to infer onboarding from the rest of the UI; inferred onboarding details are documented in `docs/product/onboarding-flow.md`.
- Repository names, local user paths, account names, email addresses, PR descriptions, chat content, and private file details visible in screenshots are described generically.
- The annotated June 5, 2026 screenshot at `.context/attachments/NJpu5l/CleanShot 2026-06-05 at 08.42.35@2x.png` clarifies the main workspace shell structure: project/workspace sidebar, project/branch breadcrumb, chat tabs, center agent timeline and composer, right All files/Changes/Checks panel, and lower Setup/Run/Terminal dock.
- The implemented shell in `src/components/workbench-shell.tsx` and
  `src/components/workbench-shell/` now supersedes older speculative shell
  notes. Use `docs/product/current-shell-inventory.md` for the current Ensemble
  shell contract, and use this screenshot inventory as evidence for Conductor
  workflow parity.

## 01-onboarding

No onboarding PNG files were captured under `.context/conductor-screens/01-onboarding/`.

- Flow: `01-onboarding`
- Screen name: Screenshot gap
- User goal: Understand first-run setup gate before using the app.
- Entry point: First launch or missing prerequisite detection.
- Primary actions: Not directly captured.
- Secondary actions: Not directly captured.
- Visible UI regions: Not captured.
- Empty/loading/error states: Not captured.
- Data shown: Not captured.
- Settings or configuration implied: Inferred from settings and ADR 0014: git, GitHub CLI auth, Pi runtime/provider readiness, root directory, SQLite, process environment.
- Ensemble parity requirement: Implement a setup gate with concrete remediation states, but do not claim exact visual parity until screenshots exist.
- Pi-specific adaptation: Replace Claude/Codex provider checks with Pi CLI RPC runtime, Pi agent directory, and Pi model/provider discovery.
- Risks or implementation notes: The exact first-run sequence remains an open UX gap.

## 02-root-settings

### `.context/conductor-screens/02-root-settings/CleanShot 2026-06-04 at 17.55.01@2x.png`

- Flow: `02-root-settings`
- Screen name: App Settings - General
- User goal: Configure global interaction and notification behavior.
- Entry point: Settings sidebar, General tab.
- Primary actions: Sync agent configuration, choose send shortcut, choose follow-up behavior, toggle notifications and context/tool-call display preferences.
- Secondary actions: Test completion sound, return to app, switch settings sections, jump to local project settings.
- Visible UI regions: macOS window chrome, settings sidebar, local-project shortcuts, centered settings form with row dividers and controls.
- Empty/loading/error states: No loading or error state visible.
- Data shown: Current global defaults for message sending, follow-up/steering, notifications, sound, context display, sleep prevention, MCP status display, and tool-call expansion.
- Settings or configuration implied: Global UI/agent preferences, notification permission, sound preference, power-management behavior, MCP visibility.
- Ensemble parity requirement: Provide compact global settings with toggles, selects, sync actions, and local project shortcuts.
- Pi-specific adaptation: Replace Claude/Codex sync with Pi resource/config sync or inspection around `~/.pi/agent`, project `.pi`, skills, prompts, and MCP-equivalent resources.
- Risks or implementation notes: Some Conductor behaviors are provider-specific; Ensemble should expose only Pi-supported controls and keep unsupported parity items visible as future work.

### `.context/conductor-screens/02-root-settings/CleanShot 2026-06-04 at 17.55.25@2x.png`

- Flow: `02-root-settings`
- Screen name: App Settings - Models
- User goal: Choose default models and runtime behavior for new agent sessions and reviews.
- Entry point: Settings sidebar, Models tab.
- Primary actions: Select default chat model, review model, reasoning/thinking level, personality/style, plan-mode default, fast-mode default, and browser-control integration.
- Secondary actions: Switch settings sections or return to app.
- Visible UI regions: settings sidebar, centered model preference form, segmented rows with selects and toggles.
- Empty/loading/error states: No loading or error state visible.
- Data shown: Current model names, thinking levels, personality/default style, plan and fast mode toggles.
- Settings or configuration implied: Separate model defaults for normal chat and code review; per-session behavior defaults.
- Ensemble parity requirement: Support default model/reasoning/personality-like controls for new chats and review-specific workflows.
- Pi-specific adaptation: Map to Pi model identifiers, thinking levels, Pi steering/follow-up behavior, and any Pi-supported review model separation.
- Risks or implementation notes: Exact Pi model capabilities and whether review can use a separate model need SDK discovery.

### `.context/conductor-screens/02-root-settings/CleanShot 2026-06-04 at 17.55.35@2x.png`

- Flow: `02-root-settings`
- Screen name: App Settings - Providers
- User goal: Inspect and manage agent-provider authentication.
- Entry point: Settings sidebar, Providers tab.
- Primary actions: Switch provider tab, refresh auth status, choose CLI or API-key auth method, open provider settings in an editor, run provider login command.
- Secondary actions: View plan/account status and provider metadata.
- Visible UI regions: settings sidebar, provider tabs, connected status badge, metadata table, auth-method cards, settings-file row.
- Empty/loading/error states: Connected state visible; no failed auth state captured.
- Data shown: Provider, plan, organization, and account metadata are visible but treated as sensitive and not transcribed.
- Settings or configuration implied: Provider auth mode, provider settings path, login command, refresh action.
- Ensemble parity requirement: Provide a provider readiness screen that explains current auth state and remediation.
- Pi-specific adaptation: Replace multi-provider Claude/Codex tabs with Pi CLI/RPC auth/model/provider readiness and Pi agent directory/resource discovery.
- Risks or implementation notes: Ensemble should not expose tokens or account identifiers unnecessarily; secret values should be hidden and stored outside plain JSON.

### `.context/conductor-screens/02-root-settings/CleanShot 2026-06-04 at 17.55.51@2x.png`

- Flow: `02-root-settings`
- Screen name: App Settings - Environment Variables
- User goal: Manage environment variables passed to agents and runtime commands.
- Entry point: Settings sidebar, Environment tab.
- Primary actions: Add environment variable, add a documented variable from the catalog, expand documented/hidden variable lists.
- Secondary actions: Inspect whether a variable is set without revealing its value.
- Visible UI regions: settings sidebar, add-variable button, scrollable catalog list, per-row secret icon/status/action.
- Empty/loading/error states: Most catalog entries show an unset state; no error visible.
- Data shown: Variable names and descriptions for proxy, provider, cloud, OpenAI, and gateway-related configuration. No values are visible.
- Settings or configuration implied: App-level environment store, secret masking, provider-specific documented variable catalog.
- Ensemble parity requirement: Support global environment variables, documented variable hints, hidden values, unset/set status, and per-variable edit/add actions.
- Pi-specific adaptation: Replace Claude/Codex-specific catalog items with Pi-relevant variables and still allow generic variables for scripts, tools, and provider SDKs.
- Risks or implementation notes: Secret storage should not use repository config or `~/.config/ensemble/config.json`; use macOS Keychain with SQLite metadata.

### `.context/conductor-screens/02-root-settings/CleanShot 2026-06-04 at 17.56.01@2x.png`

- Flow: `02-root-settings`
- Screen name: App Settings - Appearance
- User goal: Tune visual theme, code rendering, markdown rendering, and terminal typography.
- Entry point: Settings sidebar, Appearance tab.
- Primary actions: Select theme, accessible-color mode, code theme, monospace font, markdown style, terminal font, and terminal font size; toggle sidebar diff colors and ligatures.
- Secondary actions: Preview code, markdown, and terminal rendering.
- Visible UI regions: settings sidebar, scrollable appearance form, live preview blocks for code, markdown, and terminal output.
- Empty/loading/error states: No loading or error state visible.
- Data shown: Current theme choices, preview samples, font names, font-size slider.
- Settings or configuration implied: App appearance, accessibility colors, diff color policy, code/terminal font preferences.
- Ensemble parity requirement: Provide appearance settings with immediate previews for code, markdown, and terminal surfaces.
- Pi-specific adaptation: Keep independent Ensemble visual identity while matching functional customization; previews should use Ensemble sample text and Pi terminal examples.
- Risks or implementation notes: Avoid inheriting Conductor color palette or typography exactly; define Ensemble-specific design tokens.

### `.context/conductor-screens/02-root-settings/CleanShot 2026-06-04 at 17.56.11@2x.png`

- Flow: `02-root-settings`
- Screen name: App Settings - Git
- User goal: Configure branch naming and post-merge/archive behavior.
- Entry point: Settings sidebar, Git tab.
- Primary actions: Choose branch name prefix mode, toggle automatic workspace rename, toggle local branch deletion on archive, toggle archive-on-merge, toggle automerge affordance.
- Secondary actions: Follow external repository-setting guidance for remote branch deletion/automerge.
- Visible UI regions: settings sidebar, git preference form with radio buttons and toggles.
- Empty/loading/error states: No loading or error state visible.
- Data shown: Branch prefix options, current toggle states, detected GitHub username represented generically.
- Settings or configuration implied: GitHub identity awareness, workspace naming policy, archive cleanup policy, merge workflow policy.
- Ensemble parity requirement: Provide global Git workflow preferences and apply them during workspace creation, archive, PR, and merge actions.
- Pi-specific adaptation: None for Pi runtime; preserve git behavior while using Ensemble labels and environment variables.
- Risks or implementation notes: Destructive archive/delete behavior needs confirmation and must not remove user changes unexpectedly.

### `.context/conductor-screens/02-root-settings/CleanShot 2026-06-04 at 17.56.19@2x.png`

- Flow: `02-root-settings`
- Screen name: App Settings - Account and Integrations
- User goal: Inspect account, integration, privacy, token, and permission status.
- Entry point: Settings sidebar, Account tab.
- Primary actions: Manage Linear integration, verify GitHub CLI readiness, paste/update GitHub token, toggle enterprise data privacy, toggle tool approval requirement, sign out.
- Secondary actions: Reveal/hide a token field and inspect integration status indicators.
- Visible UI regions: account identity card, integration status rows, masked token field, privacy/permission toggles, sign-out action.
- Empty/loading/error states: Connected/ready states visible; no disconnected state captured.
- Data shown: Personal account details and token-shaped values are visible but intentionally not transcribed.
- Settings or configuration implied: Account identity, Linear linkage, GitHub CLI auth, optional GitHub token, enterprise privacy, tool approval policy.
- Ensemble parity requirement: Provide a consolidated account/integrations/privacy surface.
- Pi-specific adaptation: Ensemble account/sign-in is deferred for v1; focus this surface on `gh` CLI status, Linear OAuth status, Pi permission mode, and enterprise privacy adapted to Pi.
- Risks or implementation notes: V1 GitHub uses authenticated `gh`; any direct GitHub token field is post-v1/direct-API scope and must use macOS Keychain.

### `.context/conductor-screens/02-root-settings/CleanShot 2026-06-04 at 17.56.30@2x.png`

- Flow: `02-root-settings`
- Screen name: App Settings - Experimental
- User goal: Enable under-development or power-user features.
- Entry point: Settings sidebar, Experimental tab.
- Primary actions: Toggle big terminal mode, many-tab mode, dashboard/sidebar visibility, voice dictation, sidebar resource usage, Graphite stack support, and React profiler button.
- Secondary actions: Read caveat/warning text for unstable features.
- Visible UI regions: settings sidebar, experimental feature list with toggles and descriptions.
- Empty/loading/error states: No loading or error state visible.
- Data shown: Experimental feature names and warnings.
- Settings or configuration implied: Feature flags, developer diagnostics, optional integrations, UI density/visibility settings.
- Ensemble parity requirement: Maintain a feature-flag surface for non-core parity features and diagnostics.
- Pi-specific adaptation: Voice and terminal features are runtime-agnostic; Graphite stack support depends on git workflow integration, not Pi. React profiler applies to Electron/React implementation.
- Risks or implementation notes: Voice and Graphite are deferred by ADR 0020; production React profiler is deferred by ADR 0021; the chat-tab limit is resolved by ADR 0022.

### `.context/conductor-screens/02-root-settings/CleanShot 2026-06-04 at 17.56.38@2x.png`

- Flow: `02-root-settings`
- Screen name: App Settings - Advanced
- User goal: Configure high-impact filesystem and executable-path settings.
- Entry point: Settings sidebar, Advanced tab.
- Primary actions: Choose root directory, browse filesystem, override agent executable paths, choose SSH private key, toggle upstream setup on plain git push.
- Secondary actions: Switch back to app or other settings sections.
- Visible UI regions: settings sidebar, path inputs, browse buttons, system-executable shortcut buttons, destructive-warning text.
- Empty/loading/error states: No loading or error state visible.
- Data shown: Local root path and executable path examples are visible but not transcribed.
- Settings or configuration implied: Managed root directory, external executable overrides, SSH key path for cloud/remote access, git upstream behavior.
- Ensemble parity requirement: Provide advanced path/runtime controls and clear warnings around root changes.
- Pi-specific adaptation: Replace Claude/Codex executable paths with Pi executable diagnostics and optional executable override for wrappers such as oh-my-pi.
- Risks or implementation notes: ADR 0017 resolves root changes: switch root and reindex/adopt by default; migration and deletion are explicit separate actions.

### `.context/conductor-screens/02-root-settings/CleanShot 2026-06-04 at 17.56.50@2x.png`

- Flow: `02-root-settings`
- Screen name: Repository Settings - Paths, Branch, Preview, Files, Scripts
- User goal: Configure one local repository's workspace behavior.
- Entry point: Settings sidebar local-project list.
- Primary actions: Inspect root/workspace paths, choose branch source, choose remote origin, configure preview URL, configure files-to-copy patterns, edit setup/run/archive scripts.
- Secondary actions: Open path dropdowns, browse/inspect warnings, open documentation links, expand advanced script options.
- Visible UI regions: local-project settings page, path sections, dropdowns, text inputs/textareas, inline warnings.
- Empty/loading/error states: Files-to-copy section shows no matching ignored files for the current patterns.
- Data shown: Private repository name, paths, and script commands are visible but described generically.
- Settings or configuration implied: Repository root path, workspace path, default branch, remote origin, preview URL template, files-to-copy patterns, scripts.
- Ensemble parity requirement: Provide repository-scoped settings that override shared config and expose config/source diagnostics.
- Pi-specific adaptation: Support both `ensemble.json` and `conductor.json`, expose `ENSEMBLE_*` and compatible `CONDUCTOR_*` variables in preview URLs and scripts.
- Risks or implementation notes: Do not move/delete repository or workspace directories from settings; archive or remove through explicit lifecycle actions.

### `.context/conductor-screens/02-root-settings/CleanShot 2026-06-04 at 17.56.59@2x.png`

- Flow: `02-root-settings`
- Screen name: Repository Settings - Spotlight, Agent Preferences, Removal
- User goal: Configure repository-level automation instructions and destructive repository removal.
- Entry point: Same repository settings page, scrolled lower.
- Primary actions: Edit setup/run/archive scripts, create shared config file, toggle spotlight testing, expand per-action agent preference sections, remove repository.
- Secondary actions: Expand advanced script fields and read share-with-team guidance.
- Visible UI regions: scripts section, spotlight testing toggle, preference accordion rows, remove repository button.
- Empty/loading/error states: No loading or error state visible.
- Data shown: Private script commands are visible but described generically.
- Settings or configuration implied: Shared config generation, spotlight testing, review/PR/fix/conflict/branch-rename/general instruction overrides.
- Ensemble parity requirement: Support repository action-specific instruction templates and spotlight testing behavior.
- Pi-specific adaptation: Store Pi-specific instruction templates in `ensemble.json` or personal settings, while preserving `conductor.json` script compatibility.
- Risks or implementation notes: Repository removal is destructive/high-impact and must distinguish removing from app records versus deleting files.

## 03-add-repo

### `.context/conductor-screens/03-add-repo/CleanShot 2026-06-04 at 17.57.15@2x.png`

- Flow: `03-add-repo`
- Screen name: Project Add Menu in Active Workspace
- User goal: Add/open a project without leaving the current workspace.
- Entry point: Project sidebar add button.
- Primary actions: Open local project, open GitHub project, start from quick-start templates, choose a recent local path.
- Secondary actions: Continue viewing current workspace, inspect dashboard/history, use workspace right-side panels.
- Visible UI regions: app shell, project/workspace sidebar, add-project popover, center agent timeline, right file/checks panel, bottom run/terminal dock.
- Empty/loading/error states: No loading or error state visible.
- Data shown: Private project names, paths, chat text, and files are visible but not transcribed.
- Settings or configuration implied: Recents list, project storage, GitHub project integration, quick-start templates.
- Ensemble parity requirement: Provide project-add menu with local open, GitHub clone/open, quick-start, and recents.
- Current Ensemble shell alignment: The visible project-add menu already establishes Open project, Open GitHub project, Quick start, and recents as the shell contract. Linear issue entry remains v1 scope through the Linear issue workflow, not a required item in this menu.
- Pi-specific adaptation: New projects should initialize Ensemble/Pi repository settings and preserve Pi project context files.
- Risks or implementation notes: Recents may expose private paths; avoid unnecessary telemetry and store locally.

### `.context/conductor-screens/03-add-repo/CleanShot 2026-06-04 at 17.57.35@2x.png`

- Flow: `03-add-repo`
- Screen name: Clone GitHub Repository - Form
- User goal: Clone a repository into the managed root.
- Entry point: Open GitHub project action.
- Primary actions: Enter repository URL, select a recent GitHub repo, choose clone location, browse filesystem, start clone.
- Secondary actions: Dismiss modal by backing out/canceling via normal dialog behavior.
- Visible UI regions: blurred app background, centered modal, URL field, recent repo list, location field, browse button, primary clone button.
- Empty/loading/error states: Clone button appears inactive until required input is valid.
- Data shown: Private recent repository names and local path are visible but not transcribed.
- Settings or configuration implied: GitHub recents, default managed repos location, `gh`/git clone readiness.
- Ensemble parity requirement: Provide a modal clone flow with recents, URL entry, managed-location default, and validation.
- Pi-specific adaptation: No runtime adaptation; after clone, initialize repository settings and Pi workspace context.
- Risks or implementation notes: Validate URLs and handle private repo auth failures from `gh`/git with actionable remediation.

### `.context/conductor-screens/03-add-repo/CleanShot 2026-06-04 at 17.58.11@2x.png`

- Flow: `03-add-repo`
- Screen name: Clone GitHub Repository - Progress
- User goal: See clone progress and know the app is working.
- Entry point: Submit clone form.
- Primary actions: Wait for clone to finish.
- Secondary actions: Inspect command output/log in modal.
- Visible UI regions: macOS menu bar, blurred app background, centered modal, recent repo list, location field, progress log, disabled in-progress button.
- Empty/loading/error states: Loading/progress state visible with git output lines.
- Data shown: Private repository URL/path and clone output are visible but generalized.
- Settings or configuration implied: Persistent clone location, command logging, project creation lifecycle.
- Ensemble parity requirement: Show clone progress inline with command output and disabled duplicate-submit control.
- Pi-specific adaptation: No Pi runtime adaptation until the first workspace/session is created.
- Risks or implementation notes: Error state was not captured; implement auth/network/path-exists failures with remediation.

### `.context/conductor-screens/03-add-repo/CleanShot 2026-06-04 at 17.58.30@2x.png`

- Flow: `03-add-repo`
- Screen name: Post-Clone Workspace Landing and Repository Menu
- User goal: Start working in the newly cloned repository/workspace and manage repository actions.
- Entry point: Clone completion opens a new workspace.
- Primary actions: Prompt the agent, run workspace command, inspect files, create another workspace, create from issue/PR, open repository settings.
- Secondary actions: Change repository icon, hide repository, remove repository.
- Visible UI regions: project/workspace sidebar, repository context menu, center new-workspace landing card, composer, right file tree, bottom run dock.
- Empty/loading/error states: New workspace empty chat state with landing card and optional setup-script prompt.
- Data shown: Private repository/workspace names and file tree are visible but not transcribed.
- Settings or configuration implied: Repository context menu actions, workspace placeholder naming, default branch and copied-file count.
- Ensemble parity requirement: After clone, land in an isolated workspace with branch/copy summary and repository management menu.
- Pi-specific adaptation: Start a Pi session from the new workspace with Pi model controls in the composer.
- Risks or implementation notes: Distinguish repository-level actions from workspace-level actions in state and storage.

## 04-create-workspace

### `.context/conductor-screens/04-create-workspace/CleanShot 2026-06-04 at 17.58.59@2x.png`

- Flow: `04-create-workspace`
- Screen name: New Workspace Success Landing
- User goal: Begin work in a freshly isolated workspace.
- Entry point: New workspace creation from an existing repository.
- Primary actions: Enter an agent prompt, run workspace command, inspect copied files, add setup script.
- Secondary actions: Switch workspaces, create PR from header, use all-files/changes/checks tabs.
- Visible UI regions: project/workspace sidebar, top breadcrumb, center landing card, composer with model controls, right file panel, bottom setup/run/terminal dock.
- Empty/loading/error states: Empty new-chat state; no setup output yet.
- Data shown: Private project/workspace names are visible but generalized; summary shows branch source and copied-file count.
- Settings or configuration implied: Auto-generated placeholder workspace name, branch from configured default branch, files-to-copy behavior, optional setup script.
- Ensemble parity requirement: Create a worktree, name it, branch from configured default, copy eligible files, and show a concise success summary.
- Pi-specific adaptation: Composer should use Pi model/thinking/session controls and create a Pi session on first prompt.
- Risks or implementation notes: The actual workspace-creation form is not captured; only the success state is known.

## 05-workspace-agent

### `.context/conductor-screens/05-workspace-agent/CleanShot 2026-06-04 at 17.59.09@2x.png`

- Flow: `05-workspace-agent`
- Screen name: Agent Timeline with Runtime Error and Checks Panel
- User goal: Review or continue an agent session while monitoring workspace readiness.
- Entry point: Open an existing workspace chat tab.
- Primary actions: Read agent timeline, retry failed provider call, retry in a new chat, send a new prompt, create PR, commit/push, add todo, run setup.
- Secondary actions: Switch file/changes/checks tabs, switch setup/run/terminal tabs, change model/reasoning controls, add attachments or voice input if enabled.
- Visible UI regions: project/workspace sidebar, tabbed chat header, scrollable agent timeline, inline error cards, bottom composer, checks side panel, bottom terminal dock.
- Empty/loading/error states: Provider/session-limit error visible; setup tab empty with run setup action; no todos state.
- Data shown: Private chat content and file details are visible but not transcribed; visible status includes no PR, uncommitted changes, and no todos.
- Settings or configuration implied: Retry behavior, model and reasoning controls, setup/run lifecycle, PR/check/todo state.
- Ensemble parity requirement: Render structured agent events, tool calls, runtime errors, retry actions, composer controls, and side-panel status without losing workspace context.
- Current Ensemble shell alignment: The tab strip, timeline location, setup warning, and composer placement are locked. Chat content and prompt behavior remain deferred until Pi integration.
- Pi-specific adaptation: Replace provider-limit errors with Pi CLI/RPC runtime error cards, Pi session retry/fork behavior, and Pi model/thinking controls.
- Risks or implementation notes: Retrying in a new chat must preserve file state and make session branching understandable.

## 06-terminal-run

### `.context/conductor-screens/06-terminal-run/CleanShot 2026-06-04 at 17.59.20@2x.png`

- Flow: `06-terminal-run`
- Screen name: Setup Output in Terminal Dock
- User goal: Verify setup script output while staying in the workspace.
- Entry point: Run setup from the setup tab.
- Primary actions: Read setup output, rerun setup, switch to run or terminal tabs, run workspace command.
- Secondary actions: Continue chat or checks review while output remains visible.
- Visible UI regions: same workspace shell as agent screen, bottom-right terminal dock with setup output and rerun button.
- Empty/loading/error states: Completed setup output visible; no error state captured.
- Data shown: Private command output is visible but generalized.
- Settings or configuration implied: Setup script command, captured process logs, terminal tab persistence.
- Ensemble parity requirement: Provide docked setup/run/terminal panes with output capture and rerun controls.
- Current Ensemble shell alignment: The lower-right Setup / Run / Terminal dock, collapse affordance, and script-state action placement are already represented. Future terminal tickets should replace placeholder logs with live process/PTY data in place.
- Pi-specific adaptation: Run scripts are independent of Pi but should include `ENSEMBLE_*` and compatibility environment variables.
- Risks or implementation notes: Large output, interactive prompts, and process cancellation need terminal/process supervision.

## 07-diff-review

### `.context/conductor-screens/07-diff-review/CleanShot 2026-06-04 at 17.59.33@2x.png`

- Flow: `07-diff-review`
- Screen name: Changes Tree in Review Panel
- User goal: Inspect changed files and line-count summaries during review.
- Entry point: Select Changes tab in the right panel.
- Primary actions: Expand/collapse folders, select changed files, toggle review mode, search changes, change list/tree display.
- Secondary actions: Keep setup output visible, continue agent chat, switch to checks.
- Visible UI regions: right changes tree grouped by folders, per-file status and line counts, review/search/list controls, bottom terminal dock.
- Empty/loading/error states: No empty or error state; populated changes tree visible.
- Data shown: Private file names and change counts are visible but generalized.
- Settings or configuration implied: File status calculation, diff color policy, review-mode preference.
- Ensemble parity requirement: Provide a structured changes tree with file statuses, additions/deletions, grouping, search, and review controls.
- Current Ensemble shell alignment: All files / Changes / Checks tab placement, changes list/tree toggle, folder grouping, and command-style file search are represented in the current shell. Future work should wire git/diff data into these surfaces.
- Pi-specific adaptation: Diff/review data is runtime-agnostic; selected diff/comment context should be sendable to Pi.
- Risks or implementation notes: Full diff body and line-comment UI are not captured in this screenshot set.

## 08-checks-pr

### `.context/conductor-screens/08-checks-pr/CleanShot 2026-06-04 at 18.00.40@2x.png`

- Flow: `08-checks-pr`
- Screen name: Create PR Agent Task In Progress
- User goal: Have the agent commit/push/create a PR while checks remain visible.
- Entry point: Create PR action from workspace header or checks panel.
- Primary actions: Watch agent work, stop/abort if needed, inspect checks status, inspect setup output.
- Secondary actions: Switch side-panel tabs or terminal tabs.
- Visible UI regions: active workspace shell, working status in top bar, agent timeline with thinking/tool events, checks side panel, setup output dock.
- Empty/loading/error states: Agent working/loading state visible; checks still show no PR/uncommitted state at start.
- Data shown: Private PR instruction content and chat details are visible but not transcribed.
- Settings or configuration implied: Create-PR instruction template, git staging/commit/push behavior, `gh` integration.
- Ensemble parity requirement: Represent PR creation as an agent-assisted workflow with status in the main timeline and side-panel state updates.
- Pi-specific adaptation: Use Pi to generate or execute PR workflow steps, with `gh` CLI as source of GitHub state.
- Risks or implementation notes: Must guard against committing unrelated files and should stage only requested workspace changes.

### `.context/conductor-screens/08-checks-pr/CleanShot 2026-06-04 at 18.01.51@2x.png`

- Flow: `08-checks-pr`
- Screen name: PR Checks Pending or Failing
- User goal: Evaluate whether a PR can be merged while checks are incomplete or failing.
- Entry point: Checks tab after PR creation.
- Primary actions: Open PR externally, inspect pending/failing/passing checks, inspect comments, add all comments to chat, add todo, merge with warnings if allowed.
- Secondary actions: Open external check/deployment links and switch side-panel tabs.
- Visible UI regions: top status banner with PR number and pending state, PR title/description area, git status row, checks list, comments section, todos section, bottom terminal tabs.
- Empty/loading/error states: Pending check state and no-todos state visible.
- Data shown: PR title/description, check provider names, comment identifiers, and private content are visible but generalized.
- Settings or configuration implied: PR metadata cache, CI/check status polling, comment ingestion, merge policy, todo storage.
- Ensemble parity requirement: Show PR metadata, check states, comments, todos, external links, and merge blockers in one checks panel.
- Current Ensemble shell alignment: The right PR header and Checks panel already represent the no-PR, checking, blocked, and ready state shape. Future work should wire `gh`/GitHub metadata and merge confirmation into the existing surfaces.
- Pi-specific adaptation: Add comments/review context to Pi chat rather than Claude/Codex chat.
- Risks or implementation notes: `gh` may not expose all comment/review-thread detail needed; direct GitHub API may be required later.

### `.context/conductor-screens/08-checks-pr/CleanShot 2026-06-04 at 18.02.16@2x.png`

- Flow: `08-checks-pr`
- Screen name: PR Ready to Merge
- User goal: Confirm all required checks/deployments are green and merge the PR.
- Entry point: Checks tab after checks pass.
- Primary actions: Open PR, open preview/deployment, merge PR, inspect passed checks and comments, add comments to chat, add todo.
- Secondary actions: Open external deployment/check links.
- Visible UI regions: green readiness banner, PR and preview buttons, merge button, PR summary, git status, deployments, checks, comments, todos.
- Empty/loading/error states: Ready-to-merge state and no-todos state visible.
- Data shown: PR metadata and deployment/comment identifiers are visible but generalized.
- Settings or configuration implied: Deployment status tracking, ready-to-merge calculation, merge action authorization.
- Ensemble parity requirement: Provide a distinct ready state with prominent merge action once PR, checks, and deployments satisfy policy.
- Pi-specific adaptation: Runtime-agnostic; Pi can be used to resolve comments or failures before merge.
- Risks or implementation notes: Merge is externally visible and should require confirmation or respect repository merge policy.
