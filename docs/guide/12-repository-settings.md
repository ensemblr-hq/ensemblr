# 12. Repository settings — `.ensemblr/settings.toml`

`.ensemblr/settings.toml` at the root of a repository is the single committed
file Ensemblr reads for per-repository configuration. It is TOML, it is checked
in, and it is reviewed like code — everyone who clones the repository gets the
same setup script, the same run scripts, the same branch defaults.

It is the *only* repository config file Ensemblr reads. Config files from other
workspace managers left on disk are silently ignored. Background:
[ADR 0030](../adr/0030-use-ensemblr-settings-toml-as-sole-repository-config.md).

Because every workspace is a git worktree, the file is read from the **active
workspace's worktree**, not the primary clone. A branch that edits
`.ensemblr/settings.toml` changes behaviour for the workspace on that branch and
nowhere else.

---

## Layering: the file versus your personal settings

Repository settings resolve per key. Highest wins:

| Precedence | Source | Notes |
| --- | --- | --- |
| 1 | `.worktreeinclude` | Files-to-copy patterns only |
| 2 | **`.ensemblr/settings.toml`** | The committed file — this page |
| 3 | Personal settings | Rows you edit in the Repo settings panes, stored locally |
| 4 | User defaults | Your `~/.config/ensemblr/config.json` |
| 5 | Built-in defaults | What ships with Ensemblr |

**The committed file outranks your personal settings.** When both define the
same key, the committed value wins and your personal edit is stored but
shadowed — several Repo settings panes say so inline. Keys the file omits fall
through to your personal rows, then your user defaults, then the built-in
default. See [11. App settings](./11-app-settings.md) for the user-scope side.

`.worktreeinclude` is a separate, generic files-to-copy list, kept for
compatibility with tooling that already uses it. When present, its patterns win
over `file_include_globs` below.

---

## Diagnostics

Ensemblr never silently drops a config file over one bad key. A key it does not
recognise, or a value of the wrong type, becomes a **warning diagnostic** naming
the exact path (`$.git.branch_prefix`, `$.scripts.run.dev.icon`) and is skipped;
everything else in the file still loads.

The same holds inside a single run script: a mistyped `icon`, `default`, or
`available_in` costs you that field only, and the script still launches with the
default for it. **Only a missing or empty `command` drops an entry.**

One exception runs the other way: a file that does not *parse* at all is never
overwritten by the Scripts pane. The write fails, surfaces an error, and leaves
your file byte-for-byte intact.

---

## Top-level keys

| Key | Type | What it does |
| --- | --- | --- |
| `environment_variables` | table | Repository-scoped environment variables, passed to agent sessions, scripts, and terminals. |
| `file_include_globs` | array of strings | Gitignore-style patterns for files copied into every new workspace. Defaults to `[".env*"]`. |
| `claude_executable_path` | string | Executable override for the Claude Code harness. |
| `codex_executable_path` | string | Executable override for the OpenAI Codex harness. |
| `gemini_executable_path` | string | Executable override for the Gemini harness. |
| `opencode_executable_path` | string | Executable override for the opencode harness. Also accepted as `open_code_executable_path`. |
| `amp_executable_path` | string | Executable override for the Amp harness. |
| `copilot_executable_path` | string | Executable override for the Copilot harness. |
| `pi_executable_path` | string | Executable override for Pi. |
| `enterprise_data_privacy` | boolean | Accepted and validated; see below. |
| `spotlight_testing` | table | Accepted and validated; see below. |

Blocks — `[git]`, `[scripts]`, `[scripts.run.<name>]`, `[prompts]` — are
documented in their own sections below.

### Keys that are accepted but do nothing

Some keys parse and type-check without changing any behaviour. Ensemblr accepts
them so a file carrying one still loads cleanly, but **nothing reads the value**:

| Key | Type it must be | Status |
| --- | --- | --- |
| `enterprise_data_privacy` | boolean | Accepted, validated, inert |
| `spotlight_testing` | table | Accepted, validated, inert |
| `claude_executable_path` | string | Accepted, validated, inert |
| `codex_executable_path` | string | Accepted, validated, inert |
| `gemini_executable_path` | string | Accepted, validated, inert |
| `opencode_executable_path` / `open_code_executable_path` | string | Accepted, validated, inert |
| `amp_executable_path` | string | Accepted, validated, inert |
| `copilot_executable_path` | string | Accepted, validated, inert |
| `pi_executable_path` | string | Accepted, validated, inert |

If you find one of these in a real repository, it is not doing what its name
suggests. A wrong type still produces a diagnostic, so the file will tell you
you got the type wrong for a key that has no effect either way.

To actually pin the executable a runtime uses, set it in **Settings → Providers**
— see [11. App settings](./11-app-settings.md). That override applies app-wide,
not per repository.

---

## `[git]`

Per-repository git defaults. Each one overrides the matching user-scope Git
setting for this repository.

| Key | Type | What it does |
| --- | --- | --- |
| `branch_from` | string | The branch new workspaces fork from. |
| `branch_prefix` | string | Prefix for new workspace branch names. |
| `remote_origin` | string | The remote Ensemblr treats as origin. |
| `delete_local_branch_on_archive` | boolean | Delete the local branch when a workspace is archived. The remote branch is untouched. |
| `archive_after_merge` | boolean | Archive a workspace automatically once its pull request merges. |
| `set_upstream_on_push` | boolean | Configure new workspaces so a plain `git push` sets the branch upstream. |

**Historical spelling.** `branchPrefix` in camelCase is still accepted as an
alias for `branch_prefix`, so configs written before the snake_case convention
keep resolving. It is the only camelCase `[git]` key accepted — the other five
must be snake_case.

```toml
[git]
branch_from = "develop"
branch_prefix = "feat/"
delete_local_branch_on_archive = true
archive_after_merge = true
set_upstream_on_push = true
```

Branch and workspace mechanics: [5. Workspaces](./05-workspaces.md).

---

## `[scripts]`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `setup` | string | unset | Runs when a new workspace is created. |
| `archive` | string | unset | Runs before a workspace is archived. |
| `run` | string *or* table | unset | Either the legacy single run command, or the `[scripts.run.<name>]` tables below. |
| `run_mode` | string | `concurrent` | Whether run scripts may run in parallel across workspaces. |
| `auto_run_after_setup` | boolean | `false` | Start the default run script automatically once setup exits 0. |

`run_mode` takes exactly two values, with no hyphen:

| Value | Behaviour |
| --- | --- |
| `concurrent` | Run scripts may run in several workspaces at once. |
| `nonconcurrent` | Only one run script runs at a time. |

**An unrecognised value falls back to `concurrent`** rather than failing. A
non-string value produces a diagnostic and also leaves the default in place.

```toml
[scripts]
setup = "npm ci"
archive = "rm -rf node_modules"
run_mode = "nonconcurrent"
auto_run_after_setup = true
```

The Scripts pane in Repo settings reads and writes this block — see
[Editing from the app](#editing-from-the-app) below.

---

## `[scripts.run.<name>]`

Each table declares one named run script. The table name is the script's name;
`dev-server` renders in the UI as `Dev server`.

| Key | Type | Required | Default | What it does |
| --- | --- | --- | --- | --- |
| `command` | string | **Yes** | — | The shell command to run. |
| `icon` | string | No | `play` | One of the curated icon names below. |
| `default` | boolean | No | `false` | Marks this script as the one `⌘R` and the Run button start. |
| `available_in` | array of strings | No | unset | Environments the script is offered in. |

**`command` is the one field a script cannot do without.** An entry with no
`command`, or an empty one, is dropped entirely and reported as a diagnostic.
Every other field degrades: a bad `icon` falls back to `play`, a bad `default`
is treated as `false`, a bad `available_in` is treated as undeclared. One bad
field never hides an otherwise launchable script.

**`default` is exclusive.** At most one script keeps it. If a second table also
sets `default = true`, that second one is rejected with a diagnostic and loaded
with `default = false` — the first declared default wins. When no script sets
it, the first declared script is used.

**Duplicate names are first-wins.** A second table with a name already taken is
dropped with a diagnostic.

**`available_in` filters, it does not fail.** The key also names cloud
sandboxes; Ensemblr is local-only, so the only value it launches is `local`. A
script that omits `available_in` is available. A script that declares it without
`local` is filtered out of the Run menu — it is marked `Not available locally`
in the Scripts pane rather than offered and failed at launch.

### Icon names

There are **57** curated icon names. The list is closed so that a committed
config can never reference an icon that fails to render. Anything outside it
falls back to the default, **`play`**.

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

Before named run scripts, a repository declared one command:

```toml
[scripts]
run = "npm run dev"
```

That form still works. It is upgraded into a single implicit script:

| Field | Value it gets |
| --- | --- |
| Name | `run` |
| `command` | The string you wrote |
| `icon` | `play` |
| `default` | `true` |
| `available_in` | unset (available everywhere) |

The upgrade applies **only when no `[scripts.run.<name>]` tables exist**. If the
file has both, the named tables win and the legacy string is ignored.

Run scripts in use: [7. Terminals and run scripts](./07-terminals-and-run-scripts.md).

---

## `[prompts]`

Team-shared custom instructions attached to the workspace action buttons. Each
value is a string. A personal preference typed into the Repo → Actions pane wins
over the committed text for you only; clearing yours falls back to the shared
text.

| Canonical key | Accepted aliases | Applies to |
| --- | --- | --- |
| `code_review` | `review`, `codeReview` | The **Review** button |
| `create_pr` | `createPr` | The **Create PR** button |
| `fix_errors` | `fix_check_errors`, `fixCheckErrors`, `fixErrors` | The **Fix errors** button |
| `resolve_conflicts` | `resolveConflicts` | The **Resolve conflicts** button |
| `branch_rename` | `branch_naming`, `branchNaming`, `branchRename` | Branch-name generation |
| `general` | — | A master prompt prepended to the first message of every new chat in the repository |

Prefer the canonical snake_case spelling. The aliases exist so files written
before the convention settled keep resolving; they are not deprecated warnings,
they simply resolve to the same setting.

```toml
[prompts]
code_review = "Check migrations against the schema in docs/ before approving."
create_pr = "Always include a test plan section."
general = "This repo targets Node 24. Never suggest a Node 22 API."
```

The action buttons themselves: [8. Reviewing changes](./08-reviewing-changes.md).

---

## A worked example

This is Ensemblr's own committed `.ensemblr/settings.toml`, verbatim:

```toml
[scripts]
setup = "npm ci"

# Electron dev server. Node 24 is pinned by scripts/require-node-version.mjs, so
# every command goes through the wrapper — non-interactive shells never activate
# mise on their own.
[scripts.run.dev]
command = "./scripts/with-pinned-node.sh npm run dev"
icon = "play"
default = true
available_in = ["local"]

[scripts.run.checks]
command = "./scripts/with-pinned-node.sh npm run check && ./scripts/with-pinned-node.sh npm run typecheck"
icon = "list-checks"
available_in = ["local"]

[scripts.run.test]
command = "./scripts/with-pinned-node.sh npm test"
icon = "test-tube"
available_in = ["local"]

[scripts.run.playground]
command = "./scripts/with-pinned-node.sh npm run dev:playground"
icon = "play"
available_in = ["local"]

[scripts.run.unsigned]
command = "./scripts/with-pinned-node.sh npm run make:unsigned && open out"
icon = "package"
available_in = ["local"]
```

Reading it line by line:

- **`[scripts] setup = "npm ci"`** — every new workspace runs `npm ci` on
  creation. No `archive` script, so nothing runs on the way out.
- **No `run_mode`**, so it falls back to `concurrent`: several workspaces can run
  their dev server at the same time, each on its own `ENSEMBLR_PORT`.
- **No `auto_run_after_setup`**, so it falls back to `false`: after `npm ci`
  finishes, nothing starts on its own.
- **Five named run scripts**, so the Run menu offers five entries rather than
  one. They appear in declaration order: Dev, Checks, Test, Playground,
  Unsigned.
- **`[scripts.run.dev]` carries `default = true`** — it is what `⌘R` and the
  Run button start. No other table sets `default`, so there is no conflict to
  resolve.
- **Icons** are drawn from the curated set: `play` for the two servers,
  `list-checks` for the lint/typecheck pair, `test-tube` for the suite, and
  `package` for the build.
- **Every script declares `available_in = ["local"]`** — explicit rather than
  omitted. Same effect here, since `local` is the only environment Ensemblr
  launches, but it documents intent.
- **The comment above `[scripts.run.dev]`** explains why every command is
  wrapped rather than calling `npm` directly. Note that this comment does not
  survive a save from the Scripts pane.
- **No `[git]`, `[prompts]`, `environment_variables`, or
  `file_include_globs`** — those all fall through to personal settings, then to
  user defaults. `file_include_globs` therefore resolves to its built-in
  `[".env*"]`.

---

## Editing from the app

**Repo settings → Scripts** reads and writes this file directly. It is the sole
store for script settings — there is no shadow copy elsewhere.

What that means in practice:

- Saving on the Scripts pane rewrites `.ensemblr/settings.toml`. Every other
  section survives by value; the write is atomic (temp file plus rename).
- **Comments and blank-line grouping are lost** on a save. The rewrite emits
  scalars ahead of sub-tables and no comments at all. If your file's comments
  matter, edit it by hand instead.
- A file that does not parse is never overwritten. The save fails with an error
  and your file is untouched.
- If the workspace you have open commits different scripts on its branch, the
  pane tells you so — it runs the branch's version. Merge the file to change
  what it runs.

Every other Repo settings pane — Environment, Git, Actions, Security, Misc —
writes personal rows that never touch this file. Background:
[ADR 0041](../adr/0041-write-repository-scripts-to-ensemblr-settings-toml.md).

---

← [11. App settings](./11-app-settings.md) ·
[Guide index](./README.md) ·
[13. Keyboard shortcuts](./13-keyboard-shortcuts.md) →
