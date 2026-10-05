# Ensemblr v0.2.3

Ensemblr 0.2.3 adds an app-wide compute queue for heavy commands, closes out a workspace when its pull request merges, scopes and filters Linear issues, and makes a Claude session's first answer arrive in seconds instead of half a minute.

### Added

* **An app-wide compute queue.** Test suites, builds and typechecks run through one queue shared by every agent in every workspace, so your machine stays usable however many agents are working. The sidebar lists running and queued jobs with cancel, Open log and Start now, and Settings controls the slot count and CPU priority. (#714, #719, #721, #722)
* **A workspace closes out when its pull request merges.** The board card moves to Done and the Linear or GitHub issue it came from is closed. (#706)
* **Linear, filtered and scoped.** Filter issues by assignee on every surface that lists them, scope a repository to its Linear teams with `[linear] teams`, see which Linear project an issue belongs to, and find started issues from the create-from search. (#723, #705, #697, #704, #716)
* **A fork's own GitHub issues.** Issues come from your fork rather than its upstream, with a **Show upstream issues** setting to switch back. (#724)

### Changed

* **Unattended agents see their pull request through its checks** before they report. (#725)
* **Development runs inside a Nix dev shell.** (#714)
* **The create-from Issues tab lists work ready to start**, sorted by priority. Spinners turn in step, and the sidebar re-renders less. (#696, #699, #718, #703)

### Fixed

* **A Claude session's first answer no longer waits on every MCP server**, which took 20 to 30 seconds. (#720)
* **Setup no longer runs twice when a workspace is created.** (#715)
* **"Linear is unreachable" clears on its own.** (#726)

See the [changelog](https://github.com/ensemblr-hq/ensemblr/blob/v0.2.3/CHANGELOG.md) for every change.

### Install

macOS (Apple silicon and Intel):

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Or download the `.dmg` for your Mac: `Ensemblr-0.2.3-arm64.dmg` (Apple silicon) or `Ensemblr-0.2.3-x64.dmg` (Intel).

Linux (x64):

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

Both `.dmg` files are signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so they open without a Gatekeeper prompt and validate offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.2.2...v0.2.3>
