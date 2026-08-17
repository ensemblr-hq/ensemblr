# `.ensemblr/settings.toml` — repository settings

The one committed file Ensemblr reads for per-repository configuration. TOML,
checked in, reviewed like code: everyone who clones the repository gets the same
setup script, the same run scripts, the same branch defaults. Config files from
other workspace managers left on disk are ignored.

Because every workspace is a git worktree, the file is read from the **active
workspace's worktree**. A branch that edits it changes behaviour for the
workspace on that branch and nowhere else.

## Precedence

Resolved per key, highest wins:

1. `.worktreeinclude` — files-to-copy patterns only
2. **`.ensemblr/settings.toml`** — the committed file
3. Personal settings — rows the user edits in the Repo settings panes
4. User defaults — `~/.config/ensemblr/config.json`
5. Built-in defaults

The committed file **outranks** personal settings. Where both define a key, the
committed value wins and the personal edit is stored but shadowed.

## The schema directive

Put this on line 1 so an editor validates the file:

```toml
#:schema https://www.ensemblr.dev/schemas/settings.schema.json
```

Inside the Ensemblr repository itself, use the relative path
`../schemas/settings.schema.json` instead.

The Scripts pane drops every comment on a rewrite but reads this one directive
back and restores it. It never *adds* one, so a file that should have it must be
written by hand.

## Diagnostics

A key Ensemblr does not recognise, or a value of the wrong type, becomes a
**warning naming the exact path** (`$.git.branch_prefix`, `$.scripts.run.dev.icon`)
and is skipped — everything else in the file still loads. Ensemblr never drops a
config file over one bad key.

A file that does not *parse* is never overwritten by the Scripts pane: the write
fails, surfaces an error, and leaves the file byte-for-byte intact.

## Top-level keys

| Key | Type | What it does |
| --- | --- | --- |
| `environment_variables` | table | Repository-scoped env vars, passed to agent sessions, scripts, and terminals. Names must be valid POSIX identifiers. |
| `file_include_globs` | array of strings | Gitignore-style patterns for untracked files copied into every new workspace. Defaults to `[".env*"]`. |

**Never put a secret in `environment_variables`** — the file is committed. Link
an Infisical project, or use the Keychain-backed rows in Settings.

`.worktreeinclude` in the repository root outranks `file_include_globs`.

### Keys that are accepted but inert

These parse and type-check, and **nothing reads them**:
`enterprise_data_privacy` (boolean), `spotlight_testing` (table), and the
executable overrides `amp_executable_path`, `claude_executable_path`,
`codex_executable_path`, `copilot_executable_path`, `gemini_executable_path`,
`opencode_executable_path` (also accepted as `open_code_executable_path`), and
`pi_executable_path` (all strings).

To actually pin a runtime's executable, use **Settings → Providers**. That
override is app-wide, not per repository.

## `[scripts]`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `setup` | string | unset | Runs when a new workspace is created. |
| `archive` | string | unset | Runs before a workspace is archived. |
| `run` | string *or* table | unset | The legacy single run command, or the `[scripts.run.<name>]` tables. |
| `run_mode` | string | `concurrent` | `concurrent` or `nonconcurrent` — no hyphen. An unrecognised value falls back to `concurrent`. |
| `auto_run_after_setup` | boolean | `false` | Start the default run script once setup exits 0. |

## `[scripts.run.<name>]`

One table per named run script. The table name is the script's name;
`dev-server` renders as `Dev server`.

| Key | Type | Required | Default | What it does |
| --- | --- | --- | --- | --- |
| `command` | string | **Yes** | — | The shell command to run. |
| `icon` | string | No | `play` | One of the curated names below. |
| `default` | boolean | No | `false` | The script `⌘R` and the Run button start. |
| `available_in` | array of strings | No | unset | Environments the script is offered in. |

`command` is the one field a script cannot do without: an entry with no
`command`, or an empty one, is dropped entirely with a diagnostic. Every other
field degrades — a bad `icon` falls back to `play`, a bad `default` to `false`,
a bad `available_in` to undeclared. One bad field never hides a launchable
script.

`default` is exclusive: the first declared default wins, and a second is loaded
with `default = false` plus a diagnostic. With none declared, the first script
is used. Duplicate names are first-wins.

`available_in` filters rather than fails. Ensemblr is local-only, so `local` is
the only value it launches. Omitting the key means available; declaring it
without `local` marks the script `Not available locally`.

### Icon names

57 curated names, closed so a committed config can never reference an icon that
fails to render. Anything outside the list falls back to `play`.

```
activity          badge-check       blocks            book-open
box               bug               calculator        cloud
code              cog               component         container
cpu               database          download          eye
file-code         flame             flask-conical     folder
gauge             git-branch        git-merge         git-pull-request
globe             hammer            hard-drive        key
layers            layout-dashboard  list-checks       lock
microscope        monitor           network           package
paintbrush        palette           play              plug
refresh-cw        repeat            rocket            search
send              server            settings          shield-check
smartphone        sparkles          terminal          test-tube
timer             trending-up       upload            wrench
zap
```

### The legacy `run = "…"` form

```toml
[scripts]
run = "npm run dev"
```

Still works, upgraded into one implicit script named `run`, `icon = "play"`,
`default = true`, `available_in` unset. The upgrade applies **only when no
`[scripts.run.<name>]` tables exist** — with both present, the named tables win
and the string is ignored.

## `[git]`

Per-repository git defaults, each overriding the matching user-scope setting.

| Key | Type | What it does |
| --- | --- | --- |
| `branch_from` | string | The branch new workspaces fork from. |
| `branch_prefix` | string | Prefix for new workspace branch names. |
| `remote_origin` | string | The remote Ensemblr treats as origin. |
| `delete_local_branch_on_archive` | boolean | Delete the local branch on archive. The remote branch is untouched. |
| `archive_after_merge` | boolean | Archive a workspace once its pull request merges. |
| `set_upstream_on_push` | boolean | New workspaces set upstream on a plain `git push`. |

`branchPrefix` in camelCase is still accepted as an alias for `branch_prefix`.
It is the only camelCase `[git]` key accepted; the other five must be snake_case.

## `[prompts]`

Team-shared custom instructions attached to the workspace action buttons. A
personal preference typed into Repo → Actions wins for that user only.

| Canonical key | Aliases | Applies to |
| --- | --- | --- |
| `code_review` | `review`, `codeReview` | the **Review** button |
| `create_pr` | `createPr` | the **Create PR** button |
| `fix_errors` | `fix_check_errors`, `fixCheckErrors`, `fixErrors` | the **Fix errors** button |
| `resolve_conflicts` | `resolveConflicts` | the **Resolve conflicts** button |
| `branch_rename` | `branch_naming`, `branchNaming`, `branchRename` | branch-name generation |
| `general` | — | prepended to the first message of every new chat in the repository |

Prefer the canonical snake_case spelling; the aliases exist so older files keep
resolving.

## `[infisical]`

Which Infisical project the repository's secrets come from. Committed on
purpose — a teammate who clones is already pointed at the right secrets. **No
credential is ever written here**: the Machine Identity is per-machine state, in
SQLite with its secret in the macOS Keychain.

| Key | Type | What it does |
| --- | --- | --- |
| `project_id` | string | Required — the block is ignored without it. |
| `environment` | string | Required. The environment slug, e.g. `dev`. |
| `path` | string | Secret path within the environment. Defaults to `/`. |
| `recursive` | boolean | Also read folders nested under `path`. Defaults to `false`. |
| `site_url` | string | Instance URL, for self-hosted or EU-cloud deployments. |
| `project_name` | string | Display name, so the pane can name the project before a fetch. |

Values resolve live at every launch, so a rotated secret takes effect on the
next terminal, script, or agent started. Keys the app does not model survive a
rewrite untouched.

## `~/.config/ensemblr/config.json`

The user-scope declarative config, a JSON file carrying a matching `$schema`
key. Ensemblr writes one into the file it creates itself, so an existing config
usually has it. Top-level keys: `schemaVersion` (Ensemblr supports `1`), `app`,
`environment`, `managed`, `repositoryDefaults`, `repositoryRules`, `security`,
`ui`.

`repositoryDefaults` applies to every repository as the `user-default` source;
`repositoryRules` applies only to repositories whose path matches the rule.

## Both schemas

`schemas/settings.schema.json` and `schemas/config.schema.json` in the Ensemblr
repository describe these two files, with `schemas/README.md` covering the
canonical URLs and editor wiring. **The loader is the source of truth and the
schema mirrors it** — adding, renaming, or retyping a key updates both in the
same change, and `tests/main/published-schemas.test.ts` fails on drift.
