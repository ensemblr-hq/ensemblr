# Settings Wiring Review

Date: 2026-07-14

Purpose: record what user/global and repository settings are actually wired today, what is intentionally dead/removed, and what is still pending. This reflects the current codebase, not the older settings inventory screenshots.

## Summary

Ensemblr now has two real settings paths:

1. **User/App settings** live in `~/.config/ensemblr/config.json` for migrated sections. They are owned by `AppSettingsService`, mirrored into renderer Jotai atoms, and live-reloaded when the file changes.
2. **Repository settings** resolve through `.ensemblr/settings.toml`, `.worktreeinclude`, SQLite personal rows, user defaults, and built-in defaults. The resolver is real, but several repo settings screens still store values only in renderer `localStorage`, so those controls do not affect runtime behavior.

Highest-risk gap: repo settings UI currently contains several false affordances. Scripts and environment are wired; Git/Misc/Actions are only partially wired.

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

Status: **partially wired**.

Wired:

- Default chat model.
- Default chat thinking level.
- Hidden models.
- Favourite models, still localStorage because it is a composer picker preference.
- Model catalog cache, still runtime/localStorage cache.

Pending/dead:

- Review model and review thinking level persist and render in Settings, but no runtime consumer was found. Current review action inserts a prompt into the active chat instead of spawning/routing through the configured review model.

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

Risk:

- Repository TOML nested Git keys may not normalize snake_case to the camelCase expected by runtime code. Example risk: a nested `branch_prefix` value may not become `branchPrefix`.

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

- Pi executable picker backend writes the real SQLite setting. The text field and clear button write localStorage only, so the UI can drift from the runtime override.

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

- Delete branch on archive.
- Archive on merge.

Pending:

- Branch new workspaces from stores only in renderer localStorage and is not consumed by runtime.
- Remote origin stores only in renderer localStorage and is not consumed by runtime.
- Repo Git booleans have no editable SQLite path in the screen.

### Repo Actions

Status: **mostly pending**.

Pending / false affordance:

- Use spotlight testing stores only in renderer localStorage.
- Code review preferences store only in renderer localStorage.
- Create PR preferences store only in renderer localStorage.
- Fix errors preferences store only in renderer localStorage.
- Resolve conflicts preferences store only in renderer localStorage.
- Branch rename preferences store only in renderer localStorage.
- General action preferences store only in renderer localStorage.

Additional mismatch:

- Runtime agent-action prompts read resolver keys shaped like `piActions.review`.
- Repo TOML parser accepts a `[prompts]` table as `prompts.review`.
- The Actions settings UI writes neither key family into SQLite.
- Result: built-in action prompts usually win.

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

`repoSettingsOverrideAtomFamily` is the main source of false settings affordances. It backs Repo Git, Actions, and Misc controls, but the real resolver/runtime mostly ignores those values.

## Recommended Next Work

1. Remove or disable repo controls that only write localStorage, unless they are wired in the same change.
2. Fix Pi executable Advanced UI to read/write/delete the real SQLite setting.
3. Decide review model fate: wire it into a separate review runtime path or remove it.
4. Normalize repo action preferences around one key family and wire UI → SQLite/TOML → resolver → runtime.
5. Wire terminal scrollback limit or remove the control.
6. Wire repo config edit action for `.ensemblr/settings.toml`.
7. Decide whether `repositoryDefaults` and `repositoryRules` are still product scope; if yes, implement them in resolution.
