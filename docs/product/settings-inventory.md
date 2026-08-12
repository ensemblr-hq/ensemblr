# Settings Inventory

Date: 2026-08-12 (last full pass 2026-08-08)

This inventory reflects the settings screens as implemented in code. It separates
app-wide settings from repository settings and assigns each setting to the right
persistence layer.

App-scope sections (`settings-sidebar.tsx`): **General, Models, Providers,
Environment, Git, Appearance, Integrations** in the main group, and
**Diagnostics, Shortcuts, Experimental** under "More". Repo-scope sections:
**Environment, Git, Scripts, Actions, Security, Misc**.

**Restructured by #248.** The catch-all **Advanced** page is gone and its rows
moved to the pages that own them: the Ensemblr root directory to General, the
terminal scrollback limit to Appearance, and the Pi executable override into
Providers, which already holds per-runtime executables. Two pages are new — a
read-only **Shortcuts** reference and a per-repository **Security** page — and
Developer Mode joined the experimental defaults. Diagnostics, provider readiness
checks, and the Shortcuts reference are localized: main sends a catalogue code
plus its interpolation values and the renderer owns the wording, while the
English text stays on the wire for the support bundle. `ShortcutDef` now carries
bindings only; shortcut names live in the renderer catalogues keyed by shortcut
id. The rows below are grouped by their **current** page.

## Storage Legend

| Store | Use for |
| --- | --- |
| SQLite | Mutable local app state, personal overrides, cached integration status, workspace/repository records. |
| `~/.config/ensemblr/config.json` | **Source of truth for App settings** — General, Models, Git, Appearance, and Experimental (partial: `autoRunAfterSetup`) are implemented under `app.general.*` / `app.models.*` / `app.git.*` / `app.appearance.*` / `app.experimental.*` (see ADR 0029) — plus declarative user defaults, managed policy-like settings, and repository matching rules. Created on first run; live-watched for external edits. |
| `localStorage` (`atomWithStorage`) | Non-Settings-page UI state, App controls not backed by `config.json` (Experimental Developer Mode and the terminal scrollback limit, now on Appearance), the Providers executable field's stale renderer mirror, Repo Git/Actions/Misc personal overrides, composer favourites, the model-catalog and slash-command caches, and per-chat unread marks. |
| Repository config | Shared project behavior in the committed `.ensemblr/settings.toml`. Use for scripts, run mode, files-to-copy, and team-shared repository defaults. |
| Pi user environment | Pi auth, models, provider settings, skills, extensions, prompts, themes, sessions, and project `.pi` resources. Ensemblr should not duplicate this as source of truth. |
| macOS Keychain | Secret values such as tokens/API keys. SQLite may keep metadata only. |

## App Settings Sections

### General

Source of truth: `~/.config/ensemblr/config.json` under `app.general.*`. The
renderer hydrates from it on launch, writes section-scoped patches back through
IPC, and live-reloads when the file is edited externally (see ADR 0029).

| Setting | Behavior | Storage |
| --- | --- | --- |
| Send-message shortcut | Send binding for the Pi composer. | `config.json` (`app.general.sendShortcut`). |
| Follow-up behavior | Maps to Pi steering/queue behavior. | `config.json` (`app.general.followUpBehavior`). |
| Desktop notifications | Notify when a Pi turn/session completes or fails. | `config.json` (`app.general.desktopNotifications`); OS permission external. |
| Auto-convert long pasted text | Converts a long paste into an Ensemblr/Pi attachment. | `config.json` (`app.general.autoConvertLongText`). |
| Always show context usage | Show Pi context/token usage when the SDK provides it. | `config.json` (`app.general.alwaysShowContextUsage`). |
| Caffeinate while agents run | Prevent sleep during active Pi sessions/scripts. | `config.json` (`app.general.caffeinateWhileRunning`). |
| Don't collapse tool calls | Render Pi tool calls expanded instead of collapsed (`toolCallCollapse` enum `collapsed`/`expanded`). | `config.json` (`app.general.toolCallCollapse`). |

Removed entirely: **Soften AI certainty** and **Show MCP status in chat**. Both
were toggles with no functional consumer (planned but never wired), so their
atoms were dropped; they are not user-configurable and not stored in
`config.json`.

### Models

Source of truth: `~/.config/ensemblr/config.json` under `app.models.*` (same
sync/live-reload path as General; see ADR 0029). Favourites and the catalog
cache stay in `localStorage` — they're set outside the Settings page (composer
star) or are derived runtime cache, not user settings.

| Setting | Behavior | Storage |
| --- | --- | --- |
| Default chat model | Pi model id for new chats; bound to the runtime via the `--model` spawn flag. | `config.json` (`app.models.defaultModel`). |
| Default thinking level | Pi thinking level for new chats; bound via `--thinking`. | `config.json` (`app.models.defaultThinkingLevel`). |
| Review model + thinking | Separate model/thinking for the workspace Review action. | `config.json` (`app.models.reviewModel`, `app.models.reviewThinkingLevel`). |
| Model visibility | Toggle models off in Settings → Models so they drop out of the composer picker. Inverse storage (records hidden ids); hiding never changes the active/default model. | `config.json` (`app.models.hiddenModels`, string[]). |
| Favourite models | Star models in the composer picker to pin them to a top "Favourites" group with the low 1-9 shortcuts. App-wide, shared across all workspaces. | `atomWithStorage` (`favourite_models`, string[]). |
| Model catalog cache | Last non-empty `pi --list-models` result cached so the picker is populated instantly on launch; refreshed silently in the background. | `localStorage` (`pi_models_snapshot`). |

Removed (Pi has no out-of-the-box support — verified against pi 0.79.1 docs and `/earendil-works/pi`): **Personality/style** (no core concept; was an Ensemblr prompt preset only), **Default plan mode** (`--plan` exists only as an optional extension), **Default fast mode** (no such concept), **Browser-control integration** (no core support). The per-chat model/thinking selection resolves as: per-chat override → Settings default → Pi-reported default → first available model.

### Providers

**Reinstated 2026-08-07 (#226) as the agent-runtime surface.** The screen was
removed in the 2026-07-19 pass, when Pi was the only runtime and provider/auth
setup was entirely Pi's. ADR 0042 added Claude Code as a second first-class
runtime, so `/settings/providers` (`agent-providers/agent-providers-section.tsx`)
now renders one tab per registered runtime — Claude Code leads, Pi follows in
registry order — over `listAgentProviderDescriptors()` from
`src/shared/agent-provider`. Each tab shows that runtime's executable row,
readiness checks, signed-in accounts, and settings-file location, and the
section-level Refresh re-probes whichever tab is open. Terminal harnesses
(Codex, Vibe) are not agent providers and never appear here.

Ensemblr still stores no provider tokens: each runtime keeps its own
credentials, and the aggregate setup gate remains in **Diagnostics**.

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

| Setting | Behavior | Storage |
| --- | --- | --- |
| Documented variable catalog | Pi-relevant documented variables only (`PI_CODING_AGENT_DIR`, `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`, the 8 provider API keys, `DEBUG`, `CI`). No Claude Code/Codex/Cursor catalog entries. Shown in a collapsible "Show documented variables (N)" list with a `+` to set each. | Built-in catalog; user values separate. |
| Non-secret variable values | Passed to Pi sessions, scripts, and terminals. | SQLite (`settings` table, `environment.variables.*`); optional `config.json` defaults. |
| Secret variable values | Auto-classified: a known secret catalog key or sensitive-named key routes to the secret store; everything else is plain. Masked in the list; the eye toggle reveals the real value on demand (plain from SQLite, secret read back from Keychain). | macOS Keychain; SQLite metadata. |
| Set/unset status | Configured variables (`set`/`masked`) render as editable rows; reserved runtime vars (`ENSEMBLR_*`) are excluded. | SQLite metadata/cache. |
| Add / edit / delete variable | Right slide-over (Name + Value). Custom adds and edits require a value; documented adds may set an empty string. Name is locked when the key is preset (documented add or edit). | SQLite / secret store. |
| Env files | Load `KEY=value` files from disk at session launch (lowest precedence within a scope, so explicit vars win; reserved keys skipped). Native file picker. **User (app) scope only for now**; storage is per-scope so repository scope is a later no-op. | Ordered path list in SQLite (`settings` table, `environment.files`); file contents read at assembly time. |

### Appearance

Source of truth: `~/.config/ensemblr/config.json` under `app.appearance.*` (same
sync/live-reload path as General; see ADR 0029). Each value applies live — theme
plus the accessible-color/ligature classes on the document root, the mono font
via the `--ensemblr-font-mono` CSS variable, terminal typography through the
xterm adapter, and the code theme through the Shiki/Streamdown renderers. The
default mono/terminal family is bundled JetBrains Mono Nerd Font so code and
terminal surfaces render consistently before user font customization. Unlike
General/Models (fresh seed), Appearance runs a **one-time migration** of the old
`ensemblr_pref_*` `localStorage` values into `config.json` on first launch, then
removes the legacy keys; the renamed `one-dark` code theme is carried over as
`one-dark-pro`.

| Setting | Behavior | Storage |
| --- | --- | --- |
| Theme | Ensemblr-specific themes. | `config.json` (`app.appearance.theme`). |
| Accessible colors | Ensemblr accessibility palette variants. | `config.json` (`app.appearance.accessibleColors`). |
| Code theme | Ensemblr code/diff highlighting theme. Picks a theme family; the stored id names the family and the app renders its light or dark cut to match the app theme. Only syntax colours follow it — code surfaces paint from the `code` design tokens. | `config.json` (`app.appearance.codeTheme`). |
| Mono font | Font for code, diffs, and inline code. | `config.json` (`app.appearance.monoFont`). |
| Code ligatures | Enables ligatures in the mono font. | `config.json` (`app.appearance.codeLigatures`). |
| Markdown style | Ensemblr markdown rendering preset. | `config.json` (`app.appearance.markdownStyle`). |
| Terminal font | xterm.js font family. | `config.json` (`app.appearance.terminalFont`). |
| Terminal font size | xterm.js font size (8–24). | `config.json` (`app.appearance.terminalFontSize`). |

### Git

Source of truth: `~/.config/ensemblr/config.json` under `app.git.*`
(`app-settings.ts`), not SQLite.

| Setting | Behavior | Storage |
| --- | --- | --- |
| Branch name prefix | Prefix new workspace branches; source is detected GitHub username, custom string, or none. | `config.json` (`app.git.*`). |
| Rename workspace when branch is named | Renames a placeholder workspace name once its branch is named. | `config.json` (`app.git.*`). |
| Delete local branch on archive | Deletes the local branch on archive, with explicit confirmation where needed. | `config.json` (`app.git.*`). |
| Archive on merge | Archives the workspace after a successful merge. | `config.json` (`app.git.*`). |
| Set upstream on plain `git push` | Add `--set-upstream` on a plain push when the branch has no upstream. | `config.json` (`app.git.setUpstreamOnPush`). |

### Integrations

Sole control on this page is the **Linear** connection row
(`integrations.tsx`). GitHub readiness is on the **Diagnostics** page, not here;
GitHub access uses authenticated `gh` (including `gh api`) and stores no token
field. App account identity and sign-out are deferred (Ensemblr is local-first).

| Setting | Behavior | Storage |
| --- | --- | --- |
| Linear integration | First-class v1 integration: connect/disconnect/reconnect via OAuth, issue CRUD, and workspace creation from issues. | Tokens in Keychain; connection/cache metadata in SQLite. |

### Experimental

Exactly two toggles (`experimental.tsx`). The earlier speculative flag list —
Big terminal mode, many-tabs, Dashboard/Sidebar visibility, In-app browser
preview, Voice mode, Sidebar resource usage, Graphite stack support, and React
profiler — is not present in code (removed in the #113 experimental-toggle
refinement).

| Setting | Behavior | Storage |
| --- | --- | --- |
| Developer Mode | Show developer-only diagnostics and Pi debug controls. | `localStorage` (`ensemblr_pref_exp_developer_mode`). |
| Auto-run after setup | Start a repo's run script automatically after setup when no repo override exists. | `config.json` (`app.experimental.autoRunAfterSetup`). |

### Shortcuts

Read-only reference of every registered shortcut, rendered from the shared
keymap. `ShortcutDef` carries bindings only — the display name of a shortcut is
a renderer catalogue key looked up by shortcut id, which is what let this screen
be localized at all.

### Advanced — removed (#248)

The page no longer exists. Its rows moved as follows; where a row was a false
affordance before the move, it still is, and that is recorded on its new page
rather than here.

| Former Advanced row | Now on | Component |
| --- | --- | --- |
| Ensemblr root directory | **General** | `settings/root-directory-row.tsx` |
| Terminal scrollback limit | **Appearance** | `settings/terminal-scrollback-row.tsx` |
| Pi executable path | **Providers**, as the per-runtime executable row | `settings/agent-providers/provider-executable-row.tsx` |
| SSH private key path | Nowhere — deferred with cloud/remote workspaces (ADR 0020) | — |

Note: "Set upstream on plain `git push`" lives on the **Git** page
(`app.git.setUpstreamOnPush`), and never lived on Advanced.

## Repository Settings Sections

The repo scope has six pages (`settings-sidebar.tsx` `repoNav`): **Environment,
Git, Scripts, Actions, Security, Misc**. Repo Git/Actions/Misc personal overrides live in
`localStorage` (`repoSettingsOverrideAtomFamily`, key
`ensemblr_pref_repo_override_<repoId>`); Scripts has no personal layer — it reads
and writes the committed `.ensemblr/settings.toml` directly (ADR 0041).
Resolved values come from the committed `.ensemblr/settings.toml` and SQLite
through `useRepoSettings`. Action preferences are the only localStorage repo
overrides currently consumed by runtime; the other local-only controls remain
false affordances. Git/Actions/Misc rows show a `SourceBadge`; the Scripts screen
does not, because every value there comes from one file.

### Environment (repo)

Repo-scoped environment-variable CRUD (`repo/$repoId/environment.tsx`), same
panel as the user-scope Environment page but keyed to the repository scope.

### Git (repo)

| Setting | Behavior | Storage |
| --- | --- | --- |
| Branch new workspaces from | Intended base ref for new workspace branches (`branchFrom`); the current control is not consumed by workspace creation. | localStorage screen value only. |
| Remote origin | Intended remote for push/pull/PR (`remoteOrigin`); the current control is not consumed by runtime Git operations. | localStorage screen value only. |
| Delete branch on archive | Read-only here; canonical SQLite rows, app defaults, and built-ins resolve into archive behavior. | Resolved value; no repository editor in the screen. |
| Archive on merge | Read-only here; canonical SQLite rows, app defaults, and built-ins resolve into merge behavior. | Resolved value; no repository editor in the screen. |

The TOML parser preserves `[git]` child keys such as `branch_prefix` in nested
snake_case form. Those keys do not currently become the canonical top-level
resolver keys used by the screen and runtime.

### Scripts

| Setting | Behavior | Storage |
| --- | --- | --- |
| Setup script | Runs when a workspace is created or manually rerun; auto-skipped when the dependency fingerprint is unchanged (ADR 0034). | `[scripts] setup` in `.ensemblr/settings.toml`. |
| Run scripts | Named shortcuts behind the terminal dock's Run button. | `[scripts.run.<name>]` tables in `.ensemblr/settings.toml`. |
| Run mode | Concurrent / nonconcurrent run behavior. | `[scripts] run_mode` in `.ensemblr/settings.toml`. |
| Auto-run after setup | Start the run script automatically once setup completes. | `[scripts] auto_run_after_setup` in `.ensemblr/settings.toml`. |
| Archive script | Runs before archive. | `[scripts] archive` in `.ensemblr/settings.toml`. |

The Scripts form debounces writes through IPC and rewrites the repository root's
committed `.ensemblr/settings.toml` (ADR 0041) — there is no personal SQLite
layer for scripts, and legacy rows were migrated into the file once. The rewrite
preserves other sections by value but not their comments, and refuses to touch a
file that does not parse. Running still resolves from the workspace worktree, so
the screen flags a workspace whose branch commits different scripts.

### Actions

Spotlight testing plus per-action agent-preference text (`repo/$repoId/actions.tsx`,
`REPO_ACTION_KEYS`).

| Setting | Behavior | Storage |
| --- | --- | --- |
| Use spotlight testing | Intended to replace Run with Spotlight for the repository; no runtime consumer exists yet. | localStorage screen value only; `[spotlight_testing]` parses but is not consumed. |
| Code review / Create PR / Fix errors / Resolve conflicts / Branch rename / General preferences | Custom Pi instructions for each workspace action. The action runner appends the matching personal preference to the generated prompt, writes it as a workspace attachment, and submits it. | localStorage personal override, consumed at runtime. Shared `[prompts]` TOML values parse as `prompts.*` but are not merged into this path. |

### Security (repo)

New in #248 (`repo/$repoId/security.tsx`). Holds one row.

| Setting | Behavior | Storage |
| --- | --- | --- |
| Workspace permission mode | The mode agent-control checks before every write op — read-only, approval-required, or workspace-trusted (ADR 0016). Resolved and saved under the resolver's `security.permissionMode` key, with a reset back to the inherited value. | Repository config through the settings resolver. |

### Misc

Identity/paths, preview URLs, files-to-copy, and repository removal
(`repo/$repoId/misc.tsx`).

| Setting | Behavior | Storage |
| --- | --- | --- |
| Root path | Path to the managed or adopted repository (read-only). | SQLite only. |
| Workspaces path | Path to workspaces under the Ensemblr/shared root (read-only). | SQLite only. |
| Preview URLs | Multi-row templates; support `$ENSEMBLR_WORKSPACE_NAME` and `$ENSEMBLR_PORT`, but the current Open button uses terminal-output auto-detection and ignores these values. | localStorage screen value only. |
| Files to copy | gitignore-style globs copied into new worktrees. Runtime reads `.worktreeinclude` or `.ensemblr/settings.toml`; the current textarea does not write either source. | Runtime repository files plus a disconnected localStorage screen value. |
| Remove repository | Remove from app records via a confirm dialog; the handler runs `archiveRepository` under the hood. | SQLite lifecycle. |

Although `filesToCopy` can appear in the generic settings-resolution snapshot,
the create-workspace copy service reads repository files directly and does not
consume a personal SQLite row.

## Configuration Precedence

For repository behavior, resolve each key with this precedence (highest to lowest; see ADR 0030):

1. `.worktreeinclude` for files-to-copy patterns.
2. The committed `.ensemblr/settings.toml` at the repository root.
3. Personal repository settings in SQLite (edited via the Git and Misc settings screens; scripts no longer have this layer, per ADR 0041).
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
> launch (removing them only after a successful write). Developer Mode and
> Terminal scrollback still persist only to `localStorage`. Pi executable Browse
> writes SQLite, while its text/clear UI remains a disconnected localStorage
> mirror. Repo Git/Actions/Misc personal overrides live in `localStorage`; Scripts
> settings live only in the committed `.ensemblr/settings.toml`, which the
> Scripts screen writes. The committed file also holds shared repo defaults.

## Open Settings Questions

- Resolved (pi 0.79.1): plan mode is extension-only, fast mode and browser control have no core support, personality has no Pi concept — all dropped from the Models settings screen. Review-model separation is supported via a separate spawned session with its own `--model`.
- Resolved 2026-07-28 (#184): plan mode ships as a **per-chat toggle (⌥⇧P), not a setting**. There is still no "Default plan mode" row on Models. Pi enforcement runs through the shipped extension's `tool_call` hook against the shared classifier in `src/shared/plan-mode/`; Claude Code uses its own native plan mode (ADR 0042, decision 3).
- Resolved 2026-08-07 (#226, ADR 0042): the Providers screen is back, now scoped to agent runtimes rather than model providers. Model/thinking defaults on **Models** stay app-wide; per-runtime executable, readiness, accounts, and settings-file location live on **Providers**.
- No active settings product question remains from the 2026-08-08 refresh. Known implementation gaps are tracked in `settings-wiring-review-2026-07-14.md`; new settings work should update both documents when a value moves between `config.json`, SQLite, localStorage, repository config, or Keychain.
