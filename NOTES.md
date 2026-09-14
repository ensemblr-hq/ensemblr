# Ensemblr v0.1.17

Ensemblr 0.1.17 closes the 2026-09-12 audit with a renderer origin move, gives the review workflow a per-turn diff on every turn footer and in the Changes panel, ships structured bodies for the app's own control-tool timeline rows, and hardens the file-search dialog, the composer's Linear picker, and the sub-agent tab close path.

### Highlights

* **The renderer is served from its own `app://bundle` origin and the `file:` fuse is off, closing SH-03 of the 2026-09-12 audit.** A packaged renderer was a `file:` document with `GrantFileProtocolExtraPrivileges` granted, so a renderer XSS could reach `~/.ssh/id_ed25519` with no IPC handler and no path validation in the loop, and the CSP could not close it — the app needed `connect-src file:` to load its own assets and `img-src https:` carried the result out. The scheme is now named by no directive and refused by the fuse underneath. The move is carried by 0.1.15's storage mirror, which had to ship first and did: anyone who has run 0.1.15 or 0.1.16 keeps their renderer state. An install that jumps straight from a pre-0.1.15 version has no mirror to seed from and comes up with renderer defaults for board order, viewed marks, pins, and per-chat overrides — the rest of the state is in SQLite and unchanged. (#596)
* **Every turn footer now carries a diff of what the turn changed.** A chip per file opens the diff viewer at that turn's scope, and the Changes panel gains a "Latest turn" source resolved from the workspace's newest checkpoint. The transcript is not virtualized, so each turn's `git diff` is held back until its footer scrolls into view and a frozen turn range never polls. (#592)
* **Every `ensemblr_*` control-tool row has a real body instead of a raw JSON dump.** Twelve ops — `wait_for_agents`, `read_conversation`, `get_last_message`, `get_conversation_status`, `list_models`, `recall_memory`, `list_workspaces`, `list_terminals`, `read_terminal_output`, `linear_list_issues`, `linear_get_issue`, `get_diff_comments`, plus `resolve_diff_comments` showing the ids it could not close — get structured presenters, and every settled control row carries the "Raw execution" disclosure that was previously gated behind extension-owned presentations. (#600)
* **A ready-to-merge PR that still holds unpushed commits reports `pr-unpushed` with a warning-tone up-arrow** rather than the green ready glyph, on the sidebar row and the board card alike. A row therefore reports unpushed commits with no extra git query, and the open workspace's row adds uncommitted edits from the working-tree status it already shares with the route layout. (#601)
* **A sub-agent's tab close is withheld while its delegate is still running,** on the tab-strip control and the ⌘W accelerator together, so the orchestrator stays connected to what it is waiting on. The close path is unchanged for a finished delegate. (#599)
* **Picking a Linear issue from the composer shows the chip immediately** instead of waiting five seconds for its comments. The chip lands from the picker's own row and the comments are fetched behind it, rewriting the attachment and repointing the chip at the fuller document. (#598)
* **The file search dialog is snappy again and no longer opens mid-list.** Ranking moved into the dialog behind `shouldFilter={false}` with a debounced query and an ASCII fast path for case-folding, cutting a settled keystroke on a 5,000-file workspace from 25-87 ms to 3-6.5 ms; the selection now survives a re-rank so Enter is never inert. (#597)
* **A tool row's "Raw execution" disclosure paints inside its own row again.** `size-full` on the Streamdown root had made Chrome treat the parent's flex-computed height as definite, pushing the details past the parent's bottom edge and onto the next two rows of the timeline; the fix sizes the markdown body by width alone. (#602)

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

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.16...v0.1.17>
