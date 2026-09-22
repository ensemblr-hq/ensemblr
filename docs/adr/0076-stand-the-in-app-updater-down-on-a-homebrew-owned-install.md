# 0076. Stand the In-App Updater Down on a Homebrew-Owned Install

Date: 2026-09-22

## Status

Accepted

Amends [0055](./0055-resolve-updates-in-app-against-the-github-releases-api.md):
its `app.general.automaticUpdates` switch was the only thing keeping the in-app
updater off a copy Homebrew installed, and it defaults to on. The switch stays;
for a Homebrew-owned copy it no longer has to be flipped by hand. The feed, the
channels, and the state machine are unchanged.

## Context

A Homebrew-installed copy started refusing to launch after a restart: macOS
called `Ensemblr.app` damaged and offered to move it to the Trash. `brew
reinstall ensemblr` did not fix it. Deleting the `.app` first and then
reinstalling did. The damaged bundle's Finder creation date read 1980.

Every part of that came from two updaters sharing one bundle.

- **The in-app updater and Homebrew both wrote the same copy.** The cask carries
  `auto_updates true`, and `automaticUpdates` defaults to on. Squirrel's ShipIt
  replaced `/Applications/Ensemblr.app` six times between 20 August and 8
  September, and after that Homebrew reinstalled and upgraded the same copy
  (`brew reinstall` on 9 September, `brew upgrade --greedy` on 22 September).
  ShipIt installs the bundle it extracts from the release `.zip`, and that
  archive stores the `Ensemblr.app/` directory entry at 1980-01-01. The date
  comes from Electron's own zip, which is built reproducibly, and Forge's
  packager keeps it. That is the 1980 date.
- **Homebrew never replaces that directory.** On `upgrade` and `reinstall`,
  `Cask::Artifact::Moved` deletes the children of the existing `.app` and moves
  the new `Contents` in, because deleting an app folder makes macOS treat the
  app as uninstalled and drop its data. `reinstall` passes the new cask as the
  old one's successor, and that is what selects this path. So the root ShipIt
  made survives every later `brew` run.
- **Gatekeeper's refusal stuck to that root.** In the unified log for 22
  September, `brew upgrade --greedy` swapped 0.1.20 in at 17:24:16. The first
  launch at 17:27 went
  through with the XProtect analysis deferred. After a restart at 17:37, four
  launches were refused (`GK evaluateScanResult: 0`, `errSecCSUnsigned`,
  "Terminating process due to Gatekeeper rejection"). Three of them came after
  `brew reinstall -f` had rewritten `Contents` at 17:40:58. Once the `.app` was
  deleted and reinstalled, the same bytes launched. Those contents pass
  `codesign --verify --deep --strict`, `spctl`, and `syspolicy_check` under the
  1980 root and under a fresh one, so the refusal was state attached to the
  directory, not a broken signature.

Apple does not document which record holds that state, and the Gatekeeper
database is readable only by root. So the exact trigger for the refusal is
inferred. The precondition is not inferred: a bundle root made by one installer
had its contents swapped in by the other. `docs/build-and-release.md` already
says this in its note on `auto_updates true`: "Two updaters writing one bundle
is how an install gets corrupted." `auto_updates true` does not prevent it. It
only makes a plain `brew upgrade` skip the cask. `--greedy`, `brew upgrade
--cask ensemblr`, and `brew reinstall` all ignore it, and those are what people
who install with Homebrew run.

## Decision

**A copy Homebrew installed is updated by Homebrew only.** The updater checks
for Homebrew ownership at launch, and a Homebrew-owned copy gets capability
`none` with the coded failure `update-managed-by-homebrew`. It never reads the
feed, never arms Squirrel, and never stages anything. Settings shows the
translated reason with the command, and so does the menu's check.

- **Ownership comes from the Caskroom link.** Homebrew leaves a symlink at
  `<Caskroom>/<token>/<version>/<App>.app` pointing at the bundle it moved into
  place, and it writes nothing into the bundle. `findHomebrewCask`
  (`src/main/updates/homebrew-cask.ts`) searches `/opt/homebrew/Caskroom` and
  `/usr/local/Caskroom` for a link that resolves to the running bundle and
  returns its token. It matches the link target, not the name `ensemblr`, so a
  renamed or forked cask still counts. Only Homebrew creates those links, so it
  cannot match a copy Homebrew did not install. The token rides on the failure
  as `homebrewCask`, so the command the renderer names upgrades the cask that
  actually owns the copy.
- **It outranks the `/Applications` check.** Moving a Homebrew copy would not
  change who owns it. So `update-managed-by-homebrew` is reported before
  `update-not-in-applications`, and only on darwin. Linux has no casks.
- **Refuse, don't notify.** ADR 0055 considered a notify-only mode and dropped
  it as the wrong answer for the Homebrew case. A check-only offer would also put
  a sidebar panel in front of Homebrew users that they can't dismiss. The
  refusal is a reason in Settings, not a nag. If a notice turns out to be
  wanted, it can be added later without undoing this.

## Consequences

- **The two-updater state can no longer start from Ensemblr's side.** A new
  Homebrew install keeps its root for life, but only Homebrew writes into it.
- **The cask's `auto_updates true` is now wrong and should be removed.** The app
  no longer updates itself under Homebrew, so the stanza only hides Ensemblr
  from `brew outdated` and a plain `brew upgrade`. That is a change to
  `ensemblr-hq/homebrew-tap`, which this repository cannot write. Until it
  lands, a Homebrew copy updates only through `brew upgrade --cask ensemblr` or
  `--greedy`, which is the command the refusal names.
- **An install already damaged is not repaired by this.** The bad root is fixed
  only by deleting `/Applications/Ensemblr.app` and reinstalling, because
  `brew reinstall` keeps the directory. Ensemblr settings and data live outside
  the bundle and are not lost.
- **A copy installed some other way gets its updater back.** After a `brew
  uninstall`, a copy dragged in from the `.dmg` has no Caskroom link, and
  ownership is read fresh at every launch, never cached.
- **If this recurs on a root Homebrew made itself**, one without a 1980 creation
  date, then Homebrew's in-place swap alone is enough to trigger the refusal.
  That needs reporting upstream, and this ADR's diagnosis should be revisited.
