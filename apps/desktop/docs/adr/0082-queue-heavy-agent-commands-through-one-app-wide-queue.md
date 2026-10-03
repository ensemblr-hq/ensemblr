# 0082. Queue Heavy Agent Commands Through One App-Wide Queue

Date: 2026-10-03

## Status

Accepted

## Context

Ensemblr runs many agents at once: several workspaces, each with an
orchestrator and its sub-agents, on two runtimes. Each agent decides for itself
when to run a test suite, a typecheck, a build, or a nix rebuild, and nothing
coordinated those decisions. Four agents finishing a change at the same moment
start four `bun run test` runs and two `nix build`s together, and the machine
the human is sitting at stops responding until they finish.

Agents reach a shell along four paths, and an answer that covered only one
would only move the problem to another:

1. their own shell tool — `Bash` on Claude Code, `bash` on Pi;
2. typing into an Ensemblr terminal with `ensemblr_write_terminal`;
3. starting a repository setup or run script with `ensemblr_start_terminal`;
4. the setup script the app itself starts when a workspace is created.

## Decision

One `ComputeQueueService` in the main process
(`src/main/compute-queue/`) owns a small number of global slots — one by
default, `app.computeQueue.concurrency` in `config.json` — across every
workspace and both runtimes.

**Heavy is a classification, not a list of tools.**
`classifyHeavyCommand` (`src/shared/compute-queue/heavy-command.ts`) lexes a
command line with the tolerant mode of Plan Mode's lexer, strips wrappers
(`env`, `time`, `nice`, `sudo`, `timeout`), unwraps runners (`bunx`, `npx`,
`python -m`), normalises package-manager scripts to `run <script>`, recurses
into `bash -c` and `nix develop -c`, and matches a built-in list of test
runners, compilers, bundlers, and nix rebuild commands. The user extends it
with `extraPatterns` and carves out of it with `exemptPatterns`. It lives in
`shared/` for the reason Plan Mode's classifiers do: the Claude hook runs in
main and the Pi extension asks the app per tool call, so there is one copy.

**Every path is gated.**

- A heavy command in an agent's own shell is refused before it runs — by a
  `PreToolUse` hook on Claude Code (`claude-compute-queue-guard.ts`, active in
  every permission mode) and by a branch of the `checkPlanModeTool` round trip
  Pi already makes for every `bash` call.
- `ensemblr_write_terminal` refuses a line that would submit a heavy command,
  joining the input with what the terminal has buffered since its last submit
  so a command split across writes is still seen whole.
- A heavy setup or run script started by an agent, or by the app on workspace
  creation, waits for a slot before its terminal launches and holds it until
  the terminal exits. Every setup script counts as heavy.
- A heavy script the user clicks starts at once but takes a slot, so agents
  queue behind the human rather than beside them.

**The refusal redirects rather than rewrites.** The refusal names
`ensemblr_run_queued` with the command to pass. That tool queues the command,
runs it headless in the workspace with its full Ensemblr environment —
Infisical secrets included — under `nice`, in its own process group, and
returns the exit code with a redacted tail of the output. Waits are capped like
`ensemblr_wait_for_agents`: a `timedOut` answer keeps the job's place, and
`ensemblr_wait_for_job` picks the wait up again.

Slots are granted round-robin across workspaces, so one workspace's burst
cannot starve the others. The queue is visible in a sidebar panel that lists
running and queued jobs from every workspace, with cancel and open-log actions.

The agent settings tools cannot change `app.computeQueue`. An agent that could
switch the queue off, or exempt its own command, would hold the key to the
lock it is behind.

## Alternatives Considered

**Rewrite the shell command transparently.** Both runtimes can rewrite a tool
call's input: Claude through the hook's `updatedInput`, Pi by mutating the
event's input. Rewriting `bun run test` into a wrapper that waits for a slot
would keep the output in the agent's own tool result. It was rejected for
three reasons:

- Claude's `Bash` tool caps a call at ten minutes. A long wait in the queue
  would kill the call, and the agent's retry would land at the back of the
  queue.
- Quoting an arbitrary compound line into a wrapper, across the shells agents
  use, is fragile.
- The wrapper would depend on the control channel's environment reaching the
  agent's shell, which neither runtime guarantees.

The capped wait loop keeps a job's place across any number of waits.

**Limit resources at the OS level instead.** A cgroup or `systemd-run` slice
for every agent process tree would bound CPU without anyone classifying
commands. It is Linux-only, it slows every agent command rather than
serialising the heavy ones, and it leaves the human with no view of what is
waiting. Lowering CPU priority survives here as `niceness` on queued jobs.

**Queue in a dock terminal per job.** Live output, with no new UI. Rejected
because queued jobs would hold terminal slots from the per-tree budget while
they wait, and because a PTY hands agents ANSI-laden output with no clean exit
code.

## Consequences

- The gate is best effort, not a sandbox. A script file that wraps
  `bun run test`, a `Makefile` target, or a command assembled from variables
  is not recognised. The classifier errs towards recognising commands rather
  than proving them safe, so `tsc --version` counts as heavy.
- Third-party harness TUIs (Claude Code, Codex, Vibe in a terminal tab) are not
  gated. Codex and Vibe expose no pre-execution hook; a Claude harness could be
  given one later through `--settings`. What `ensemblr_write_terminal` types
  into a harness terminal is not classified either: it is a prompt to another
  agent, not a command line.
- A command recalled from shell history in a terminal (the up arrow) is not
  seen: the gate reads only the text written through `ensemblr_write_terminal`,
  so a recalled line submitted with a bare newline reaches the shell
  unclassified.
- A queued command runs in its own process group, and the whole group is
  signalled when the job ends, so a child the command backgrounded does not
  outlive it. A command that deliberately daemonises is killed with it.
- An agent can still edit `~/.config/ensemblr/config.json` directly with its
  file tools. The settings tools refuse the section, but the file is outside
  any workspace's guard.
- A heavy run script that never exits, such as a watcher, holds its slot until
  it is stopped.
- Queued jobs live in memory. Quitting the app cancels them and kills running
  process groups; a restart starts with an empty queue.
