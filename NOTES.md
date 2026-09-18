# Ensemblr v0.1.19

Ensemblr 0.1.19 is a patch release: agents are handed control-tool names their own client can call, turn diffs stop double-counting untracked files, an overflowing tab strip pages with edge arrows, and a pull request no longer reads Ready to merge while its checks are still arriving.

### Highlights

* **Control-tool names reach each agent spelled for its own client.** Every playbook, directive, tool description, and op result named the control tools in Pi's bare `ensemblr_*` spelling, because Pi's extension is where they are registered unwrapped — so a Claude agent, which holds `mcp__ensemblr__ensemblr_set_name` and nothing called `ensemblr_set_name`, read a few hundred names it could not call, and called one anyway. `namespaceControlToolNames` now rewrites them per caller on the way out, idempotently, across the playbook, the per-turn directives, the MCP `instructions` block, every tool description, and op results. Content the app *read* rather than wrote — a diff, a transcript, scrollback, a stored diagram, a Linear issue — stays verbatim, since rewriting it would hand an agent a file that disagrees with disk. Spawned prompts and follow-ups are respelled for the recipient's runtime rather than the sender's, covering peer and review briefs, the Concierge frame, and ordinary cross-runtime delegation. A name the app does not serve is left as written, so a misspelling fails as itself rather than looking served. (#612)
* **A turn's diff no longer reports every earlier untracked file as its own.** A turn checkpoint is captured with `add -A` into a throwaway index, but `git diff <checkpoint>` walked the real one, so each untracked file was counted twice — once as a deletion, once as an addition — and leaked into every later turn's diff. Both legs are now tree-to-tree: the live leg writes the working tree, `.gitignore` respected, into a tree object through its own throwaway index, with the workspace index, HEAD, and refs untouched. A finished chat's last turn is bounded by the next checkpoint taken anywhere in the workspace, so it stops diffing the live tree forever and reporting other chats' work as its own; a streaming turn stays live. File chips widen only the labels that would otherwise name two different files with the same word. (#613)
* **An overflowing tab strip shows it, and pages with an arrow at each end.** Each end of the strip fades while tabs remain beyond it and carries an arrow that pages that way; the review panel's header now uses the shared `TabScroller`, so all three strips behave alike. The fade is a mask over the tabs rather than an overlay, so it works on any surface, and a resting arrow is `invisible` rather than transparent, so a strip does not announce two controls that do nothing. (#614)
* **A pull request no longer reads Ready to merge while GitHub is still queueing its checks.** GitHub advances a PR's head the moment it accepts a push and queues the head's checks seconds later; in that gap the rollup is empty and the mergeability verdict still describes the commit that passed. An empty rollup soon after checks were last seen now reads as checking, `mergeStateStatus: UNSTABLE` reads as checking and `BEHIND` as blocking, and every PR with anything still in flight — including one both blocked and running checks, the normal state on a protected branch — refreshes every 30 seconds instead of 120. A repository that has never reported a check is never held back. (#615)

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

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.18...v0.1.19>
