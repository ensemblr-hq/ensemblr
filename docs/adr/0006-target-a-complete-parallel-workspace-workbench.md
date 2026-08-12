# 0006. Target a Complete Parallel-Workspace Workbench

Date: 2026-06-04

## Status

Superseded by [0048](0048-retire-feature-parity-as-the-product-target.md) (2026-08-12).

Feature parity with another product is no longer Ensemblr's target. The scope
below is restated in Ensemblr's own terms in 0048; the capability list still
describes what the product covers, but "for parity" is no longer a reason to
build or to keep anything.

## Context

The product goal is a Pi-focused desktop workbench covering the whole isolated-workspace workflow: parallel git-backed workspaces, agent sessions, scripts, review, and merge.

That workflow is centered on isolated git-backed workspaces, parallel agents, setup/run/archive scripts, workspace review, diff comments, checks, pull requests, checkpoints, repository settings, MCP, terminal workflows, and workspace-specific environment variables.

Ensemblr should cover that whole surface while remaining a distinct product with its own code, branding, assets, and implementation.

## Decision

Ensemblr will target complete coverage of that workflow as the product goal.

Complete coverage means shipping working behavior across the whole surface, especially:

- Project and repository management.
- Git worktree workspace isolation.
- One workspace per shippable stream of work.
- Parallel workspace and same-workspace multi-session workflows.
- Setup, run, and archive scripts.
- Files-to-copy and `.worktreeinclude` behavior.
- Workspace environment variables and port allocation.
- Agent controls adapted to Pi.
- Structured agent timeline and terminal panes.
- Diff review, line comments, PR actions, checks, todos, and merge readiness.
- Checkpoints and revert behavior.
- MCP/resource behavior adapted to Pi's ecosystem.
- Settings, keyboard shortcuts, deep links, privacy/security posture, and troubleshooting workflows.

Ensemblr will not copy any other product's proprietary code, private implementation, brand identity, visual assets, or trademarks.

## Alternatives Considered

### Pi-only minimal desktop app

Ensemblr could be a simpler Pi session browser with terminal panes and project history. This is rejected because the stated product goal is parallel work and review flow, not only Pi session management.

### Borrow only broad concepts

Ensemblr could implement the broad shape of parallel workspaces and leave review, checks, and the PR flow shallow. This is rejected because the product target is complete coverage of the workflow, with differences only where Pi or the chosen stack require them.

## Consequences

- The roadmap should be organized as a capability matrix over that workflow surface.
- Architecture decisions must preserve worktree-based parallelism, reviewability, and local script/process workflows.
- UX can be distinct, but workflows should feel familiar to anyone who has used a parallel-workspace tool.
- The implemented workbench shell is the current product contract for layout and visible affordances; future work should wire behavior into those surfaces rather than redesigning the app shell.
- Pi-specific differences must be explicit rather than accidental.
- Implementation should prioritize the highest-leverage capabilities before polish.
