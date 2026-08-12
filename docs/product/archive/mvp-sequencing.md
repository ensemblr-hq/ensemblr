# MVP Sequencing

Date: 2026-06-04 (status reviewed 2026-08-08)

> **Archived 2026-08-08.** Milestones 0–4 are complete and Milestone 5 is largely
> complete, so nothing here is actionable: this document records the original
> ordering, not a live checklist. It is kept for provenance and is no longer
> maintained. See `docs/product/archive/README.md`.
>
> **Live equivalent:** `docs/product/implementation-roadmap.md` — its *Roadmap
> Sequence* table carries the same milestone ordering against shipped state, its
> *Milestone Dependencies* section carries the ordering constraints, and its
> *Completed Implementation* tables attach PR/commit evidence. The deferred list
> below survives verbatim as that document's *Explicitly deferred until
> post-core*.
>
> Two Milestone 2 lines have been overtaken: the app now runs **two** agent
> runtimes (Pi via CLI RPC, Claude Code in-process via the SDK) as siblings under
> `src/main/agent-runtime/` (ADR 0042), and Milestone 3's run-script line now
> means any number of named `[scripts.run.<name>]` scripts rather than one
> `run` command (ADR 0041). Milestone 5's "Big terminal mode" was satisfied by
> the terminal dock and is not a separate setting.

Ensemblr targets the full workbench. MVP sequencing is about implementation order, not reduced product ambition.

## Principle

Build every major workflow in thin vertical slices before polishing visual details.

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
- Discover/adopt existing workspaces from a shared root.
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
- Full checkpoint-ref interoperability with another workspace manager.
- Voice mode.
- Graphite stack support.
- Cloud or remote workspace SSH settings.
- Production React profiler controls.
