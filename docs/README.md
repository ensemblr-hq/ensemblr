# Ensemblr Documentation

Documentation for Ensemblr — a macOS orchestrator for multi-agent coding work,
driving the Pi CLI or the Claude Code CLI. Agents drive the app itself through
**Ensemblr Control**; the worktree manager underneath keeps a fan-out of them
from colliding. Start with the root [`README.md`](../README.md) for an overview,
then dive in here.

## Using Ensemblr

The current build is [`0.1.0-beta.14`](https://github.com/ensemblr-hq/ensemblr/releases/tag/v0.1.0-beta.14) — signed, notarized, Apple silicon only. [Download the `.dmg`](https://github.com/ensemblr-hq/ensemblr/releases/download/v0.1.0-beta.14/Ensemblr-0.1.0-beta.14-arm64.dmg). You bring your own agent CLI — Pi or Claude Code, one is enough — plus `git` and an authenticated `gh`.

- [`guide/`](./guide) — the user guide: [install](./guide/01-install.md), [requirements](./guide/02-requirements.md), [first run](./guide/03-first-run.md), [concepts](./guide/04-concepts.md), and the day-to-day surfaces through to [troubleshooting](./guide/14-troubleshooting.md). Start at [`guide/README.md`](./guide/README.md).

## Working on Ensemblr

- [`onboarding.md`](./onboarding.md) — clone → prerequisites → install → run → first change → first PR, including which test runner a new test belongs to.
- [`architecture-map.md`](./architecture-map.md) — which directory owns which concern across the four runtime boundaries, the IPC contract path, and where state persists.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — how to propose a change, which gates must pass, and what CI does and does not run.

## Guides

- [`agent-control.md`](./agent-control.md) — **Ensemblr Control**: how agents drive the app, the permission model, guardrails, and multi-agent orchestration.
- [`harnesses.md`](./harnesses.md) — the two first-class agent runtimes (Pi, Claude Code) versus the terminal harnesses Ensemblr launches as their native TUI, with install, auto-approve, and resume details.
- [`build-and-release.md`](./build-and-release.md) — packaging, code signing, notarization, and build channels.

## Reference

- [`pi/`](./pi) — Pi integration internals: the [RPC protocol](./pi/rpc-protocol.md) and [event taxonomy](./pi/event-taxonomy.md).
- [`claude/`](./claude) — Claude Code runtime internals: the [runtime guide](./claude/README.md) (adapter wiring, discovery, live-discovered slash commands / MCP roster / model catalogue, effort, context measurement) and the [SDK surface reference](./claude/sdk-surface.md). [ADR 0042](./adr/0042-add-claude-code-as-a-second-first-class-agent-runtime.md) is the decision record.
- [`adr/`](./adr) — **54** Architecture Decision Records, numbered `0001`–`0055` (`0007` was withdrawn before acceptance), covering the accepted decisions and their supersessions. ADRs are historical records: some cite planning documents that were removed before the public release, and those references are left as written rather than rewritten after the fact.
- [`ux-conventions.md`](./ux-conventions.md) — the settled workflows, information architecture, visual design, copy, and icon conventions the shell is built to.
- [`i18n-glossary.md`](./i18n-glossary.md) — the Russian and Greek product vocabulary every translation is held to. The completion contract itself is [`.claude/rules/i18n.md`](../.claude/rules/i18n.md).
- [`considerations/`](./considerations) — design records and forward-looking notes: the [Ensemblr Control design](./considerations/agent-control-layer.md) and the [orchestration playbook](./considerations/agent-orchestration-playbook.md).

## Repository docs

- [`../CONTEXT.md`](../CONTEXT.md) — product definition and ubiquitous language.
- [`../CHANGELOG.md`](../CHANGELOG.md) — notable changes (Keep a Changelog format).
- [`../AGENTS.md`](../AGENTS.md) — contributor policies (npm, Biome, Jotai, Tailwind, JSDoc). Each `src/*` subtree has its own scoped `AGENTS.md`.
- [`../.claude/rules/`](../.claude/rules) — the binding rule files `AGENTS.md` defers to: [`stack.md`](../.claude/rules/stack.md) (pinned versions and non-obvious constraints), [`patterns.md`](../.claude/rules/patterns.md) (structural patterns), [`jsdoc.md`](../.claude/rules/jsdoc.md), [`comments.md`](../.claude/rules/comments.md), [`i18n.md`](../.claude/rules/i18n.md) (translation completeness), [`code-review.md`](../.claude/rules/code-review.md).
- [`../SECURITY.md`](../SECURITY.md) — the threat model and how to report a vulnerability.
- [`../LICENSE`](../LICENSE) — Apache License 2.0. [`../NOTICE`](../NOTICE) carries the bundled third-party attributions.
