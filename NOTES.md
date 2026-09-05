## Ensemblr v0.1.3

**Every workspace can carry an architecture diagram.** Directories as nodes, cross-module imports as edges, top-level directories as boundary frames, opened from the conversation tab strip beside the file preview. It is a committed file at `.ensemblr/architecture.json` rather than a row in the database, so it travels with the code it describes — a clone arrives with the architecture already drawn, and a refinement shows up in a pull request instead of hiding in application state.

Nothing in the app derives it. The module-graph scanner is gone, because its only output was a diff full of directory names an agent had to rewrite before it was worth reading; the document is authored entirely through two control ops, and the bundled `architecture-diagram` skill teaches what only a model can fix — boundary labels, node types, reading order, which edges carry meaning. The rule it lives by is stated in the skill: **it is a drawing for you, never a source of truth for an agent**, which reads the code instead.

The feature ships behind an **experimental switch, defaulting off** — and it is a feature gate rather than a preference. With it off, the pane, both control ops, the skill, and every mention of the diagram in an agent playbook are *absent* rather than disabled, so nothing advertises a surface the app will not serve.

**The guide finally shows the app at its own resolution.** Screenshots now come from a separate demo Electron entrypoint that renders the shipped renderer against scripted fixtures, so a shot is a file in `demo/scenarios/` rather than a state someone reproduced by hand and then scrubbed. The guide image set is recaptured at full native resolution: 21 shots at 2992×1866, no downscale and no quantization, including the seven that were missing or outstanding.

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

### What's Changed since v0.1.2

#### Added

* **The workspace architecture diagram, in its own pane**: a committed document at `.ensemblr/architecture.json`, opened from the conversation tab strip. Authored through `ensemblr_get_architecture_diagram` and `ensemblr_update_architecture_diagram` rather than derived from a scan — the scanner, the IR translator, the scan queue and the on-create seeding all go, about 1,200 lines whose output was never worth reading unrevised. A stale diagram asks to be corrected through three gates, cheapest first: a workspace nobody has drawn costs one failed `stat`, only one that has a diagram pays for the change-set read, and only a change set landing inside a component's `sources` pays for the timestamps. Ships behind an experimental switch defaulting off; with it off the pane, the ops, the skill and every playbook mention are absent rather than disabled. Migration 027 adds only the `diagram` tab kind. (#437)

* **A separate demo Electron entrypoint for screenshots**: `demo/demo-main.ts`, `demo/demo-preload.ts` and a renderer root at `demo/main.tsx`, launched by `npm run dev:demo`. It renders the shipped renderer against a stubbed bridge whose answers come from a scenario file, so states that are awkward to stage against real data — an agent frozen mid-turn, a board with cards in every column, a diff with a review thread open — are a file rather than a manual setup followed by scrubbing tracker titles and blurring `/Users/…` paths. Nothing under `src/` changes and the packaged app carries no demo code, because there is none to strip: demo mode has its own `tsconfig.demo.json`, its own `.demo/` output, and its own Electron product name so its `userData` is neither the installed app's nor the dev build's. The guide image set is recaptured at 2992×1866 with no downscale or quantization, replacing a 1600px-wide pngquant'd set. (#435)

#### Changed

* **Dev dependencies bumped within their pinned majors**: `@biomejs/biome` 2.5.11, `@vitejs/plugin-react` 6.1.1, `happy-dom` 20.12.0. The `$schema` URL in `biome.json` moves with Biome, which reports a config pinned to the previous patch as stale. (#436)

* **`docs/` corrected against the code**: the drift an audit turned up is fixed rather than tidied around, the published 0.1.2 assets are pinned in the install guide, and the troubleshooting page stops attributing "`npm run make` exits 0 and `out/` is empty" solely to running under Node 26 — a failed Electron download presents identically and was not mentioned. (#432, #433, #434)

* **Demo mode is excluded from fallow and react-doctor**: a screenshot harness is not product code, and scoring it as first-party is all noise. Fallow takes a `demo/**` ignore pattern so the tree drops out at file discovery and every pass skips it; react-doctor ignores `demo/**` and `.demo/`. Verified at 0 demo files discovered against 1,588 under `src/`, and a full react-doctor scan reporting 0 demo findings at score 100. (#435)

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.2...v0.1.3
