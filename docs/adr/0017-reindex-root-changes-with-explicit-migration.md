# 0017. Reindex Root Changes with Explicit Migration

Date: 2026-06-04

## Status

Accepted

## Context

Ensemble uses a configurable root directory for managed repositories, workspaces, and archived contexts. Conductor's settings copy warns that changing the root can delete existing repos and workspaces. Ensemble also targets shared-root interoperability with Conductor, so destructive root behavior would be risky.

## Decision

Ensemble will not automatically delete existing repositories or workspaces when the root directory changes.

Changing the root directory means Ensemble will switch to the selected root and reindex/adopt repositories and workspaces found there. Existing files in the previous root remain on disk unless the user explicitly chooses a separate cleanup/delete action.

Migration behavior:

- Reindex/adopt is the default root-change behavior.
- Moving repositories/workspaces from one root to another is an explicit migration action.
- Deleting old root contents is an explicit destructive action requiring confirmation.
- If the new root is shared with Conductor, Ensemble applies the shared-root interoperability rules.

## Consequences

- Root changes are safer and better aligned with Conductor interoperability.
- Users may have orphaned old roots until they explicitly clean them up.
- The UI must clearly explain the difference between switching roots, migrating contents, and deleting contents.
- SQLite records must reconcile against filesystem/git reality after root changes.
