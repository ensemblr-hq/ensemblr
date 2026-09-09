## Ensemblr v0.1.11

Ensemblr 0.1.11 makes agent work easier to follow and harder to lose: tool activity now reads as purpose-built timeline entries, Pi delivery and queued follow-ups recover more reliably, and delegated work is held behind an enforced wait barrier until every child reports.

### Highlights

* **Purpose-built tool activity.** Pi Lens, context-mode, Context7, MCP adapter, background-task, web-access, and workspace-diff calls now have focused timeline presenters with compact previews, readable results, and localized English, Russian, and Greek labels. Workspace diffs retain per-file identity and truncation notices, URL previews redact credentials and signed parameters, and `.mts` files receive TypeScript highlighting. (#516, #517, #520, #522, #526)
* **More dependable Pi turns and queues.** Ensemblr now waits for Pi's definitive settlement event before surfacing terminal failures or draining follow-ups, confirms prompt acceptance, shows injected steering prompts, and preserves final or truncated responses before later activity can fold them away. Pi 0.80.4 or newer is now required. (#513, #515, #525)
* **Queued follow-ups survive transient diagnostics.** Existing Pi and Claude Code runtimes remain usable when a background readiness probe fails; same-tick queue operations are serialized, temporary refusals defer cleanly, and runtime replacement validates the new executable before closing a healthy session. (#521)
* **Delegation now enforces its own lifecycle.** Root Pi orchestrators must collect every spawned child's report before unrelated tools or premature prose can continue. The barrier survives reloads, recovers interrupted spawns fail-closed, and distinguishes informational `done`/`progress` signals from blockers and decisions. (#523, #524)

### Changed

* AFK mode shows a one-time, persistent warning about its additional token cost before activation. Composer, shortcut, and native-menu activation all use the same guard. (#518)
* Live model catalog reductions are confirmed before replacing cached data, allowing removed providers and models to retire without letting a transient partial listing erase valid choices. (#514)
* Shell tool rows distinguish a process's non-zero exit code from a tool invocation failure while preserving the command output. (#519)

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

---

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.10...v0.1.11>
