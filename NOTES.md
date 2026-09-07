## Ensemblr v0.1.6

**Linux updates install in the app.** An AppImage running from a directory it can write now downloads a newer release, verifies it against the SHA-256 digest GitHub publishes for the asset, stages it beside the running file, and swaps it in with an atomic rename on restart. The rename is load-bearing: a running AppImage is a FUSE mount of the very file being replaced, so truncating it corrupts the live process while a rename leaves the old inode alive for as long as the mount holds it. Everything that cannot swap — a build not running as an AppImage, a read-only or root-owned directory, a release with no published digest — keeps the check-only behaviour and links at the release page.

**A terminal an agent starts now says which shell it got.** `ensemblr_start_terminal` used to answer with a terminal id alone, so an agent writing into it had no way to know whether `VAR=x cmd` and `export` would be rejected by a fish login shell. Both `startTerminal` and `listTerminals` now report the shell, `listTerminals` also reports the foreground command so an idle terminal is identifiable as one worth reusing, and `stopTerminal` can close the dock tab — refused with `denied-scope` on any terminal the calling session did not start, because closing discards the scrollback for good.

**The Concierge is reachable whenever its conversation is open.** `ensemblr_message_concierge` refused with "No Concierge conversation is open" whenever the in-memory runtime attachment was null — at boot, after a stop, after a crash, and across a context clear — while the conversation sat open on disk with its whole transcript. Reachability now resolves against the persisted row, and a failed background attach no longer closes a conversation the user owns.

**Elsewhere:** the dashboard header fits at the app's minimum width instead of silently clipping its sort control, the dock empty states and the archive toast stop painting dark under a light window, the scroll-to-newest button became a composer-aligned squircle, demo mode can stage AFK mode, and renderer tests install their own web storage rather than inheriting whatever the host Node happened to define.

### Install

macOS:

```sh
brew install --cask ensemblr-hq/tap/ensemblr
```

Linux:

```sh
curl -fsSL https://www.ensemblr.dev/install.sh | sh
```

The `.dmg` is signed with a Developer ID certificate, hardened-runtime, notarized by Apple and stapled, so it opens without a Gatekeeper prompt and validates offline. The Linux installer needs no root, writes nothing outside `$HOME`, verifies the download against the digest GitHub publishes, and keeps a manifest so `--uninstall` removes exactly what it added. Re-running it is an update.

### What's Changed since v0.1.5

#### Added

* **A Linux build running as an AppImage installs its own updates**, verified against the digest GitHub publishes and applied with an atomic rename on restart. The update service's Squirrel-shaped seams became the port rather than growing a parallel Linux service, so ADR 0055's hard-off and staged-drop rules stay in one place. Also fixes a Linux-only bug where `app.relaunch()` was called with no `execPath`, which under an AppImage pointed at the ephemeral `/tmp/.mount_*` squashfs the runtime unmounts on exit. (#484)
* **A terminal an agent starts reports its shell and its foreground command**, `stopTerminal` can close the dock tab under a `denied-scope` guard, and both stop paths report a refusal instead of throwing. The playbook gains the matching terminal-discipline block, including the fact that the repository's Ensemblr-managed environment — Infisical secrets included — reaches terminals and scripts and never an agent's own shell tool. (#479)
* **Demo mode can stage AFK mode.** `DemoChat` gains an `afkMode` flag, declared per chat because a delegate inherits AFK from its parent and a scenario-level flag could not tint a delegate's tab. Two scenarios ship: mid-run through the delivery loop, and settled with the report as the subject. (#481)

#### Changed

* **The scroll-to-newest button is a composer-aligned squircle** rather than a centered pill, mirroring the unread pill on the composer's right. `corner-shape: superellipse()` takes a log2 exponent, so the utility's `superellipse(4)` was two steps past squircle toward square — which is why raising `rounded-*` against it appeared to do nothing. The wrapper repeats the composer's own two boxes rather than one hardcoded pair, since the three call sites do not share a layout. (#487)
* **The Concierge gets its own README section and two screenshots**, one of them a new demo scenario showing it hand real change to an orchestrator it spawns. The ten guide shots whose composer is visible were re-captured to pick up the AFK composer chip. (#482)
* **`docs/` audited against the repository and pinned to the published 0.1.5 assets**, read off the tag with `gh release view` rather than string-replaced, with every URL confirmed to return 200 first. (#477, #478)

#### Fixed

* **`ensemblr_message_concierge` no longer refuses a Concierge conversation that is open on disk.** Opening, clearing, and the new reattach now run behind one lifecycle queue, the self-heal no longer closes the row it is repairing, and a failed agent attach no longer closes a conversation the user owns. ADR 0065 records the amendment to 0059. (#485)
* **The dashboard header fits at the app's minimum width.** The tightest case is 768px with the sidebar expanded, where the header is only ~512px; correctness now comes from flex plus two container-query tiers rather than breakpoints, and nothing loses its name. No new catalogue keys. (#486)
* **The dock empty states and the archive toast respect light mode.** The empty states took `.terminal-surface`, which is dark in both window modes, where the real dock terminal beside them already follows the app theme; the toast resolved sonner's theme from `prefers-color-scheme` while its surface followed the root theme class. The archived-workspace toast now also names the workspace it archived. (#483)
* **Renderer tests install their own web storage** instead of inheriting whichever keys the host Node defines — 13 assertions passed on Node 24 and failed on Node 26 because Vitest drops a happy-dom window key that already exists on the process global. (#480)

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.5...v0.1.6
