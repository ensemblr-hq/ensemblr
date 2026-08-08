# Agent Harnesses

Ensemblr runs two **first-class agent runtimes** on its native chat surface —
**Pi** (see [`pi/`](./pi/)) and **Claude Code** (see
[ADR 0042](./adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md)) —
but it can also launch **third-party coding-agent CLIs** — "harnesses" — inside a
workspace terminal tab. Each runs as its native TUI in a `node-pty` terminal,
resumes its own conversations, and (for MCP-capable ones) gets
[Ensemblr Control](./agent-control.md).

The registry of launchable harnesses is `src/shared/agents.ts` — the single
source of every launch command. The renderer only ever sends a harness **id**;
the main process assembles the command from the registry, so a renderer value is
never turned into free-text shell.

## Harness Claude Code is not native Claude Code

The two Claude paths are deliberately separate, and the difference is
load-bearing. "Launch Claude Code" means two different things depending on which
one you mean, and both reach the same control server, so the name alone will not
tell you which caller you are looking at:

| | Harness `claude` tab | Native Claude chat |
|---|---|---|
| What launches it | `ensemblr_launch_harness` with `harnessId: "claude"`, or the robot menu | opening a chat tab on the `claude` agent runtime, or `ensemblr_start_conversation` from a `claude` chat |
| Transport | `claude` TUI in a `node-pty` terminal | `@anthropic-ai/claude-agent-sdk`, driven in-process from main |
| Binary | your `claude`, found on `PATH` | your `claude`, from the Providers override or `PATH` — Ensemblr ships none (ADR 0042 §1) |
| Surface | raw terminal | chat tab, structured timeline, tool cards, checkpoints, forking, summaries |
| Species | `harness` | agent runtime `claude` (`AgentProviderId`, alongside `pi`) |
| Permissions | always `--dangerously-skip-permissions` (see below) | honours the workspace permission mode, like Pi |
| Control origin | the workspace-level origin `ws:<id>`, shared with every terminal | its own per-session origin, with lineage (`parentSessionId`, `depth`) |
| Playbook | `HARNESS_AWARENESS` | `ORCHESTRATOR_AWARENESS` / `SUBAGENT_AWARENESS` |
| Control tools | no chat-tab tools | full `ensemblr_*` set over the same MCP endpoint |
| Spawning children | must pass `model` — the app cannot tell its runtime | may omit `model`; the child is pinned to the `claude` runtime |

Native Claude **never** inherits the harness's skip-permissions flag. Keep the
two code paths visibly distinct so that default cannot leak across.

Both Claude paths reach the control layer over `POST /mcp`; the endpoint decides
what to serve from `ControlAudience` (does the caller drive a chat tab, and is it
a root or a spawned child), never from the runtime's name. That is the whole
reason a first-class runtime can be added without touching the withholding
policy.

**Plan Mode is Pi-only.** `PLAN_MODE_ORCHESTRATOR_AWARENESS` and
`PLAN_MODE_SUBAGENT_AWARENESS` are consumed solely by the shipped Pi extension,
which resolves this turn's Plan Mode over `getSessionBrief` and swaps the
playbook. A runtime whose only channel is MCP has its system prompt fixed at
session open (`systemPromptAppend` in
`src/main/agent-runtime/session/agent-control-wiring.ts`), so it receives the
role playbook and, per turn, only the upkeep block through `resolveTurnPreamble`.

## Supported harnesses

| Harness | id | Binary | Resume | Ensemblr Control |
| --- | --- | --- | --- | --- |
| Claude Code | `claude` | `claude` | yes | yes (MCP) |
| OpenAI Codex | `codex` | `codex` | yes | yes (MCP) |
| Mistral Vibe | `vibe` | `vibe` | yes | yes (MCP, via `VIBE_MCP_SERVERS`) |

A harness only appears in the launch menu when its binary is found on `PATH`.
Install and authenticate each from its own vendor before launching it in
Ensemblr:

- **Claude Code** — install the `claude` CLI and sign in (`claude`, then follow
  the auth prompt).
- **OpenAI Codex** — install the `codex` CLI and authenticate per OpenAI's docs.
- **Mistral Vibe** — install the `vibe` CLI and authenticate per Mistral's docs.

Ensemblr does not manage these credentials; each harness reads its own.

## Auto-approve by default

By product decision, harnesses launch with their "skip permission prompts" flag
so they can work non-interactively in a PTY. These flags were verified against
each tool's current docs (do not edit them from memory):

- **Claude Code** — `--dangerously-skip-permissions`
- **OpenAI Codex** — `--dangerously-bypass-approvals-and-sandbox`
- **Mistral Vibe** — `--agent auto-approve --trust` (`--trust` also skips the
  one-time directory-trust prompt that would otherwise block a non-interactive
  launch)

Because these bypass the harness's own approval gates, run harnesses only in
workspaces you trust — the isolation boundary is the workspace's git worktree.

## Resume

Ensemblr captures each harness's native session id from its on-disk logs so a
tab can reattach the **exact** conversation after it is closed or the app
restarts:

- **Claude Code** — id from the transcript filename under `~/.claude/projects/`;
  resumes with `--resume <id>`, or `--continue` for the most recent conversation
  in the directory.
- **OpenAI Codex** — id from the rollout log under `~/.codex/sessions/`; resumes
  with `resume <id>`, or `resume --last`.
- **Mistral Vibe** — id from the session log under `~/.vibe/logs/session/`;
  resumes with `--resume <id>`, or `--continue`.

When no id is known, Ensemblr falls back to the "most recent conversation for
this directory" form.

## Ensemblr Control auto-config

All three harnesses are MCP clients, so Ensemblr decorates every launch command
(`src/main/agent-control/harness-launch-config.ts`) to point them at the
loopback control server with a scoped bearer token — giving them the
`ensemblr_*` tools described in [`agent-control.md`](./agent-control.md). The
token itself never enters the command line; each harness reads it from the
injected `ENSEMBLR_CONTROL_TOKEN` env var.

| Harness | MCP config | Playbook |
|---|---|---|
| Claude Code | `--mcp-config '<json>'`, bearer header expands `${ENSEMBLR_CONTROL_TOKEN}` | `--append-system-prompt-file` |
| Codex | `-c mcp_servers.ensemblr.url=…` + `-c mcp_servers.ensemblr.bearer_token_env_var=…` | none — reads the MCP server's `instructions` field as its tool-namespace description |
| Mistral Vibe | `VIBE_MCP_SERVERS='<json>'` env prefix with `api_key_env` — Vibe has no MCP-config flag, only `VIBE_*` env vars | `--add-dir <dir>`, whose `AGENTS.md` it loads as project instructions |

The playbook is `HARNESS_AWARENESS` (`src/shared/agent-control/awareness.ts`),
rewritten to `<userData>/harness-instructions/AGENTS.md` on every harness launch
— through a staging file and a rename, so a harness still reading the file
during another launch never sees a half-written prompt. It is a shorter,
harness-shaped variant of the Pi role playbooks: a harness tab is a
terminal titled from the harness's own session log, so the chat-tab tools
(`ensemblr_set_name`, `ensemblr_set_summary`, `ensemblr_ask_user_question`, Plan
Mode) are neither served over MCP nor mentioned.

> Vibe fails silently when the control server is unreachable — no error, no
> stderr, exit 0, just no tools. To check the wiring, ask it to list the tools
> whose names contain `ensemblr`.

## See also

- [`agent-control.md`](./agent-control.md) — what launched agents can drive.
- [`pi/`](./pi/) — the first-party Pi runtime (RPC protocol, event taxonomy).
