# Settings Wiring Review

Original review: 2026-07-14

Last verified: 2026-07-19 against `034d12b`

Purpose: record what user/global and repository settings are actually wired, what is intentionally dead/removed, and what is still pending. This reflects the current codebase rather than the older settings inventory screenshots.

## Summary

Ensemblr now has two real settings paths:

1. **User/App settings** live in `~/.config/ensemblr/config.json` for migrated sections. They are owned by `AppSettingsService`, mirrored into renderer Jotai atoms, and live-reloaded when the file changes.
2. **Repository settings** resolve through `.ensemblr/settings.toml`, `.worktreeinclude`, SQLite personal rows, user defaults, and built-in defaults. The resolver is real, but several repo settings screens still store values only in renderer `localStorage`, so those controls do not affect runtime behavior.

Highest-risk gap: repo settings UI still contains false affordances. Scripts and environment are wired, and personal action preferences now reach runtime prompts. Repo Git, Misc, spotlight testing, shared action prompts, and several Advanced controls remain partial or disconnected.

## Implementation update — 2026-07-19

The pending items in this review were implemented as a stacked series of PR-sized workstreams. The sections below describe the *pre-implementation* state; the current wiring is:

- **Repo-settings persistence backbone** — a generic `updateRepositorySettings` IPC + SQLite writer keyed on canonical resolver keys, mirroring the Scripts pattern. Committed `[git]` TOML now normalizes onto canonical top-level keys; `[prompts]` normalizes onto `actionPreferences.<key>`.
- **Advanced** — Pi executable path hydrates from / writes / clears the real SQLite setting (get/set/clear IPC); terminal scrollback is a real `appearance.terminalScrollbackMb` setting feeding xterm + the pty buffer.
- **Repo Git** — delete-on-archive / archive-on-merge switches are writable; `branchFrom` persists to SQLite and drives workspace-creation base selection. `remoteOrigin` is read-only with a note (a configurable push/pull/PR remote is a separate effort — it spans several services that hardcode `origin`).
- **Repo Actions** — resolver-only merge fix: committed `[prompts]` merge *under* personal `actionPreferences` at runtime; the UI and personal prefs are unchanged.
- **Repo Misc** — `filesToCopy` persists to SQLite and layers into the files-to-copy service; `previewUrls` persist to SQLite and drive the dock Open control (with `$ENSEMBLR_PORT` / `$ENSEMBLR_WORKSPACE_NAME` interpolation and a dropdown for multiples).
- **Repo Environment / config edit** — repo env files are enabled; the `.ensemblr/settings.toml` edit button opens the file (creating a starter when absent).
- **Cross-cutting** — `repositoryDefaults` / `repositoryRules` now apply during resolution (path-matched rules override defaults); `config.json` live-reloads its non-App sections and broadcasts to the renderer.
- **`repoSettingsOverrideAtomFamily`** slimmed to personal `actionPreferences` only; the migrated fields moved to SQLite.
- **Spotlight testing** — remains a separate, unbuilt feature (workspace→root diff/apply with rollback; see `discovery-spotlight-testing.md`). Its toggle is now a disabled "Coming soon" control rather than a localStorage no-op.

## User/App Settings

### General

Status: **wired**.

- `sendShortcut` drives composer submit behavior.
- `followUpBehavior` drives steer/queue/block behavior.
- `desktopNotifications` gates turn-finished notifications.
- `autoConvertLongText` gates long paste conversion into attachments.
- `alwaysShowContextUsage` gates context usage visibility.
- `caffeinateWhileRunning` gates the macOS power blocker while Pi runs.
- `toolCallCollapse` drives default tool-card collapse state and the global toggle hotkey.

Removed by design:

- Soften AI certainty.
- Show MCP status in chat.

### Models

Status: **wired for the current flow**.

- Default chat model.
- Default chat thinking level.
- Review model and review thinking level. The Review action opens a new chat, primes that chat's model/thinking overrides, attaches the generated review prompt, and auto-submits it.
- Hidden models.
- Favourite models, still localStorage because it is a composer picker preference.
- Model catalog cache, still a runtime/localStorage cache.

Removed by design:

- Personality/style.
- Default plan mode.
- Default fast mode.
- Browser-control integration.

### Environment

Status: **wired**.

- App-scope variables have CRUD from renderer through IPC into SQLite/Keychain.
- Secret values route through the secret store with metadata in SQLite.
- App-scope env files are wired.
- Variables inject into Pi sessions, scripts, and terminals through workspace environment assembly.

### Appearance

Status: **wired**.

- Theme applies through root theme effect.
- Colored sidebar diffs are consumed by workspace diff stats.
- Accessible colors apply root classes.
- Code theme is consumed by code block and message rendering.
- Mono font applies through `--ensemblr-font-mono`.
- Code ligatures toggle a root class.
- Markdown style affects message rendering.
- Terminal font and terminal font size apply to xterm.

### Git

Status: **mostly wired**.

- Branch prefix source/custom/none is used during workspace creation.
- Rename workspace when branch is named is used by the branch-name queue.
- Delete local branch on archive, archive on merge, and set upstream on push feed runtime merge/archive/push behavior through resolved settings.

Confirmed limitation:

- Repository TOML nested Git keys are preserved as nested snake_case values, for example `git.branch_prefix`. They do not normalize to the canonical top-level keys used by the resolver/runtime, such as `branchFrom`, `remoteOrigin`, `deleteLocalBranchOnArchive`, and `archiveAfterMerge`.

### Integrations and Diagnostics

Status: **wired for current v1 scope**.

- Linear OAuth connect/disconnect/status/token flow exists.
- GitHub remains owned by `gh` auth and diagnostics, not a token field.
- Diagnostics page is wired and can copy a sanitized bundle.
- Providers screen was removed by design because Pi owns provider configuration.

### Experimental

Status: **intentionally minimal**.

Most experimental options were killed or resolved elsewhere. Do not resurrect old screenshot toggles without a fresh product decision.

Currently present:

- Developer Mode: wired, localStorage, controls debug-only surfaces.
- Auto-run after setup: wired in `config.json` and feeds repository script resolution as a user default.

Killed/resolved/deferred:

- Big terminal mode: resolved through terminal dock behavior, no setting.
- Many tabs per workspace: resolved by fixed tab limit, no setting.
- Dashboard/sidebar/browser-preview flags: killed for now unless re-approved.
- Sidebar resource usage: killed for now; sampler not core.
- Voice mode: deferred.
- Graphite: deferred.
- React profiler: internal development diagnostic only, not a production setting.

### Advanced

Status: **mixed**.

Wired:

- Root directory picker and reconciliation are wired through SQLite app settings.

Partially wired / broken:

- Pi executable **Browse** writes the real SQLite `piExecutablePath` setting used by diagnostics, Pi sessions, model discovery, and setup checks. The displayed text field hydrates from localStorage instead of the resolved SQLite value, and typing or **Use bundled Pi** changes only localStorage. There is no backend clear path, so the UI can drift from runtime.

Pending/dead:

- Terminal scrollback limit is UI/localStorage only. Main terminal scrollback still uses a hardcoded default.
- SSH private key path is deferred with cloud/remote workspaces.

## Repository Settings

### Storage and Precedence

Current intended precedence:

1. `.worktreeinclude` for files-to-copy only.
2. `.ensemblr/settings.toml` committed repo config.
3. SQLite personal repo rows.
4. User defaults from `config.json`.
5. Built-in defaults.

`.ensemblr/settings.toml` is read-only to the app. Users hand-edit and commit it.

### Repo Environment

Status: **wired**.

- Repo-scope variables have CRUD and override app variables.
- Secrets route through Keychain.
- Values inject into Pi sessions, scripts, and terminals.
- Repo env files are not enabled in the UI.

### Repo Scripts

Status: **wired**.

- Setup script.
- Run script.
- Archive script.
- Run mode.
- Auto-run after setup.

The UI writes personal SQLite rows. If `.ensemblr/settings.toml` defines the same key, the committed value wins and the SQLite edit is shadowed.

### Repo Git

Status: **partially wired**.

Wired/read-only:

- Delete branch on archive and archive on merge resolve from canonical repository SQLite rows, user defaults, or built-ins and feed runtime archive/merge behavior.

Pending / false affordance:

- Branch new workspaces from stores only in renderer localStorage and is not consumed by workspace creation.
- Remote origin stores only in renderer localStorage and is not consumed by push/pull/PR behavior.
- Repo Git booleans have no editable SQLite path in the screen.
- The TOML `[git]` object remains nested and snake_case, so it does not currently supply the canonical keys above.

### Repo Actions

Status: **partially wired**.

Wired, personal-only:

- Code review, create PR, fix errors, resolve conflicts, branch rename, and general preferences persist in the per-repo localStorage override.
- `useAgentActionRunner` now reads the matching preference, appends it after bounded built-in/context text, writes the generated action prompt as a workspace attachment, and submits it to the target chat.
- Review actions additionally use the configured review model and thinking level in a new chat.

Pending / false affordance:

- Use spotlight testing stores only in renderer localStorage and has no runtime consumer.

Shared-config mismatch:

- The TOML parser accepts `[prompts]` as `prompts.*`.
- Resolver built-ins use `piActions.*`.
- The runtime action runner reads `actionPreferences` from renderer localStorage, not either resolver key family.
- Shared TOML prompts and SQLite action rows therefore do not merge into the working personal action preferences.

### Repo Misc

Status: **mostly pending**.

Wired/read-only:

- Root path display.
- Workspaces path display.
- Repository removal/archive lifecycle.

Pending / false affordance:

- Preview URLs store only in renderer localStorage. Runtime currently auto-detects preview URLs from terminal output.
- Files to copy stores only in renderer localStorage. Runtime uses `.worktreeinclude` or `.ensemblr/settings.toml`.

### Repo Config Edit Button

Status: **pending**.

- User-scope `Edit in config.json` is wired.
- Repo-scope `Edit in .ensemblr/settings.toml` renders but click is a no-op.

## Cross-Cutting Issues

### Config service cache

`AppSettingsService` watches and live-reloads the App settings slice. The broader `EnsemblrConfigService` loads and caches `config.json`; no general live reload was found for non-App settings such as `app.linear`, `security`, `managed`, `environment`, `repositoryDefaults`, or `repositoryRules`.

### Repository defaults and rules

`repositoryDefaults` and `repositoryRules` are accepted by the top-level config loader, but no meaningful repo matching/rule application was found in current resolution. Treat them as not wired until proven otherwise.

### LocalStorage repo override atoms

`repoSettingsOverrideAtomFamily` remains the main source of false settings affordances. It backs Repo Git, Actions, and Misc controls. Runtime now consumes `actionPreferences`, but still ignores `branchFrom`, `remoteOrigin`, `useSpotlight`, `previewUrls`, and `filesToCopy`.

## Recommended Next Work

1. Remove or disable repo controls that only write localStorage, unless they are wired in the same change.
2. Fix the Advanced Pi executable UI to hydrate, write, and clear the real SQLite setting.
3. Normalize repo action preferences around one key family and merge personal/UI plus shared TOML values into the runtime prompt path.
4. Normalize repository TOML Git fields and wire `branchFrom` / `remoteOrigin` into runtime behavior.
5. Wire terminal scrollback limit or remove the control.
6. Wire the repo config edit action for `.ensemblr/settings.toml`.
7. Decide whether `repositoryDefaults` and `repositoryRules` are still product scope; if yes, implement them in resolution.
