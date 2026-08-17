---
name: ensemblr
description: How Ensemblr works from inside it — the workspace/git-worktree model, the ensemblr_* control tools and what their answers mean, the committed .ensemblr/settings.toml (setup and run scripts, [git], [prompts], [infisical], environment variables), ~/.config/ensemblr/config.json, the Changes panel and diff comments, the kanban board, and the Linear and pull-request rules agent work must not break. Read this when a task touches repository settings, run scripts, workspaces or branches, terminals, the diff, or any tool whose name starts with ensemblr_.
---

# Working inside Ensemblr

You are running inside **Ensemblr**, a macOS desktop coding-workspace app. It
opens git repositories, cuts an isolated workspace per stream of work, runs
coding agents against them, and reviews what they changed. You are one of those
agents.

Your session prompt already carries the **playbook**: the tool inventory, the
etiquette, and the bookkeeping expected of you each turn. That playbook is the
live contract — where it and this skill disagree, the playbook wins. This skill
is the reference underneath it: the vocabulary, the file formats, and the
behaviour a tool answer is describing.

## Where you are running

Ensemblr drives two **agent runtimes** natively, in a chat tab with a structured
timeline: **Pi** and **Claude Code**. It also launches third-party **harnesses**
— Claude Code, OpenAI Codex, Mistral Vibe — as their own TUI inside a workspace
terminal tab. Claude Code is both, and the two paths are deliberately different:
a harness tab always runs skip-permissions and holds no chat-tab tools, while a
native chat tab honours the workspace permission mode and holds the full set.

Either way you reach the app through tools named `ensemblr_*`, served over an
MCP endpoint. **A harness may re-expose them under its own naming scheme** — an
extra `ensemblr` segment in front, an `mcp__` wrapper — so match on the tail of
the name rather than the whole of it. It is the same tool.

## The vocabulary

| Term | What it is |
| --- | --- |
| **Project** | one git repository Ensemblr tracks, with its own settings |
| **Workspace** | one isolated stream of work — **literally a git worktree**, on its own branch, with its own agent sessions and terminals |
| **Base branch** | the *merge target* a workspace's diff is measured against. Not the fork point, and retargetable at any time |
| **Agent session** | a saved conversation, pinned for life to the runtime that opened it |
| **Harness** | a third-party agent CLI running in a terminal tab |
| **Run script** | a named command from `[scripts.run.<name>]` — a dev server, a playground, a build |
| **Board** | the kanban columns every workspace sits in: Backlog, In Progress, In Review, Done, Canceled |
| **Permission mode** | per project: workspace-trusted (default), approval-required, or read-only |
| **Ensemblr Control** | the permission-gated surface these `ensemblr_*` tools are |

Everything Ensemblr manages lives under one root directory (`~/Ensemblr` by
default): `repos/` holds one clone per project, `workspaces/` one directory per
workspace. Treat that shape as managed — never rearrange it by hand.

## The four things that are always true

1. **Your workspace is a worktree.** Your branch, your working tree, shared
   object store. Never `git branch -m` — it renames the branch behind the app
   and desyncs the workspace from git. Use `ensemblr_set_branch_name`, which
   renames workspace and branch together.
2. **Writes are scoped to your own workspace; reads may span all of them.**
   Inspect before acting.
3. **You take work as far as In Review.** Never move a Linear issue to a
   `completed` or `canceled` state — the port refuses it whatever you pass — and
   never open a pull request unless the user asked for one in the current task.
4. **`.ensemblr/settings.toml` is read from *your* worktree**, so a branch that
   edits it changes behaviour for that workspace and nowhere else.

## Working the loops

- **Name the work first.** Your tab (`ensemblr_set_name`), the workspace and its
  branch together (`ensemblr_set_branch_name`, one kebab-case slug, one-shot).
  Do it before the work, not after — until you do, the board shows a card whose
  name says nothing.
- **Keep the tracked issue current.** Move it to a started state and claim it
  when you begin; move it to In Review the same turn the work becomes reviewable.
- **Close the loop on review.** Resolve a diff comment only in the turn you
  actually fixed what it asked. Leave the rest open and say which, and why.
- **Record the summary** (`ensemblr_set_summary`) before your closing message.

## Reference

Load these when the task actually needs them — each is a full reference, not a
summary.

- **[references/control-tools.md](references/control-tools.md)** — every
  `ensemblr_*` tool, the argument vocabulary they share, what each `status` word
  means, how results are truncated, and the delegation loop.
- **[references/settings-toml.md](references/settings-toml.md)** — the complete
  `.ensemblr/settings.toml` reference: `[scripts]`, `[scripts.run.<name>]` with
  its icon list, `[git]`, `[prompts]`, `[infisical]`, `environment_variables`,
  `file_include_globs`, the keys that are inert, and `~/.config/ensemblr/config.json`.
- **[references/workspaces-and-git.md](references/workspaces-and-git.md)** — the
  worktree model, base branches, which files a new workspace inherits,
  checkpoints, the Changes panel and diff comments, and the standing rules on
  Linear and pull requests.
