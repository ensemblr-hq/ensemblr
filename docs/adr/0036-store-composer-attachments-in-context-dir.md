# 0036. Persist Composer Attachments Under the Workspace `.context/` Directory

Date: 2026-07-15

## Status

Accepted

Relates to [0027](0027-use-workspace-archive-lifecycle.md) (workspace archive
lifecycle), which owns the `.context/` handoff folder.

## Context

The composer needed to accept pasted and dropped images and files. Nothing
decided where those bytes live, how large a paste may be, or how non-raster
"images" such as SVG are handled.

## Decision

Persist attachments under the workspace's existing `.context/` handoff folder
via dedicated IPC channels, with a size-tiered copy-or-reference policy.

- New IPC channels `writeWorkspaceImageAttachment` and
  `writeWorkspaceFileAttachment` (`src/shared/ipc/channels.ts`). The main process
  writes raster images to `.context/images/` and other files to
  `.context/attachments/` (`src/main/workspace-files/list-workspace-files.ts`),
  reusing the `.context/` folder rather than inventing a new location.
- Size policy: files at or below 10MB are copied into the workspace; larger
  files with a resolvable source path are referenced by absolute path instead of
  copied; a 50MB hard cap bounds oversized in-memory pastes. The copy-vs-
  reference threshold is mirrored renderer-side in
  `src/renderer/lib/workbench/composer-attachments.ts`.
- Images are validated by magic-byte signature. Types with no raster signature
  (SVG, which is XML text) are rerouted to the file-attachment path and inlined
  as text rather than rejected.
- Attachments are serialized *into the prompt message text* when sent to Pi
  (`<attached_file path="…">…</attached_file>` blocks); raster images are
  referenced by their `.context/images/` path, so no image bytes travel on the
  RPC wire.

## Consequences

- Attachment bytes accumulate under `.context/` and travel with the archive
  snapshot per 0027.
- The 10MB copy-vs-reference threshold and the 50MB cap are duplicated across
  the main and renderer sides and must stay in sync.
- Supported raster formats are an explicit MIME allowlist; new formats require
  extending it.
