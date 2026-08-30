## Ensemblr v0.1.0-beta.18

### What's Changed

#### Features

* **Concierge delegation first**: The Concierge now delegates to orchestrators as its first action, ahead of tool inventory. Investigating, planning, and implementing are explicitly named as the orchestrator's job. A four-item brief checklist replaces the open-ended read, with tempting reads (approach selection, file list drafting) ruled out by name. The Concierge answers state questions itself and does not spawn an agent to read the board. "Delegate one workspace at a time" is replaced by "one orchestrator per workspace" — the one-writer rule is a property of a worktree, not a cap on the Concierge. A task that spans projects gets a workspace and orchestrator in each, spawned in the same turn, with coordination left to the Concierge. Multiple orchestrators may work the same task from separate workspaces, each on a different model or approach, so the user can choose between implementations. (#378)

#### Fixes

* **Iconify collections registered once**: Iconify collections are now registered once at renderer startup in `main.tsx`, before the first render. Previously, registration was a module-scope side effect, so glyphs only resolved if something else had already pulled the workbench barrel in. `OpenTargetIcon` drew vscode-icons glyphs without importing them, leaving those icons on an HTTP request to api.iconify.design instead of the bundle. The renderer test suite also stops reaching the network: vitest aliases `@iconify/react` to its own offline build, and a new test guards both behaviors. Also clears unused imports and bindings that surfaced. (#372)

* **Headerless Markdown tables**: Headerless Markdown tables (pipe tables without a header row) no longer render with an empty header band. A new `dropEmptyTableParts` rehype plugin removes a `<thead>` whose cells are all empty. Only structural tags are walked, so images, line breaks, or inline chips count as content. It also removes the `<table>` when taking the band away leaves no rows at all. Copying a headerless table now works correctly: `tableDataToMarkdown` returns the empty string for a table with no headers, and `tableMarkdown` rebuilds a blank header row as wide as the widest body row for proper round-tripping. The clipboard stub moves to shared DOM support for end-to-end copy tests. (#371)

#### Documentation

* **ADR count corrected**: README said 52 Architecture Decision Records; `docs/adr/` holds 54 (0001-0055, with 0007 absent). (#370)

* **CI claim corrected**: CONTRIBUTING said "CI does not run them" of the local gates. That has been false since THE-194 (#308): `.github/workflows/checks.yml` runs check, typecheck and test in its `verify` job on a macOS runner, plus a react-doctor `scan` job. The claim is replaced with what the workflow actually does, and the "CI does not run them" note moves to the `electron --test` suites where it still holds. (#370)

* **README updated for v0.1.0-beta.17**: The Version line and download links now point to `0.1.0-beta.17` and `Ensemblr-0.1.0-beta.17-arm64.dmg`. The Homebrew line needs no edit as the release job bumped the cask automatically. (#369)

* **Drift corrections ahead of v0.1.0-beta.17**: Download links, tag links, and version references in docs were updated from 0.1.0-beta.14 to 0.1.0-beta.17. Architecture map counts refreshed: IPC handlers 33→36, request schemas 21→23, shared-root modules 27→32, IPC contracts 38→41, test suites 171/274/34→202/317/38. Added missing concerns: src/main/dictation/, components/text-context-menu/, lib/agent-failure-text/, state/updates/. Corrected the claim that both setup gates read one check table. Dropped the stale release count from the release ritual. (#368)

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.0-beta.17...v0.1.0-beta.18
