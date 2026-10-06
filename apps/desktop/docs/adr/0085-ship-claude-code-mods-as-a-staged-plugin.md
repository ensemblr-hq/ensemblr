# 0085. Ship Claude Code Mods As A Staged Plugin

Date: 2026-10-06

## Status

Accepted

Extends [ADR 0053](0053-ship-a-bundled-ensemblr-skill-to-both-runtimes.md),
which stands: the skill bundle is still loaded in place by both runtimes. This
ADR adds a second plugin root, Claude-only, with a different loading path.

## Context

Claude Code 2.1.288 added function hooks ("mods"): a plugin's
`hooks/hooks.json` names a TypeScript module under `modules`, and that module
hooks engine events — a tool call before and after it runs, every row the
conversation keeps (`session.append`), each compaction, the context blocks of
a conversation's first message. Four of them close gaps the playbook can only
describe:

- **git-guard** — the playbook forbids `git branch -m` (the workspace keeps
  pointing at a branch that no longer exists), the shared stash stack outside
  its recipe, and git aimed at another checkout through `-C`, `--git-dir`,
  `--work-tree`, `GIT_DIR`, or `GIT_WORK_TREE`. A model that forgets the
  playbook now hears the rule at the moment it matters.
- **secret-redact** — an agent once grepped `/proc/<pid>/environ` and pulled a
  control token into its context. Nothing stopped a secret value from reaching
  the model through any tool.
- **compact-keeper** — a summary that drops a child's `agentSessionId` or a
  queued `jobId` leaves an orchestrator unable to wait on or close what it
  started.
- **ticket-context** — a workspace created from a Linear issue told the agent
  the issue's identifier and title, never its description.

Three facts about the engine shaped where and how they ship. All three were
checked against real binaries, not read off documentation:

1. **Engines before 2.1.288 refuse `modules`.** Claude Code 2.1.120 and 2.1.236
   both reject `{ "modules": [...] }` with `hooks: expected record`, recorded as
   a `hook-load-failed` plugin error on every session.
2. **The engine writes into a plugin folder that holds a module.** Loaded with
   `--plugin-dir` in SDK mode (how Ensemblr hosts Claude), 2.1.289 lays
   `.claude-plugin/types/**` and a root `tsconfig.json` into the folder on every
   load. A read-only folder is skipped silently and the module still loads.
3. **`$` never crosses an import.** `claude plugin validate` refuses a module
   that hands the engine interface to a function imported from another file.

## Decision

**The mods are a second plugin root, `resources/agent-mods/`, staged into a
writable copy before Claude loads it.**

```
resources/agent-mods/
├── .claude-plugin/plugin.json
├── hooks/
│   ├── hooks.json            ← { "hooks": {}, "modules": ["./register.ts"] }
│   ├── register.ts           ← registers the four mods
│   └── <mod>.ts, ...         ← one file per mod, plus $-free helpers
└── tests/*.test.ts           ← `claude plugin test`, never staged
```

`src/main/agent-skills/` copies everything but `tests/` into
`<userData>/claude-mods/<content-hash>/` and hands that root to the SDK's
`plugins` and the harness's `--plugin-dir`, never to Pi. Loading the packaged
folder in place would have the engine write type files into the signed macOS
app bundle, and into the repository checkout in development. A content-hashed
directory is staged once per build and renamed into place whole, so concurrent
sessions never read a half-written copy.

**`"hooks": {}` beside `modules` is the version gate.** Engines that predate
modules validate an empty classic hook table and ignore the unknown key, so
2.1.120 and 2.1.236 load the plugin with no error at all; 2.1.288 and later read
`modules`. No version probe, no second manifest.

**Secret values never travel toward the mod.** The mod holds one value, the
session's own control token, which its environment already carries. Every other
value is matched in the main process: the mod sends the row's text to an
internal control op, `redactText`, and gets back the text with each exact value
replaced by `[redacted:NAME]`. The values are the workspace's assembled
`redactValues` (Infisical secrets, Keychain or safeStorage environment rows) and
every control token live in the workspace. A variable, file, or reply that
carried the values to the mod would be one the model could read too. The op is
an oracle — it confirms a guess — and that is no new exposure, because
`runQueued` output is already redacted against the same values.

Redaction runs at `session.append`, not per tool. Every row passes that event,
so a secret is caught whichever tool, attachment, or delivery carried it. The
person's own prompt and slash commands are left as typed.

**The linked issue reaches the mod the same way**, through a second internal op,
`getLinkedIssue`, which reads the workspace's linked issue and fetches its
description through the existing Linear port.

Both ops are reachable over `POST /invoke` only. Neither is registered as an MCP
tool, so the model's tool list does not change.

**Every mod is UI-free.** Ensemblr hosts Claude Code over the Agent SDK, where
no pane, band, status line, or toast is drawn.

## Consequences

Each conversation row costs one loopback request while a workspace has secrets
to match; the main process caches each workspace's value table for about a
minute, because Infisical resolves over the network. When the app does not
answer, the mod still replaces the control token itself and lets the row
through rather than blocking the session.

What the mods rewrite is what the model reads and what the next request sends.
A tool's structured record beside its result (`tool_use_result` in the SDK
stream, which the engine stores as made) still carries the raw output. The model
never reads that record, but the transcript file and a host that renders from it
do.

git-guard reads a command line, it does not run a shell. It follows quotes,
operators, substitutions, `cd`, and `export`, and resolves paths through
symbolic links. A path built from a variable it cannot read is refused for a
write, with a request to write the path literally. Read-only subcommands may
look at any repository, since reads may span every open workspace.

The mods are checked by `claude plugin validate` and `claude plugin test`
against the engine itself, outside the repository's own type-check: their types
come from the installed engine, which writes them at load time, not from a
package the repository can pin.

Mod reload and error lines reach an SDK host as `ui_log` messages. Ensemblr does
not surface them yet. Hot reload in SDK sessions also needs
`CLAUDE_CODE_PLUGIN_DIR_WATCH=1`, which Ensemblr does not set, because a staged
copy is immutable for the life of a build.
