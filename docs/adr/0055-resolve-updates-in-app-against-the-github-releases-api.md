# 0055. Resolve Updates In App Against The GitHub Releases API

Date: 2026-08-18

## Status

Accepted

Builds on [ADR 0054](0054-build-releases-in-ci-and-reserve-the-nightly-tag.md),
whose tag scheme — `v<semver>` is a release, the literal `nightly` is the
nightly, nothing else publishes — is the contract this reads. Extends
[ADR 0032](0032-channel-scoped-bundle-identity.md): the per-channel bundle id it
established is what makes cross-channel updates structurally impossible here.

## Context

Ensemblr had no update path at all. No `autoUpdater`, no `update-electron-app`,
no `electron-updater`; the app menu carried About / Settings / Hide / Quit and
nothing else. An installed copy stayed on whatever version it was downloaded at
until someone revisited the Releases page and dragged a new build into
`/Applications`.

Two channels ship, and neither may ever update into the other:

| Channel | Tag | Build channel | Bundle id | Product |
| --- | --- | --- | --- | --- |
| beta | `v<semver>` (`-beta.N`) | `release` | `dev.ensemblr.app` | `Ensemblr` |
| nightly | rolling `nightly` | `canary` | `dev.ensemblr.app.canary` | `Ensemblr Canary` |

Electron's `autoUpdater` is Squirrel.Mac on darwin. It takes an HTTPS URL
returning either `204 No Content` or
`{ url, name, notes, pub_date }`, and it performs **no version comparison of its
own** — whatever a feed hands it gets installed. `MakerZIP` already produces the
zipped `.app` Squirrel consumes, so the artifact side needed nothing new. The
open question was only where the feed comes from.

### `update.electronjs.org` cannot serve either channel

The obvious answer — the free hosted feed for public GitHub repos, wrapped by
`update-electron-app` — is unusable here, and not marginally.

Its resolver skips any release failing this test
(`electron/update.electronjs.org`, `src/updates.ts`):

```ts
if (!semver.valid(release.tag_name) || release.draft || release.prerelease) {
```

Every Ensemblr release is flagged `--prerelease --latest=false` by
`.github/workflows/release.yml`, and the literal `nightly` tag is not semver.
The service would return a permanent 204 to both channels — a feed that
succeeds, reports "up to date", and never updates anything. It becomes an option
at 1.0 and not before.

## Decision

**The app resolves the update itself against the GitHub Releases API, and arms
Squirrel only once it has established the candidate is strictly newer.** No
update server, no cross-repo write token — the machinery whose cost got THE-195
dropped.

Both workflows attach one extra asset per release,
`update-darwin-arm64.json`, holding exactly the Squirrel payload. On a timer and
on demand, `src/main/updates/release-feed.ts`:

1. `GET`s `/repos/<owner>/<repo>/releases?per_page=30` with `If-None-Match` from
   a stored ETag — a 304 does not count against the unauthenticated 60/hour, and
   the schedule below spends about six calls a day.
2. Picks the release for **its own build channel**: tag `nightly` for `canary`,
   highest-semver `v*` tag for `release`.
3. Reads that release's feed document and compares its `name` against
   `app.getVersion()` with `semver.gt`.
4. Only when strictly newer: `setFeedURL({ serverType: 'json', url })` then
   `checkForUpdates()`.

Because Squirrel does not compare versions, **pointing it at a feed is the
commitment to install, not the question.** That inversion is the whole design:
the decision happens in step 3, and step 4 is already the download.

### Why the version lives in a separate asset

The rolling `nightly` tag never changes, so nothing about the release *names* the
build under it. The alternatives were parsing the version out of the release body
— prose, hand-edited, and a cross-repo dependency on its own format — or reading
it off the asset filename, which the nightly deliberately keeps fixed so the
download URL stays bookmarkable.

A feed document sidesteps both: it states the version outright, and it is the
same document Squirrel then consumes, so the version the app compared and the
build it installs cannot disagree. It also makes the two channels one code path
rather than two.

`UPDATE_FEED_ASSET_NAME` is therefore a contract with both workflows, in the same
sense ADR 0054 made the tag scheme one.

So is the shape of the version inside it. `semver.gt` is the only thing standing
between two nightlies, and semver compares prerelease identifiers left to right,
numerically only when *both* sides are all digits. A nightly stamped
`0.1.0-beta.9-nightly.<date>` puts `9-nightly` in that position — alphanumeric,
so `10-nightly` sorts *below* it and the canary channel would silently freeze the
day `package.json` crossed `beta.9`. `nightly.yml` therefore strips the base to
`<major>.<minor>.<patch>`, which leaves the date as the first identifier that can
differ.

### Channels cannot cross

The channel is baked into the main bundle by `vite.main.config.mts` from
`ENSEMBLR_BUILD_CHANNEL`, through the same `resolveBuildChannel` helper
`forge.config.ts` derives the bundle id and product name from
(`src/shared/build-channel.ts`). Sniffing `app.getName()` instead would misread
the dev build, which `src/main/main.ts` deliberately renames.

Given per-channel bundle ids (ADR 0032), a canary and a release install are
separate `.app`s that Squirrel replaces independently. Channel isolation is
therefore structural, not a rule the resolver has to remember — but the resolver
still derives its feed from its own channel, so the guarantee does not rest on
LaunchServices alone.

The `dev` channel refuses outright: `make:dev` is a local dogfood build with no
published releases to read.

### The user can hand the install to something else

`app.general.automaticUpdates` (default on) turns the updater off entirely, for a
copy a package manager owns — a Homebrew cask above all, which is where THE-197
is heading.

**Off is a hard off**, not notify-only: no scheduled check, no check the user
asks for from the menu, and no install. Anything softer would still replace the
bundle under the manager that installed it, which is the exact failure the switch
exists to prevent. Switching off also drops a staged update — safe, because
Squirrel only ever applies one through `quitAndInstall`, which the service then
never calls, so the staged bundle is inert rather than pending.

The service reads the setting at the moment of use rather than capturing it, and
`settingsChanged()` starts or stops the schedule to match, so a change takes
effect without a restart — including one made by hand in `config.json`, which the
config watcher routes to the same call.

Deliberately **one boolean and not three modes**. A notify-only middle setting
was considered and dropped: it is the wrong answer for the case that motivated
the switch, and for everyone else the only decision worth making is *when to
restart*, which is already a button rather than a preference.

### Restarting goes through the quit guard

`autoUpdater.quitAndInstall()` issues its own `app.quit()`, which `before-quit`
intercepts like any other — and `src/main/app/quit-coordinator.ts` re-issues a
confirmed quit as a plain `app.quit()`. Calling `quitAndInstall` directly would
therefore be confirmed, torn down, and then re-issued as an ordinary quit,
**silently discarding Squirrel's relaunch**.

So the restart enters the coordinator as a third gesture. An exit mode
(`'quit' | 'install-update'`) rides the existing confirm → agent teardown →
re-issue path and decides only the final call. Agents mid-turn still get their
confirmation; a refusal leaves the update staged and clears the mode, so the next
ordinary ⌘Q cannot relaunch into an update nobody asked for.

## Consequences

- **No infrastructure, and no second repository.** The feed is two static
  documents GitHub already hosts.
- **Channel policy ships in the binary.** Changing which releases a channel
  accepts needs a release, not a server deploy. Acceptable while there are two
  channels and one tag scheme; a self-hosted feed on ensemblr.dev remains the
  escape hatch, and only step 1–3 would move.
- **The unauthenticated rate limit is shared per IP.** A saturated office NAT can
  return 403; that surfaces as `update-feed-rate-limited` and the next check
  retries. Failures are recorded on the snapshot for Settings either way, but a
  background failure is deliberately not toasted — a check runs every four hours
  and an offline laptop would otherwise nag all day.
- **A release published without its feed document is a coded failure, not
  silence.** `update-feed-malformed` names it rather than reporting "up to date",
  which is the reading that would hide a broken workflow for a whole cycle.
- **Fuses stay on.** `EnableEmbeddedAsarIntegrityValidation` and
  `OnlyLoadAppFromAsar` are compatible with Squirrel replacing the whole `.app` in
  principle, but this is the combination to prove with a real notarized install
  and relaunch rather than assume.
- **Homebrew has an answer before the tap exists.** THE-197's cask will carry
  `auto_updates true` so `brew upgrade` and the in-app updater agree on who
  upgrades; until then — and for anyone installing by other means — the
  `automaticUpdates` switch is the manual version of the same guarantee.
