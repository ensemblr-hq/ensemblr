<p align="center">
  <img alt="Ensemblr" src="./assets/wordmark.gif" width="588">
</p>

# Ensemblr™

**A macOS orchestrator for multi-agent coding work, driving the Pi CLI or the Claude Code CLI — whichever
you already run.**

The agent inside a workspace can drive the app itself: spawn sub-agents into their own chat tabs, delegate
a unit of work to each, block until they finish, read their reports, and integrate the results. That
permission-gated surface is **Ensemblr Control**, and the worktree manager underneath it exists to make it
safe — every stream of work gets its own git worktree, branch, and review path, so a fan-out of agents
cannot collide.

**Apple silicon Macs only. Bring your own agent CLI — Pi or Claude Code, one is enough. `git` and an
authenticated `gh` are required.**

No Ensemblr account, no sign-in, no cloud sync, no telemetry. State is a local SQLite database, secrets go
to the macOS Keychain, GitHub tokens stay with `gh` and are never copied anywhere, and the app ships no
agent binary of its own — it drives the one you installed.

<video src="https://github.com/user-attachments/assets/c5db8e14-0a89-474d-ad6a-994769b3e71b" controls muted loop playsinline>
  <a href="https://github.com/user-attachments/assets/c5db8e14-0a89-474d-ad6a-994769b3e71b">Watch Ensemblr Control drive the app (60 seconds, no audio)</a>
</video>

*Ensemblr Control driving the app from inside a workspace: the agent names its own tab, moves the workspace to In progress, starts a run script, then delegates to two sub-agents in their own chat tabs and launches a Claude Code harness in a terminal.*

- **Version:** [`0.1.0-beta.16`](https://github.com/ensemblr-hq/ensemblr/releases/tag/v0.1.0-beta.16) (pre-1.0, polish stage)
- **Platform:** macOS on Apple silicon
- **License:** Apache-2.0

---

## Status

Ensemblr is **pre-1.0, in the polish stage**. The core workflows — isolated workspaces, Pi and Claude Code
agent sessions, the review and PR flow, and the GitHub / Linear / git integrations — are implemented and
wired to real services. The first public build is out as a **beta**; expect rough edges and breaking
changes before 1.0. See [`CHANGELOG.md`](./CHANGELOG.md) for recent changes.

## Install

```bash
brew install --cask ensemblr-hq/tap/ensemblr
```

Or **[download Ensemblr 0.1.0-beta.16 (.dmg, Apple silicon)](https://github.com/ensemblr-hq/ensemblr/releases/download/v0.1.0-beta.16/Ensemblr-0.1.0-beta.16-arm64.dmg)** — open it and drag Ensemblr to Applications.

The build is code-signed with a Developer ID certificate, hardened-runtime, notarized by Apple, and
stapled, so it opens without a Gatekeeper prompt and validates offline. Every build is on the
[Releases page](https://github.com/ensemblr-hq/ensemblr/releases).

To build it yourself instead, on an Apple silicon Mac with Node 24.x:

```bash
npm install
npm run make          # .dmg + .zip under out/make/
```

A build of your own is signed and notarized only when Apple API credentials are present in the
environment; without them you get an unsigned build that Gatekeeper will hold on first launch. The full
path — prerequisites, channels, unsigned builds, and where Ensemblr keeps its data — is
[`docs/guide/01-install.md`](./docs/guide/01-install.md).

## Prerequisites

Ensemblr drives CLIs you install and authenticate yourself — it ships no agent binary and holds no provider
key. On a clean Apple silicon Mac:

```bash
# 1 — Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2 — GitHub CLI
brew install gh

# 3 — at least one agent runtime; either one on its own is enough
brew install --cask claude-code             # Claude Code
curl -fsSL https://pi.dev/install.sh | sh   # Pi

# 4 — authenticate GitHub
gh auth login --hostname github.com

# 5 — authenticate the runtime you installed
claude                                      # complete the login prompt, or /login inside a session
pi --list-models                            # verifies your Pi providers resolve
```

`git` comes with the Xcode command line tools — `xcode-select --install` if `git --version` fails.

Claude Code also installs with the official script, which is what the app itself offers when that check
fails: `curl -fsSL https://claude.ai/install.sh | bash`. Pi providers are configured in Pi, not in
Ensemblr; the Providers settings tab reports what `pi --list-models` returns and lets you point Ensemblr at
a specific executable.

## Requirements

`git`, the GitHub CLI (`gh`, authenticated), and **at least one** agent runtime — either the Pi CLI or the
Claude Code CLI. The two are gated against each other: a machine carrying only one of them is ready.
Ensemblr checks all of this itself at first launch and offers a fix per failing check. Every check is
documented in [`docs/guide/02-requirements.md`](./docs/guide/02-requirements.md).

## Documentation

**Using Ensemblr** — the [user guide](./docs/guide/README.md):
[install](./docs/guide/01-install.md) ·
[requirements](./docs/guide/02-requirements.md) ·
[first run](./docs/guide/03-first-run.md) ·
[concepts](./docs/guide/04-concepts.md) ·
[workspaces](./docs/guide/05-workspaces.md) ·
[agents](./docs/guide/06-agents.md) ·
[terminals & run scripts](./docs/guide/07-terminals-and-run-scripts.md) ·
[reviewing changes](./docs/guide/08-reviewing-changes.md) ·
[agent control](./docs/guide/09-agent-control.md) ·
[integrations](./docs/guide/10-integrations.md) ·
[app settings](./docs/guide/11-app-settings.md) ·
[repository settings](./docs/guide/12-repository-settings.md) ·
[shortcuts](./docs/guide/13-keyboard-shortcuts.md) ·
[troubleshooting](./docs/guide/14-troubleshooting.md)

**Working on Ensemblr** — [`CONTRIBUTING.md`](./CONTRIBUTING.md) ·
[`docs/onboarding.md`](./docs/onboarding.md) (clone → run → first change) ·
[`docs/architecture-map.md`](./docs/architecture-map.md) (which directory owns which concern) ·
[`docs/adr/`](./docs/adr) (52 Architecture Decision Records) ·
[`docs/agent-control.md`](./docs/agent-control.md) ·
[`docs/harnesses.md`](./docs/harnesses.md) ·
[`docs/build-and-release.md`](./docs/build-and-release.md) ·
[`CONTEXT.md`](./CONTEXT.md) (product definition and ubiquitous language) ·
[`SECURITY.md`](./SECURITY.md)

---

## What it does

**Agents drive the app — that is the point.** Ensemblr Control is a permission-gated surface that lets an
agent spawn conversations, launch harnesses, run terminals, open file and diff tabs, read the workspace
diff and leave review comments on it, read and write Linear issues, ask you a multiple-choice question, and
move its workspace across the board. Pi reaches it through a shipped extension; Claude Code and any
MCP-capable harness reach the same operations through an embedded MCP server, so the two surfaces cannot
drift.

**Multi-agent orchestration, not just a fan-out button.** The root agent delegates a unit of work per
sub-agent, each in its own tab and its own context, then blocks on `ensemblr_wait_for_agents` until they
report back — no hand-rolled polling loop. Sub-agents do their own work and never delegate onward, so the
tree stays one level deep. Depth, spawn count, and spawn rate are capped. Linear writes are withheld from
sub-agents, and nothing at any depth can move an issue to a completed or canceled state: agent work stops
at In Review, enforced in code rather than in a prompt.

**The Concierge sits above every workspace.** One panel, opened from a floating launcher rather
than a workspace's own chat strip, that reads across every project and workspace you have open —
files, diffs, review comments, terminal output, the board, Linear — and remembers what it learns
between conversations in a memory of its own. It never writes a file itself: real change is
delegated to an orchestrator it spawns into the workspace that needs it, so the containment that
keeps one workspace from touching another also keeps the Concierge from becoming a way around it.

**Two agent runtimes, one chat surface.** Pi runs as a CLI in RPC mode; Claude Code is driven through the
Agent SDK against *your own* `claude` binary — Ensemblr ships none. Both share the same timeline, tool
cards, model and thinking pickers, tool-approval prompts, git-backed checkpoints, session branching, and
composer attachments. **Plan mode** holds an agent to read-only tools until it submits a plan, enforced per
tool call rather than by instruction, and inherited by every sub-agent it spawns.

**A worktree manager underneath.** Start a workspace from an existing branch, a GitHub PR, or a Linear
issue. Each one is a git worktree with its own branch, working tree, agent sessions, run state, and review
path. A workspace either *adopts* an existing branch or *cuts* a fresh one; the base branch is fetched and
fast-forwarded first, and can be retargeted later without touching the worktree. A dashboard board groups
workspaces into Backlog, In progress, In review, Done, and Canceled.

**A board that starts before the workspace does.** Backlog also carries the work that has no workspace yet
— unstarted Linear issues and unassigned open GitHub issues — and dragging one rightward is what creates
the workspace from it. Nothing is ever written back to the tracker: dismissing an issue hides it locally,
and its own status stays yours to change. GitHub issues are cached locally so the board paints at app
start rather than waiting on a `gh` call per repository, and says so when it is showing cached rows.

**Integrations that account for more than one account.** Connect any number of Linear organizations at
once — every one syncs, and browse, search, and the issue pickers show them all with the organization on
each row. Link a repository to an Infisical project and its secrets resolve live into every workspace,
terminal, and agent at launch, never written into the repository. Claude Code sessions surface what the
account has spent against its claude.ai plan, per rate-limit window, next to the session's running cost.

**Local-first review that ends in GitHub.** One panel with Files, Changes, and Checks. Source-scoped diffs,
per-file discard, a live file tree, and review comments anchored to specific lines that agents can read,
answer, and resolve. Then an inline PR editor, commit and push, per-check status through `gh`, and a
two-step merge — or archive the workspace instead.

**Terminals and run scripts.** An xterm.js dock over real PTYs, restored across restart. A repository
declares any number of named run scripts in its committed `.ensemblr/settings.toml`, each with a command
and an icon, one of them the ⌘R default; single-command setup and archive scripts run on the same
lifecycle, with setup fingerprinted so an unchanged workspace skips it.

**Three languages.** The app ships in English, Russian, and Greek — window, native menu bar, and the prose
agents write back. A user-facing string a change adds ships translated in the same change.

The scope rests on **five commitments**: the agent can drive the app under permission; isolation is the
product; the agent runtime is pluggable and never privileged; review is local-first and ends in GitHub;
configuration is committed, legible, and ours.

---

## What it stores, and where

There is no Ensemblr account to create, nothing to sign in to, and nothing synced off your machine.

- **No account, no server.** Ensemblr talks to GitHub, Linear, and your agent CLIs directly. There is no
  Ensemblr backend in the path and no telemetry.
- **GitHub tokens stay with `gh`.** Ensemblr stores none — no token field in settings, no OAuth screen, no
  second place one can leak from. It shells out to the CLI you already authenticated.
- **Secrets live in the macOS Keychain**, never a file and never an environment variable. Linear's OAuth
  tokens go straight there; the app can list what it holds without reading it back.
- **State is a local SQLite database** (Node 24's built-in `node:sqlite`), alongside worktrees under a root
  directory you choose.
- **No agent binary ships in the app.** Your `pi` and `claude` installs, your credentials, your models,
  your config — the ~260 MB the Claude Agent SDK would bundle is deliberately left out.

The threat model, including what is explicitly *out* of scope, is [`SECURITY.md`](./SECURITY.md); what each
integration stores is [`docs/guide/10-integrations.md`](./docs/guide/10-integrations.md).

---

## Core vocabulary

Full glossary in [`CONTEXT.md`](./CONTEXT.md); the user-facing tour is
[`docs/guide/04-concepts.md`](./docs/guide/04-concepts.md).

| Term | Meaning |
| --- | --- |
| **Project** | A tracked codebase Ensemblr can open, configure, and use as the source for workspaces. |
| **Workspace** | An isolated project copy for one stream of work — its own branch, working tree, agent sessions, run state, and review path. |
| **Agent Runtime** | A coding agent Ensemblr drives on its own chat surface — Pi or Claude Code — selected per conversation. |
| **Harness** | A coding-agent CLI launched in a workspace terminal tab as its native TUI, rather than on the chat surface. |
| **Ensemblr Control** | The permission-gated surface that lets an agent drive the app itself, through the `ensemblr_*` tools. |
| **Review Flow** | Inspect changes, run checks, create a PR, merge accepted work, or archive rejected work. |

---

## Tech stack

| Area | Choice |
| --- | --- |
| Desktop shell | Electron 43, Electron Forge 7 (Vite plugin, Fuses hardening) |
| UI | React 19, TypeScript 7 (strict) |
| Styling | Tailwind CSS 4, shadcn/ui (`radix-nova`) + Radix UI, Lucide icons |
| Routing | TanStack Router (file-based) |
| Async data | TanStack Query, TanStack Virtual |
| State | Jotai |
| Composer editor | Lexical (`lexical` + `@lexical/react`), plain-text mode with decorator-node chips |
| Localization | i18next 26 + react-i18next 17 — `en` / `ru` / `el`, catalogues bundled as JSON |
| Terminal | xterm.js 6 + `node-pty` |
| Markdown | `streamdown` + Shiki |
| Agent runtimes | Pi (CLI RPC) + Claude Code (`@anthropic-ai/claude-agent-sdk`); Codex / Vibe / `claude` TUI as terminal harnesses |
| Agent control | Loopback HTTP + MCP (`@modelcontextprotocol/sdk`) |
| Validation | Zod 4 |
| Storage | SQLite via Node 24's built-in `node:sqlite` |
| Build | Vite 8, Electron Forge (DMG + ZIP, hardened runtime, arm64) |
| Testing | Vitest 4 (+ happy-dom) and `electron --test` |
| Lint / format | Biome 2.5 |
| Runtime / package manager | Node 24.x (exactly), npm 11 |

---

## Contributing

Issues are welcome. For code, open an issue to discuss the change first — this is a pre-1.0 codebase with
opinionated structure, and a large unsolicited diff is hard to take. Start at
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

Security reports go to [`SECURITY.md`](./SECURITY.md), never to a public issue.

## License

Licensed under the [Apache License, Version 2.0](./LICENSE). Copyright 2026 Philipp Soldunov.

Bundled third-party components and their licenses are listed in [`NOTICE`](./NOTICE).

### Trademark

Ensemblr™ is a trademark of Philipp Soldunov (EUTM application pending).

The Apache 2.0 license covers this source code. It does not grant any
right to use the Ensemblr name, logo, or branding. You may state that
your project is derived from or compatible with Ensemblr. You may not
name your fork or distribution "Ensemblr", nor use the name or logo in
a way that suggests endorsement by or affiliation with the project.

Built with love in Cyprus 🇨🇾
