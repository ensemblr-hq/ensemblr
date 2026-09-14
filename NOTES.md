# Ensemblr v0.1.18

Ensemblr 0.1.18 is a patch release: an inline delegation keeps its card for the whole run, and the narrow-window navigation sidebar opens clear of the title bar.

### Highlights

* **An inline delegation reads as a card for its whole life.** A `Task` or `Agent` row only became a delegation card once its first nested row had landed — correct for an ordinary tool, whose pulse already says everything an empty body would, but it left the stretch a user most wants to watch (the delegate actually working) inert. Making the card depend per render on whether a row had arrived is not the fix: it swaps the component mid-run, React remounts the row, and a disclosure the user had opened closes under them. So the card is unconditional for an inline delegation — before its first nested row and after a run that produced none — and the empty body says which of the two empty states it is. `Skill` is deliberately absent from `ownsNestedActivity`: an ordinary skill load hands `SKILL.md` straight back to its caller rather than opening a subagent, while a skill Claude Code *does* run in one still earns its card from its first nested row via the parent link. A background launch is refused, because that work reports through the background-task surface and the launch's own result body, so a card over it would promise rows that never come. (#609)
* **The navigation sidebar's sheet opens below the title bar, and its top strip is no longer a drag region.** Below the `md` breakpoint the sidebar stops being a column and becomes a sheet, and a sheet pins itself to the viewport's own top edge — which on Linux, where Ensemblr draws its own title bar, is the strip the window controls live in. Both stylesheet rules that hold a sheet clear of that strip key on `data-slot="sheet-content"`, and the sidebar primitive stamps `data-slot="sidebar"` over it *after* the spread, so the sidebar slipped both. Through the sizing rule, the narrow-window sidebar was the one sheet still opening underneath the title bar with its first row unclickable; through the `no-drag` rule, the strip the sidebar draws inside that sheet stayed a window-drag region on macOS, so press-and-drag on its empty left two-thirds moved the window out from under the open sheet. The sizing rule now keys on `data-mobile`, which separates the sheet from the desktop wrapper carrying the same slot, and the `no-drag` selector wraps its ancestor in `:where()` to land at the weight of the drag rule it takes back. The new test runs the shipped rules' own selector lists against the elements the primitive actually renders, so re-vendoring either surfaces there rather than on a narrow window. (#608)

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

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.17...v0.1.18>
