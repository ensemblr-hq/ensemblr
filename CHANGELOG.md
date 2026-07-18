# Changelog

All notable changes to Ensemblr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Dashboard Workspace Board** (`c73ced6`, #125; `eee3e6f`, #128; `2f4aeb7`, #130): The Dashboard route now shows a draggable workspace board with Backlog, In progress, In review, Done, and Canceled columns, persisted local board status/order, workspace card action menus, and fixed drop targets. The board stays reachable when setup is blocked, the sidebar is collapsed, or no workspaces remain.

- **Bundled Terminal Font** (`d2220aa`, #122): JetBrains Mono Nerd Font assets are bundled under `src/renderer/styles/fonts/` and wired into terminal/code typography so first launch has stable monospace rendering before user font customization.

- **Clickable File & Directory References in Assistant Messages** (in progress, branch `psoldunov/check-master-sync`): Inline-code in assistant markdown that resolves to a workspace path now renders as an attachment chip instead of a plain `code` span. File chips open a file-preview tab; directory chips switch to the All files tab and expand/reveal that folder in the tree:
  - Path classification is isolated in `src/renderer/lib/pi/inline-attachment.ts` — an extension/filename allowlist gated by a safe-path pattern, excluding library display names (`node.js`, `next.js`, …) so prose does not render dead chips
  - `MessageInlineCode` (in `message.tsx`) wires the classifier into Streamdown's inline-code renderer; chips use per-extension icons via `@iconify/react` (`getWorkspaceFileIconName`) instead of generic file/folder glyphs
  - File-vs-directory is resolved through a new `WorkspacePathKindResolver` context; directory reveals flow through the transient `workspaceDirectoryRevealRequestAtom` and a new `expandDirectories` writer on `useFileTreeExpansion`; `toWorkspaceLookupPath` canonicalizes paths so chip lookups and tree keys compare equal
  - New tests: `tests/renderer/message-attachment-chips.test.tsx`, `tests/renderer/chat-directory-attachments.test.tsx`, `tests/renderer/all-files-directory-reveal.test.tsx`

- **Pasted Image Attachments** (`1cbf07c`, #99): The chat composer now accepts pasted images and resolves workspace file payloads so they render as attachment chips and `@`-mention payloads:
  - New workspace-files payload resolution reads file bytes/metadata over a dedicated IPC channel (`src/main/workspace-files/list-workspace-files.ts`, `src/shared/ipc/contracts/workspace-files.ts`)
  - Composer state tracks attachments (`use-composer-state.ts`), with pure attachment/mention helpers in `src/renderer/lib/workbench/composer-attachments.ts` and `mention-payload.ts` plus per-extension `file-icons.ts`
  - New tests: `tests/renderer/composer-attachments.test.ts`, `tests/renderer/mention-payload.test.ts`, and expanded `tests/main/list-workspace-files.test.ts`

- **Social Avatar Generator** (`e502d2c`, #92): `npm run avatar:generate` (`scripts/generate-avatar.mjs`) renders a borderless 512×512 avatar (gitignored `assets/avatar.png`). The dot-matrix "E" glyph shrank 20% (CELL 88 → 70.4) with a proportional chromatic-split offset, and shared icon geometry/colors/rasterization were extracted into `scripts/icon-art.mjs` and `scripts/icon-colors.mjs` so the app icon and avatar share one `renderMaster` source.

- **Appearance Settings Wired to `config.json`**: The Settings → Appearance page is now fully functional and persisted in `~/.config/ensemblr/config.json` under `app.appearance` (source of truth; see ADR 0029). All eight prefs apply live:
  - Theme, accessible-color variants (Okabe-Ito palettes for protanopia/deuteranopia/tritanopia), and code ligatures toggle document-root classes; the mono font drives the `--ensemblr-font-mono` CSS variable so every `font-mono` surface re-fonts instantly (`src/renderer/state/preferences/use-appearance-effect.ts`)
  - Code theme now flows through the Shiki (`code-block.tsx`) and Streamdown (`message.tsx`) renderers — previously hardcoded to GitHub themes; the picked theme loads on demand and feeds both light/dark slots
  - Terminal font and size live-apply to open xterm surfaces without re-mounting the PTY (`xterm-terminal.tsx` + adapter `setFont`); the shared fallback stack is exported once as `DEFAULT_FONT_FAMILY`
  - Markdown style adds a `prose` preset via `@tailwindcss/typography`; sidebar diff stats render with active-row-aware tokens (`diff-stats.tsx`)
  - One-time migration of the legacy `ensemblr_pref_*` `localStorage` values into `config.json` on first launch (legacy `one-dark` → `one-dark-pro`), removing legacy keys only after a successful write (`use-appearance-migration.ts`)
  - New tests: `tests/renderer/use-appearance-effect.test.tsx`, `tests/renderer/use-appearance-migration.test.tsx`, `tests/renderer/workspace-diff-stats.test.tsx`

- **Run Script Hotkey** (`run.start`): ⌘/Ctrl+R now toggles the active workspace's run script from anywhere in the workbench — starts it when stopped, stops it while running, and no-ops when no run script is configured:
  - The View → Reload menu item is now accelerator-less so ⌘R reaches the renderer; Force Reload (⌘⇧R) remains the keyboard path to a full reload (`src/main/menu/application-menu.ts`)
  - Registered as the `run.start` shortcut in `src/shared/keymap/shortcuts.ts`; the toggle logic lives in the `useRunScriptHotkey` hook and is captured even while a text field or terminal has focus (so ⌘R never falls through to a native reload)
  - The Run dock empty state surfaces the ⌘R hint on its "Start Run" action
  - New test: `tests/renderer/use-run-script-hotkey.test.tsx`

- **Ask Agent to Create Setup Script**: The Setup dock tab's "no setup script configured" empty state now offers two actions instead of one:
  - "Ask agent" opens a fresh chat and seeds — never auto-submits — a prompt directing the agent to inspect the project and author the repository's `.ensemblr/settings.toml` `[scripts]` block (`src/renderer/hooks/workbench-shell/composer/use-ask-agent-setup-script.ts`)
  - "Add manually" opens the repository's Scripts settings as before
  - Dock empty states split into dedicated components (`setup-missing-empty-state`, `setup-not-run-empty-state`, `run-stopped-empty-state`)
  - New test: `tests/renderer/use-ask-agent-setup-script.test.tsx`

- **Git Settings UI** (`d61d93e`): New Settings → Git page with user-scope git defaults stored in `~/.config/ensemblr/config.json` under `app.git`. Settings include:
  - `branchPrefixSource`: `'github-username'` | `'custom'` | `'none'` - Source for branch name prefix
  - `branchPrefixCustom`: Custom prefix string when source is `'custom'`
  - `renameWorkspaceOnBranch`: Auto-rename workspace from LLM-generated branch name (enabled by default)
  - `deleteLocalBranchOnArchive`: Delete local branch when workspace is archived (disabled by default)
  - `archiveAfterMerge`: Auto-archive workspace after PR merge (disabled by default)
  - `setUpstreamOnPush`: Set upstream on first push (enabled by default)

- **Auto Branch Naming** (`d61d93e`): Automatic branch name generation from first Pi message in placeholder workspaces. Uses Pi CLI RPC mode with `--mode rpc` to generate a descriptive branch name, then:
  - Sanitizes to kebab-case
  - Truncates to 40 characters (word boundary)
  - Prefixes with user-specified or GitHub username prefix
  - Renames both workspace and git branch atomically
  - 20-second timeout for LLM generation

- **File Tree View** (`d2158d5`): All files panel now renders as a collapsible folder tree with:
  - Virtualized rendering via `@tanstack/react-virtual` (28px row height, 12-row overscan)
  - Collapsible directories (start collapsed by default)
  - Live filesystem watch with 250ms debounce
  - Polling fallback (30s interval) for platforms without recursive watch support
  - Ignored directory exclusion (`.git`, `node_modules`, `.DS_Store`)
  - Persistent expansion state with stale path pruning

- **Lazy Live Tree for Ignored Directories** (`6ef81a7`): Git-ignored directories are collapsed in the initial tree view and lazy-loaded on demand:
  - Cap of 1000 entries per ignored directory
  - Single IPC call per directory expansion via `readWorkspaceDirectory`
  - Point-in-time snapshot (not live-refreshed after initial load)
  - Deduplication against base file list
  - Used for `.context/` (generator scaffold output) and `.vite/` (Vite dev server cache)

- **Gitignore Updates** (`6ef81a7`): Added the following to `.gitignore`:
  - `.context/` - Generator output directory for official scaffolding (per AGENTS.md policy)
  - `.vite/` - Vite dev server cache and build artifacts

- **Wordmark Animation** (`957a71d`): Glitch burst effect now fires immediately on `WelcomeWordmark` component mount (line 155 in `welcome-wordmark.tsx`), eliminating the static "dead" period on welcome screen load. The periodic glitch pattern (9-17s interval) continues thereafter unchanged.

- **Context-Aware Close Action** (`695de4f`): ⌘/Ctrl+W close action is now context-aware:
  - In workspace view: Closes the active tab with smart behavior (close if multiple tabs, reset sole chat tab to fresh state, no-op for empty sole tab)
  - In Settings: Returns to the screen Settings was opened from (tracked via `settingsReturnToAtom`)
  - On other screens: Falls back to closing the BrowserWindow
  - Centralized via `CloseActionProvider` with a stack-based registration system
  - New IPC channels: `closeActiveTab` and `closeWindow`
  - New test: `tests/renderer/session-tab-close.test.ts`

- **Clone GitHub Repo Search** (`70f86b2`): The clone-GitHub dialog's URL field is now a search combobox over the full accessible repo set:
  - Type to search every accessible repository, not just the recent list; arrow/Enter to confirm a match, or paste a URL directly
  - Full repo set is fetched lazily in the background, paginated and deduped via a new `recent | full` scope on the `gh` repository-list IPC (`src/main/repository/list-github-repositories.ts`, `src/main/ipc/request-schemas.ts`)
  - Pure, tested search/rank helpers in `src/renderer/lib/welcome/github-repo-search.ts`; search + keymap logic extracted into the `useCloneRepoSearch` hook (`src/renderer/hooks/welcome/use-clone-repo-search.ts`)
  - "Searching all repositories…" hint stays visible on empty results; the clone action is gated on URL-like input so a bare search term cannot start a doomed clone
  - New tests: `tests/renderer/github-repo-search.test.ts`, `tests/renderer/clone-github-recent-repos.test.tsx`, `tests/renderer/dom/clone-github-dialog.test.tsx`, `tests/main/list-github-repositories.test.ts`

### Changed

- **Workspace Process Environment** (`4695229`, #120; `b9bdd09`, #121): Setup/run scripts and terminal sessions now inherit the user's shell-derived environment and workspace toolchain `PATH`, then merge workspace environment overlays and `ENSEMBLR_*` variables while keeping macOS launch-context variables stripped.

- **Setup Scripts Resolved from Workspace Settings** (`1de8f4f`, #97): Setup and Run scripts now resolve from the workspace's own resolved settings rather than repository-only config, so per-workspace `.ensemblr/settings.toml` `[scripts]` overrides take effect (`src/main/scripts/script-lifecycle-service.ts`, `src/renderer/hooks/use-scripts-settings-form.ts`). Live-workspace file watching and query keys were reworked to key off the workspace model.

- **Package Manager → npm**: Migrated JavaScript/TypeScript package management from Bun to npm. `npm install` now manages dependencies against a `package-lock.json` lockfile (Bun and `bun.lock` are retired). Details:
  - Guardrail hooks (`.claude/hooks/enforce-npm.sh`, `.codex/hooks/enforce-npm-package-manager.sh`) now block direct `bun`, `bunx`, `pnpm`, `pnpx`, `yarn`, `yarnpkg`, and matching `corepack` calls
  - Scripts run through npm (`npm run check`, `npm run typecheck`, `npm run dev`, `npm run package`, `npm run make`)
  - Vitest stays the test runner, now invoked via `npx vitest run` (`npm run test` / `npm run test:coverage`); main-process suites remain on `electron --test`
  - Dev tooling scripts ported off Bun runtime APIs (`Bun.spawn` → `node:child_process`), runnable via `npx tsx scripts/<name>.ts`
  - `@types/node` pinned to `^24` to match the pinned Node 24 runtime (`.nvmrc` / `mise.toml` / `engines`); `npm run typecheck` now also type-checks dev `.ts` scripts via `tsconfig.scripts.json`, which caught a latent `TextDecoder.decode` type error the untyped `tsx` runner would have shipped

- **Wordmark Mount Behavior** (`957a71d`): Changed from `scheduleNextBurst()` to `runBurst()` on component mount, ensuring immediate visual feedback.

- **Repository Resolution Precedence** (`d61d93e`): Added `user-default` source to the config resolution chain, feeding user-scope git defaults (`app.git.*`) into repository settings as the 7th precedence level (before built-in defaults).

- **Setup Diagnostics** (`a7c7b56`): Reworked panel with per-check remediation actions. Remediation documentation links now open in the default browser through a new `openExternal` IPC channel with URL validation (http/https schemes only).

- **Documentation** (`dd2baf4`): Corrected overstated rule-suppression rationale in doctor-config documentation.

- **Test Runner → Vitest**: Renderer (`tests/renderer/**`) and shared (`tests/shared/**`) suites migrated off `bun test` onto Vitest, run with `npx vitest run` under npm (see the Package Manager → npm entry above). Details:
  - Config in `vitest.config.mts`; default `environment` is `node` so pure-logic tests keep the real `navigator`/`process`, and DOM component tests opt into happy-dom per file via a `// @vitest-environment happy-dom` docblock
  - Scoped DOM harness `tests/renderer/support/dom.tsx` (`renderWithProviders` + `window.ensemblr` stubs); jest-dom matchers registered in `tests/renderer/support/vitest.setup.ts`
  - Coverage is native Istanbul (`npx vitest run --coverage`, provider `@vitest/coverage-istanbul`) emitting `coverage/coverage-final.json`, read directly by `fallow audit`
  - New aggregate scripts: `test` (`npx vitest run`) and `test:coverage`; mocks use `vi.fn()`/`vi.spyOn()`/`vi.mock()`
  - Removed the global happy-dom registrator (`tests/renderer/support/register-dom.ts`), the lcov→istanbul bridge (`scripts/lcov-to-istanbul.mjs`), and `bunfig.toml`
  - Main-process suites (`tests/main/**`) stay on `electron --test` — they need the Electron runtime

### Fixed

- **Session Tab Interaction Polish** (`4a8801b`, #123; `ae163fe`, #124): Close controls are easier to hit, drag overlays no longer interfere with tab controls, and active session selection stays stable after drag reorder.

- **Workspace Dashboard Edge Cases** (`48e6b2f`, #131; `7da4597`, #132; `ed1461f`, #133): Placeholder workspace names avoid reuse collisions, collapsed sidebar triggers render again, and the Dashboard remains accessible when the last workspace is archived/deleted.

- **Base Branch Synced Before Workspace Creation** (`67cf369`, #98): Remote-backed base branches are fetched and fast-forwarded before a workspace is created, so new workspaces start from the latest `master`/`main` when online. The sync is best-effort, so offline workspace creation still works (`src/main/repository/create-workspace.ts`, `src/main/repository/git-ops.ts`; new `tests/main/create-workspace.test.ts`).

- **Chat Close No Longer Blocked by a Running Session** (`1de8f4f`, #97): Closing a chat tab now stops its running Pi session without blocking the close (`src/main/pi-agent/pi-session-lifecycle.ts`, `src/renderer/state/workspace/close-running-chat-guard.ts`; new `tests/main/pi-session-service.test.ts`).

- **Dependency Security Patches** (`3a373b3`, #93): Forced patched transitive dependencies via npm `overrides` to clear 10 Dependabot alerts — `linkify-it` 3.0.3 → 5.0.2 (ReDoS), `tar` 6.2.1 → 7.5.19 (path traversal), `tmp` 0.0.33 → 0.2.7 (path traversal). `npm audit` now reports 0 vulnerabilities.

- **Stray Second Dock Instance / Dock Flash** (ADR 0031): The packaged app no longer flashes a second Dock icon — or boots a whole second instance — when a spawned child touches macOS Launch Services (a terminal running `open`, a git/`gh` credential helper, an editor launch, a Pi extension child):
  - New `src/main/environment/launch-env.ts` exports a pure `stripLaunchContextEnv` that removes the macOS/Electron launch markers (`__CFBundleIdentifier`, `XPC_SERVICE_NAME`, `XPC_FLAGS`, `LaunchInstanceID`, `ELECTRON_RUN_AS_NODE`, `ELECTRON_NO_ATTACH_CONSOLE`, `ELECTRON_NO_ASAR`) — and nothing else, so the user's login-shell environment (ADR 0003) is preserved
  - Applied at every child-spawn boundary: once at the shared `createLocalCommandService` base env (covering the login-shell probe and the Pi RPC readiness smoke), explicitly at each direct `process.env` spawn (git checkpoints, clone, git probe, keychain `security`, `pmset`, open-in-editor), and again at the final boundary for the terminal PTY, the generic command spawner, and both the real (`buildSpawnEnv`) and smoke Pi spawns
  - `src/main/main.ts` now holds a single-instance lock (packaged only; dev is excluded because dev builds share one `Ensemblr (DEV)` userData across Conductor workspaces). A blocked relaunch folds into the running instance via a `second-instance` handler that focuses the existing window; the lock keys on userData so it also catches direct-exec relaunches that bypass Launch Services
  - New test: `tests/main/launch-env.test.ts`

- **Dock Flash on Workspace Creation — Bundle-Identity Collision** (ADR 0032): After the ADR 0031 env-strip closed the child-spawn relaunch path, a stray Dock tile could still flash on new-workspace creation. `lsregister -dump` showed the cause: several packaged bundles (a release-style build, an `Ensemblr-canary.app`, an `Ensemblr-dev.app`, plus a dangling registration whose bundle was deleted) all registered under the one hardcoded `dev.ensemblr.app`. macOS treats those as interchangeable, so resolving the id can relaunch a *sibling* build, which then hits the running instance's single-instance lock and quits — the flash. The lock makes it brief; only a unique identity prevents it.
  - `forge.config.ts` now scopes `appBundleId` **and** product name to a build channel read from `ENSEMBLR_BUILD_CHANNEL` (default `release`): `release` → `dev.ensemblr.app` / `Ensemblr`, `canary` → `dev.ensemblr.app.canary` / `Ensemblr Canary`, `dev` → `dev.ensemblr.app.dev` / `Ensemblr Dev`. `npm run make`/`package` are unchanged (release); dogfood builds use the new `make:canary` / `make:dev` / `package:dev` scripts so they never claim the release identity
  - `src/main/main.ts` no longer clobbers the packaged product name to `'Ensemblr'`; it applies the `(DEV)` suffix only to the unpackaged dev build, so a packaged `canary`/`dev` build keeps its channel name — and thus its own userData and single-instance lock
  - New `scripts/diagnose-dock-flash.mjs` (`npm run diagnose:dock-flash`) lists every `dev.ensemblr.app*` LaunchServices registration, flags id collisions and dangling entries, and with `--fix` unregisters dangling ones (live sibling builds are left alone)

- **Preload Bundle Deprecation Warning**: `vite.preload.config.mts` now suppresses only the `inlineDynamicImports` Rollup deprecation that `@electron-forge/plugin-vite@7.11.2` forces on the single-file preload bundle (the plugin merges config last and `mergeConfig` cannot delete the key it set), while forwarding every other warning. Remove once the plugin migrates off `inlineDynamicImports`.

---

## Versioning Note

Ensemblr follows a pre-1.0 semantic versioning approach where:

- `MAJOR` version (currently 0) remains 0 until stable v1 release
- `MINOR` version increments with significant feature additions
- `PATCH` version increments with bug fixes and small improvements

---

## Commit References

| Commit | Date | Feature |
| -------- | ------ | --------- |
| `ed1461f` | 2026-07-18 | Keep dashboard accessible when no workspaces remain (#133) |
| `7da4597` | 2026-07-18 | fix: restore collapsed sidebar triggers (#132) |
| `48e6b2f` | 2026-07-18 | fix(workspace): avoid reused placeholder names (#131) |
| `eee3e6f` | 2026-07-18 | Add dashboard workspace card action menus (#128) |
| `c73ced6` | 2026-07-18 | feat(workspace): add draggable dashboard board (#125) |
| `ae163fe` | 2026-07-18 | Fix session tab selection after drag reorder (#124) |
| `4a8801b` | 2026-07-18 | fix(session-tabs): improve tab close controls (#123) |
| `d2220aa` | 2026-07-17 | Show setup status and bundle terminal font (#122) |
| `b9bdd09` | 2026-07-17 | fix(environment): use workspace toolchain PATH (#121) |
| `4695229` | 2026-07-17 | fix(terminal): inherit shell-derived env for setup and run scripts (#120) |
| `1cbf07c` | 2026-07-10 | feat(composer): support pasted image attachments (#99) |
| `67cf369` | 2026-07-10 | fix(repository): sync base before workspace creation (#98) |
| `1de8f4f` | 2026-07-10 | Use workspace settings for setup scripts and unblock chat closes (#97) |
| `3a373b3` | 2026-07-10 | fix(deps): patch tar, tmp, linkify-it via npm overrides (#93) |
| `e502d2c` | 2026-07-10 | feat(icon): shrink wordmark "E" 20% and add social avatar generator (#92) |
| `70f86b2` | 2026-07-08 | feat(welcome): add repo search to the clone GitHub dialog |
| `695de4f` | 2026-06-16 | feat(window): context-aware ⌘/Ctrl+W close action (#69) |
| `6ef81a7` | 2026-06-16 13:47:27 +0300 | feat(workspace): gitignore .context and serve files as lazy live tree |
| `d2158d5` | 2026-06-16 11:14:09 +0300 | feat(review-files): organize all-files screen as file tree with live watch |
| `d61d93e` | 2026-06-16 07:17:24 +0300 | feat(git-settings): user-scope git defaults and auto branch-naming |
| `957a71d` | 2026-06-15 23:23:28 +0300 | feat(wordmark): fire first glitch burst immediately on mount |
| `a7c7b56` | 2026-06-15 23:16:16 +0300 | feat(setup-diagnostics): rework panel with remediation actions |
| `dd2baf4` | 2026-06-15 23:45:03 +0300 | docs(doctor-config): correct overstated rule-suppression rationale |

---

## Documentation Updates

The following documentation files were updated to reflect these changes:

- `README.md` - Updated the current feature list, tool versions, macOS SQLite path, and ADR count.
- `docs/product/current-shell-inventory.md` - Updated dashboard, shell-provider, Changes tab, setup/run script, terminal environment, settings, and resolved-unknowns guidance.
- `docs/product/implementation-roadmap.md` - Added current implementation deltas since `de46de5` and removed stale settings decisions.
- `docs/product/conductor-parity.md` - Updated dashboard, setup/run, environment, settings, and feature-flag parity rows.
- `docs/product/open-decisions.md` - Removed stale AI-certainty/experimental-flag decisions and marked board status/unread/review semantics resolved.
- `docs/product/settings-inventory.md` - Reflected the actual Appearance schema and bundled default terminal font.
- `docs/product/docs-consistency-audit.md` - Recorded the 2026-07-18 docs refresh audit.
