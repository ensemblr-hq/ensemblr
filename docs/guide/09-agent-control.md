# Ensemblr Control

Agents running inside a workspace can drive Ensemblr itself. That is Ensemblr
Control: a set of tools the app hands the agent, gated by the same permission
mode that governs its file and shell access.

An agent with Control can:

- open a chat tab and start another conversation, steer it, and close it
- launch a harness — Claude Code, Codex, Vibe — in a terminal
- start and stop the setup script, a run script, or a scratch terminal, type into
  one, and read its output
- bring a tab, terminal, or the Files / Changes / Checks panel forward
- read the workspace diff, leave review comments on specific lines, and resolve
  ones it has addressed
- read Linear issues, comment on one, and move it along
- move its workspace across the board

A workspace created from a tracker issue tells its agent so. The chat carries a
standing block naming that issue and the moments at which the ticket is expected
to move, so the agent keeps the ticket current instead of waiting for you to ask
for each transition by hand. What that block permits is cut to what the caller
may actually do — a sub-agent is denied tracker writes, a planning agent is
denied the move.
- name its own tab and record a summary of what the conversation covered
- **ask you a question** and block until you answer

## You configure nothing

There is no setup step, no config file, and no token for you to manage.

Ensemblr runs a small control server on `127.0.0.1` — loopback only, on an
ephemeral port — for the lifetime of the app. Every agent it launches gets a
bearer token injected into its environment, scoped to that session. The agent
never supplies its own identity, and the token never appears on a command line.

Two bridges reach the same server and the same gate:

| Agent | Bridge |
| --- | --- |
| Pi | a shipped Pi extension, loaded at launch |
| Claude Code, and every MCP-capable harness | an embedded MCP server |

Because both funnel into one service, the two surfaces cannot drift apart. See
[ADR 0040](../adr/0040-use-loopback-control-server-for-agent-app-control.md).

Control follows the workspace permission mode, so it is already governed by the
setting you chose in [`06-agents.md`](./06-agents.md):

| Mode | Reads | Writes |
| --- | --- | --- |
| Read only | allowed | blocked |
| Approval required | allowed | ask you first |
| Workspace trusted | allowed | run automatically |

Whatever the mode, **writes act only on the caller's own workspace** while
**reads may span every open workspace**. Asking you a question and escalating to
an orchestrator are exempt from the write gate — an agent in read-only mode can
still tell you it is stuck.

## What it refuses

Some things are not a matter of asking the agent nicely. They are refused in
code, so a prompt cannot talk its way past them:

- **Linear writes are withheld from sub-agents.** A spawned child can *read* the
  ticket it was briefed from, but commenting and updating belong to the
  orchestrator. Three children each posting on the same issue produces noise
  nobody can retract, and an issue's state describes the whole body of work
  rather than the one unit a child was handed.
- **No agent may close a Linear issue.** Any update targeting a state whose type
  is *completed* or *canceled* is refused — both, because closing a ticket as
  canceled is the same act under a different name. Agent work goes as far as
  **In Review** and you decide whether it is done.
- **A planning agent may not move the ticket either.** It has not implemented
  anything yet, so In Review would claim work that does not exist.
- **The guard fails closed.** A state the app cannot classify — an unknown id, a
  stale cache, a metadata read that could not reach Linear — is refused too. An
  unclassifiable state might be a Done column, and the point is that Ensemblr
  never posts an agent's "finished" to a tracker your team reads.
- **A write never guesses which organization it means.** With several Linear
  accounts connected, an ambiguous target is refused with the candidates named
  rather than resolved by chance. A workspace created from an issue defaults to
  that issue's account, and that default is applied only after the entity itself
  has been looked up, so it can never mask an issue that belongs elsewhere.

A refusal comes back to the agent as a modelled answer naming the recovery, not
as a crash, so it can correct course rather than retry blindly.

## Guardrails

Delegation is bounded so a runaway agent cannot fill your machine with children:

| Guardrail | Limit |
| --- | --- |
| Spawn depth | **1** — only a root orchestrator may spawn; a sub-agent cannot delegate onward |
| Spawns per session | 20 |
| Spawns per minute | 10 |
| Blocking wait | times out after 5 minutes; the child keeps running |
| Waiting on an ancestor | refused — it would deadlock |

Plan mode is inherited by a spawned child, and the depth cap still applies, so
inheritance never recurses.

## Orchestrator and sub-agents

When you ask an agent for something big enough to split up, it becomes an
**orchestrator** and works in a loop:

1. **Delegate** — spawn a sub-agent per unit of work, each in its own chat tab
   with its own brief.
2. **Wait** — block until they report, or until the wait times out.
3. **Evaluate** — read each result; send a follow-up to any child that came back
   wrong or incomplete, and wait again.
4. **Integrate** — fold the reports into one answer for you.

Each sub-agent gets a real chat tab you can open and read, so a delegated run is
never a black box. That tab has no composer — the orchestrator owns the child,
not you — but in its place is a read-only readout of the model, reasoning level,
and context the child is running with.

A sub-agent that hits a genuine blocker escalates to its orchestrator rather than
stopping silently. Decisions that are yours to make are collected by the
orchestrator and put to you in one questionnaire, instead of four children
interrupting you separately.

**Claude Code can delegate its own way instead.** Settings → Providers → Claude
Code → **Sub-agents** switches a first-class Claude chat between Ensemblr's chat
tabs (the default, described above) and the runtime's built-in sub-agent tool,
which keeps children inside the conversation. Exactly one is ever live: picking
one withholds the other, so the model is never holding the playbook for one
mechanism and the tools for the other. The choice is fixed when a chat opens, so
it applies to chats you start afterwards. Pi has no sub-agent tool of its own,
and a spawned child always delegates through chat tabs whatever the setting says
— that is what keeps the depth cap meaningful.

## The Concierge is a caller too

The Concierge reaches the same control server through the same bridges, but it is
not in a workspace, so the rules land differently:

- **Reads span everything and writes stop at its own folder.** There is no
  permission mode to relax — writing a file in any workspace, opening a terminal,
  and launching a harness are refused outright, whatever the mode a repository is
  set to.
- **Every op that acts on a workspace has to name one.** A workspace agent gets
  its own by default; the Concierge has none, so an op that names no workspace is
  refused rather than guessed at.
- **What it spawns is a root orchestrator, not a sub-agent.** The child owns the
  task and fans out its own children under its own depth cap.
- **It holds four ops nothing else does.** Listing every project, navigating the
  app to a workspace, cutting a new workspace off a project, and searching its own
  memory. A workspace agent is withheld all four: it belongs to one project and
  cannot act on another.

[6. Agents](./06-agents.md#the-concierge) covers the Concierge itself.

## Full tool reference

This page covers what you see. The complete tool list — every operation, its
arguments, its result shape, and guidance for writing prompts that use them —
lives in [`../agent-control.md`](../agent-control.md).
