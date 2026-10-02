# 0072. Serve the Packaged Renderer from Its Own Origin

Date: 2026-09-13

## Status

Accepted

Step two — and the last — of closing **SH-03** from the 2026-09-12 security
audit (`docs/audits/2026-09-12-security-performance/09-electron-shell-deeplinks-supply-chain.md`).
Step one was [ADR 0071](./0071-mirror-renderer-local-storage-into-sqlite.md),
which put the renderer's `localStorage` where a change of origin cannot orphan
it. This one makes the change of origin.

**It must not ship in the same release as 0071**, and not merely because the
mirror has to have merged first: the mirror populates on *boot*, so it has to
have **run on the user's machine**. An install that launches the mirror release
once is covered; an install that jumps straight from a pre-mirror version to
this one has nothing to seed from and comes up with defaults.

That precondition is **met**: the mirror shipped in 0.1.15 and 0.1.16 has
shipped since, so the installed version already carries it. The residual gap is
only the install that skips both.

## Context

The packaged renderer was a `file:` document and
`GrantFileProtocolExtraPrivileges` was granted. Electron's own warning about
that fuse is that a page on `file:` "has unilateral access to every file on your
machine", so a renderer XSS read `~/.ssh/id_ed25519` with no IPC handler and no
path validation in the loop.

The CSP added in #569 could not close it. A `file:` document's own assets are
cross-origin to it, so `connect-src` had to include `file:` for the app to load
its own bundle — which is the same grant an XSS would use — and `img-src
https:`, needed for pull-request badges, carried the result back out. The fuse
was the only control in that chain.

Flipping the fuse alone does not work, and that was measured on a copied
Electron with it off and re-signed:

- The renderer entry is an ES module, and a module script is always fetched in
  CORS mode. With the fuse off the `file:` origin turns opaque, Chromium refuses
  every chunk, and the window comes up blank.
- A `file:` document with the fuse off also loses `localStorage` and
  `sessionStorage` outright — `SecurityError: … Access is denied for this
  document.`
- A custom `app://` scheme registered `standard` + `secure` works with the fuse
  off: origin `app://bundle`, `localStorage` works, module scripts execute, own
  assets fetch, and `fetch('file:///etc/passwd')` is refused.

## Decision

**The packaged renderer is served from `app://bundle` by a `protocol.handle`
registration, and `GrantFileProtocolExtraPrivileges` is off.** The two are one
change: either without the other ships a blank window.

- **`src/main/app/app-bundle.ts` holds the addressing and the path resolution,
  and imports no Electron**, so the resolution is unit-tested
  (`tests/main/app-bundle.test.ts`) rather than only exercised by a packaged
  build. `src/main/app/app-protocol.ts` is the Electron glue — the same split
  `external-links-policy.ts` / `external-links.ts` already uses.
- **The scheme answers one host and serves one directory.** A request whose host
  is not `bundle`, or whose path resolves outside the built renderer directory,
  is answered 404 rather than clamped. Two mechanisms share that work: the URL
  parser collapses a `..` segment (literal or `%2e`-spelled) before the pathname
  is read, and a `path.relative` check catches what survives because it was
  smuggled through an encoded separator (`..%2f`). This is Electron's own
  documented pattern for the scheme.
- **The scheme is declared alongside the Linear asset scheme**, in the single
  `registerSchemesAsPrivileged` call in
  `src/main/linear/linear-asset-protocol.ts`. Electron honours only the first
  such call — a second call's scheme fails to load as a document with
  `ERR_FAILED` — so there is one call and it is not in `src/main/app/`. Both
  schemes take `standard` + `secure` + `supportFetchAPI` and neither takes
  `bypassCSP` or `allowServiceWorkers`.
- **It is registered in development too**, where nothing loads it, so the
  packaged path is not a branch that exists only in a build nobody runs locally.
- **`file:` leaves the CSP entirely.** `'self'` now resolves to `app://bundle`,
  which is what a `standard` scheme buys, so the packaged source list is the
  same one development uses. A policy that no longer names `file:` is what
  turns the fuse from the only control into the second of two.
- **The navigation policy compares origins and nothing else.** While the
  renderer was `file:` its origin was opaque, so the entry had to be compared as
  a whole URL with the query and fragment stripped, and the app's own `blob:`
  could only be recognised by its inner *protocol* — which admitted any `file:`
  blob rather than this document's. Both collapse into the comparison
  development already used, and `AppDocument` collapses with them into one
  origin string.
- **Origins are built as `scheme://host`, never read off `URL.origin`**, which
  reports the string `"null"` for `file:` and for every non-special scheme —
  exactly where `app://bundle` and a `file:` document have to be told apart.
  `documentOrigin` in `app-bundle.ts` is that one function, shared by the
  navigation policy and by the storage mirror so the two cannot drift.

## Rejected alternatives

### Name `app://bundle` explicitly in the CSP alongside `'self'`

Belt and braces against `'self'` failing to resolve for a non-special scheme.
Rejected because it would not be belt and braces but a second source of truth:
a `standard` scheme has a tuple origin by definition, which is the property the
whole change rests on — if `'self'` did not resolve, `localStorage` and the
module graph would already be gone and the explicit source would not save the
build.

### Read bundle files with `fs` and build the `Response` by hand

Avoids depending on `net.fetch` resolving a `file:` URL inside `app.asar` and on
its MIME sniffing. Rejected: Electron's `file:` loader is asar-aware — it is how
`loadFile` reached the packaged entry before this change — and hand-rolling the
response means hand-rolling a MIME table, where getting `.js` wrong fails the
module graph on strict MIME checking. The documented pattern is `net.fetch`.

### Serve `app://` while leaving the fuse granted, and flip it in a third release

Would also cover the install that skips the mirror release, by keeping a
one-time `file:` harvest window open. Rejected as unwarranted: it needs a second
document at launch, is unverified, and buys only the version-skipping case. See
the note under Consequences.

## Consequences

- A renderer XSS can no longer read the user's files. `fetch('file:///…')` is
  refused by the fuse, and the CSP no longer names `file:` in any directive.
- The renderer keeps `localStorage` — ADR 0071's mirror seeds the new
  `app://bundle` origin from the snapshot the `file://` origin left behind, on
  first launch of this release.
- **An install that skips the mirror release loses its renderer preferences**
  — board order, viewed marks, pins, collapsed projects, per-chat overrides, PR
  drafts, Linear filters, sidebar sizes. Nothing else: everything else lives in
  SQLite. The mirror is written on boot, so this is bounded to users who jump
  from a pre-0071 version straight to this one.
- The `app:` scheme is now taken for the app's own bundle. Anything else the
  main process wants to serve to the renderer gets its own scheme in the same
  `registerSchemesAsPrivileged` array, not another host under `app://`.
- Deep links, the Linear asset scheme, the PDF `<embed>` and hash routing are
  unchanged. The router already used hash history, so no path under
  `app://bundle` other than the entry is ever navigated to.
