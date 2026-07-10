# MVP Sequencing

Date: 2026-06-04

Ensemblr targets Conductor feature parity adapted for Pi. MVP sequencing is about implementation order, not reduced product ambition.

## Principle

Build every major Conductor workflow, adapted for Pi, in thin vertical slices before polishing visual details.

## Milestone 0: Product Foundation

- Electron + React + TypeScript app shell.
- shadcn/ui + Tailwind design foundation.
- SQLite database and migrations.
- `~/.config/ensemblr/config.json` loader and schema stub.
- Ensemblr root directory management.
- Repository config loader for the committed `.ensemblr/settings.toml` and `.worktreeinclude`.
- Setup gate checks.
- Linear OAuth connection surface and token storage foundation.

## Milestone 1: Workspace Core

- Add/open repository.
- Sign in to Linear and browse/search/read issues.
- Managed root layout: `repos/`, `workspaces/`, `archived-contexts/`.
- Create git worktree workspace with branch.
- Create workspace from Linear issue.
- Discover/adopt existing workspaces from shared Conductor root.
- Create `.context/` in each workspace.
- Files-to-copy behavior.
- Setup script execution.
- Workspace list/sidebar and status.

## Milestone 2: Pi Agent Core

- Pi CLI RPC session creation through discovered/overridden executable.
- Preserve `~/.pi/agent` and project resource loading.
- Structured Pi event timeline.
- Prompt input, steering/follow-up, abort.
- Model/thinking controls mapped from Pi capabilities.
- Tool call/result rendering.
- Pi session mapping to workspace.
- Basic checkpoints around Pi turns.

## Milestone 3: Terminal And Run Scripts

- xterm.js terminal pane.
- PTY/process service.
- Run script button and lifecycle.
- Setup/archive/run logs.
- `ENSEMBLR_*` env vars.
- Concurrent/nonconcurrent run script modes.

## Milestone 4: Review Flow

- File status and diff viewer.
- Turn diff from checkpoints.
- Local diff comments.
- Send selected review/comment context to Pi.
- Commit, push, PR creation through `gh`.
- PR metadata and checks tab.
- Linear issue create/read/update/comment actions, plus workspace-linked metadata/status.
- GitHub comments/review threads where practical through `gh`.
- Merge readiness and merge action.

## Milestone 5: Settings And Parity Polish

- App settings.
- Repository settings.
- Declarative config viewer/source precedence.
- Security/privacy settings.
- Appearance and storage settings.
- Keyboard shortcuts and command palette.
- Deep links.
- Big terminal mode.
- Error/empty/loading states.

## Deferred Until After Core Completion

- Packaging, signing, notarization, and auto-update.
- SDK sidecar process isolation.
- Managed/bundled Pi runtime installer.
- Full Conductor checkpoint-ref interoperability.
- Voice mode.
- Graphite stack support.
- Cloud or remote workspace SSH settings.
- Production React profiler controls.
