# Ensemblr v0.1.12

Ensemblr 0.1.12 lets Pi extensions present their own tool activity while making Pi startup and slash-command discovery more dependable.

### Highlights

* **Extension-owned tool presentations.** Pi extensions can now provide a versioned, schema-validated presentation for tool calls: titles, Lucide glyphs, previews, and structured bodies. Ensemblr safely persists and restores complete presentation snapshots while retaining host-owned presenters and a localized raw-execution fallback. (#531)
* **More reliable Pi startup and prompt delivery.** Startup readiness and prompt acknowledgement now have separate bounded waits, reducing premature delivery failures without replaying any prompt whose execution may be uncertain. Failed child spawns also settle cleanly so saved conversations can resume. (#530)
* **Fresh Pi slash commands.** Pi command discovery now warms when the composer opens and refreshes mounted command catalogues every five minutes; Claude Code discovery remains lazy. (#529)

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

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.11...v0.1.12>
