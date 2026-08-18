# 0054. Build Releases In CI And Reserve The Nightly Tag

Date: 2026-08-17

## Status

Accepted

Amends [ADR 0032](0032-channel-scoped-bundle-identity.md), whose per-channel
bundle id and product name stand. Only its claim that each channel is "a distinct
app at runtime" changes: identity stays per-channel, state no longer does.

**Updated 2026-08-18.** `nightly.yml` now carries `schedule: 0 4 * * *`, so the
paragraph below on staying dispatch-only is historical. The ordering dependency
it named is gone rather than satisfied: THE-195 was dropped, and ensemblr.dev now
pins two download links — the newest `v<semver>` and the rolling `nightly` — by
hand, re-pinned per release by an agent in that repository. A site that names
both tags explicitly cannot be hijacked by whichever release happens to be
newest, which is what the reserved-tag filter existed to prevent.

## Context

Six releases (`v0.1.0-beta.1` … `v0.1.0-beta.6`) were cut by hand — `npm run
make` on one Apple-silicon laptop holding a Developer ID certificate and an App
Store Connect key, then the `.dmg` and `.zip` uploaded to a GitHub Release by
hand. So a packaging break on `master` — a new `external` dependency missing from
`PACKAGE_KEEP_*`, a notarization step that stopped working — is discovered at
ship time, releasing is gated on one person at one machine, and nothing builds
the default branch between tags.

Two things make automating this more than a matter of writing a workflow.

**The signing gate fails open.** `notarizationEnabled` in `forge.config.ts`
requires darwin, `ENSEMBLR_SKIP_SIGN` unset, and all three Apple credentials.
Miss one and the build produces an unsigned `.app` and exits 0. That is the right
default for a contributor without Apple keys and exactly wrong for a release job,
where the failure is invisible until a user's Gatekeeper rejects the download.

**A nightly is not a private artifact.** ensemblr.dev's `getLatestRelease()`
takes the first non-draft entry from `/releases?per_page=10`, prereleases
included — every Ensemblr build so far is one, so `/releases/latest` would report
nothing. The first published nightly therefore becomes the advertised download on
the marketing site, and `check-pinned-release.ts` (a daily cron in that repo)
starts failing every night. Whatever distinguishes a nightly from a release is an
API a second repository consumes, not an internal naming choice.

## Decision

**Build in GitHub Actions on a pinned `macos-15` runner**, with `checks.yml`
converted into a `workflow_call` reusable workflow so the release path runs the
same verification a pull request does rather than a copy of it.

**A release is cut by writing its notes.** `release.yml` triggers on
`release: published`, not on a tag push. The existing ritual — `gh release create
vX.Y.Z --notes-file …` — already fires that event, so CI attaches binaries to a
release a human wrote, and pushing a bare tag deliberately does nothing. The
alternative, triggering on `refs/tags/v*`, forces the workflow to invent notes
with `--generate-notes` and would double-fire against the release event on a
build that spends half an hour notarizing.

**Signing is asserted twice, at the cause and at the effect.**
`ENSEMBLR_REQUIRE_SIGN=1` makes `forge.config.ts` throw before packaging, naming
the prerequisite it lacked; `npm run verify:signing` then walks `out/` and
asserts a *Developer ID Application* authority, `spctl` acceptance and a stapled
ticket on every `.app` and `.dmg`, and extracts each `.zip` to check the bundle
it actually holds. The first turns a silent fallback into an error, the second
catches anything that got past it.

The authority assertion covers the `.dmg` and not just the `.app` because the
other two checks are individually unsound: `stapler validate` passes on an
unsigned image, which is the whole failure below, and `spctl --assess` exits 0
on anything once Gatekeeper assessments are disabled — printing the same
`no usable signature` string it prints when *rejecting*. `codesign` is the only
one of the three whose verdict does not depend on machine policy.

The second assertion paid for itself on its first run: every release through
`v0.1.0-beta.6` shipped a `.dmg` that was **notarized and stapled but never
signed**. `spctl` rejects such an image with `no usable signature` on every
assessment type, because a notarization ticket needs a signature to attach a
verdict to — and `stapler validate` passes regardless, which is why six releases
went out without anyone noticing. `postMake` now runs `codesign --timestamp` on
each DMG before submitting it, and the same image then reports
`accepted / source=Notarized Developer ID`.

**The tag namespace is reserved, and it is a cross-repo contract.** `v<semver>`
is a real release. The literal `nightly` is a rolling tag whose release is
re-pointed and whose assets are clobbered each run. Nothing else publishes. A
rolling tag beats dated `nightly-YYYYMMDD` tags here: no retention prune job, a
permanently bookmarkable download URL, and change detection that reads the tag's
own commit (`git rev-parse refs/tags/nightly^{commit}`) rather than parsing a
release body or trusting a `pushed_at` timestamp — a quiet week must not
republish an identical binary. The tag is force-moved rather than deleted and
recreated, which preserves the release's `created_at` so the nightly sinks down
`/releases` instead of jumping to the top every night.

**The nightly ships on the canary channel and stays dispatch-only until the site
can filter it.** Canary gives it `dev.ensemblr.app.canary` and "Ensemblr Canary"
per ADR 0032, so an installed nightly can never take over the release's Launch
Services registration. `nightly.yml` carries no `schedule:` block and its
`publish` input defaults to false, so the whole signing path is exercisable today
without hijacking the download button; the cron lands when THE-195 deploys the
filter in both `getLatestRelease()` and `check-pinned-release.ts`.

**A packaged dogfood channel shares the release's state.** ADR 0032 treated
per-channel `userData` as a feature, because Electron derives it from the product
name. That was already only half true — the SQLite database is keyed on the
`dev.ensemblr.app` constant and the config on the home directory, so both were
channel-independent from the start — and the half that held was the wrong half:
it stranded the localStorage-backed recents, workspace selection and per-repo
overrides in a sibling directory while leaving two channels free to open the same
database concurrently. `src/main/main.ts` now pins `userData` to the release's
directory for every packaged build. The unpackaged `electron-forge start` build
keeps its isolated `Ensemblr (DEV)` state.

## Consequences

- Cutting a release is one command and no laptop. A packaging break surfaces on
  `master` rather than at ship time, because the nightly builds the same way.
- **The nightly outranks every release in `/releases`**, because it is the most
  recently published entry every night. Anything downstream reading "the newest
  release" gets it, so ensemblr.dev pins both tags by name instead (see Status).
- Six repository secrets are now required. Until they exist, both workflows fail
  at their first step naming the missing ones.
- The release job holds a Developer ID private key. The keychain is created per
  job from `security` calls in a local composite action — no third-party action
  sits in that position — and both it and the `.p8` are removed in an
  `if: always()` step.
- **Canary and the release can no longer run at the same time**; launching one
  while the other runs folds into the running instance. Given they share a
  database file, concurrent instances were a hazard rather than a feature.
- The README's version line and download URL stay hand-edited. The release job
  prints the exact replacement lines to its run summary, so automating it later
  is an added step rather than a rewrite.
