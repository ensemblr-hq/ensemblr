# Settings Inventory

Date: 2026-06-04

This inventory comes from the settings screenshots plus accepted ADRs. It separates app-wide settings from repository settings and assigns each setting to the right persistence layer.

## Storage Legend

| Store | Use for |
| --- | --- |
| SQLite | Mutable local app state, personal overrides, cached integration status, workspace/repository records. |
| `~/.config/ensemble/config.json` | **Source of truth for App settings** — General and Models are implemented under `app.general.*` / `app.models.*` (see ADR 0029) — plus declarative user defaults, managed policy-like settings, and repository matching rules. Created on first run; live-watched for external edits. |
| `localStorage` (`atomWithStorage`) | Non-Settings-page UI state, app preferences not yet migrated to `config.json` (theme, fonts, Git/Experimental/Advanced toggles), composer favourites, and the model-catalog cache. |
| Repository config | Shared project behavior in `ensemble.json`, with `conductor.json` compatibility. Use for scripts, run mode, files-to-copy, and team-shared repository defaults. |
| Pi user environment | Pi auth, models, provider settings, skills, extensions, prompts, themes, sessions, and project `.pi` resources. Ensemble should not duplicate this as source of truth. |
| macOS Keychain | Secret values such as tokens/API keys. SQLite may keep metadata only. |

## App Settings Sections

### General

Source of truth: `~/.config/ensemble/config.json` under `app.general.*`. The
renderer hydrates from it on launch, writes section-scoped patches back through
IPC, and live-reloads when the file is edited externally (see ADR 0029).

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Sync agent configs | Similar concept, provider-specific. | Inspect/sync Pi resources where supported; avoid mutating `~/.pi/agent` without explicit user action. | Action/log in SQLite; Pi environment remains source of truth. |
| Send-message shortcut | Direct. | Same behavior for Pi composer. | `config.json` (`app.general.sendShortcut`). |
| Follow-up behavior | Direct. | Map to Pi steering/queue behavior. | `config.json` (`app.general.followUpBehavior`). |
| Desktop notifications | Direct. | Notify when Pi turn/session completes or fails. | `config.json` (`app.general.desktopNotifications`); OS permission external. |
| Auto-convert long pasted text | Direct. | Same, producing Ensemble/Pi attachments. | `config.json` (`app.general.autoConvertLongText`). |
| Always show context usage | Direct. | Show Pi context/token usage when SDK provides it. | `config.json` (`app.general.alwaysShowContextUsage`). |
| Caffeinate while agents run | Direct. | Prevent sleep during active Pi sessions/scripts. | `config.json` (`app.general.caffeinateWhileRunning`). |
| Expand tool calls by default | Direct. | Same for Pi tool calls. | `config.json` (`app.general.toolCallCollapse`). |

Removed entirely: **Soften AI certainty** and **Show MCP status in chat**. Both
were toggles with no functional consumer (planned but never wired), so their
atoms were dropped; they are not user-configurable and not stored in
`config.json`.

### Models

Source of truth: `~/.config/ensemble/config.json` under `app.models.*` (same
sync/live-reload path as General; see ADR 0029). Favourites and the catalog
cache stay in `localStorage` — they're set outside the Settings page (composer
star) or are derived runtime cache, not user settings.

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Default chat model | Direct concept. | Pi model id for new chats; bound to the runtime via the `--model` spawn flag. | `config.json` (`app.models.defaultModel`). |
| Default thinking level | Direct concept. | Pi thinking level for new chats; bound via `--thinking`. | `config.json` (`app.models.defaultThinkingLevel`). |
| Review model + thinking | Direct concept. | Separate model/thinking for the workspace Review action. | `config.json` (`app.models.reviewModel`, `app.models.reviewThinkingLevel`). |
| Hidden models | n/a (Ensemble). | Toggle models off in Settings → Models so they drop out of the composer picker. Inverse storage (records hidden ids); hiding never changes the active/default model. | `config.json` (`app.models.hiddenModels`, string[]). |
| Favourite models | n/a (Ensemble). | Star models in the composer picker to pin them to a top "Favourites" group with the low 1-9 shortcuts. App-wide, shared across all workspaces. | `atomWithStorage` (`favourite_models`, string[]). |
| Model catalog cache | n/a (Ensemble). | Last non-empty `pi --list-models` result cached so the picker is populated instantly on launch; refreshed silently in the background. | `localStorage` (`pi_models_snapshot`). |

Removed (Pi has no out-of-the-box support — verified against pi 0.79.1 docs and `/earendil-works/pi`): **Personality/style** (no core concept; was an Ensemble prompt preset only), **Default plan mode** (`--plan` exists only as an optional extension), **Default fast mode** (no such concept), **Browser-control integration** (no core support). The per-chat model/thinking selection resolves as: per-chat override → Settings default → Pi-reported default → first available model.

### Providers

**Removed.** The standalone Providers screen (route, sidebar entry, and command-palette
entry) was deleted. Provider/auth setup is owned by Pi itself — Ensemble does not store
provider tokens or duplicate Pi's provider configuration. The readiness checks that screen
surfaced (Pi runtime, Pi model provider, GitHub CLI) still live in **Diagnostics**, sourced
from the setup-diagnostics gate.

### Environment

**Status: implemented** — fully editable CRUD on a per-scope environment store, wired end to
end (renderer → IPC → `EnvironmentVariablesService` → SQLite/Keychain) and injected into Pi
sessions, scripts, and terminals at session launch via `assembleEnvironment` (app →
repository → workspace precedence). The earlier "read-only / manage via Keychain or shell
profile" copy was a hallucination and has been replaced.

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Documented variable catalog | Direct. | Pi-relevant documented variables only (`PI_CODING_AGENT_DIR`, `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`, the 8 provider API keys, `DEBUG`, `CI`). No Claude Code/Codex/Cursor catalog entries. Shown in a collapsible "Show documented variables (N)" list with a `+` to set each. | Built-in catalog; user values separate. |
| Non-secret variable values | Direct. | Passed to Pi sessions, scripts, and terminals. | SQLite (`settings` table, `environment.variables.*`); optional `config.json` defaults. |
| Secret variable values | Direct. | Auto-classified: a known secret catalog key or sensitive-named key routes to the secret store; everything else is plain. Masked in the list; the eye toggle reveals the real value on demand (plain from SQLite, secret read back from Keychain). | macOS Keychain; SQLite metadata. |
| Set/unset status | Direct. | Configured variables (`set`/`masked`) render as editable rows; reserved runtime vars (`ENSEMBLE_*`/`CONDUCTOR_*`) are excluded. | SQLite metadata/cache. |
| Add / edit / delete variable | Direct. | Right slide-over (Name + Value). Custom adds and edits require a value; documented adds may set an empty string. Name is locked when the key is preset (documented add or edit). | SQLite / secret store. |
| Env files | Direct (Conductor "Env files"). | Load `KEY=value` files from disk at session launch (lowest precedence within a scope, so explicit vars win; reserved keys skipped). Native file picker. **User (app) scope only for now**; storage is per-scope so repository scope is a later no-op. | Ordered path list in SQLite (`settings` table, `environment.files`); file contents read at assembly time. |

### Appearance

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Theme | Direct. | Ensemble-specific themes. | SQLite/config. |
| Colored sidebar diffs | Direct. | Same. | SQLite/config. |
| Accessible colors | Direct. | Ensemble accessibility palette variants. | SQLite/config. |
| Code theme | Direct. | Ensemble code/diff highlighting theme. | SQLite/config. |
| Mono font | Direct. | Font for code, diffs, and inline code. | SQLite/config. |
| Code ligatures | Direct. | Same. | SQLite/config. |
| Markdown style | Direct. | Ensemble markdown rendering preset. | SQLite/config. |
| Terminal font | Direct. | xterm.js font family. | SQLite/config. |
| Terminal font size | Direct. | xterm.js font size. | SQLite/config. |

### Git

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Branch name prefix | Direct. | Prefix new workspace branches; support detected GitHub username, custom, or none. | SQLite/config. |
| Rename workspace when branch is named | Direct. | Same for placeholder workspace names. | SQLite/config. |
| Delete local branch on archive | Direct. | Same with explicit confirmation where needed. | SQLite/config. |
| Archive on merge | Direct. | Same after successful `gh pr merge`. | SQLite/config. |
| Automerge affordance | Direct. | Show automerge action when GitHub/repo supports it. | SQLite/config; GitHub state cache. |

### Account and Integrations

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| App account identity | Direct in Conductor. | Deferred for v1; Ensemble is local-first. | Not applicable in v1. |
| Linear integration | Direct. | First-class v1 integration with OAuth login, issue CRUD, and workspace creation from issues. | Tokens in Keychain; connection/cache metadata in SQLite. |
| GitHub CLI integration | Direct. | Required `gh auth status` for v1. | SQLite cache; `gh` config external source. |
| GitHub token field | Direct. | Do not implement in Ensemble; GitHub access uses authenticated `gh`, including `gh api`. | Not applicable. |
| Enterprise data privacy | Direct. | Same concept, adapted to Pi and external-provider features. | SQLite/config; repo override in repository config. |
| Tool approvals | Direct concept. | Ensemble permission mode mapped to Pi CLI/RPC tool allow/exclude controls where available. | SQLite/config; repo policy override possible. |
| Sign out | Direct if cloud account exists. | Deferred unless a future Ensemble account exists. | Not applicable in v1. |

### Experimental

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Big terminal mode | Direct. | Resolved (ENS-068): provided by the terminal dock; no separate flag. | n/a |
| Many chat/terminal tabs per workspace | Direct. | Resolved by ADR 0022 at five tabs; no toggle. | n/a |
| Dashboard/workspace sidebar visibility | Direct. | Resolved (ENS-068): v1 user-scope flags `Dashboard`, `Sidebar chats`, `Auto-run after setup`, `In-app browser preview`. | SQLite/config. |
| Voice mode | Direct. | Deferred until after core completion. | Future feature flag. |
| Sidebar resource usage | Direct. | Resolved (ENS-068): toggle ships in v1 user-scope Experimental settings; the CPU/memory sampler is post-core (follow-up ticket). | SQLite/config; sampler service post-core. |
| Graphite stack support | Direct. | Deferred until after core completion. | Future integration flag. |
| React profiler | Direct developer feature. | Development/internal diagnostics only; not a normal v1 production setting. | Internal debug flag. |

### Advanced

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Root directory | Direct. | Ensemble root with optional Conductor shared-root interoperability. | SQLite current value; config override/default. |
| Agent executable paths | Direct concept. | Auto-discovered Pi-compatible executable with explicit override for `pi`, wrapper scripts, or alternate launchers such as `oh-my-pi`. | SQLite/config. |
| SSH private key path | Direct concept for cloud/remote access. | Deferred with cloud/remote workspace support. | Not applicable in v1. |
| Set upstream on plain git push | Direct. | Same git convenience setting. | SQLite/config. |

## Repository Settings Sections

### Repository Identity and Paths

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Repository record/name/icon | Direct. | Same, with Ensemble icon choices. | SQLite. |
| Root path | Direct. | Path to managed or adopted repository. | SQLite only. |
| Workspaces path | Direct. | Path to workspaces under Ensemble/shared root. | SQLite only. |
| Archive repository | Direct. | Lifecycle state with preserved `.context/` under `archived-contexts/`; reversible. | SQLite (`repositories.archived_at` + `archive_records`); filesystem snapshot under managed root. |
| Remove repository | Direct. | Remove from app records; deleting files, if supported, must be explicit. | SQLite lifecycle; filesystem action explicit. |

### Branch and Remote

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Branch new workspaces from | Direct. | Same. | Personal override in SQLite; shared default in repository config where appropriate. |
| Remote origin for push/pull/PR | Direct. | Same. | SQLite personal override; can infer from git. |
| Branch naming preferences | Direct. | Use global defaults plus repo overrides. | SQLite; config defaults/rules. |

### Preview URL

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Preview URL template | Direct. | Support `ENSEMBLE_*`; support `CONDUCTOR_*` compatibility variables for Conductor-compatible repos or explicit opt-in. | SQLite personal override; shared default in `ensemble.json` if added. |
| Auto-detect preview from logs | Direct concept from screenshots. | Same if implementation can detect local server URLs. | Runtime cache in SQLite. |

### Files to Copy

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Files-to-copy patterns | Direct. | Same pattern semantics; `.worktreeinclude` support required. | `.worktreeinclude`/repository config for shared; SQLite personal override. |
| Matching ignored-file preview | Direct. | Same. | Derived at runtime; not stored except cache if needed. |

### Scripts

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Setup script | Direct. | Same; runs when workspace is created or manually rerun. | Repository config for shared; SQLite personal override. |
| Run script | Direct. | Same; run button in terminal dock. | Repository config for shared; SQLite personal override. |
| Archive script | Direct. | Same; runs before archive. | Repository config for shared; SQLite personal override. |
| Run script mode | Direct from existing docs. | Same concurrent/nonconcurrent behavior. | Repository config for shared; SQLite personal override. |
| Create shared config file | Direct. | Create `ensemble.json` first; support `conductor.json` for compatibility. | Repository config. |

### Spotlight Testing

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Use spotlight testing | Direct. | Replace running app from root while testing workspace changes. | Repository config if shared; SQLite personal override. |
| Spotlight sync state | Direct concept. | Runtime state of root/workspace synchronization. | SQLite. |

### Agent Action Preferences

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Code review preferences | Direct. | Custom Pi instructions for review action. | SQLite personal override; `ensemble.json` shared if safe. |
| Create PR preferences | Direct. | Custom Pi instructions for PR action. | SQLite personal override; `ensemble.json` shared if safe. |
| Fix errors preferences | Direct. | Custom Pi instructions for fix-errors action. | SQLite personal override; `ensemble.json` shared if safe. |
| Resolve conflicts preferences | Direct. | Custom Pi instructions for conflict resolution action. | SQLite personal override; `ensemble.json` shared if safe. |
| Branch rename preferences | Direct. | Custom Pi instructions for deriving branch/workspace names. | SQLite personal override; `ensemble.json` shared if safe. |
| General preferences | Direct. | Custom Pi instructions prepended to new chats in this repository. | SQLite personal override; `ensemble.json` shared if safe. |

## Configuration Precedence

For repository behavior, use the already accepted precedence:

1. Personal repository settings in SQLite.
2. `ensemble.json` at repository root.
3. `conductor.json` at repository root.
4. Built-in defaults.

For app-wide behavior, use:

1. Locked/managed settings from `~/.config/ensemble/config.json`, if supported by schema.
2. User-selected settings in `~/.config/ensemble/config.json` (App settings already migrated — General, Models). Sections not yet migrated still read from `localStorage`.
3. Built-in defaults (the shared Zod schema fills any missing or invalid field).
4. Pi user environment for Pi-specific resources and auth.

> Migration status: General and Models are the source of truth in `config.json`.
> Other App sections (Appearance, Git, Experimental, Advanced) still persist to
> `localStorage` and will move to `config.json` in a later pass. Repo settings
> are out of scope for this change.

## Open Settings Questions

- Resolved (pi 0.79.1): plan mode is extension-only, fast mode and browser control have no core support, personality has no Pi concept — all dropped from the Models settings screen. Review-model separation is supported via a separate spawned session with its own `--model`.
- Which non-deferred experimental features are v1 parity requirements versus post-core flags?
