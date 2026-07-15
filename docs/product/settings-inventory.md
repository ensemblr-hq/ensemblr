# Settings Inventory

Date: 2026-07-15

This inventory reflects the settings screens as implemented in code. It separates
app-wide settings from repository settings and assigns each setting to the right
persistence layer.

App-scope sections (`settings-sidebar.tsx`): **General, Models, Environment, Git,
Appearance, Integrations** in the main group, and **Diagnostics, Experimental,
Advanced** under "More". Repo-scope sections: **Environment, Git, Scripts,
Actions, Misc**. There is no Providers screen (removed).

## Storage Legend

| Store | Use for |
| --- | --- |
| SQLite | Mutable local app state, personal overrides, cached integration status, workspace/repository records. |
| `~/.config/ensemblr/config.json` | **Source of truth for App settings** — General, Models, Git, Appearance, and Experimental (partial: `autoRunAfterSetup`) are implemented under `app.general.*` / `app.models.*` / `app.git.*` / `app.appearance.*` / `app.experimental.*` (see ADR 0029) — plus declarative user defaults, managed policy-like settings, and repository matching rules. Created on first run; live-watched for external edits. |
| `localStorage` (`atomWithStorage`) | Non-Settings-page UI state, the App toggles not backed by `config.json` (Experimental Developer Mode; Advanced Pi executable path and terminal scrollback limit), repo personal overrides, composer favourites, and the model-catalog cache. |
| Repository config | Shared project behavior in the committed `.ensemblr/settings.toml`. Use for scripts, run mode, files-to-copy, and team-shared repository defaults. |
| Pi user environment | Pi auth, models, provider settings, skills, extensions, prompts, themes, sessions, and project `.pi` resources. Ensemblr should not duplicate this as source of truth. |
| macOS Keychain | Secret values such as tokens/API keys. SQLite may keep metadata only. |

## App Settings Sections

### General

Source of truth: `~/.config/ensemblr/config.json` under `app.general.*`. The
renderer hydrates from it on launch, writes section-scoped patches back through
IPC, and live-reloads when the file is edited externally (see ADR 0029).

| Setting | Conductor mapping | Ensemblr adaptation | Storage |
| --- | --- | --- | --- |
| Send-message shortcut | Direct. | Same behavior for Pi composer. | `config.json` (`app.general.sendShortcut`). |
| Follow-up behavior | Direct. | Map to Pi steering/queue behavior. | `config.json` (`app.general.followUpBehavior`). |
| Desktop notifications | Direct. | Notify when Pi turn/session completes or fails. | `config.json` (`app.general.desktopNotifications`); OS permission external. |
| Auto-convert long pasted text | Direct. | Same, producing Ensemblr/Pi attachments. | `config.json` (`app.general.autoConvertLongText`). |
| Always show context usage | Direct. | Show Pi context/token usage when SDK provides it. | `config.json` (`app.general.alwaysShowContextUsage`). |
| Caffeinate while agents run | Direct. | Prevent sleep during active Pi sessions/scripts. | `config.json` (`app.general.caffeinateWhileRunning`). |
| Don't collapse tool calls | Direct. | Render Pi tool calls expanded instead of collapsed (`toolCallCollapse` enum `collapsed`/`expanded`). | `config.json` (`app.general.toolCallCollapse`). |

Removed entirely: **Soften AI certainty** and **Show MCP status in chat**. Both
were toggles with no functional consumer (planned but never wired), so their
atoms were dropped; they are not user-configurable and not stored in
`config.json`.

### Models

Source of truth: `~/.config/ensemblr/config.json` under `app.models.*` (same
sync/live-reload path as General; see ADR 0029). Favourites and the catalog
cache stay in `localStorage` — they're set outside the Settings page (composer
star) or are derived runtime cache, not user settings.

| Setting | Conductor mapping | Ensemblr adaptation | Storage |
| --- | --- | --- | --- |
| Default chat model | Direct concept. | Pi model id for new chats; bound to the runtime via the `--model` spawn flag. | `config.json` (`app.models.defaultModel`). |
| Default thinking level | Direct concept. | Pi thinking level for new chats; bound via `--thinking`. | `config.json` (`app.models.defaultThinkingLevel`). |
| Review model + thinking | Direct concept. | Separate model/thinking for the workspace Review action. | `config.json` (`app.models.reviewModel`, `app.models.reviewThinkingLevel`). |
| Model visibility | n/a (Ensemblr). | Toggle models off in Settings → Models so they drop out of the composer picker. Inverse storage (records hidden ids); hiding never changes the active/default model. | `config.json` (`app.models.hiddenModels`, string[]). |
| Favourite models | n/a (Ensemblr). | Star models in the composer picker to pin them to a top "Favourites" group with the low 1-9 shortcuts. App-wide, shared across all workspaces. | `atomWithStorage` (`favourite_models`, string[]). |
| Model catalog cache | n/a (Ensemblr). | Last non-empty `pi --list-models` result cached so the picker is populated instantly on launch; refreshed silently in the background. | `localStorage` (`pi_models_snapshot`). |

Removed (Pi has no out-of-the-box support — verified against pi 0.79.1 docs and `/earendil-works/pi`): **Personality/style** (no core concept; was an Ensemblr prompt preset only), **Default plan mode** (`--plan` exists only as an optional extension), **Default fast mode** (no such concept), **Browser-control integration** (no core support). The per-chat model/thinking selection resolves as: per-chat override → Settings default → Pi-reported default → first available model.

### Providers

**Removed.** The standalone Providers screen (route, sidebar entry, and command-palette
entry) was deleted. Provider/auth setup is owned by Pi itself — Ensemblr does not store
provider tokens or duplicate Pi's provider configuration. The readiness checks that screen
surfaced (Pi runtime, Pi model provider, GitHub CLI) still live in **Diagnostics**, sourced
from the setup-diagnostics gate.

### Diagnostics

First-class user-scope section (`diagnostics.tsx`). Renders the full setup gate —
Pi runtime/readiness, git, GitHub CLI (`gh auth status`), Linear, and the Ensemblr
runtime — plus a **Copy diagnostics bundle** action that copies a secret-redacting
summary for support. This is where GitHub readiness surfaces; it is not on the
Integrations page.

### Environment

**Status: implemented** — fully editable CRUD on a per-scope environment store, wired end to
end (renderer → IPC → `EnvironmentVariablesService` → SQLite/Keychain) and injected into Pi
sessions, scripts, and terminals at session launch via `assembleEnvironment` (app →
repository → workspace precedence). The earlier "read-only / manage via Keychain or shell
profile" copy was a hallucination and has been replaced.

| Setting | Conductor mapping | Ensemblr adaptation | Storage |
| --- | --- | --- | --- |
| Documented variable catalog | Direct. | Pi-relevant documented variables only (`PI_CODING_AGENT_DIR`, `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`, the 8 provider API keys, `DEBUG`, `CI`). No Claude Code/Codex/Cursor catalog entries. Shown in a collapsible "Show documented variables (N)" list with a `+` to set each. | Built-in catalog; user values separate. |
| Non-secret variable values | Direct. | Passed to Pi sessions, scripts, and terminals. | SQLite (`settings` table, `environment.variables.*`); optional `config.json` defaults. |
| Secret variable values | Direct. | Auto-classified: a known secret catalog key or sensitive-named key routes to the secret store; everything else is plain. Masked in the list; the eye toggle reveals the real value on demand (plain from SQLite, secret read back from Keychain). | macOS Keychain; SQLite metadata. |
| Set/unset status | Direct. | Configured variables (`set`/`masked`) render as editable rows; reserved runtime vars (`ENSEMBLR_*`) are excluded. | SQLite metadata/cache. |
| Add / edit / delete variable | Direct. | Right slide-over (Name + Value). Custom adds and edits require a value; documented adds may set an empty string. Name is locked when the key is preset (documented add or edit). | SQLite / secret store. |
| Env files | Direct (Conductor "Env files"). | Load `KEY=value` files from disk at session launch (lowest precedence within a scope, so explicit vars win; reserved keys skipped). Native file picker. **User (app) scope only for now**; storage is per-scope so repository scope is a later no-op. | Ordered path list in SQLite (`settings` table, `environment.files`); file contents read at assembly time. |

### Appearance

Source of truth: `~/.config/ensemblr/config.json` under `app.appearance.*` (same
sync/live-reload path as General; see ADR 0029). Each value applies live — theme
plus the accessible-color/ligature classes on the document root, the mono font
via the `--ensemblr-font-mono` CSS variable, terminal typography through the
xterm adapter, and the code theme through the Shiki/Streamdown renderers. Unlike
General/Models (fresh seed), Appearance runs a **one-time migration** of the old
`ensemblr_pref_*` `localStorage` values into `config.json` on first launch, then
removes the legacy keys; the renamed `one-dark` code theme is carried over as
`one-dark-pro`.

| Setting | Conductor mapping | Ensemblr adaptation | Storage |
| --- | --- | --- | --- |
| Theme | Direct. | Ensemblr-specific themes. | `config.json` (`app.appearance.theme`). |
| Colored sidebar diffs | Direct. | Same. | `config.json` (`app.appearance.coloredSidebarDiffs`). |
| Accessible colors | Direct. | Ensemblr accessibility palette variants. | `config.json` (`app.appearance.accessibleColors`). |
| Code theme | Direct. | Ensemblr code/diff highlighting theme. | `config.json` (`app.appearance.codeTheme`). |
| Mono font | Direct. | Font for code, diffs, and inline code. | `config.json` (`app.appearance.monoFont`). |
| Code ligatures | Direct. | Same. | `config.json` (`app.appearance.codeLigatures`). |
| Markdown style | Direct. | Ensemblr markdown rendering preset. | `config.json` (`app.appearance.markdownStyle`). |
| Terminal font | Direct. | xterm.js font family. | `config.json` (`app.appearance.terminalFont`). |
| Terminal font size | Direct. | xterm.js font size (8–24). | `config.json` (`app.appearance.terminalFontSize`). |

### Git

Source of truth: `~/.config/ensemblr/config.json` under `app.git.*`
(`app-settings.ts`), not SQLite.

| Setting | Conductor mapping | Ensemblr adaptation | Storage |
| --- | --- | --- | --- |
| Branch name prefix | Direct. | Prefix new workspace branches; source is detected GitHub username, custom string, or none. | `config.json` (`app.git.*`). |
| Rename workspace when branch is named | Direct. | Same for placeholder workspace names. | `config.json` (`app.git.*`). |
| Delete local branch on archive | Direct. | Same with explicit confirmation where needed. | `config.json` (`app.git.*`). |
| Archive on merge | Direct. | Same after a successful merge. | `config.json` (`app.git.*`). |
| Set upstream on plain `git push` | Direct. | Add `--set-upstream` on a plain push when the branch has no upstream. | `config.json` (`app.git.setUpstreamOnPush`). |

### Integrations

Sole control on this page is the **Linear** connection row
(`integrations.tsx`). GitHub readiness is on the **Diagnostics** page, not here;
GitHub access uses authenticated `gh` (including `gh api`) and stores no token
field. App account identity and sign-out are deferred (Ensemblr is local-first).

| Setting | Conductor mapping | Ensemblr adaptation | Storage |
| --- | --- | --- | --- |
| Linear integration | Direct. | First-class v1 integration: connect/disconnect/reconnect via OAuth, issue CRUD, and workspace creation from issues. | Tokens in Keychain; connection/cache metadata in SQLite. |

### Experimental

Exactly two toggles (`experimental.tsx`). The earlier speculative flag list —
Big terminal mode, many-tabs, Dashboard/Sidebar visibility, In-app browser
preview, Voice mode, Sidebar resource usage, Graphite stack support, and React
profiler — is not present in code (removed in the #113 experimental-toggle
refinement).

| Setting | Ensemblr adaptation | Storage |
| --- | --- | --- |
| Developer Mode | Show developer-only diagnostics and Pi debug controls. | `localStorage` (`ensemblr_pref_exp_developer_mode`). |
| Auto-run after setup | Start a repo's run script automatically after setup when no repo override exists. | `config.json` (`app.experimental.autoRunAfterSetup`). |

### Advanced

| Setting | Ensemblr adaptation | Storage |
| --- | --- | --- |
| Ensemblr root directory | Browse to the Ensemblr root; changing it reconciles the repo list. Optional Conductor shared-root interoperability. | SQLite current value / root resolver. |
| Pi executable path | Override the bundled Pi with `pi`, a wrapper script, or an alternate launcher; empty falls back to the discovered system Pi. | `localStorage` (`ensemblr_pref_pi_executable_override`). |
| Terminal scrollback limit | xterm scrollback buffer, 1–200 MB (default 10). | `localStorage` (`ensemblr_pref_terminal_scrollback_mb`). |
| SSH private key path | Deferred with cloud/remote workspace support (ADR 0020). | Not applicable in v1. |

Note: "Set upstream on plain `git push`" lives on the **Git** page
(`app.git.setUpstreamOnPush`), not here.

## Repository Settings Sections

The repo scope has five pages (`settings-sidebar.tsx` `REPO_NAV`): **Environment,
Git, Scripts, Actions, Misc**. Personal repo overrides live in `localStorage`
(`repoSettingsOverrideAtomFamily`, key `ensemblr_pref_repo_override_<repoId>`);
resolved values come from the committed `.ensemblr/settings.toml` and SQLite
through `useRepoSettings`. Each script/toggle row shows a `SourceBadge` and, where
the committed toml wins, an "Overridden by the committed `.ensemblr/settings.toml`"
hint.

### Environment (repo)

Repo-scoped environment-variable CRUD (`repo/$repoId/environment.tsx`), same
panel as the user-scope Environment page but keyed to the repository scope.

### Git (repo)

| Setting | Ensemblr adaptation | Storage |
| --- | --- | --- |
| Branch new workspaces from | Base ref for new workspace branches (`branchFrom`). | localStorage personal override; shared default in `.ensemblr/settings.toml`. |
| Remote origin | Remote used for push/pull/PR (`remoteOrigin`). | localStorage personal override; inferred from git. |
| Delete branch on archive | Read-only here; resolved from app/repo config. | Resolved value (edit in `.ensemblr/settings.toml`). |
| Archive on merge | Read-only here; resolved from app/repo config. | Resolved value (edit in `.ensemblr/settings.toml`). |

### Scripts

| Setting | Ensemblr adaptation | Storage |
| --- | --- | --- |
| Setup script | Runs when a workspace is created or manually rerun; auto-skipped when the dependency fingerprint is unchanged (ADR 0034). | `.ensemblr/settings.toml` shared; localStorage personal override. |
| Run script | Run button in the terminal dock. | `.ensemblr/settings.toml` shared; localStorage personal override. |
| Run mode | Concurrent / nonconcurrent run behavior. | `.ensemblr/settings.toml` shared; localStorage personal override. |
| Auto-run after setup | Start the run script automatically once setup completes. | `.ensemblr/settings.toml` shared; localStorage personal override. |
| Archive script | Runs before archive. | `.ensemblr/settings.toml` shared; localStorage personal override. |

The committed `.ensemblr/settings.toml` is hand-authored in the repo; Ensemblr
reads it and does not generate it (there is no "create shared config" button).

### Actions

Spotlight testing plus per-action agent-preference text (`repo/$repoId/actions.tsx`,
`REPO_ACTION_KEYS`).

| Setting | Ensemblr adaptation | Storage |
| --- | --- | --- |
| Use spotlight testing | Replace the running app from root while testing workspace changes. | `.ensemblr/settings.toml` shared; localStorage personal override. |
| Code review / Create PR / Fix errors / Resolve conflicts / Branch rename / General preferences | Custom Pi instructions for each workspace action (accordion of six textareas). | `.ensemblr/settings.toml` shared if safe; localStorage personal override. |

### Misc

Identity/paths, preview URLs, files-to-copy, and repository removal
(`repo/$repoId/misc.tsx`).

| Setting | Ensemblr adaptation | Storage |
| --- | --- | --- |
| Root path | Path to the managed or adopted repository (read-only). | SQLite only. |
| Workspaces path | Path to workspaces under the Ensemblr/shared root (read-only). | SQLite only. |
| Preview URLs | Multi-row templates; support `$ENSEMBLR_WORKSPACE_NAME` and `$ENSEMBLR_PORT`. | localStorage personal override; shared default in `.ensemblr/settings.toml`. |
| Files to copy | gitignore-style globs (textarea) copied into new worktrees. | `.ensemblr/settings.toml` shared; localStorage personal override. |
| Remove repository | Remove from app records via a confirm dialog; the handler runs `archiveRepository` under the hood. | SQLite lifecycle. |

## Configuration Precedence

For repository behavior, resolve each key with this precedence (highest to lowest; see ADR 0030):

1. `.worktreeinclude` for files-to-copy patterns.
2. The committed `.ensemblr/settings.toml` at the repository root.
3. Personal repository settings in SQLite (edited via the Scripts settings screen).
4. User defaults from `~/.config/ensemblr/config.json`.
5. Built-in defaults.

For app-wide behavior, use:

1. Locked/managed settings from `~/.config/ensemblr/config.json`, if supported by schema.
2. User-selected settings in `~/.config/ensemblr/config.json` (General, Models, Git, Appearance, and `app.experimental.autoRunAfterSetup`). The few remaining toggles read from `localStorage` (see migration status).
3. Built-in defaults (the shared Zod schema fills any missing or invalid field).
4. Pi user environment for Pi-specific resources and auth.

> Migration status: General, Models, Git, Appearance, and Experimental's
> `autoRunAfterSetup` are the source of truth in `config.json`. Appearance
> additionally migrates its legacy `ensemblr_pref_*` `localStorage` values on first
> launch (removing them only after a successful write). Only three App toggles
> still persist to `localStorage`: Experimental **Developer Mode**, and Advanced
> **Pi executable path** and **Terminal scrollback limit**. Repo personal
> overrides also live in `localStorage`; the committed `.ensemblr/settings.toml`
> holds shared repo defaults.

## Open Settings Questions

- Resolved (pi 0.79.1): plan mode is extension-only, fast mode and browser control have no core support, personality has no Pi concept — all dropped from the Models settings screen. Review-model separation is supported via a separate spawned session with its own `--model`.
- Which non-deferred experimental features are v1 parity requirements versus post-core flags?
