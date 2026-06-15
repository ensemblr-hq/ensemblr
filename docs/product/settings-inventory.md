# Settings Inventory

Date: 2026-06-04

This inventory comes from the settings screenshots plus accepted ADRs. It separates app-wide settings from repository settings and assigns each setting to the right persistence layer.

## Storage Legend

| Store | Use for |
| --- | --- |
| SQLite | Mutable local app state, personal overrides, cached integration status, UI preferences, workspace/repository records. |
| `~/.config/ensemble/config.json` | Declarative user defaults, managed policy-like settings, keybinding/UI defaults, repository matching rules. |
| Repository config | Shared project behavior in `ensemble.json`, with `conductor.json` compatibility. Use for scripts, run mode, files-to-copy, and team-shared repository defaults. |
| Pi user environment | Pi auth, models, provider settings, skills, extensions, prompts, themes, sessions, and project `.pi` resources. Ensemble should not duplicate this as source of truth. |
| macOS Keychain | Secret values such as tokens/API keys. SQLite may keep metadata only. |

## App Settings Sections

### General

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Sync agent configs | Similar concept, provider-specific. | Inspect/sync Pi resources where supported; avoid mutating `~/.pi/agent` without explicit user action. | Action/log in SQLite; Pi environment remains source of truth. |
| Send-message shortcut | Direct. | Same behavior for Pi composer. | SQLite with optional config default. |
| Follow-up behavior | Direct. | Map to Pi steering/queue behavior. | SQLite with optional config default. |
| Desktop notifications | Direct. | Notify when Pi turn/session completes or fails. | SQLite; OS permission external. |
| Completion sound | Direct. | Same, using Ensemble sound assets. | SQLite with optional config default. |
| Auto-convert long pasted text | Direct. | Same, producing Ensemble/Pi attachments. | SQLite with optional config default. |
| Remove/soften AI certainty phrase | Direct as a Conductor-specific toggle. | Resolved (ENS-069): ship as a v1 General toggle that injects a prompt preset at chat start. No output post-processing. | SQLite with optional config default. |
| Always show context usage | Direct. | Show Pi context/token usage when SDK provides it. | SQLite with optional config default. |
| Caffeinate while agents run | Direct. | Prevent sleep during active Pi sessions/scripts. | SQLite with optional config default. |
| Show MCP/resource status in chat | Direct. | Show Pi resource/MCP/tool status in composer. | SQLite with optional config default. |
| Expand tool calls by default | Direct. | Same for Pi tool calls. | SQLite with optional config default. |

### Models

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Default chat model | Direct concept. | Pi model id for new chats; bound to the runtime via the `--model` spawn flag. | `atomWithStorage` (`default_chat_model`). |
| Default thinking level | Direct concept. | Pi thinking level for new chats; bound via `--thinking`. | `atomWithStorage` (`default_chat_thinking`). |
| Review model + thinking | Direct concept. | Separate model/thinking for the workspace Review action. | `atomWithStorage` (`review_model`, `review_thinking`). |
| Favourite models | n/a (Ensemble). | Star models in the composer picker to pin them to a top "Favourites" group with the low 1-9 shortcuts. App-wide, shared across all workspaces. | `atomWithStorage` (`favourite_models`, string[]). |
| Model catalog cache | n/a (Ensemble). | Last non-empty `pi --list-models` result cached so the picker is populated instantly on launch; refreshed silently in the background. | `localStorage` (`pi_models_snapshot`). |

Removed (Pi has no out-of-the-box support — verified against pi 0.79.1 docs and `/earendil-works/pi`): **Personality/style** (no core concept; was an Ensemble prompt preset only), **Default plan mode** (`--plan` exists only as an optional extension), **Default fast mode** (no such concept), **Browser-control integration** (no core support). The per-chat model/thinking selection resolves as: per-chat override → Settings default → Pi-reported default → first available model.

### Providers

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Provider readiness | Direct concept. | Pi executable/RPC/provider/model readiness. | SQLite cache; Pi environment source of truth. |
| Auth method | Direct concept. | Pi auth mechanism; likely inherited from Pi environment. | Pi environment; Ensemble metadata in SQLite. |
| Provider metadata | Direct concept. | Show account/provider readiness without exposing sensitive details. | SQLite cache only. |
| Provider settings file | Direct concept. | Open Pi agent/settings resources where appropriate. | Pi environment. |
| Login/remediation command | Direct concept. | Pi-specific auth/remediation command or instructions. | Built-in docs/action log. |

### Environment

| Setting | Conductor mapping | Ensemble adaptation | Storage |
| --- | --- | --- | --- |
| Global env variable catalog | Direct. | Pi-relevant documented variables plus generic script/tool variables. | Built-in catalog; user values separate. |
| Non-secret variable values | Direct. | Passed to Pi sessions, scripts, and terminals. | SQLite; optional config defaults. |
| Secret variable values | Direct. | Hidden/masked, passed only to processes that need them. | macOS Keychain; SQLite metadata. |
| Set/unset status | Direct. | Same. | SQLite metadata/cache. |
| Per-variable add/edit action | Direct. | Same. | SQLite/protected store. |

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
2. User-selected settings in SQLite.
3. Declarative defaults from `~/.config/ensemble/config.json`.
4. Built-in defaults.
5. Pi user environment for Pi-specific resources and auth.

## Open Settings Questions

- Resolved (pi 0.79.1): plan mode is extension-only, fast mode and browser control have no core support, personality has no Pi concept — all dropped from the Models settings screen. Review-model separation is supported via a separate spawned session with its own `--model`.
- Which non-deferred experimental features are v1 parity requirements versus post-core flags?
