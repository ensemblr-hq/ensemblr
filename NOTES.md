## Ensemblr v0.1.10

Ensemblr 0.1.10 makes local projects and linked directories more dependable, restores Pi command discovery across installations, and improves agent-session recovery.

### Highlights

* **Open local projects in place.** “Open Local Project” now uses the selected checkout as its project root instead of cloning it under Ensemblr; its Git state and settings stay intact. Removing it from Ensemblr no longer deletes the original folder, branches, or refs. (#507)
* **Linked directories now reliably reach agents.** Directory links persist per chat, appear in sent-message history, and are applied on the next send after an active turn finishes. (#506)
* **Restore Pi skills, prompt templates, and extension slash commands.** Ensemblr now discovers commands through the configured Pi executable's RPC interface, rather than depending on a particular SDK installation layout. (#504)

### Fixed

* Hidden models are excluded from delegated-agent choices and fallback selection, while sessions recover to idle if a large completion frame is dropped. (#503)
* Repository settings now show the actual managed workspace location for imported local checkouts. (#509)

### Changed

* Simplified the linked-directory composer area with a clearer label-and-chip layout and less redundant copy. (#508)

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

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.9...v0.1.10>
