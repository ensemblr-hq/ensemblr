# Ensemblr Control

**Ensemblr Control lets an agent drive the app it runs inside.** An agent working
in a workspace can open new conversations, launch other coding agents, run
terminals, open file and diff tabs, focus panels, and move the workspace across
the dashboard board — through a set of `ensemblr_*` tools, without the user
having to click. This is what turns Ensemblr from a place you run one agent into
a place a team of agents runs itself.

It is available to every agent species Ensemblr can run:

- **Pi** (first-party) gets the tools through a shipped Pi extension.
- **Claude Code**, **Codex**, and **Vibe** get them through an embedded MCP
  server that Ensemblr auto-configures at launch. Vibe has no MCP-config flag, so
  its server arrives as a `VIBE_MCP_SERVERS` env prefix — see
  [`harnesses.md`](./harnesses.md).

## How it works

Ensemblr runs a small control server on `127.0.0.1` (loopback only, ephemeral
port). Pi reaches it via the shipped extension (`POST /invoke`); MCP-client
harnesses reach it via an MCP endpoint (`POST /mcp`). Every request carries a
per-workspace bearer token that Ensemblr injects into the agent's environment —
the agent never supplies its own identity. One service validates the request,
enforces scope and permissions, applies guardrails, and delegates to the app's
existing services.

The architecture decision is [ADR 0040](./adr/0040-use-loopback-control-server-for-agent-app-control.md);
the full design record is [`considerations/agent-control-layer.md`](./considerations/agent-control-layer.md).

## Permissions

Control actions follow the **workspace permission mode** (the same setting that
gates the agent's local tool use):

| Mode | Reads | Writes (spawn, launch, terminals, focus, board, review comments) |
| --- | --- | --- |
| `read-only` | allowed | blocked |
| `approval-required` | allowed | prompt the user to confirm |
| `workspace-trusted` | allowed | run automatically |

Scope is enforced regardless of mode: **writes act only on the caller's own
workspace**, while **reads may span all open workspaces**. Expect and handle
denials gracefully — a write can always be refused by the mode.

## Guardrails

Delegation is bounded so a runaway agent cannot fork-bomb the app
(`src/main/agent-control/guardrails.ts`):

- **Shallow by design** — only a root orchestrator may spawn; a spawned
  sub-agent cannot delegate onward (spawn depth capped at **1**).
- **20 spawns per session** (lifetime) and **10 per minute** (rolling).
- **Plan Mode is inherited** — a spawn from a planning parent produces a planning
  child, so a planning orchestrator can fan out read-only investigators without
  handing any of them a way to edit the repository. The depth cap still applies,
  so inheritance never recurses.
- A blocking wait times out after **5 minutes**; the child keeps running.
- Waiting on an ancestor session is refused (it would deadlock).

## The sub-agent role policy

Guardrails count spawns; they do not decide who may do what. That is the role
policy in `src/shared/agent-control/subagent-policy.ts`, which refuses a spawned
sub-agent thirteen ops with `denied-scope` **whatever mode it is in**:

`spawnChatTab`, `startConversation`, `sendFollowUp`, `launchHarness`,
`startTerminal`, `stopTerminal`, `writeTerminal`, `openTab`, `closeTab`,
`setBranchName`, `setWorkspaceStatus`, `askUserQuestion`, `exitPlanMode`.

Two things run together and are easy to confuse. The spawn guardrail reads
`origin.depth`, which lives in the in-memory origin registry; the role policy
reads the **durable sub-agent marker** on the chat tab. Only the second survives
a restart. Before it existed, a resumed child re-registered at depth 0, read as a
root, and got the whole surface back — while `notifyOrchestrator`, its one
sanctioned escape hatch, broke on the same missing lineage. `notifyOrchestrator`
now keys off the marker too, so the two move together.

`waitForAgents` and `listModels` are not denied — a sub-agent simply has no
children to wait on and no spawn to pick a model for. They are withheld from its
tool list along with the thirteen above, because listing a tool the service would
only refuse teaches the model to keep reaching for it. The Pi extension registers
the complement of `SUBAGENT_WITHHELD_OPS` for a child, and a parity test compares
its copy of that set against the shared one.

What a sub-agent keeps: every read, `focusTab`/`focusDockTab`/`focusPanel`,
`setName`, `setSummary`, and `notifyOrchestrator`.

## What an agent can do

The `ensemblr_*` tools group into a few families (see the
[orchestration playbook](./considerations/agent-orchestration-playbook.md) for
the exact argument shapes):

- **Conversations** — open a chat tab and start a Pi sub-agent, steer it, name
  your own tab, close a tab.
- **Harnesses** — launch Claude Code or Codex in a terminal tab.
- **Terminals** — start/stop the setup, run, or a spawn terminal; write to it;
  read its output.
- **Focus & inspect** — bring a tab, dock terminal, or the Files/Changes/Checks
  panel forward; list workspaces, tabs, terminals, and models; read a
  conversation's status or last message.
- **Board** — move the workspace across the dashboard board and read its status.
- **Review** — read the workspace diff (`ensemblr_get_workspace_diff`), read the
  review comments on it (`ensemblr_get_diff_comments`), and leave comments of
  your own (`ensemblr_add_diff_comments`). All three act on the caller's own
  workspace; none takes a workspace argument. See below.
- **Ask the user** — put a multiple-choice question to the human and block until
  they answer. Pi-only: the questionnaire renders in the chat tab that asked, in
  place of the composer, so the answer lands where the question came from. A
  harness caller has no such tab and is refused with `denied-scope`.

  One questionnaire per session at a time: a second call while one is on screen
  comes straight back unanswered rather than replacing it. A questionnaire left
  alone for 30 minutes is withdrawn and the call released. Each of those, plus
  the no-window case, resolves with a `summary` that tells the agent it was not
  a decline, so it can retry rather than act on a refusal that never happened.
  Main renders that `summary` from the answers it validated — the renderer never
  supplies prose.

  Length rules are asymmetric on purpose. An over-long option **label** is
  rejected, because the label is rendered and truncating it would change the
  choice. An over-long question **header** is **trimmed**, because it is only the
  accessible name of a pager dot — rejecting the batch over it cost a round trip
  and bought nothing. Headers no longer have to be distinct either: `headerOf`
  leads every label with its `Q<n>` position, so the pager is unambiguous however
  the agent worded them.

## Reviewing the diff

The three review ops let an agent read the work in its workspace and annotate it
where the user will find the annotation — on the line, in the Changes panel, not
buried in a chat turn.

**Scope is the review panel's scope.** `ensemblr_get_workspace_diff` resolves the
workspace's `base_branch` and diffs from `merge-base(base, HEAD)` to the working
tree, so committed-on-branch edits, uncommitted edits, and untracked files all
appear — the same set the Changes panel renders. A workspace with no recorded
base degrades to the uncommitted change set, exactly as the panel does.

**Call `stat: true` first.** A workspace diff is the one payload in this surface
with no natural size ceiling. Stat mode returns the changed-file rows and totals
and issues no per-file git call, so it is the cheap probe that says whether the
full read is worth making. `file` and `stat` are alternatives rather than a
filter pair — sending both is refused as `invalid-args`, since a single file has
no stat and silent precedence would leave the caller unsure which read it got.

**Every read is capped at 32,000 characters** — the same `MAX_AGENT_PAYLOAD_CHARS`
ceiling a joined child report gets. A full read cuts on **whole-file boundaries
only**, because a patch severed mid-hunk is unparseable; the files it drops come
back in `omittedFiles`, each re-requestable with `file: "<path>"`. That per-file
call carries the same ceiling, cutting at a **hunk boundary**: the files a full
read drops are by definition the large ones, so leaving the recovery route
unbounded would turn `omittedFiles` into an instruction to blow the context the
budget had just protected. Git's own 2 MB output cap sits well above both, so the
ceiling that binds is always this one.

**Per-file reads go out eight at a time.** The app has no whole-workspace unified
diff — the Changes panel renders one file at a time — so the port composes one
from a status read plus a patch read per changed file. Those run in windows
rather than serially, and the budget is re-checked between windows, so a wide
diff stops issuing git calls once the patches already in hand fill the payload.

**Comments are Ensemblr-local.** `ensemblr_get_diff_comments` returns the notes in
the workspace's own SQLite store — the ones the user left in the Changes panel and
the ones agents filed there. Comments synced from a GitHub pull request are
deliberately **excluded**: they are a live `gh` snapshot rather than local rows,
and nothing in this surface could reply to or resolve one, so returning them would
be reading with no action attached. Every comment carries an `origin` (`user` or
`agent`), so a future `getPullRequestComments` op is purely additive.

**Authorship is stamped, not claimed.** `ensemblr_add_diff_comments` writes rows
with `origin: 'agent'` set by the port; nothing an agent can send makes its
comment read as the user's. Both surfaces badge it: the diff viewer labels the
thread, and the Checks panel carries `origin` alongside the `path:line` that has
taken its author slot.

**The write announces itself.** The comment list is a cached query that only
renderer-local mutations invalidate, and the client refetches neither on an
interval nor on window focus — so an agent's write would otherwise sit invisible
until the panel remounted. `addDiffComments` broadcasts on
`ensemblr:agent-control-review-comments-changed`, which the renderer turns into a
cache invalidation for that workspace, the same shape `tabsChanged` already uses.

**All three survive both gates.** The two reads are reads, allowed in every
permission mode. `addDiffComments` is a write and follows the mode like any other.
Plan Mode leaves all three alone — a comment anchored to a line records what you
found rather than changing it, the same argument that keeps naming and the board
available while planning. A spawned sub-agent keeps all three too: a delegated
reviewer filing comments is the point.

## Orchestration in practice

An agent starts as an **orchestrator** (the root, lineage depth 0) and may
delegate; anything it spawns is a **sub-agent** that does its one unit of work
itself and never fans out. The intended loop is **delegate → wait → evaluate →
integrate**:

1. **Delegate** each independent, substantial workstream to its own fresh tab
   with `ensemblr_start_conversation` (give it a short `title`), briefing each
   child with what to deliver — the question, the defaults to assume, and
   whether it reports inline or writes a named file. Shared groundwork is read
   once by the orchestrator, not re-derived by every child.
2. **Wait** with `ensemblr_wait_for_agents` — it blocks efficiently instead of
   polling, and returns the moment a child finishes or signals it needs a
   decision. It hands back each child's whole final turn by default;
   `reports: "brief"` returns each report's opening plus a pointer to
   `ensemblr_get_last_message`, which is what a wide fan-out wants.
3. **Evaluate** each result; steer a child with `ensemblr_send_follow_up` and
   wait again if needed.
4. **Verify** a load-bearing claim before building on it. A child's report is a
   claim, not a fact the orchestrator checked, and a cited path reads as verified
   even when nobody opened it — both orchestrator playbooks say so outright.
5. **Integrate** the outcomes and focus the relevant view so the user can
   follow along.

Delegation is the exception, not the default — one agent in one thread is the
right tool for almost every task. A sub-agent's report is its only deliverable —
it writes no files unless its brief names a path.

Decisions the user owns end a child's report under an `Open questions` heading:
each one a question, 2-6 options, and the option the child took. The orchestrator
gathers those across its children and asks them in one `ensemblr_ask_user_question`
round before it answers. `ensemblr_notify_orchestrator` is reserved for a child
that cannot produce its deliverable at all until someone replies — in practice
children almost never use it, which is why the question rides the report instead.

A sub-agent's chat tab is read-only to the user: it renders **no composer at
all**, because the orchestrator owns that conversation and steers it with
`ensemblr_send_follow_up` for the tab's whole life. The transcript stays readable
— the report a child leaves behind is the point of the tab.

Stopping a conversation stops every sub-agent below it. The stop walks the origin
registry's lineage (`childrenOf`) and aborts each live child with reason
`orchestrator-stopped`, so a child is never left running with nobody able to
steer it or read its report. The descendants are collected even when the stopped
session's own abort fails — a wedged orchestrator is the likeliest one to refuse,
and the likeliest to have stranded something.

Withholding the composer withholds the Stop button with it, so the user's route
into a running child is its tab's close control: closing a tab whose agent is
mid-turn raises the confirm-then-cancel guard (`useCloseRunningChatGuard`), whose
Stop action cancels that session by id. Nothing asks the user from that tab either —
`ensemblr_ask_user_question` is refused to a sub-agent, precisely because the
orchestrator that owns the conversation is blocked waiting on its report.

Two things a wait returns as prose rather than as a flag. `timedOut: true` with
children still `pending` carries a `note` naming the exact resume call, in the
caller's own mode, because an orchestrator reads a bare timeout as a fault to
report. And a *default* wait that finds no registered children carries a `note`
too: lineage lives in the in-memory origin registry, so after a restart the
default target resolves empty even though `notifyOrchestrator` — keyed off the
durable marker — still works. Without the note, a resumed child's signal parks
in a wait that reads back "nothing needs me". The recovery is to wait again with
explicit `targets`, which the orchestrator still holds in its own transcript.

The same loop runs while planning, with read-only children: each one answers a
question about the codebase and reports back, and the orchestrator folds those
findings into the plan it submits. A sub-agent cannot submit a plan or question
the user in any mode — see
[Planning with sub-agents](./considerations/agent-orchestration-playbook.md#planning-with-sub-agents).

## See also

- [ADR 0040](./adr/0040-use-loopback-control-server-for-agent-app-control.md) — the accepted decision.
- [`considerations/agent-control-layer.md`](./considerations/agent-control-layer.md) — design record and as-built architecture.
- [`considerations/agent-orchestration-playbook.md`](./considerations/agent-orchestration-playbook.md) — the canonical tool guidance injected into every agent.
- [`harnesses.md`](./harnesses.md) — the third-party runtimes Ensemblr can launch.
