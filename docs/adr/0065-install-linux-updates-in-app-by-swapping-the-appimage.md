# 0065. Install Linux Updates In App By Swapping The AppImage

Date: 2026-09-07

## Status

Accepted

Amends [ADR 0056](0056-ship-a-linux-amd64-appimage.md), whose "Updates notify,
they do not install" section is superseded in part. Linux still *may* only
notify — that is now the fallback rather than the rule.

Extends [ADR 0055](0055-resolve-updates-in-app-against-the-github-releases-api.md):
the state machine, the feed resolver, and the hard-off `automaticUpdates` switch
it built are reused whole. What is added is a second installer behind the seam
Squirrel already occupied.

## Context

ADR 0056 refused to install on Linux, and the reasoning was sound at the time:
"an AppImage is a single file the user placed themselves, often on a read-only
mount, often owned by a package manager or a launcher that would be overwritten
behind its back."

Two of those three turned out to be conditions the app can *test* rather than
properties it must assume:

- **"The user placed it themselves"** is knowable. The AppImage runtime exports
  the running file's path as `APPIMAGE`. When the variable is unset the build is
  not running as an AppImage at all, and there is nothing to swap.
- **"Often on a read-only mount"** is knowable. The swap writes a sibling and
  renames over the running path, so `access(dirname, W_OK)` answers it exactly.

The third — "owned by a package manager" — is what `automaticUpdates` already
exists for, and its own UI copy names the case.

Meanwhile the gap was real. `install.sh` gives a Linux user a launcher entry, an
icon ladder, digest verification and an `--uninstall` manifest, and `update.sh`
re-runs it. But nothing in the app reaches either, so a Linux user's update path
was to notice a banner and then remember a shell command.

## Decision

A Linux build that is running as an AppImage it can write installs updates
itself: download, verify, stage, swap on restart.

### One state machine, two installers

`createUpdateService` already modelled `checking → downloading → ready →
install → restart`, which is exactly the Linux lifecycle. Its Squirrel-shaped
seams — `armUpdater`, `onUpdaterEvent`, `requestInstall` — became the port, and
`src/main/updates/appimage-installer.ts` is the second implementation.

`armUpdater` widened from `(feedUrl: string)` to `(candidate: UpdateCandidate)`.
Each platform installs from a different part of a release — darwin points
Squirrel at the feed document, Linux downloads the `.AppImage` — and neither
should have to know the other's field exists.

It also gained a return, `'armed' | 'declined'`. An installer that cannot take a
*particular* release — a Linux one GitHub published no digest for — is not the
same thing as a build that cannot update, so it says so rather than throwing:
`declined` takes the same path the check-only gate takes, naming the version and
linking at the release page, while a throw still means the platform installer
refused the build itself and reports `update-unsupported-build`. Keeping that
decision behind the seam is what stops the service from having to read
`candidate.linuxAsset`, which would put Linux's shape back above the port.

**A parallel `linux-update-service.ts` was rejected.** It would have copied ~250
lines of schedule, snapshot and enablement logic to differ in ~40, and ADR 0055's
three subtle rules — hard-off, staged-drop-on-disable, offer-survives-feed-error
— would then need keeping in step in two places. That is the parity test waiting
to fail that `.claude/rules/patterns.md` warns about.

**Shelling out to `update.sh` was rejected.** The app would fetch and execute
remote code on its own initiative, from a script outside this repository's
review, with the user's shell, `gh` token and worktree access. It also cannot
report progress into the state machine — the surface would go blind for the
length of a 120 MB download.

### Rename, never write in place

A running AppImage is a FUSE mount of the very file being replaced. Truncating
it corrupts the live process; `rename` is atomic and leaves the old inode alive
for as long as the mount holds it. The running app therefore keeps working after
its own file has been replaced underneath it, and the new version comes up on
the next launch.

### Staged, then applied — not swapped on download

`ready` keeps meaning what Squirrel means by it: downloaded, restart to apply.
The swap happens in `finishInstall`, after the agents are down and immediately
before the relaunch, so a quit the user cancels leaves the running build
untouched. It also keeps ADR 0055's rule that switching updates off drops a
staged update — on darwin that is a bundle Squirrel never applies, here it is a
file to delete, and `discardStaged` is called on both the disable path and on a
check that finds nothing newer.

### GitHub's digest is the integrity story, and it is not a signature

The AppImage is unsigned, because Linux has no notarization. What is available
is the `sha256:<hex>` digest GitHub publishes per asset — computed over what it
actually stored, and already read by `release.yml` to bump the Homebrew cask.
The installer streams the download through `createHash` and refuses a mismatch
with its own failure code, `update-verification-failed`, so tampering or
corruption does not read as a network blip the user should wait out.

**This proves integrity, not authenticity.** It is the same guarantee
`install.sh` already gives, so it is not a regression — but a release whose
assets were replaced would carry a matching digest, and nothing here would catch
it. An asset with no published digest is treated as unverifiable: the candidate
carries `null` and the build falls back to linking at the release page.

### The shell installer's manifest is kept honest

`install.sh` records the installed tag in
`${XDG_DATA_HOME:-$HOME/.local/share}/ensemblr/.version`, and `update.sh`
compares against it. Swapping the AppImage behind that would make `update.sh`
re-download a version the app already applied, so the installer rewrites it —
but only when the file already exists *and* the running AppImage sits in that
same directory, so a hand-placed AppImage never gets a manifest nobody created.

The format is copied from what is already in the file — leading `v` if there was
one, trailing newline if there was one — rather than assumed, because the script
that writes it lives in the `ensemblr-dev` repository and is not readable from
here.

### `app.relaunch()` needed fixing first

`src/main/main.ts` called `app.relaunch()` with no `execPath`. Under an AppImage
`process.execPath` is the extracted binary in `/tmp/.mount_<random>/`, a mount
the runtime tears down on exit — and Electron spawns the replacement *after* that
exit, so the default relaunches a path that no longer exists.

This was a pre-existing Linux-only bug, not one this change introduced: the only
caller was the Appearance settings "Relaunch" button, whose row is itself
Linux-only. `src/main/app/relaunch-target.ts` now resolves `APPIMAGE` for both
that button and the restart-to-install.

## Consequences

- A Linux user on a writable AppImage gets the same update experience as a macOS
  user, minus the code signature.
- `check-only` remains for every case that cannot swap: not running as an
  AppImage, a read-only or root-owned directory, a release with no verifiable
  asset. Those still link at the release page, which is what ADR 0056 built.
- `install.sh` and `update.sh` need no change, and the two update paths no longer
  contradict each other about what is installed.
- The digest check is integrity-only. Signing the Linux artifact remains open,
  and would be the thing that closes the authenticity gap.
- **Untested on a real Linux host.** The logic is covered by unit tests over a
  temp directory, but no Debian, Fedora or SteamOS machine was available to run
  an actual swap-and-relaunch. The FUSE-mount reasoning above is derived from how
  AppImage works, not from an observed run.
