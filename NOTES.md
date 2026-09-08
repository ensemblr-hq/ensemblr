## Ensemblr v0.1.8

**Fan-out no longer litters the tab strip.** Waiting on a fan-out left one dead tab per child behind, because nothing in the app ever closed one and the playbook only asked an orchestrator to clean up tabs it opened by accident — not the children it just waited on. Every delegation loop (root orchestrator, harness, plan-mode investigators) now keeps both ids `ensemblr_start_conversation` returns and closes each child's tab in the evaluate step, as it settles rather than at the end of the run. Closing archives the tab rather than deleting it, so a follow-up still reopens it.

**Elsewhere:** the Code of Conduct and `SECURITY.md` contact emails now point at `howdy@ensemblr.dev` instead of a personal address, and `docs/` was re-audited against the repository and pinned to the assets this release publishes.

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

### What's Changed since v0.1.7

#### Fixed

* **A fan-out's finished sub-agent tabs now close themselves as each child settles**, instead of leaving one dead tab per child in the tab strip. Every delegation loop keeps both ids `ensemblr_start_conversation` returns (the `chatTabId` the close op needs, not just the `agentSessionId` the playbook told it to hold onto) and closes the tab in the evaluate step. Closing archives it rather than deleting it, so a follow-up reopens it; the Review conversation's and a peer's own tabs stay explicitly excluded where they are introduced. (#496)

#### Changed

* **The Code of Conduct and `SECURITY.md` contact emails now point at `howdy@ensemblr.dev`** instead of a personal address, so reports reach the project rather than an individual. (#495)
* **`docs/` re-audited against the repository and pinned to the assets v0.1.7 published** — the ADR count, test-file counts, sub-agent blocked-op count, setup-check count, the composer-attachment tray behavior, the read-only bash classifier's newer cases, and the version-pinned-lines table all corrected, plus every install URL checked against the release. (#494)

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.7...v0.1.8
