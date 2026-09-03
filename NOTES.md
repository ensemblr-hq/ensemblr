## Ensemblr v0.1.0

**The first stable release.** Ensemblr leaves the beta series after twenty-four prereleases and three weeks. The version that ships is the one the betas converged on rather than a twenty-fifth with the suffix filed off: `0.1.0` carries no `-beta` suffix, so GitHub marks it **Latest**, the Homebrew cask bumps to it, and the Linux install script selects it over every `v0.1.0-beta.*` before it.

**macOS and Linux are both public, supported targets.** The `.dmg` is signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so it opens without a Gatekeeper prompt and validates offline. The `.AppImage` is built on Linux in CI beside it. Linux users now have a one-line installer:

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

It needs no root and writes nothing outside `$HOME`. It resolves the newest release, verifies the download against the digest GitHub publishes, places the AppImage under `~/.local/share/ensemblr`, symlinks it to `~/.local/bin/ensemblr`, and extracts the desktop entry and icon ladder the AppImage already carries so the app appears in the launcher. A manifest records exactly what it added, so `--uninstall` removes that and nothing else. Re-running it is an update.

On macOS:

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

### What stabilised

What the beta series converged on is the model underneath the app. Every stream of work gets its own git worktree, branch and review path, so a fan-out of agents cannot collide. **Ensemblr Control** lets the agent inside a workspace drive the app through a permission gate — naming its own tab, moving itself across the board, starting run scripts, spawning sub-agents into their own chat tabs and reading their reports. The runtime layer is provider-neutral, with Pi and Claude Code as sibling adapters rather than one routed through the other's vocabulary. The app ships in English, Russian and Greek, holds no account and no telemetry, keeps its state in a local SQLite database and its secrets in the OS keyring, and ships no agent binary of its own — it drives the CLI you installed and authenticated yourself.

Stability from here is ordinary semver. `0.1.0` is a stable release, not a promise that the surface is frozen; breaking changes remain possible before `1.0` and are recorded in the changelog when they land.

### What's Changed since v0.1.0-beta.24

#### Added

* **The native About panel credits every direct dependency**: the panel named its author and nothing else, leaving the 82 open-source projects Ensemblr is built out of uncredited. Each is now listed with its license and project page, under headings that read in all three of the app's languages. The metadata lives in each dependency's own `package.json`, which the packaged app does not ship — Vite bundles the code and Forge drops `node_modules` apart from the `PACKAGE_KEEP_*` entries — so `scripts/generate-credits.mjs` captures it at authoring time into a committed `credits-manifest.gen.ts`, and a drift test recomputes the manifest from `node_modules` on every run, making a dependency change that skips `npm run credits:generate` a red test rather than a stale panel. Electron splits the credits across two platform-exclusive fields that render text differently enough to need separate treatment: GTK turns an angle-bracketed URL into a link, while the macOS panel shows the brackets verbatim and buries 82 names under unclickable URLs — so `authors` carries the links and `credits` drops them, out of one document builder rather than two. (#421)

* **A repository that has already run `infisical init` is linked from its own `.infisical.json`**: the file names the project, so asking the user to pick that same project a second time is work Ensemblr can do for them. It is read as a whole-link fallback behind the saved row and the committed `[infisical]` block, and is never written back — it belongs to the CLI. Its `domain` is read as the link's instance, and only `workspaceId` and `defaultEnvironment` besides; `gitBranchToEnvironmentMapping` has no one branch to resolve against, because a repository-scope link is shared by every workspace of that repository and each sits on a different branch. `fromRepositoryConfig: boolean` becomes an `InfisicalLinkOrigin` union of local, repository-config and infisical-cli. The summary badges a discovered link as **Detected** rather than as unsaved, with a notice explaining what is already resolving, what is still missing, and what saving would add — nothing is committed on the user's behalf. Unlinking is a decision that persists: `clearLink` records a dismissal in the new `infisical_discovery_dismissals` table and the fallback honours it, so unlinking a repository whose `.infisical.json` still names the project takes rather than resurrecting on the next read with secrets flowing. Account matching never crosses instances. (#420)

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.0-beta.24...v0.1.0
