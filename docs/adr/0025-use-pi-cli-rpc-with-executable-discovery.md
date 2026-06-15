# 0025. Use Pi CLI RPC with Executable Discovery

Date: 2026-06-04

## Status

Accepted

## Context

Ensemble must preserve the user's Pi environment and support variants or wrappers such as `oh-my-pi`. The previous v1 decision embedded `@earendil-works/pi-coding-agent` directly in Electron main, but that couples Ensemble to a bundled SDK version and weakens parity with the exact Pi runtime the user expects.

Pi's documented CLI RPC mode launches the agent as a subprocess and communicates over stdin/stdout using LF-delimited JSONL:

```bash
pi --mode rpc
```

Pi also supports flags that can disable sessions, tools, extensions, skills, prompt templates, themes, and context files. Ensemble should not use those disabling flags by default because the requirement is that the user's Pi configuration, skills, extensions, plugins, prompts, themes, context files, credentials, models, and sessions work as they do in Pi itself.

## Decision

Ensemble v1 will use a Pi CLI RPC subprocess as the default Pi runtime boundary.

Runtime behavior:

- Launch the selected Pi executable with `--mode rpc` from the workspace directory.
- Use the workspace path as the process `cwd` so project `.pi`, `AGENTS.md`, `CLAUDE.md`, and cwd-based resources resolve like the Pi CLI.
- Preserve the user's normal Pi agent directory by default; do not set `PI_CODING_AGENT_DIR` unless the user explicitly configures it.
- Do not pass `--no-session`, `--no-tools`, `--no-builtin-tools`, `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-themes`, or `--no-context-files` by default.
- Stream RPC events into Ensemble's structured timeline through a `PiAgentClient` interface.
- Keep terminal panes separate from Pi RPC; xterm.js is for shells, setup/run scripts, logs, and optional manual terminals.

Model and thinking selection:

- Bind the selected model and thinking level at spawn via `--model <provider/id>` and `--thinking <level>`. The Pi `prompt` command has no model field, so selection cannot ride on the prompt frame.
- Apply mid-session switches through the RPC `set_model` and `set_thinking_level` commands, written ahead of the next `prompt`. The adapter tracks the last-applied selection (seeded from the spawn flags) and only re-sends a command when the value actually changes.
- Resolve the selection in the renderer composer in this order: explicit per-chat override → Settings "Default model"/thinking (`defaultChatModelAtom`) → Pi-reported default → first available model. A new chat therefore inherits the configured default, and a per-chat pick (stored per chat-tab id) overrides it for that chat only without leaking to others.

Executable discovery:

1. Use an explicit executable path from Ensemble app settings or `~/.config/ensemble/config.json` when provided.
2. Discover `pi` from the user's shell environment and `PATH`.
3. Check common local binary locations when shell discovery fails.
4. Let users browse/select an executable or wrapper manually.

The override may point to the normal `pi` executable, a wrapper script, or an alternate distribution/launcher such as `oh-my-pi`, as long as it supports Pi's CLI RPC contract.

Setup gate checks:

- A Pi-compatible executable is discoverable or explicitly configured.
- The executable can report version/help information where supported.
- The executable can start `--mode rpc` from a test workspace and produce valid JSONL RPC behavior.
- Ensemble can launch the executable with the expected shell-derived environment.
- Provider/model readiness is checked through Pi-compatible commands or a safe RPC smoke test where practical.

## Alternatives Considered

### Embedded Pi SDK

Embedding the SDK gives direct typed access and avoids requiring a separate executable, but it couples Ensemble to a bundled Pi SDK version and may execute Pi extensions/packages inside Electron main. That decision was accepted in ADR 0005 and is superseded by this ADR.

### SDK sidecar

A sidecar could combine SDK control with process isolation. It remains a future fallback if CLI RPC cannot expose enough UI behavior, but it adds a custom process/protocol and packaging complexity.

### Managed Pi runtime installer

Ensemble could install and manage its own Pi runtime. This remains deferred because users may want their existing Pi or wrappers such as `oh-my-pi`, and managed runtime ownership adds update/compatibility burden.

## Consequences

- Ensemble uses the same Pi runtime users can run in a terminal, improving compatibility with `~/.pi` and custom Pi distributions.
- Users can override the executable path for wrappers or alternate Pi launchers.
- Ensemble needs a robust RPC process supervisor: start, stop, abort, restart, stderr capture, JSONL parsing, backpressure, and crash recovery.
- Ensemble is constrained by the RPC protocol surface; missing capabilities may require future SDK sidecar support.
- Setup/onboarding must handle missing or invalid Pi executables with clear remediation.
- Model/thinking must be passed as spawn flags and runtime `set_model`/`set_thinking_level` commands; relying on the `prompt` frame silently drops the selection and lets Pi fall back to its own default provider/model.
