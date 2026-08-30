# Agents

Ensemblr drives two coding agents natively in chat tabs: **Pi** and **Claude
Code**. This page covers what they share, where they differ, and everything you
control from the composer.

Third-party CLIs — Codex, Vibe, and Claude Code's own terminal UI — run alongside
them as harnesses in terminal tabs. Those are covered in
[`07-terminals-and-run-scripts.md`](./07-terminals-and-run-scripts.md) and
[`../harnesses.md`](../harnesses.md).

One agent is not in a workspace at all: the [**Concierge**](#the-concierge) works
above every project, reads all of them, and hands the work to agents it puts into
the workspace that needs it.

## Two runtimes, one chat surface

Both runtimes drive the same chat: the same streaming timeline, the same tool
cards, the same checkpoints, the same permission model, the same Ensemblr Control
tools. You pick the runtime by picking a model, and once the conversation has a
session it is **pinned** to that runtime for the rest of its life. Models
belonging to the other runtime stay visible in the picker but are disabled — to
switch, start a new chat.

![A chat timeline of thinking, tool, and sub-agent cards, with the model picker under the composer and a run script streaming in the dock.](./images/06-chat.png)

One known difference in the timeline: Pi streams partial tool output, so a long
`bash` fills its tool card as it runs. Claude Code returns each tool result
complete, so its cards show a spinner until the result lands.

Claude Code's task tools have cards of their own rather than raw JSON dumps, and
a run of `TaskCreate` calls folds into the one plan card it represents instead of
stacking as identical rows. Runs fold per level of the activity tree, so a plan a
sub-agent filed stays inside the delegation that filed it.

See [ADR 0042](../adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md).

## The `ensemblr` skill

Every agent Ensemblr starts is handed a skill describing the app it is running
in — the workspace and worktree model, the `ensemblr_*` control tools, and the
full `.ensemblr/settings.toml` key reference. It loads on demand, so it costs the
conversation almost nothing until a task actually needs it, and you can call it
up yourself with `/skill:ensemblr` in a Pi chat or `/ensemblr:ensemblr` in a
Claude one.

It ships inside the app. Nothing is written into your repository or into your
`~/.claude` and `~/.pi` directories, so it never appears in a workspace diff and
never follows you into a `pi` or `claude` session you start yourself. Terminal
harnesses get it too, where the harness supports skills — the `claude` TUI does;
Codex and Vibe do not.

## Pi

Ensemblr spawns **your** `pi` binary in RPC mode and talks to it over stdio. Your
existing Pi setup comes with it — credentials, model configuration, packages,
extensions, skills, prompt templates, themes, context files.

## Claude Code

Ensemblr drives Claude Code through the Claude Agent SDK against **your own**
`claude` binary. **Ensemblr ships none.** If you have no `claude` installed, the
Providers settings tab reports it and you cannot open a Claude chat until you
resolve it — an honest failure rather than a silent fallback.

To get set up:

- Install the `claude` CLI.
- Sign in: run `claude` and complete the login prompt (or `/login` from inside a
  session).
- Your Claude settings stay where they always were, in `~/.claude/settings.json`.
  Ensemblr does not manage them.

Ensemblr resolves which `claude` to run from the override on the Providers page
first, then your shell `PATH`. What that page reports is what actually runs.

Four things are discovered **live from the installed CLI** rather than baked into
Ensemblr, so they track whatever version you have and whatever your account is
entitled to:

| Discovered | Notes |
| --- | --- |
| Slash commands | read against the workspace, so project commands show up |
| MCP server roster | your configured servers, as the CLI sees them |
| Model catalogue | an account fact, so read without a workspace |
| Thinking levels | each model carries the effort levels it supports |

All four are deferred until something asks for them, so opening the app spawns
nothing. [`../claude/README.md`](../claude/README.md) has the details.

### Plan usage and session cost

Claude Code reports what your account has spent against its claude.ai plan, and
two surfaces show it.

- **Settings → Providers** draws a bar per rate-limit window, read once per
  readiness probe. It runs on its own short deadline, so a slow usage endpoint
  costs that panel alone and never the rest of the page.
- **The composer's context card** carries the same windows for this chat's own
  session, plus a running cost estimate. "How much room is left" is one question
  over two horizons, so it is one control rather than two gauges competing on the
  same row. Click the gauge to open it — it is a popover, not a hover card, so
  the controls inside it can be reached by keyboard and read by a screen reader.

**You can ask for a fresher reading.** The card carries a **refresh** control, so
a gauge you opened mid-turn is one click from a current figure rather than
something you wait on the runtime to volunteer. Pressing it repeatedly costs the
runtime one question — the presses join the read already in flight and settle on
the same answer — and the manual path ignores the freshness interval a sealing
turn respects, on the reasoning that asking is itself the signal that the figure
on screen is the one you no longer trust. A chat with no runtime attached, a
reopened chat replaying its persisted gauges among them, draws no control rather
than one that would always fail.

The composer's figures come from the same read: a session asks the account what
every window stands at as it opens, and again after a turn seals if that answer
has gone stale. The runtime's own pushes then layer their fresher reset and
spend verdict on top, window by window — they name only whichever window moved
and need not carry a percentage at all, which is why they are not the source.

Both readings persist like any other event, so reopening a chat replays its
gauges instead of blanking them until the next turn. A crashed turn that reports
a zero cost is dropped rather than walked backwards, and a live reading layers
over the replayed one rather than replacing it. A window the account named but
never measured is drawn as a hollow outline rather than a bar at zero, which
would read as spending nothing.

Plan usage is a Claude Code fact and appears only on Claude chats.

## Choosing a model and reasoning level

The composer's model picker groups models by their inference provider — the
vendor serving them, such as Anthropic or OpenAI. That is a separate axis from
the agent runtime: which runtime a model belongs to is what pins the session.

Reasoning is steered differently by each runtime, and the two scales are never
merged:

| Runtime | Control | Levels |
| --- | --- | --- |
| Pi | **thinking** | `off` through `xhigh` — six levels |
| Claude Code | **effort** | `low`, `medium`, `high`, `xhigh`, `max`, per what the model supports |

Like the runtime, the level pins to the session.

The context gauge next to the picker shows how much of the model's window the
conversation currently occupies.

## The Concierge

Every agent described so far lives *inside* a workspace. The **Concierge** does
not. It sits above every project, in a folder of its own under the Ensemblr root,
and it is the only agent that can see all your work at once — which workspaces
have something waiting, what a running agent actually did, where a body of work
stands.

Open it with `⌘⇧C`, from View ▸ Concierge, or by clicking the round button
floating over the window. It is a **panel** rather than a chat tab: drag it where
you want it, maximize it with `⌘⇧M`, close it with `⎋`. It belongs to the app, so
it is the same conversation whichever workspace you happen to be looking at.

It runs on the same two runtimes as everything else — **Pi or Claude Code** — and
carries the Ensemblr Control tools, on a playbook written for supervising rather
than for doing the work.

### It reads everywhere and writes in one place

The Concierge can read every workspace's files, diff, and review comments; replay
any conversation in any workspace, tool calls and results included; read every
terminal's output, the board, and Linear. Acting is a narrower set:

- **Put an agent to work.** Starting a conversation in a workspace opens a **root
  orchestrator** there — a peer that owns the task and fans out its own
  sub-agents, not a child of the Concierge. It briefs that agent, steers it with
  follow-ups, and reads back what it ran.
- **Create a workspace** when the work needs one that does not exist yet, under a
  name it has to supply — the name is the sidebar label and the git branch both,
  so it is refused rather than guessed at, and you land in the new workspace once
  it appears.
- **Move the board and the tracker**, and leave or resolve review comments on any
  workspace's diff.

What it cannot do is deliberate, and enforced per tool call at the control
channel rather than asked for in the prompt:

- **It cannot write a file in any workspace.** Writes outside its own folder are
  refused, and `bash` is held to read-only commands. When something needs
  changing, it spawns an orchestrator into that workspace and briefs it — that
  agent has the write access the Concierge deliberately does not.
- **It cannot open terminals or launch harnesses.** A shell is a write channel
  the read-only rules cannot see into. It says which script should run and lets
  the workspace's own agent run it.
- **Every op that acts on a workspace names one.** The Concierge has no workspace
  of its own to default to, so an op that names none is refused rather than
  guessed at.

### Everything it names, you can click

A project, a workspace, a chat, or an artifact the Concierge mentions in its answers renders as a
chip, the same way a file path does. Clicking a workspace or a chat chip focuses it — a closed chat
reopens first; a project chip has no surface of its own to jump to, so it resolves to the project's
name rather than sitting there as dead text. Type `@` in its composer to open a menu ranked against
every project, workspace, chat, and artifact in the app, not just the one you happen to be looking
at.

Its own tool rows are written in the same vocabulary. A row that spawned an agent says it opened a
**root orchestrator**, not a sub-agent — that is what a Concierge spawn actually is, and the panel
never has any sub-agents to confuse it with — and a row that steered a chat or created a workspace
pins that chat or workspace as a chip carrying its current name, rather than spelling a raw id into
the title.

### Reading what it wrote

Clicking an artifact opens a reader over the transcript. It covers the conversation and nothing
else: the header keeps its controls, and the composer stays live, so a question about what is on
screen can be asked without dismissing it first. It reads through the same channel a workspace file
preview does, so markdown renders, images render, and an oversized file is truncated the same way.
Its own **Back to the conversation** control puts the transcript back; the header's controls keep
meaning what they say while a file is up, so closing from there closes the panel rather than the
reader.

The memory notes under `memory/` open in it too — they are ordinary markdown in the same folder, and
the Concierge writes path chips for them the same way.

### Its own folder

The Concierge works out of `concierge/` in the Ensemblr root, which is
`~/Ensemblr/concierge` unless you moved the root. It is scratch space that
belongs to the agent: not a git repository, not a project, and not something any
request is about.

| Path | Holds |
| --- | --- |
| `MEMORY.md` | the memory index — one line per memory, pointing at its file |
| `memory/` | one markdown file per durable fact |
| `artifacts/` | reports and notes it writes for you, addressable as chips and opened in the panel's reader |

Ensemblr creates all three on launch and seeds `MEMORY.md` with an empty index,
so a fresh install has somewhere to write from the first turn.

### Memory outlives the conversation

The Concierge's context does not survive a clear, so anything worth keeping is
written to a file before that happens — one file per fact under `memory/`, with a
line in `MEMORY.md` pointing at it. Next session it reads the index first and
searches what it wrote when a question touches something it might already know.

**It writes only what nothing can answer for it.** The test it applies is not
whether a fact is useful but whether it could be fetched again: anything a tool
call, a git command, or reading one file would return is left out. So no project
rosters, workspace ids, or paths; no remotes, branch lists, or commit history; no
file layouts or dependency versions; no counts and no "as of today" snapshots.
What is left is the part that exists nowhere else — a decision and what it
rejected, a constraint you told it, how you work and what you are after, and
behaviour it had to discover by running something.

That line matters more than it sounds. A memory that duplicates a tool is worse
than no memory at all, because the Concierge will trust the file instead of making
the call, and a `workspaceId` written down last week points at nothing this week.
It prunes on the same rule: a memory that has gone stale, or that turns out to be
something a tool answers, gets deleted.

**Clearing gives you the fresh conversation immediately, and the memory pass runs
behind it.** `⌘⇧K`, or View ▸ Concierge ▸ **Clear Context…**, replaces the
session on the spot and leaves the conversation it retired running one last turn
to write its files. You never wait on that turn and never see it — it writes into
a transcript nothing will open again — so what the conversation established
survives the clear even though the transcript does not.

That last turn is best-effort by design. It has five minutes, and quitting the
app closes it wherever it got to; what a cut-short pass costs is one
conversation's notes, and the files it had already written stay written.

It is also the one turn the Concierge cannot act on the app from. A retired
conversation keeps only what writing its memories needs — clearing its own file
writes, and searching its own memory index — and every other control tool is
refused for as long as it runs. Nothing it did would be visible to you: you are
in a fresh conversation, and that transcript is one nothing will open again, so
a window that moved or a question that appeared would have no cause you could
see.

A long conversation raises a banner of its own once the context passes a
threshold, offering **Clear now** or **Not yet**. It is an offer, not an
interruption: nothing is cleared until you press the button, and dismissing it
leaves the conversation alone. The threshold is
[`app.concierge.autoClearAtPercent`](./11-app-settings.md#concierge-settings),
`0.8` by default.

### Its model is its own setting

The Concierge's runtime, model, and thinking level live under `app.concierge`
rather than `app.models`, and are set in Settings → Models — the model that suits
supervising a dozen workspaces is not the one that suits editing a file in any of
them. Picking a model belonging to the other runtime reopens the Concierge on
that runtime, because a model belongs to exactly one. See
[11. App settings](./11-app-settings.md#models).

### Telling you what happened while it was closed

The launcher bubble carries a count of what the Concierge said while its panel was shut, plus a
separate mark for a question it is still waiting on you to answer, so a turn that finishes behind a
closed panel is not silent just because nobody was looking at it. Opening the panel is what clears
the count — the transcript on screen is the report.

A finished turn also raises a desktop notification under the Concierge's own name rather than a
workspace's, and clicking it opens the panel rather than navigating anywhere, since a Concierge
answer belongs to no workspace to open. It stays quiet only while the panel itself is open in a
focused window — it has no chat of its own to compare itself against the way a workspace
notification does.

## Permission modes

What an agent may do inside its workspace is a **per-project** setting, under
Settings → Repo → Security. It applies to the agent's own tools and to its
Ensemblr Control calls alike.

| Mode | Reads | Workspace writes, shell, scripts, terminals |
| --- | --- | --- |
| **Workspace trusted** (default) | allowed | run automatically |
| **Approval required** | allowed | pause and ask you |
| **Read only** | allowed | blocked |

Reads, searches, and listings are allowed in every mode. Separately, a set of
actions whose blast radius reaches past the workspace **always** asks for
confirmation, whatever the mode:

- changing app settings
- writing outside the workspace
- changing Pi's global configuration
- merging a pull request
- removing a project
- changing the Ensemblr root directory
- permanently deleting an archived workspace

One asymmetry to know about: the two stricter modes are enforced at the runtime
for **Claude Code**, which exposes the hooks to do it. **Pi keeps unrestricted
workspace control** — its CLI takes no permission flag — so with Pi the mode
still gates Ensemblr Control and the app's own channels, but not Pi's own file
and shell tools. The workspace's git worktree is the isolation boundary either
way.

## Tool approvals

Under **Approval required**, a Claude Code chat replaces the composer with an
approval card the moment a tool wants to run. It names the tool and its
arguments, and offers three answers:

| Answer | Effect |
| --- | --- |
| **Allow** | this call only |
| **Allow for this session** | this tool, for the rest of this session |
| **Deny** | refuse the call |

"Allow for this session" is held in memory only — never written to disk, never
shared with another session. Prompts are shown one at a time even when a single
assistant message fires several tool calls in parallel. If the session stops, the
chat closes, or you quit, any outstanding card is withdrawn rather than left
hanging.

## Plan mode

Toggle plan mode (⌥⇧P) and the agent is held to planning. It keeps its read-only
tools; writing, editing, and any `bash` command that is not read-only are
refused, as are the tools that would hand the work to something else — starting a
conversation, launching a harness, opening a terminal.

When it is ready it submits a plan. Ensemblr writes the plan to a file under the
workspace's `.context/plans/`, posts it into the chat, and raises a review panel
where you approve it or send it back for refinement.

![A submitted plan in the chat, with Approve, Refine, and Hand off actions on the review bar above a composer still flagged Plan.](./images/06-plan-mode.png)

Three properties make this a mode rather than a polite request:

- **It is enforced per tool call**, at the control channel, not by an instruction
  in the prompt. A model cannot decide the instruction has been superseded, and a
  compaction cannot drop it.
- **It fails closed.** A tool call the classifier cannot confidently clear is
  refused, not allowed.
- **Sub-agents inherit it.** A planning agent that fans out investigators gets
  planning investigators — none of them can edit the repository either.

Sending a plan back for refinement reminds the agent to **resubmit** when it is
done. Without that, a refine turn reads as ordinary conversation and the agent
answers in prose instead of putting the revised plan back through the panel.

Claude Code uses its own native plan mode; Ensemblr routes the result into the
same review path, so both runtimes save to the same place and raise the same
panel. See
[ADR 0044](../adr/0044-enforce-plan-mode-fail-closed-at-the-control-channel.md).

A plan-mode workspace is also named from your opening prompt before the agent
gets there, and marked provisional so the agent's own naming call still replaces
it ([ADR 0050](../adr/0050-name-a-planning-workspace-before-the-agent-does.md)).

## Checkpoints and session branching

Before each of your prompts runs, Ensemblr captures the workspace's file state
into a private git ref tied to that turn. Restoring a checkpoint reverts the
files to how they were at that boundary and hides the messages after it.

The conversation history itself is not destroyed by a restore — the runtime's own
session record stays intact. Checkpoints are about **files**; **session
branching** is about the conversation, letting you fork from an earlier point and
try a different direction while keeping what came after.

Because Ensemblr's checkpoints are git-backed and wrap turns, the Claude SDK's
own file checkpointing is deliberately left off — two checkpoint systems over one
worktree would fight. See
[ADR 0012](../adr/0012-use-git-backed-checkpoints-for-pi-turns.md).

## Composer attachments

Anything you pin into a message becomes a chip sitting inline in your sentence:

| Attachment | How you add it |
| --- | --- |
| A workspace file | `@`-mention it, drop it in, or **Attach to chat** from the Files tree |
| A folder | **Attach to chat** from the Files tree |
| A file's diff | **Attach diff to chat** from the Changes list |
| A pasted image | paste |
| A long pasted text block | paste — converted to an attachment rather than flooding the box |
| A Linear or GitHub issue | the issue picker |
| A review-comment thread | from the Changes panel |
| A terminal's output | select it, then **Attach selection to chat** from the terminal's right-click menu |

They form **one ordered list**, and the outgoing prompt carries each one at the
position its chip sat in your sentence. "Compare this screenshot against this
file" arrives with both in place, so the agent does not have to re-derive which
was which.

Payloads are written to disk under the workspace's `.context/attachments/` at the
moment you attach them, keyed by content — so an attachment has a real path the
agent can re-read, and the same file attached twice is stored once. A referenced
thing is written out as a document rather than summarised into a line of prose.

A **file or folder is attached by reference**: the chip carries the path, and the
agent opens it itself. A **diff has no file of its own**, so its patch is written
out as a markdown document and the chip points at that — a thousand-line rewrite
becomes one chip rather than burying your question under its own diff. Because
the store is keyed by content, re-attaching a file after the agent has touched it
lands a *fresh* chip instead of being folded into the stale one.

A **terminal selection** is stored under a name that says which pane it came off,
so the chip and the path the agent reads both name the terminal — a stack trace
from the Run tab and the same bytes printed in an interactive shell stay two
chips rather than collapsing into one. See
[`./07-terminals-and-run-scripts.md`](./07-terminals-and-run-scripts.md).

A workspace created from a tracker issue opens with that issue **already
attached** as a document, once per chat, rather than with a summary flattened
into the draft box — so the agent reads the body and the comments instead of
whatever survived truncation. Remove the chip and it stays removed.

See [ADR 0047](../adr/0047-model-composer-attachments-as-one-ordered-list-in-a-lexical-draft.md).

### Your message in the timeline

Once sent, a message becomes a prompt card above the turn that answers it, and a
long one **clamps** rather than pushing that answer off screen — a pasted stack
trace or wall of build output stops at about sixteen lines behind a fade, with
**Show more** to unfold it. The control appears only when something is actually
hidden, so an ordinary sentence carries no chrome.

The text is shown verbatim. What you typed is never re-read as markdown, so a
prompt full of asterisks and backticks reads back as you wrote it. Attachment
chips a clamp is covering stay reachable: tabbing to one unfolds the card rather
than scrolling focus into a strip you cannot see.

### Right-clicking text

Right-clicking the composer or the transcript opens Ensemblr's own text menu,
drawn in the app's chrome rather than by the operating system.

In the **composer** it carries the full set: the spellchecker's suggestions for
the word under the cursor and **Add to dictionary**, then Undo, Redo, Cut, Copy,
Paste, and Select all. Paste runs the real edit command, so a long paste still
becomes an attachment chip instead of flooding the box. Undo and redo are always
offered — the composer keeps its own history, so a menu that greyed them out
would be wrong as often as it was right.

On the **transcript**, which you cannot type into, the menu narrows to Copy and
Select all. Copy takes the whole selection however long it is, and Select all
covers the surface you right-clicked rather than the entire window — the one row
whose behaviour ⌘A would not reproduce, and the only one that shows no shortcut
hint for that reason.

## Linked directories

To let an agent read something outside its workspace — a sibling repository, a
design folder — link the directory. This is a **grant**, not an attachment:
nothing is copied and nothing is serialized, the agent is simply allowed to read
there. The grant is held per chat and sticks across sends.

Two deliberate behaviours:

- **Symlinks are not resolved.** The path you picked is the path that is granted.
- **A directory linked mid-session is pending** until the chat reopens, and the
  composer says so. The runtime takes its roots at launch, so the honest answer
  is to tell you rather than let the agent hit an unexplained denial.

## When a turn fails

A turn that dies — a refusal, a rate limit, a crashed process, a dropped
connection — ends in a **designed failure row** rather than a line of provider
English under the last tool card. The row leads with copy in the app's language,
says which kind of failure it was, and keeps the provider's own sentence in a
disclosure underneath for when you want the raw text. It is announced rather than
only tinted, so a screen reader reports the failure too.

Each kind offers only the recoveries it earns. A transient failure offers a
retry; a **refusal** hands your prompt back to the composer to edit, rather than
a retry that would earn the same refusal; a **blocked tool call** routes you to
the repository's Security settings, where the permission mode actually lives.
Recoveries go through the composer, so a recovered turn inherits the same guards
a typed message has — the in-flight check, the linked-directory preamble, the
Follow-up behavior, and the composer's error strip when the send itself does not
land.

The answer a fatal failure interrupted is marked **incomplete**, so a cut-off
turn reads as cut off instead of as finished.

**A spent plan window is one of those failures.** Claude Code announces an
exhausted claude.ai plan window as an ordinary assistant turn, which used to
render as the model's answer — a bare English sentence on a turn that produced no
answer at all. It is now a rate-limit row like any other, and when the runtime
named a reset the row restates the wait as a badge counting down to it. The same
row covers billing failures and exhausted API quotas, which never clear on their
own, so it promises a reset only when there is one to promise and otherwise
points you at your plan and billing. Either way **Continue** leads: whatever the
account ran into has to clear before re-sending would help, and re-sending would
start the work over.

A turn that did real work and *then* mentioned a limit still reads as an answer,
and a limit a sub-agent hit stays inside that sub-agent's own activity.

## The follow-up queue and unread marks

Type while a turn is running and your message joins the **follow-up queue**
instead of disappearing. Queued messages stay listed, and you can reorder, edit,
or remove them right up until they drain.

Two things stop a queue draining, and the strip says which: **stopping a turn**
parks the messages that turn was holding, so resuming is your call rather than
something that happens the moment the agent falls silent, and a **send that
fails** parks the rest rather than emptying them into a session that will not
take them. Either way the strip offers Resume. Closing a chat **discards** what
it still had queued — a queued message sends only through an open composer — and
the app says how many it dropped.

An **unread mark** appears on a chat where agent activity landed while you were
elsewhere. Marks are per chat, not per workspace, so reading one tab does not
clear its siblings — a workspace with three agents running keeps three separate
answers to "is there anything new here". You can also mark a workspace unread
yourself.

A mark is retired when its chat is **read** or when its tab **closes** — whether
you closed it or the agent did. A chat an agent opened, used, and closed before
anyone looked at it therefore leaves no dot pointing at a tab that is no longer
there.

## Notifications and language

Desktop notifications are on by default and can be turned off in app settings.
They are **per chat, not per app**: a chat that finishes a turn or stops to ask
you something posts its own notification, titled with that chat's name and
naming its workspace in the body, so a fan-out of agents produces one line per
agent rather than one line for the window. Clicking a notification brings
Ensemblr forward and opens the chat it came from. The Concierge is the one exception: it notifies
under its own name and clicking it opens its panel rather than a chat — see
[above](#the-concierge).

A **notification sound** rides alongside, on by default and switchable
separately — the chat can chime without the notification banner, or the other
way round. There is also an option to keep the Mac awake while an agent is
running, so a long turn is not cut short by sleep.

## Quitting with agents still running

Quitting while any chat is mid-turn raises a native confirmation first, naming
the chats that are about to be interrupted. **Quit Anyway** goes through and
stops them; **Cancel** leaves everything running. Nothing is quietly killed, and
nothing blocks a quit you meant.

Agents write back in the language the app is set to — replies, tab titles,
workspace summaries, review comments, and the questions they put to you. Code,
identifiers, file paths, shell commands, commit messages, and branch names stay
exactly as they are. English is the default and the fallback; setting the app to
English does not force an agent to answer in English when you write to it in
something else.

## See also

- [`09-agent-control.md`](./09-agent-control.md) — what an agent can drive in the app.
- [`08-reviewing-changes.md`](./08-reviewing-changes.md) — reviewing what an agent produced.
- [`11-app-settings.md`](./11-app-settings.md) — notifications, language, providers.
- [`13-keyboard-shortcuts.md`](./13-keyboard-shortcuts.md) — composer and chat shortcuts.
