## Ensemblr v0.1.5

**The composer's `@` menu now reaches this workspace's other chats.** Pointing an agent at a sibling conversation used to mean pasting a session id by hand. The menu now lists this workspace's other chats above its files, over one index space — chats lead because the file list is ranked eighty deep and hierarchically, so a chat placed after it would never be reached. Nothing new crosses to the agent: the reference block carries the `agentSessionId` that `ensemblr_read_conversation` takes, and costs the prompt roughly 150 bytes rather than an inlined transcript.

**The app's own jargon stops leaking into the rows the user reads.** "Steered an orchestrator" and "Waited for orchestrators" are gone: every timeline target is a chat now, and only a child the caller owns keeps the sub-agent noun. A peer, the Review conversation, a mixed batch, and an id the catalogue no longer holds all read as a chat. The collapse drops a branch whose arms were indistinguishable and 10 catalogue keys per locale, and the glossary retires Orchestrator as a translatable term — the role survives in the code, where `TimelineAgentRole` still needs it.

**Elsewhere:** the unattended delivery loop is now sized to the change, so a documentation edit, a version bump, or a locale fill no longer takes a written plan, a second orchestrator opened over the diff, and however many fix rounds the cycle earns to arrive somewhere the agent could have reached by reading its own diff. The criterion is evidence rather than size, the tie goes to the full loop, and the report names which path the change was sized onto.

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

### What's Changed since v0.1.4

#### Added

* **The composer's `@` menu now lists this workspace's other chats, above its files**, so handing an agent a sibling conversation is a menu row rather than a pasted session id. A typed query has to hit a contiguous run of a chat's label — a subsequence match would otherwise pin a weak row above an exact file match — while a bare `@` lists every chat. The composer's own tab is dropped, since a chat cannot be handed itself. (#474)

#### Changed

* **Every timeline target is named a chat rather than an orchestrator.** Only a child the caller owns keeps the sub-agent noun; a peer, the Review conversation, a mixed batch, and an unresolved id all read as a chat. `notify-orchestrator` reads "Notified the parent chat". Collapsing the two converged branches drops 10 keys per locale, and the glossary records why Orchestrator is retired as a translatable term. (#475)
* **The unattended delivery loop is now sized to the change.** A change takes the short path when the whole diff fits in one reading, that reading plus the repository's checks settle its correctness, and the shape was decided before the agent started — skipping the plan, the review, and the fix rounds while still building, checking, committing, pushing, and opening a pull request. The tie goes to the full loop, and the judgement only ever moves upward. (#473)
* **`docs/` pinned to the published 0.1.4 assets**, read back off the tag rather than string-replaced, with every asset URL confirmed to resolve first. (#472)

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.4...v0.1.5
