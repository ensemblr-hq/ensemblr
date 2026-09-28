# Ensemblr v0.1.23

Ensemblr 0.1.23 ships Ensemblr as a Nix flake, lets a setup or run script ask for your password, accepts any file dropped on the composer, and stops Claude turns that spin on a rejected credential.

### Highlights

* **Ensemblr is packaged as a Nix flake.** The in-app updater stands down inside the Nix store, and the flake's pins are re-pinned with the dependency updates. Nix files, `flake.lock` and `nix/` folders get the Nix icon. (#654, #655, #664)
* **Answer a script's password prompt from the Setup and Run panes.** A script that calls `sudo` used to hang with nowhere to type. The dock now lights the tab and floats a masked field over the pane; what you type goes straight to the PTY and is never kept. (#657)
* **Attach any file to the composer.** Dropping a GIF or many other files could fail. A stored attachment is now named after the format its bytes carry, empty files are accepted, dropped folders become folder chips, and images and PDFs preview up to 50 MB. (#662)
* **Claude turns stop on a rejected credential.** A chat whose runtime was sending an invalid API key showed a spinner for minutes while Claude Code retried. A cause waiting cannot fix now stops the turn on the second consecutive retry. (#653)
* **Real app icons in the Linux open-in menu.** Each installed app resolves to the icon its desktop shows, following the freedesktop Icon Theme spec. (#660)
* **Agent turns end on Checks** after opening a pull request or leaving review comments. (#659)

### Fixed

* Workspaces with uncommitted work no longer flip to ready-to-merge in the sidebar and dashboard when you switch away from them. (#663)
* The Linear sidebar label lines up with the Dashboard, History and Settings labels. (#658)
* The dock Run and Preview dropdowns size to their labels instead of clipping longer script names. (#656)
* LICENSE, NOTICE and other extension-less files get proper icons. (#661)

### Changed

* Dependabot updates batched, and `zod` deduped. (#655)

See the [changelog](https://github.com/ensemblr-hq/ensemblr/blob/v0.1.23/CHANGELOG.md) for every change.

### Install

macOS (Apple silicon and Intel):

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Or download the `.dmg` for your Mac: `Ensemblr-0.1.23-arm64.dmg` (Apple silicon) or `Ensemblr-0.1.23-x64.dmg` (Intel).

Linux (x64):

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

Both `.dmg` files are signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so they open without a Gatekeeper prompt and validate offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.22...v0.1.23>

