# Ensemblr Documentation

Documentation for Ensemblr — a macOS workbench for isolated, multi-agent coding
workflows. Start with the root [`README.md`](../README.md) for an overview, then
dive in here.

## Start here

- [`onboarding.md`](./onboarding.md) — clone → prerequisites → install → run → first change → first PR, including which test runner a new test belongs to.
- [`architecture-map.md`](./architecture-map.md) — which directory owns which concern across the four runtime boundaries, the IPC contract path, and where state persists.

## Guides

- [`agent-control.md`](./agent-control.md) — **Ensemblr Control**: how agents drive the app, the permission model, guardrails, and multi-agent orchestration.
- [`harnesses.md`](./harnesses.md) — the third-party agent CLIs (Claude Code, Codex, Vibe) Ensemblr can launch, with install, auto-approve, and resume details.
- [`build-and-release.md`](./build-and-release.md) — packaging, code signing, notarization, and build channels.

## Reference

- [`pi/`](./pi) — Pi integration internals: the [RPC protocol](./pi/rpc-protocol.md) and [event taxonomy](./pi/event-taxonomy.md).
- [`adr/`](./adr) — **42** Architecture Decision Records (`0001`–`0042`), the accepted decisions and their supersessions.
- [`considerations/`](./considerations) — design records and forward-looking notes: the [Ensemblr Control design](./considerations/agent-control-layer.md), the [orchestration playbook](./considerations/agent-orchestration-playbook.md), and a [Deno-desktop migration study](./considerations/deno-desktop-migration.md).

## Product & planning

- [`product/`](./product) — roadmap, Conductor-parity notes, screen/settings/shell inventories, and discovery snapshots.
- [`refactor/`](./refactor) — refactor plans (e.g. the workbench composition refactor).

## Repository docs

- [`../CONTEXT.md`](../CONTEXT.md) — product definition and ubiquitous language.
- [`../CHANGELOG.md`](../CHANGELOG.md) — notable changes (Keep a Changelog format).
- [`../AGENTS.md`](../AGENTS.md) — contributor policies (npm, Biome, Jotai, Tailwind, JSDoc).
- [`../LICENSE`](../LICENSE) — MIT license.
