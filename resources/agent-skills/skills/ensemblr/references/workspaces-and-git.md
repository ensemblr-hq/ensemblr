# Workspaces, git, and the review path

## A workspace is a git worktree

Not a copy, not a snapshot — a real second checkout of the same repository,
sharing one object store. That is what lets several agents work at once without
stepping on each other, and it is the isolation boundary everything else
assumes.

Everything Ensemblr manages sits under one root directory (`~/Ensemblr` by
default): `repos/` holds one clone per project, `workspaces/` one directory per
workspace grouped by project, `archived-contexts/` the preserved `.context/`
folders of archived workspaces. The shape is managed — never rearrange it by
hand.

## Base branch vs. the branch the workspace owns

Two different things, and mixing them up is the most common misreading of the
app.

- The **base branch** is the *merge target*: what the diff is measured against,
  what conflicts are reported against, what a pull request opens into. It is
  **not** the fork point, and it is retargetable at any time.
- The **branch the workspace owns** is what is checked out in the worktree and
  what commits land on. A workspace either **cut** that branch fresh or
  **adopted** one that already existed.

## Never rename the branch behind the app

`git branch -m` desyncs the workspace from git and leaves the app pointing at a
branch that no longer exists. Use **`ensemblr_set_branch_name`**, which renames
the workspace and the branch together from one kebab-case slug and keeps any
`prefix/` segment.

It is one-shot per workspace: a reply saying nothing changed is a settled
outcome, not a fault to retry. When the *user* asks for a different name in so
many words, pass `userRequested: true`.

## What a new workspace inherits

A fresh worktree has no gitignored files — no `.env`, no local credentials — so
Ensemblr copies a declared set in at creation by asking git which *gitignored*
files match the patterns. Nothing tracked and nothing unmatched is touched.

The pattern list comes from the first of these that declares one:

1. `.worktreeinclude` in the project root — legacy, one path per line
2. `file_include_globs` in `.ensemblr/settings.toml` — the committed choice
3. the user's personal patterns
4. the built-in default, `.env*`

## Setup scripts

`[scripts] setup` runs when the workspace opens. It does **not** run every time:
Ensemblr fingerprints the resolved setup command together with the contents of
every dependency lockfile it finds, and skips the run when the fingerprint has
not moved.

The fingerprint tracks **declared** dependencies, not installed state — deleting
`node_modules` without touching a lockfile will not re-trigger setup. Reinstall
explicitly.

`auto_run_after_setup = true` chains a successful setup (exit 0) into the
project's default run script.

## Terminals and run scripts

Three kinds of terminal: the **setup** script, a **run** script, and a **spawn**
terminal. Only one script of a kind runs at a time — starting a second is
refused with `conflict`, and the refusal names the terminal already holding the
slot, which `restart: true` replaces.

A repository declares its run scripts by name — a dev server, a playground, an
unsigned build — so call `ensemblr_list_run_scripts` and pass the `scriptName`
you want. Starting a run script without one takes the repository's default,
which is rarely the one you meant.

`ensemblr_read_terminal_output` reads by `terminalId` or by `kind`, cleaned of
escape codes unless you ask for `ansi`.

## The Changes panel and review comments

`ensemblr_get_workspace_diff` is the same diff the user reads in the Changes
panel. **Call it with `stat: true` first** to see which files changed and how
large the diff is, then read the whole thing or one file at a time with
`filePath` — results are capped at 32,000 characters.

Review comments are local to Ensemblr, anchored to a file and a line, and they
persist with the workspace rather than with the diff. They are labelled by
origin, so a comment you wrote never reads as one the user wrote.

- `ensemblr_get_diff_comments` hands you each comment's `id`.
- `ensemblr_add_diff_comments` files your own against a file and line — the
  right surface when your answer belongs on the line rather than in prose.
- `ensemblr_resolve_diff_comments` closes them, and takes a batch.

**The user reads them as a list in Checks.** A comment renders in both panels —
inline on its line in Changes, and in the Checks roll-up that answers what a pass
left open — and the list is what someone handed six findings actually wants.
Ensemblr brings Checks forward itself after a comment op, once per batch rather
than once per call, so never spend an `ensemblr_focus_panel` call on it.

**Resolve only what you actually fixed, in the turn you fixed it.** An open
comment is a live claim that the finding still stands, so a queue of comments
you already addressed forces the user to re-read every one. A comment you
deferred, could not reproduce, or disagree with stays open, and you say so in
your reply — resolving it to tidy the panel erases the only record that the
disagreement happened.

## The board

Five columns: Backlog, In Progress, In Review, Done, Canceled. You can move your
own workspace with `ensemblr_set_workspace_status`. Backlog also carries tracker
issues no workspace exists for yet; nothing the board does is written back to
the tracker.

## Linear

An **app-level** integration, not scoped to your workspace — one account can
span several teams, so narrow a search with `teamId` or `query` rather than
reading the whole list as the work in front of you. Several accounts can be
connected at once, and an id from one is never valid in another.

Every Linear op answers with a `status`. `not-connected` means the user has not
linked Linear at all — it is not an empty result, and retrying will not change
it.

Keep a tracked issue current without being asked: move it to a started state and
assign it to the connected user (`viewer` on `ensemblr_linear_get_metadata`) if
nobody holds it, and move it to **In Review** in the same turn the work becomes
reviewable. A change that shipped while its ticket still reads In Progress is
the tracker lying to the whole team.

**You never mark an issue done.** Any target state whose Linear type is
`completed` or `canceled` is refused whatever you pass — you take work as far as
In Review and the user decides whether it is finished.

## Pull requests

**Never create a pull request unless the user explicitly asks for one in the
current task.** Do not infer it from completed work, from a tracked issue, or
from a branch that looks ready.

When a change is backed by a tracker issue, put that issue's identifier in the
branch name, the commits, and the PR title.

## Permission modes and approvals

Per project: **workspace trusted** (default — normal in-workspace work runs
without asking), **approval required** (writes and command execution pause for
confirmation), **read only** (writes, shell, scripts, and terminals are
blocked). Reads are allowed in every mode.

A handful of actions with a blast radius beyond the workspace always ask,
whatever the mode: changing app settings, writing outside the workspace, merging
a pull request, removing a project, moving the root directory, permanently
deleting an archive.

Expect denials and handle them gracefully — a denied call means the user
declined it. Adjust; do not retry it verbatim.
