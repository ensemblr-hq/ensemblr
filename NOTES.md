## Ensemblr v0.1.1

**Fable 5.1 is selectable in a Claude Code chat.** Claude Code advertises only its moving aliases (`opus`, `sonnet`, …) from `supportedModels()`, so a named model has to be pinned into Ensemblr's catalog to appear in the picker at all. `claude-fable-5-1` is now pinned, and because the `fable` family already led the family order it sorts to the top of the list rather than trailing the other pinned rows.

Selecting it needs a **Claude Code binary at 2.1.251 or newer**. On an older binary the model id is rejected by the CLI when the chat starts rather than when the picker is opened — the same way a model the signed-in account is not entitled to fails.

```sh
claude --version   # must be >= 2.1.251
```

The rest of the release is the Linux window-drag fix and a dependency bump within every pinned major.

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

### What's Changed since v0.1.0

#### Added

* **Fable 5.1 in the Claude Code model picker**: `claude-fable-5-1` joins `PINNED_MODELS` in `src/main/claude-agent/claude-model-catalog.ts`. Pinning is what makes a named model selectable — `supportedModels()` returns only the aliases that track the newest release, so a model whose behaviour you want fixed has to be listed explicitly. Requires the user's own Claude Code binary at 2.1.251 or newer; an older binary, or an account without the entitlement, fails when the model is actually selected rather than when the picker is opened. (#423)

* **A copyright line on the macOS "Get Info" panel**: `appCopyright` in the Forge config fills `NSHumanReadableCopyright`, which the panel had been leaving blank. The holder tracks `NOTICE`, which credits the author rather than the product name. (#423)

#### Changed

* **Linux windows are dragged by the title bar, not by the toolbars**: the app's toolbars carried `-webkit-app-region: drag` on every platform. That is correct only where the platform insets its own window controls into the content — on macOS the traffic lights sit in the toolbar, which makes the toolbar the window's drag surface. Linux draws either the title bar Ensemblr renders itself or a compositor frame, and the toolbar there is plain content that should not move the window. The drag rule is now keyed on an `inset-window-controls` class that `applyWindowChrome` toggles from `chrome.controls === 'system-inset'`, and `DRAG_REGION_SELECTOR` narrows to the title bar. The stylesheet-parity test was hardened to guard that the toolbars stay gated. (#423)

* **Dependencies bumped within their pinned majors**: Electron 44.1.1, `@anthropic-ai/claude-agent-sdk` 0.3.259, Zod 4.5.4, `lucide-react` 1.40, TanStack Query/Router/Virtual, i18next and `react-i18next`, Jotai, Motion, `shadcn`, `i18next-cli`, `tsx`, and the Testing Library packages. `@types/node` stays on `^24` deliberately — it mirrors the Node major the Electron runtime embeds rather than the latest release, so typing against a newer one would let a green typecheck ship a runtime `TypeError`. The xterm core and its addons are untouched, since they are versioned independently and are only paired by publish date. The credits manifest is regenerated for the resulting metadata. (#423)

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.0...v0.1.1
