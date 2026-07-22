# Agent Harnesses

Ensemblr runs **Pi** as its first-party agent runtime (see [`pi/`](./pi/)), but it
can also launch **third-party coding-agent CLIs** — "harnesses" — inside a
workspace terminal tab. Each runs as its native TUI in a `node-pty` terminal,
resumes its own conversations, and (for MCP-capable ones) gets
[Ensemblr Control](./agent-control.md).

The registry of launchable harnesses is
`src/shared/agents/harness-registry.ts` — the single source of every launch
command. The renderer only ever sends a harness **id**; the main process
assembles the command from the registry, so a renderer value is never turned
into free-text shell.

## Supported harnesses

| Harness | id | Binary | Resume | Ensemblr Control |
| --- | --- | --- | --- | --- |
| Claude Code | `claude` | `claude` | yes | yes (MCP) |
| OpenAI Codex | `codex` | `codex` | yes | yes (MCP) |
| Mistral Vibe | `vibe` | `vibe` | yes | no |

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

Claude Code and Codex are MCP clients, so Ensemblr appends a per-workspace MCP
config to their launch command
(`src/main/agent-control/harness-mcp-config.ts`) that points at the loopback
control server with a scoped bearer token — giving them the `ensemblr_*` tools
described in [`agent-control.md`](./agent-control.md). **Vibe** has no known
HTTP-MCP config mechanism and is launched without control flags; it runs as a
plain auto-approve harness.

## See also

- [`agent-control.md`](./agent-control.md) — what launched agents can drive.
- [`pi/`](./pi/) — the first-party Pi runtime (RPC protocol, event taxonomy).
