## Ensemblr v0.1.9

**Agents can now read context usage, not just watch it get read to them.** Context usage existed only as a gauge for the user — the runtimes emit a `context-usage` event, the renderer folds it into the composer indicator, and the Concierge watches it to offer a clear — but no agent could read its own consumption, or that of a child, peer, or reviewer it was steering. `ensemblr_get_conversation_status` now takes an optional `agentSessionId` (omitted, it reports the caller's own conversation) and every conversation status carries `contextUsage` (context window, tokens, percent); crossing 50% attaches a steering note scoped to what that caller can actually do about it. A terminal harness — whose control identity is shared by every terminal in a workspace — has no conversation of its own, so it is refused a self-status read with `not-found` rather than being promised one; the harness playbook was corrected to stop advertising it.

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

### What's Changed since v0.1.8

#### Added

* **Agents can read context usage over the control layer** — their own conversation, or a child's, peer's, or reviewer's they are steering. `ensemblr_get_conversation_status` takes an optional `agentSessionId`, every result carries `contextUsage`, and crossing 50% full attaches steering guidance. A terminal harness is refused a self-status read with `not-found` instead of being offered one it cannot serve, and the harness playbook was corrected to match. (#499)

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.8...v0.1.9
