# 0071. Mirror Renderer `localStorage` into SQLite

Date: 2026-09-13

## Status

Accepted

Step one of closing **SH-03** from the 2026-09-12 security audit
(`docs/audits/2026-09-12-security-performance/09-electron-shell-deeplinks-supply-chain.md`).
It does not itself change how the renderer is served or which fuses the binary
ships with; it is the release that has to precede that change.

## Context

The packaged renderer is a `file:` document, and the
`GrantFileProtocolExtraPrivileges` fuse is granted. Electron's own warning about
that fuse is that a page on `file:` "has unilateral access to every file on your
machine", so a renderer XSS can read `~/.ssh/id_ed25519` with no IPC handler and
no path validation in the loop. The CSP added in #569 does not close it:
`connect-src` has to allow `file:` for the app to load its own assets, and
`img-src https:` — which draws pull-request badges — carries the result out.

The fuse cannot simply be flipped. Measured on a copied Electron with it off and
re-signed:

- The renderer entry is an ES module, and a module script is always fetched in
  CORS mode. With the fuse off the `file:` origin turns opaque, Chromium refuses
  every chunk, and the window comes up blank.
- A `file:` document with the fuse off also loses `localStorage` and
  `sessionStorage` outright — `SecurityError: … Access is denied for this
  document.`
- A custom `app://` scheme registered `standard` + `secure` works with the fuse
  off: origin `app://bundle`, `localStorage` works, module scripts execute, and
  `fetch('file:///etc/passwd')` is refused.

So the destination is `app://`. But web storage is keyed by *origin*, and the
renderer keeps real user state there — 39 persisted atoms across 30 files:
viewed-changes marks, board order, pins, collapsed projects, per-chat
model/thinking/Plan-Mode/AFK/linked-directory overrides, per-repository setting
overrides, PR drafts, recents, Linear issue filters, sidebar sizes. Serving the
next release from `app://` moves the origin and orphans every one of them, and
the fuse flip then makes the old ones permanently unreadable.

Nothing in the main process can reach another origin's storage after the fact:
Chromium keeps it in a LevelDB that Node has no reader for, and a `file:`
harvest window needs the very fuse being removed. The copy therefore has to be
taken **while the app is still served from `file:`** — in a release that ships
before the switch.

## Decision

The renderer keeps a **wholesale copy of its `localStorage` in the main
process**, and the main process can replay that copy into a renderer whose own
storage is empty.

- **Wholesale, not per key.** The snapshot is the storage area as one
  string-to-string map, so none of the 39 atoms — or the modules that call
  `setItem` directly — has to be named, and a key added later is carried without
  anybody remembering to.
- **Write-through, not one-shot.** `src/renderer/lib/storage-mirror.ts` pushes a
  snapshot when it starts, after each settled burst of writes, and on
  `pagehide`. A snapshot identical to the last one is not sent. This is what
  keeps the copy current: a one-time capture at first boot would be weeks stale
  by the time the switch ships.
- **Writes are intercepted where all writers pass.** Jotai's `atomWithStorage`
  reaches `localStorage` itself and several modules call it directly, so the
  mirror replaces `setItem`/`removeItem`/`clear` on the object that owns them —
  the prototype in a browser, the instance for a test double — rather than
  asking 30 files to route through a wrapper.
- **The copy lives in its own table**, `renderer_storage_mirror` (migration
  `032`), through
  `src/main/storage/repositories/renderer-storage-repository.ts`. Not the
  `settings` table, which was the first shape and the wrong one:
  `collectSqliteSettings` in `src/main/config/config-resolution.ts` enumerates
  every app-scope row with no key allowlist, so the blob came back as a resolved
  setting on every `settings-resolution` call — a query the renderer refetches
  per repository on window focus. Measured, a 200 KB mirror grew that response
  from ~1.5 KB to 201 KB.
- **Both directions are keyed by origin.** The mirror row records the origin its
  snapshot came from, and a separate `renderer_storage_seeded_origins` table
  records which origins have been seeded. Main takes the origin from
  `event.sender.getURL()` as `scheme://host` — built from protocol and host
  rather than read off `URL.origin`, which reports `null` for both `file:` and
  any non-special scheme, so the packaged `file:` renderer and a future
  `app://bundle` would be indistinguishable exactly where it matters. A snapshot
  main cannot attribute is refused (`unknown-origin`) rather than filed under a
  guess.
- **An origin is never seeded from a snapshot it took itself.** Its storage
  being empty means the user cleared it, not that the renderer moved — so a
  deliberate wipe stays wiped. A seed is offered only to an origin that has not
  been seeded before and did not author the mirror.
- **The seed is synchronous, happens in the preload, and is all-or-nothing.**
  `src/preload/seed-renderer-storage.ts` asks main for the mirror *only* when the
  document's own storage is empty, and applies it before any page script runs,
  so nothing reads a preference and finds nothing there. If any write is refused
  the whole replay is undone: a half-applied seed is the one state that destroys
  the mirror, because main refuses the snapshot missing those keys for the
  session and then accepts that same reduced storage on the next launch, when
  the document is no longer empty and no seed is offered. An emptied document is
  what the seed is designed to recognise.
- **The ceiling sits below an origin's quota, not above it.**
  `MAX_RENDERER_STORAGE_MIRROR_BYTES` is 4 MB of JSON against the ~5 MB an
  origin holds, because whatever is accepted has to be replayable into a target
  origin later. Accepting more than a document can hold is what makes a partial
  seed reachable in the first place.
- **Main marks an origin seeded only once a renderer proves the seed arrived.**
  The seed is handed out unmarked; the marker is written when that renderer's own
  snapshot comes back still carrying those keys. A snapshot that does *not* carry
  them is refused (`seed-not-applied`) and the older copy is kept — the one
  ordering that could otherwise destroy the only copy of the user's
  preferences. The check is key *presence*, not value equality: a renderer that
  boots and immediately rewrites a seeded preference has still received its seed,
  and demanding the values match would refuse its snapshots for the rest of the
  session.
- **An empty snapshot never replaces a populated mirror** (`empty-snapshot`).
  A renderer with nothing in its storage is either a fresh origin, which the
  seed is there to fill, or a renderer whose seed was rolled back. Neither is a
  reason to throw the copy away, and a genuine wipe re-syncs on the user's next
  preference write rather than being restored on the next launch.

Release N+1 then serves the renderer from `app://`, drops `file:` from
`PACKAGED_SELF` in `src/shared/content-security-policy.ts`, revisits
`appDocumentUrl`/`isAppOwnBlob` in `src/main/app/external-links-policy.ts`,
joins the `app://` registration to the single `registerSchemesAsPrivileged` call
in `src/main/linear/linear-asset-protocol.ts`, and sets
`GrantFileProtocolExtraPrivileges: false`.

## Rejected alternatives

### Ship the switch and the migration in one release

The migration has to run under the origin it is copying, so a release that
serves `app://` has already lost the `file:` storage before its first line runs.
The only single-release variant is a hidden `file:` harvest window, which needs
the fuse still granted, is unverified, and boots a second document at launch —
more risk than the sequencing it saves.

### Read Chromium's Local Storage LevelDB from main

Origin-independent and fully offline, but Node has no LevelDB reader, so it
means a native dependency compiled per platform to parse a private on-disk
format that Chromium may change in any Electron bump.

### Move the 39 atoms off `localStorage` onto main-process storage

The honest long-term shape, and it makes the origin irrelevant rather than
survivable. Rejected *for this release* because it touches 30 files and turns
synchronous reads into round-trips, which is a behaviour change to ship
alongside a security fix. The mirror does not block it: an atom moved later
simply stops appearing in the snapshot.

### Snapshot once at first boot, behind a marker

What the ticket originally proposed. It loses every preference change made
between that boot and the release that switches origins — which is the whole
period the user is actually working.

## Consequences

- The user's preferences exist in two places, and the renderer's copy stays the
  authority. The mirror is read only when an origin has no storage of its own.
- The switch to `app://` can be made in a later release without the user losing
  their board layout, viewed marks, or per-chat overrides.
- A renderer XSS can push up to 4 MB into the mirror. It is bounded, replaces
  only itself, and is refused above that ceiling. Nothing else reads the table,
  so the blob cannot reach a surface that did not ask for it.
- The mirror keeps working after the switch, so a *further* origin change gets
  its own seed rather than finding the one marker already spent.
- A profile restored onto a new machine is **not** covered, and that is the
  deliberate half of the trade. An origin whose storage is empty and whose
  snapshot the mirror already holds is indistinguishable from one the user
  cleared, and the two want opposite answers. Respecting the wipe wins: the
  restore case is a partial copy (SQLite carried across, Chromium's LevelDB
  left behind) and the user can repeat it, whereas a wipe silently undone on the
  next launch is a preference the app refuses to forget.
- Whether the seed reaches the page is proved by the renderer rather than
  assumed by the preload, so a seed that lands nowhere is retried on the next
  launch instead of being written off.
