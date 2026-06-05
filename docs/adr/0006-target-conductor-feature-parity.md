# 0006. Target Conductor Feature Parity

Date: 2026-06-04

## Status

Accepted

## Context

The product goal is to build Ensemble as a Pi-focused desktop workbench with complete feature parity with Conductor, aside from the agent runtime and previously locked stack decisions.

Conductor's public docs describe a product centered on isolated git-backed workspaces, parallel agents, setup/run/archive scripts, workspace review, diff comments, checks, pull requests, checkpoints, repository settings, MCP, terminal workflows, and workspace-specific environment variables.

Ensemble should match Conductor's workflows and capability surface while remaining a distinct product with its own code, branding, assets, and implementation.

## Decision

Ensemble will use Conductor feature parity as the product target.

Feature parity means matching publicly observable and documented behavior where practical, especially:

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

Ensemble will not copy Conductor's proprietary code, private implementation, brand identity, visual assets, or trademarks. When Conductor-specific labels are not appropriate, Ensemble may use equivalent names while preserving user-facing workflow compatibility.

## Alternatives Considered

### Pi-only minimal desktop app

Ensemble could be a simpler Pi session browser with terminal panes and project history. This is rejected because the stated product goal is Conductor-style parallel work and review flow, not only Pi session management.

### Inspired-by-Conductor workflow

Ensemble could borrow only broad concepts from Conductor. This is rejected because the product target is complete feature parity, with differences only where Pi or the chosen stack require them.

## Consequences

- The roadmap should be organized as a Conductor parity matrix.
- Architecture decisions must preserve worktree-based parallelism, reviewability, and local script/process workflows.
- UX can be distinct, but workflows should feel familiar to Conductor users.
- The implemented workbench shell is the current product contract for Conductor-style layout and visible affordances; future work should wire behavior into those surfaces rather than redesigning the app shell.
- Pi-specific differences must be explicit rather than accidental.
- Implementation should prioritize the highest-leverage parity features before polish.
