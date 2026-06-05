# 0023. Use Conductor-Style Merge Confirmation

Date: 2026-06-04

## Status

Accepted

## Context

Conductor's checks and PR flow presents merge readiness in the Checks panel. When checks pass, the merge action is prominent and ready. After selecting merge, Conductor presents a confirmation/final action flow, including archive behavior.

Ensemble uses `gh` CLI for v1 GitHub integration and targets Conductor parity for PR/check/merge workflows.

## Decision

Ensemble will use a Conductor-style merge confirmation flow.

Merge policy:

- When required checks pass and there are no unresolved blockers, show a prominent ready-to-merge action.
- Selecting merge opens a confirmation step rather than merging immediately.
- The confirmation step summarizes branch, PR, check state, unresolved comments/todos, and archive behavior.
- The final merge action runs through `gh pr merge` where permissions allow.
- After a successful merge, offer or perform archive according to repository/app setting.

Recommended defaults:

- Require confirmation before every merge.
- Archive after merge when the user's repository/app setting enables it.
- Do not allow merge with failing required checks by default.
- If GitHub allows an override path, expose it only as an explicit warning action requiring confirmation.
- Automerge is a separate explicit action when GitHub/repository policy supports it.

## Consequences

- Ensemble matches Conductor's two-step ready/confirm merge ergonomics.
- Merge is treated as an externally visible irreversible action requiring confirmation.
- The Checks panel must model blockers, check state, comments, todos, and archive-on-merge state.
- `gh` command failures must be shown with clear remediation and no hidden retry loops.
