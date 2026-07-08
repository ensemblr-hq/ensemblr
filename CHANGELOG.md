# Changelog

All notable changes to Ensemble are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Git Settings UI** (`d61d93e`): New Settings → Git page with user-scope git defaults stored in `~/.config/ensemble/config.json` under `app.git`. Settings include:
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

- **Wordmark Mount Behavior** (`957a71d`): Changed from `scheduleNextBurst()` to `runBurst()` on component mount, ensuring immediate visual feedback.

- **Repository Resolution Precedence** (`d61d93e`): Added `user-default` source to the config resolution chain, feeding user-scope git defaults (`app.git.*`) into repository settings as the 7th precedence level (before built-in defaults).

- **Setup Diagnostics** (`a7c7b56`): Reworked panel with per-check remediation actions. Remediation documentation links now open in the default browser through a new `openExternal` IPC channel with URL validation (http/https schemes only).

- **Documentation** (`dd2baf4`): Corrected overstated rule-suppression rationale in doctor-config documentation.

- **Test Runner → Vitest**: Renderer (`tests/renderer/**`) and shared (`tests/shared/**`) suites migrated off `bun test` onto Vitest, run with `bunx vitest run` (Bun stays the package manager only). Details:
  - Config in `vitest.config.mts`; default `environment` is `node` so pure-logic tests keep the real `navigator`/`process`, and DOM component tests opt into happy-dom per file via a `// @vitest-environment happy-dom` docblock
  - Scoped DOM harness `tests/renderer/support/dom.tsx` (`renderWithProviders` + `window.ensemble` stubs); jest-dom matchers registered in `tests/renderer/support/vitest.setup.ts`
  - Coverage is native Istanbul (`bunx vitest run --coverage`, provider `@vitest/coverage-istanbul`) emitting `coverage/coverage-final.json`, read directly by `fallow audit`
  - New aggregate scripts: `test` (`bunx vitest run`) and `test:coverage`; mocks use `vi.fn()`/`vi.spyOn()`/`vi.mock()`
  - Removed the global happy-dom registrator (`tests/renderer/support/register-dom.ts`), the lcov→istanbul bridge (`scripts/lcov-to-istanbul.mjs`), and `bunfig.toml`
  - Main-process suites (`tests/main/**`) stay on `electron --test` — they need the Electron runtime

---

## Versioning Note

Ensemble follows a pre-1.0 semantic versioning approach where:
- `MAJOR` version (currently 0) remains 0 until stable v1 release
- `MINOR` version increments with significant feature additions
- `PATCH` version increments with bug fixes and small improvements

---

## Commit References

| Commit | Date | Feature |
|--------|------|---------|
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

- `docs/product/implementation-roadmap.md` - Added "Completed Implementation" section
- `docs/product/conductor-parity.md` - Updated Settings row, added User git defaults row
- `docs/product/current-shell-inventory.md` - Updated All Files tab status, added Settings → Git row, updated Current Unknowns, added context-aware close action details to Chat/session tabs and Settings shell entry rows
