<p align="center">
  <img alt="Ensemblr" src="./assets/wordmark.gif" width="588">
</p>

# Ensemblr

**A macOS workbench for isolated, multi-agent coding workflows.**

Ensemblr is a native macOS desktop app for running coding-agent work in isolated project workspaces.
Isolation is the product: every stream of work gets its own worktree, branch, and review path.
**Pi** and **Claude Code** are its two first-class agent runtimes, driven on the app's own chat surface;
third-party CLIs (Codex, Vibe, and the `claude` TUI) also run as terminal harnesses, and a
permission-gated control surface — **Ensemblr Control** — lets agents drive the app itself.

![The Ensemblr dashboard board, with workspace cards spread across the Backlog, In progress, In review, and Done columns.](./docs/guide/images/00-hero-dashboard.png)

- **Version:** [`0.1.0-beta.1`](https://github.com/ensemblr-hq/ensemblr/releases/tag/v0.1.0-beta.1) (pre-1.0, polish stage)
- **Platform:** macOS on Apple silicon
- **License:** MIT

---

## Status

Ensemblr is **pre-1.0, in the polish stage**. The core workflows — isolated workspaces, Pi and Claude Code
agent sessions, the review and PR flow, and the GitHub / Linear / git integrations — are implemented and
wired to real services. The first public build is out as a **beta**; expect rough edges and breaking
changes before 1.0. See [`CHANGELOG.md`](./CHANGELOG.md) for recent changes.

## Install

**[Download Ensemblr 0.1.0-beta.1 (.dmg, Apple silicon)](https://github.com/ensemblr-hq/ensemblr/releases/download/v0.1.0-beta.1/Ensemblr-0.1.0-arm64.dmg)** — open it and drag Ensemblr to Applications.

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
[`docs/adr/`](./docs/adr) (47 Architecture Decision Records) ·
[`docs/agent-control.md`](./docs/agent-control.md) ·
[`docs/harnesses.md`](./docs/harnesses.md) ·
[`docs/build-and-release.md`](./docs/build-and-release.md) ·
[`CONTEXT.md`](./CONTEXT.md) (product definition and ubiquitous language) ·
[`SECURITY.md`](./SECURITY.md)

---

## What it does

**Isolated workspaces.** Start a workspace from an existing branch, a GitHub PR, or a Linear issue. Each
one is a git worktree with its own branch, working tree, agent sessions, run state, and review path. A
workspace either *adopts* an existing branch or *cuts* a fresh one; the base branch is fetched and
fast-forwarded first, and can be retargeted later without touching the worktree. A dashboard board groups
workspaces into Backlog, In progress, In review, Done, and Canceled.

**Two agent runtimes, one chat surface.** Pi runs as a CLI in RPC mode; Claude Code is driven through the
Agent SDK against *your own* `claude` binary — Ensemblr ships none. Both share the same timeline, tool
cards, model and thinking pickers, tool-approval prompts, git-backed checkpoints, session branching, and
composer attachments. **Plan mode** holds an agent to read-only tools until it submits a plan, enforced per
tool call rather than by instruction.

**Agents can drive the app.** Ensemblr Control is a permission-gated surface that lets an agent spawn
conversations, launch harnesses, run terminals, open file and diff tabs, read and write issues, and move
its workspace across the board — Pi through a shipped extension, Claude Code and MCP-capable harnesses
through an embedded MCP server. Linear writes are withheld from sub-agents, and nothing can move an issue
to a completed or canceled state: agent work stops at In Review, enforced in code.

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

The scope rests on **five commitments**: isolation is the product; the agent runtime is pluggable and never
privileged; the agent can drive the app under permission; review is local-first and ends in GitHub;
configuration is committed, legible, and ours.

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
| UI | React 19, TypeScript 6 (strict) |
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

[MIT](./LICENSE) © Philipp Soldunov

Built with love in Cyprus 🇨🇾
