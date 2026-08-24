# Concepts

Ensemblr uses a small, fixed vocabulary. Every screen, menu, and setting in the
app leans on it, and so does the rest of this guide. This page walks the terms in
the order you meet them.

[`CONTEXT.md`](../../CONTEXT.md) is the canonical definition of each one, written
for people working on Ensemblr itself. This page says the same things in the
order a user runs into them.

## Project

A **project** is a codebase Ensemblr tracks: one git repository it can open,
configure, and use as the source for isolated copies. You add a project once —
by cloning it or by pointing Ensemblr at a checkout you already have — and
everything else hangs off it.

A project carries its own settings: which branch new work targets, what to run on
setup, which run scripts exist, what permission mode agents work under.

_You'll see this in_ [`03-first-run.md`](./03-first-run.md) and
[`12-repository-settings.md`](./12-repository-settings.md).

## Workspace

A **workspace** is one isolated copy of a project, holding one stream of work: a
feature, a bug fix, an experiment, a pull request you are reviewing. It has its
own branch, its own working tree, its own agent sessions, its own terminals, and
its own review path.

A workspace is **literally a git worktree**. Not a copy, not a snapshot — a real
second checkout of the same repository, sharing one object store. That is what
makes several agents able to work at once without stepping on each other, and
it is the isolation boundary everything else assumes.

_You'll see this in_ [`05-workspaces.md`](./05-workspaces.md).

## The Ensemblr root directory

Ensemblr keeps everything it manages under one directory you can see and open —
`~/Ensemblr` by default, changeable in settings. It has four managed
subdirectories:

| Directory | Holds |
| --- | --- |
| `repos/` | one clone per project |
| `workspaces/` | one folder per workspace, grouped by project |
| `archived-contexts/` | preserved `.context/` folders from archived workspaces |
| `concierge/` | the Concierge's own folder — its memory and the reports it writes |

Open them in Finder whenever you like. Do not rearrange them by hand — Ensemblr
treats the shape as managed, and moving things around out from under it is how
you end up with a workspace it can no longer find.

_You'll see this in_ [`11-app-settings.md`](./11-app-settings.md).

## Base branch, and the branch a workspace owns

These are two different things, and mixing them up is the single most common
misreading of the app.

The **base branch** is the **merge target**. It is what your diff is measured
against, what merge conflicts are reported against, and what a pull request opens
into. That is all it is.

The **branch the workspace owns** is the branch checked out in its worktree — the
branch your commits land on. A workspace either cut that branch fresh or took
over one that already existed.

The base branch is not the fork point, and it is not recorded at creation as one.
You can **retarget** it at any time — pointing the workspace at a different merge
target — and the worktree is not touched. Your commits stay exactly where they
are; only the comparison moves.

_You'll see this in_ [`05-workspaces.md`](./05-workspaces.md) and
[`08-reviewing-changes.md`](./08-reviewing-changes.md).

## Adopt and cut

When a workspace is created it does one of two things with its branch:

| | Adopt | Cut |
| --- | --- | --- |
| What happens | an existing branch is checked out into the new worktree | a fresh branch is created |
| The workspace | takes over that branch | owns a branch nothing else knows about |
| Pushes | land on whatever pull request already tracks it | need a new pull request |
| Naming | the branch keeps its own name | the name is generated (see below) |
| On archive | the branch is never destroyed — the workspace did not cut it | branch cleanup may remove it |

Picking a pull request or an existing branch adopts. Picking the project's
default branch, or an issue, cuts. Git allows a branch in one worktree at a time,
so a branch another active workspace already holds cannot be adopted twice — you
are offered Open or Duplicate branch instead.

_You'll see this in_ [`05-workspaces.md`](./05-workspaces.md); the reasoning is in
[ADR 0043](../adr/0043-adopt-an-existing-branch-instead-of-always-forking.md).

## Agent runtime, harness, provider

Three words that sound interchangeable and are not.

An **agent runtime** is a coding agent Ensemblr drives natively in a chat tab.
There are two: **Pi** and **Claude Code**. Each has its own executable discovery,
readiness probe, model catalogue, and reasoning ladder. A conversation is pinned
to one runtime for its whole life.

A **harness** is a third-party coding-agent CLI that Ensemblr launches in a
workspace terminal tab, running as its own TUI: Claude Code, OpenAI Codex,
Mistral Vibe.

A **provider** is the inference vendor a model is served by — Anthropic, OpenAI.
It groups the model picker; it says nothing about which runtime you are using.

**Claude Code is both a runtime and a harness.** The native chat tab and the
terminal tab are separate paths with different permissions and different
surfaces. [`../harnesses.md`](../harnesses.md) has the full comparison.

_You'll see this in_ [`06-agents.md`](./06-agents.md) and
[`07-terminals-and-run-scripts.md`](./07-terminals-and-run-scripts.md).

## Agent session and session branch

An **agent session** is a saved conversation, attached to a project or a
workspace and pinned to the runtime that opened it. Close the tab, quit the app,
come back tomorrow — the session is still there.

A **session branch** forks a session from an earlier point in the conversation
without discarding the rest of its history. Useful when a turn went the wrong way
and you want to retry from before it, while keeping what came after for
reference.

## The board

Every workspace sits in one of five columns:

| Column | Meaning |
| --- | --- |
| Backlog | queued, not started |
| In Progress | being worked |
| In Review | changes ready for you to look at |
| Done | finished |
| Canceled | abandoned |

You drag cards between columns and reorder within one. Agents can move their own
workspace too.

Backlog also carries **tracker issues no workspace exists for yet** — unstarted
Linear issues and unassigned open GitHub issues. Dragging one rightward creates
the workspace from it. Nothing the board does is written back to the tracker.

_You'll see this in_ [`05-workspaces.md`](./05-workspaces.md).

## Permission modes

A per-project setting governing what an agent may do inside its workspace:

| Mode | Effect |
| --- | --- |
| **Workspace trusted** (default) | normal in-workspace work runs without asking |
| **Approval required** | writes and command execution pause for your confirmation |
| **Read only** | writes, shell, scripts, and terminals are blocked |

Reads are allowed in every mode. A handful of actions with a blast radius beyond
the workspace — changing app settings, writing outside the workspace, merging a
pull request, removing a project, moving the root directory, permanently deleting
an archive — always ask, whatever mode you are in.

_You'll see this in_ [`06-agents.md`](./06-agents.md).

## Plan mode

A per-chat toggle that holds an agent to planning. It gets read-only tools until
it submits a plan, and the plan comes back to you for approval before anything is
edited. It is enforced per tool call rather than requested in the prompt, and a
sub-agent spawned by a planning agent inherits it.

_You'll see this in_ [`06-agents.md`](./06-agents.md).

## Review flow

Inspecting what a workspace changed, running checks, leaving comments on lines,
resolving merge conflicts against the base branch, opening a pull request,
merging accepted work, archiving rejected work. Ensemblr treats this as part of
the workspace, not as a separate destination.

_You'll see this in_ [`08-reviewing-changes.md`](./08-reviewing-changes.md).

## Attachment

Anything you pin into a message as a chip: a workspace file or folder, a pasted
image or long text block, a Linear or GitHub issue, a review-comment thread, a
changed file's diff. Attachments form **one ordered list**, and the outgoing
prompt carries each one at the position its chip sat in your sentence — so
"compare this against that" arrives with *this* and *that* still in the right
places.

## Linked directory

A read grant over a directory outside the workspace, held per chat and sticky
across sends. Nothing is copied and nothing is serialized — the agent is simply
allowed to read there. Symlinks are deliberately left unresolved: the path you
picked is the path that is granted.

## Follow-up queue

Messages you send while a turn is still running. They stay listed, reorderable,
editable, and removable until they drain, rather than vanishing into the runtime
where you cannot see them.

## Unread mark

A record that agent activity landed in a chat you were not reading. Marks are per
chat, not per workspace, so catching up on one tab does not silence its siblings.
A mark is retired when you read the chat or when its tab closes, so a chat an
agent opened and closed on its own leaves no dot behind.

## Run script

A named command a project declares under `[scripts.run.<name>]` in
`.ensemblr/settings.toml` — a dev server, a playground, a build. A project may
declare several; one is the default that the dock's Run button and ⌘R target.

_You'll see this in_ [`07-terminals-and-run-scripts.md`](./07-terminals-and-run-scripts.md).

## Ensemblr Control, orchestrator, sub-agent

**Ensemblr Control** is the permission-gated surface that lets an agent running
inside a workspace drive the app itself — spawn conversations, launch harnesses,
run terminals, focus panels, read the diff, leave and resolve review comments,
ask you a question, move the workspace across the board.

When one agent delegates to others, the **orchestrator** is the root agent that
does the delegating, and a **sub-agent** is a spawned child. A sub-agent does its
one unit of work itself and never delegates onward.

_You'll see this in_ [`09-agent-control.md`](./09-agent-control.md).

## Concierge

The **Concierge** is the one agent that belongs to no workspace. It lives in
`concierge/` under the Ensemblr root, reads every workspace at once, and writes
files only in that folder of its own. To change anything in a project it starts
an orchestrator in the workspace concerned and briefs it, so the vocabulary above
is what it works in: it supervises, and the agents it puts to work do the work.

Its **memory** is the other half of that. It writes what it learns as ordinary
markdown files under `concierge/memory/`, indexed by `concierge/MEMORY.md`, so
what it knows outlives the conversation that taught it. Only what it could not
fetch again, though — a fact a tool call or a git command would return is left to
the tool rather than copied into a file that then goes stale.

_You'll see this in_ [`06-agents.md`](./06-agents.md#the-concierge).
