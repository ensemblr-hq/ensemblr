# 0041. Multiple Named Run Targets Per Workspace

Date: 2026-08-05

## Status

Accepted

Relates to [0007](0007-support-conductor-compatible-repository-config.md)
(Conductor-compatible repository configuration) and
[0030](0030-use-ensemblr-settings-toml-as-sole-repository-config.md) (sole
`.ensemblr/settings.toml` config).

## Context

A workspace had exactly one `scripts.run` command: one fixed "Run" dock tab,
one ⌘/Ctrl+R hotkey, one settings-screen field. A monorepo with several
independently runnable projects (e.g. a `web` frontend and an `api` backend)
had no way to start more than one dev server per workspace — running a second
command meant reusing the same slot and losing the first.

`runScriptMode` (`concurrent`/`nonconcurrent`) already let the *same* run
command overlap with itself inside one workspace, but there was no way to
configure and run *different* named commands side by side, and no UI to show
more than the latest session's output.

## Decision

Add named run targets, each independently start/stop-able and able to run
concurrently with its siblings:

- **Config shape.** `scripts.run` becomes polymorphic rather than gaining a
  new key: a bare string (`run = "npm run dev"`) keeps working unchanged and
  parses to one unnamed target (id `default`); an array of tables
  (`[[scripts.run]] name = "Web" \n command = "npm run dev:web"`) declares
  several. Personal SQLite overrides mirror the same array shape (JSON) rather
  than a plain string. `scripts.setup` and `scripts.archive` are unaffected —
  this feature is scoped to `run` only.
- **Identity.** Each target carries a stable `id` — explicit when set (SQLite
  writes always assign one via `crypto.randomUUID()` at creation in the
  Settings editor), otherwise derived from a slug of `name` with a numeric
  suffix on collision. Renaming a target in the Settings screen keeps its `id`,
  so a running session's exclusivity lock and dock tab survive the rename;
  renaming inside hand-edited TOML without setting an explicit `id` does not
  carry that guarantee (documented as a hand-edit caveat).
- **Concurrency scoping.** `runScriptMode` keeps its existing meaning —
  whether *the same* target can have overlapping relaunches — now scoped by
  `(workspaceId, kind, runTargetId)` instead of `(workspaceId, kind)`.
  Different targets always run independently of each other and of this
  setting: starting `api` never blocks on, races, or stops `web`.
- **Sessions.** No new terminal-session kind or DB migration: `run-script`
  sessions gain a `runTargetId` field on the live in-memory session snapshot.
  It is not persisted to `metadata_json` and does not need to be — run-script
  sessions are never restored across restarts (only interactive `terminal`
  sessions are), so the id only has to survive for the life of the process.
  Preview-URL auto-detection already scans per session, so it already worked
  per target with no change.
- **Dock UI.** One dock tab per configured run target (dynamic ids
  `` run:${id} ``), each with its own Run/Stop and preview-Open controls moved
  into the tab's own panel — mirroring how Setup's controls already lived
  in-panel rather than the shared header, which only ever worked for a single
  run script. A workspace with zero configured targets still shows one
  placeholder "Run" tab (id `default`) with the "No run script configured"
  empty state, matching the always-present Setup tab.
- **Hotkey.** ⌘/Ctrl+R acts on the run target it last started or stopped,
  falling back to the first configured target when none has been used yet —
  reducing to today's exact single-target behavior for the common case.
- **Auto-run after setup.** `autoRunAfterSetup` now starts every configured
  run target once setup exits cleanly, not just one.

## Consequences

- Existing single-string `scripts.run` configs and their personal SQLite
  overrides keep working with no migration and no on-disk format change.
- The Settings screen's single "Run script" field becomes a repeatable
  name+command list with add/remove rows.
- `WorkspaceScriptSettings.scripts` no longer carries `run`; run targets live
  in a dedicated `runTargets: WorkspaceRunTarget[]` field, since `setup`/
  `archive` remain single scalars but `run` is now a list.
- `WorkspaceShellModel.scripts` similarly replaces its single `run` summary
  with `runTargets: WorkspaceRunTargetSummary[]`; every consumer (dock tabs,
  dock actions, the hotkey, script summaries) is target-aware.
- Conductor itself only understands the single-string `scripts.run` shape;
  a repo edited in Ensemblr with multiple named targets will read as an
  invalid/ignored field if reopened in Conductor. This is an accepted,
  Ensemblr-only extension of the shared field, called out in
  `docs/product/conductor-parity.md`.
