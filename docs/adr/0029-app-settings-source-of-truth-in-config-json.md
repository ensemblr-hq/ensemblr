# 0029. App Settings Source of Truth in config.json

Date: 2026-06-15

## Status

Accepted

## Context

App (user-scope) settings were persisted in the renderer via Jotai
`atomWithStorage`, i.e. browser `localStorage` inside the Electron renderer.
That made the settings opaque to inspection, impossible to hand-edit, and
invisible to the declarative `~/.config/ensemble/config.json` that ADR 0009
established as Ensemble's user configuration format.

We want `config.json` to be the source of truth for App settings so users (and
managed/policy tooling) can read and edit them directly, and so the "Edit in
config.json" affordance opens the file that actually drives the app.

This change covers the **General** and **Models** sections only. Repository
settings are out of scope.

## Decision

App settings for General and Models are persisted in
`~/.config/ensemble/config.json` under `app.general.*` and `app.models.*`, and
that file is the source of truth.

- A shared Zod schema (`src/shared/config/app-settings.ts`) defines the settings,
  their defaults, and per-field fallback (`.catch`) so a hand-edited file is
  resilient: a missing or invalid field defaults rather than rejecting the file.
- The main process owns the file via an `AppSettingsService`: it creates the file
  with defaults on first use, applies section-scoped patches with an atomic
  temp-write + rename, and **watches** the file for external edits, broadcasting
  changes to the renderer (suppressing the echo of its own writes).
- IPC: `getAppSettings`, `updateAppSettings(patch)`, `openAppConfigFile`, and the
  `onAppSettingsChanged` broadcast.
- The renderer mirrors the file in a Jotai atom hydrated on launch and kept in
  sync with external edits; per-setting atoms keep the existing `useAtom` API, so
  consumers are unchanged. Writes are optimistic and persisted through IPC.
- Settings **not** on the Settings page stay in `localStorage`
  (`atomWithStorage`): composer favourites, the model-catalog cache, and the
  app preferences not yet migrated (Appearance, Git, Experimental, Advanced).
- Seeding is fresh: the file is created with defaults; existing `localStorage`
  values are not migrated.

## Alternatives Considered

### Keep `localStorage` as source of truth, mirror to `config.json`

Rejected: two writers, drift, and the file wouldn't be authoritative — defeating
the goal of a hand-editable source of truth.

### Persist to SQLite

The earlier settings inventory imagined SQLite. Rejected for user-facing App
settings: SQLite isn't hand-editable or inspectable, and ADR 0009 already
designates `config.json` as the user configuration surface.

### Poll instead of watch

Rejected: a filesystem watch gives immediate live-reload for external edits with
less overhead than polling; debounced and echo-suppressed against our own writes.

## Consequences

- App settings are inspectable and hand-editable; "Edit in config.json" opens the
  authoritative file (created if missing).
- External edits live-reload the UI.
- The settings inventory's app-wide precedence simplifies for migrated sections:
  `config.json` holds the user's values directly, with schema defaults filling
  gaps — no separate SQLite layer for these.
- Mixed storage during migration: General/Models in `config.json`, other sections
  still in `localStorage` until a follow-up pass moves them.
- A bad value typed into the file degrades to that field's default rather than
  breaking the app.
