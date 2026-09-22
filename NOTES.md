# Ensemblr v0.1.21

Ensemblr 0.1.21 lets a user trust individual read-only tools for Plan Mode and the Concierge, stops the in-app updater from fighting a Homebrew-owned install, and picks up a round of dependency patches.

### Highlights

* **Trust individual read-only tools for Plan Mode and the Concierge.** Both guards refuse every tool the app cannot vouch for as read-only, which left a Pi user's own extensions refused with no way out. `providers.piReadOnlyTools` / `providers.claudeReadOnlyTools`, edited under Settings → Providers → Read-only tools, are consulted by both guards after their write and shell rules; the settings patch refuses to let a Concierge grant itself a writer through either list. Pi's `web_search`/`web_fetch` from `pi-web-access` are cleared by default for both guards. ([ADR 0075](https://github.com/ensemblr-hq/ensemblr/blob/v0.1.21/docs/adr/0075-let-the-user-vouch-for-read-only-tools.md), #638)
* **A Homebrew install no longer ends up "damaged" after a restart.** The updater now recognizes a copy Homebrew installed and does not update it at all; Settings → General names the `brew upgrade --cask` command in its place. To recover an install that is already damaged, delete `/Applications/Ensemblr.app` and run `brew reinstall --cask ensemblr`. ([ADR 0076](https://github.com/ensemblr-hq/ensemblr/blob/v0.1.21/docs/adr/0076-stand-the-in-app-updater-down-on-a-homebrew-owned-install.md), #641)
* **Dependencies moved to current patches** — Electron 44.3.0 → 44.4.3, `@tanstack/react-router`, `lucide-react`, the Lexical group, and a dev-dependencies group of five. (#631, #632, #633, #634, #635)

See the [changelog](https://github.com/ensemblr-hq/ensemblr/blob/v0.1.21/CHANGELOG.md) for every change.

### Install

macOS (Apple silicon and Intel):

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Or download the `.dmg` for your Mac: `Ensemblr-0.1.21-arm64.dmg` (Apple silicon) or `Ensemblr-0.1.21-x64.dmg` (Intel).

Linux (x64):

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

Both `.dmg` files are signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so they open without a Gatekeeper prompt and validate offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.20...v0.1.21>
