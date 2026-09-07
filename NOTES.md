## Ensemblr v0.1.7

> **Security release — please update.** 0.1.7 closes a privately reported bypass of the `bash` command gate that Pi Plan Mode and the Concierge both depend on. Everyone running 0.1.6 or earlier should move to this build.

**A command could be talked past the `bash` gate.** The classifier that decides whether a command is safe to run under Plan Mode judged some commands by a word that was not the thing actually being run, so a command that read as read-only inspection could reach execution. Two surfaces depended on that classifier: Pi Plan Mode, and the Concierge on both runtimes. The Concierge is the one that matters — it reads across every open workspace, so a single hostile repository reached a context with access to all of them. The `read-only` workspace mode was never exposed, because both runtimes withhold the shell there outright rather than classifying anything, and Claude Code's plan mode is its own native gate. The gate now refuses the construction outright rather than trying to enumerate a safe subset, and three sibling gaps in the same classifier were closed with it. Read-only commands stay readable: each guard's flags are scoped to the command that really has them, and a per-command table of value-taking letters keeps things like `git status -uno`, `git log -S` and `date -Iseconds` working.

**Acknowledgement pending.** The issue was reported to us privately under `SECURITY.md`. We have asked the reporter whether they are willing to be publicly acknowledged and have not yet heard back. These notes will be updated once we have their answer.

**The welcome screen fits a narrowed pane.** Both elements on it carried a hard intrinsic width with no relationship to the pane they sat in, and the shell's content column clips, so the overflow disappeared silently. The wordmark and the action tiles now share one capped measure and derive their size from the box model rather than from viewport breakpoints — the pane is the window less the sidebar, which is the wrong axis for `sm:`.

**Pasted-text chips stand in a tray above the draft.** A stored-text chip is close to three lines tall, and inline it inflated the line box it sat in: the sentence wrapped around it and the words either side landed on different lines with a wall of monospace between them. Those chips are now pinned above the typed text as a wrapping row, while every other chip stays in the sentence where it reads as a word. A backspace at the start of the sentence no longer silently removes one.

**Elsewhere:** `docs/` was audited against the repository and its install instructions pinned to the assets 0.1.6 actually published, and the README picked up a CodeRabbit PR-reviews badge.

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

### What's Changed since v0.1.6

#### Security

* **Plan Mode and the Concierge could be talked past with a leading environment assignment.** The `bash` guard dropped `NAME=value` tokens to reach the head word without ever inspecting them, so it judged a command by a word that was not the thing being run — an assignment of one of git's own environment hooks, or of `PATH`, turned a command the gate read as read-only inspection into arbitrary execution. A leading assignment is now refused outright, with no safe-list, and the refusal names the variable and says to re-run without it. Three sibling holes in the same classifier went with it. Only Pi Plan Mode and the Concierge were exposed. ADR 0044 §3 records the decisions and the false-positive discipline they rest on. (#491)

#### Fixed

* **The welcome screen fits a narrowed pane** instead of clipping silently. Correctness comes from the box model — one capped measure the wordmark and the action grid both fill, the wordmark deriving its height from the aspect ratio it already declared, and the tiles in a three-column grid — rather than from viewport breakpoints, which are the wrong axis when the pane is the window less the sidebar. (#490)
* **Stored-text chips stand in a tray above the draft** rather than inflating the line box they sat in. The chip remains an `AttachmentNode` in the same Lexical document, so ADR 0047's single ordered attachment list, the linearizer, the `segments` contract, the send pipeline and the follow-up queue are untouched. A mixed batch now sends in the order the composer shows, and a backward delete at the start of the sentence no longer eats the last tray chip. ADR 0067 records it, amending 0047. (#492)

#### Changed

* **`docs/` audited against the repository and pinned to the published 0.1.6 assets**, read off the tag rather than string-replaced, with every rewritten URL checked against the release's asset list. Renumbers the second ADR 0065 to 0066 and corrects the ADR count, the test-file counts, the bound-shortcut count and six stale symbol names. (#489)
* **A CodeRabbit PR-reviews badge in the README header.**

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.6...v0.1.7
