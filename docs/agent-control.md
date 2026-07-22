# Ensemblr Control

**Ensemblr Control lets an agent drive the app it runs inside.** An agent working
in a workspace can open new conversations, launch other coding agents, run
terminals, open file and diff tabs, focus panels, and move the workspace across
the dashboard board — through a set of `ensemblr_*` tools, without the user
having to click. This is what turns Ensemblr from a place you run one agent into
a place a team of agents runs itself.

It is available to every agent species Ensemblr can run:

- **Pi** (first-party) gets the tools through a shipped Pi extension.
- **Claude Code** and **Codex** get them through an embedded MCP server that
  Ensemblr auto-configures at launch.
- **Vibe** runs without control (no MCP config path) — see [`harnesses.md`](./harnesses.md).

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

| Mode | Reads | Writes (spawn, launch, terminals, focus, board) |
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
- A blocking wait times out after **5 minutes**; the child keeps running.
- Waiting on an ancestor session is refused (it would deadlock).

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

## Orchestration in practice

An agent starts as an **orchestrator** (the root, lineage depth 0) and may
delegate; anything it spawns is a **sub-agent** that does its one unit of work
itself and never fans out. The intended loop is **delegate → wait → evaluate →
integrate**:

1. **Delegate** each independent, substantial workstream to its own fresh tab
   with `ensemblr_start_conversation` (give it a short `title`).
2. **Wait** with `ensemblr_wait_for_agents` — it blocks efficiently instead of
   polling, and returns the moment a child finishes or signals it needs a
   decision.
3. **Evaluate** each result; steer a child with `ensemblr_send_follow_up` and
   wait again if needed.
4. **Integrate** the outcomes and focus the relevant view so the user can
   follow along.

Delegation is the exception, not the default — one agent in one thread is the
right tool for almost every task. A sub-agent that hits a blocker calls
`ensemblr_notify_orchestrator` to pull the orchestrator back rather than stalling.

## See also

- [ADR 0040](./adr/0040-use-loopback-control-server-for-agent-app-control.md) — the accepted decision.
- [`considerations/agent-control-layer.md`](./considerations/agent-control-layer.md) — design record and as-built architecture.
- [`considerations/agent-orchestration-playbook.md`](./considerations/agent-orchestration-playbook.md) — the canonical tool guidance injected into every agent.
- [`harnesses.md`](./harnesses.md) — the third-party runtimes Ensemblr can launch.
