# 0035. Keep Workspace Pull-Request State Fresh With a Background Sweeper and Turn-Signal Refresh

Date: 2026-07-15

## Status

Accepted

Extends [0013](0013-use-gh-cli-for-v1-github-integration.md) (use `gh` CLI for
GitHub integration).

## Context

Pull-request snapshots were cached per workspace and only refreshed when a
workspace was open and being viewed. Two consequences followed: sidebar rows for
workspaces the user had not opened showed stale merge/checks status, and a pull
request the agent had just created did not appear until a manual refresh.

## Decision

Layer two complementary refresh tiers over the existing `gh`-backed snapshot
cache.

### Background sweeper (main process)

`createWorkspacePrStatusSweeper` (`src/main/github/workspace-pr-sweeper.ts`)
refreshes every non-archived workspace's cached snapshot on a fixed interval
(120s). It sweeps sequentially to bound `gh` load and swallows per-workspace
failures so one failing workspace never stalls the sweep. It is wired into the
IPC handler setup and disposed on shutdown.

A dependency-free shared deriver `deriveWorkspacePrPresentation`
(`src/shared/github-pr-presentation.ts`) collapses a snapshot into the compact
sidebar status, mirroring the renderer's fuller model so the main process and
renderer agree on merged/blocked/checking/ready without the main process
importing renderer types.

### Turn-signal refresh (renderer)

`classifyPullRequestRefreshAction`
(`src/renderer/hooks/workbench-shell/route-layout/detect-pull-request-creation.ts`)
inspects persisted Pi session events, detecting `gh pr create` in tool-call
input and PR URLs in tool-result output, and drives a retry-until-present state
machine so a freshly created PR surfaces in the active workspace immediately
rather than at the next sweep.

## Consequences

- A recurring main-process background service runs for the app lifetime.
- Two derivation paths for PR presentation (shared deriver, renderer model) must
  be kept in agreement; the shared deriver documents this coupling.
- Turn-signal refresh depends on parsing agent tool-call/result text and is a
  heuristic tied to `gh` output shape.
- Merged-PR header actions (continue vs archive the workspace) consume this
  state; they are UI wiring over the synced snapshot, not a separate decision.
