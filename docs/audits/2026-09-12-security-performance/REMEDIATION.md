# Remediation — 2026-09-12 security and performance audit

Every one of the 147 findings in the fifteen reports is dispositioned below.
Four waves of work, committed on `psoldunov/security-and-performance-audit`:

| Commit | Wave |
| --- | --- |
| `a358ca12` | 1 — permission model, Plan Mode, filesystem containment |
| `67b89c14` | 2 — agent control, secrets, Electron shell, integrations |
| `6e06a780` | 3 — storage and runtime pipeline, main-process event loop |
| `a2494a5b` | 4 — renderer rendering path, bundle, remaining handovers |
| `7a2183a8` | diagnostics cleanup (`fallow` dead code and import cycle) |

**Verified at the end of every wave, sequentially:** `npm run typecheck` (all
four projects), `npm run check`, the full Vitest suite (718 files, 8,351 tests),
and all 31 `electron --test` suites. `fallow audit` reports 0 dead-code issues,
0 duplication introduced, 0 circular dependencies introduced.

## Not fixed, and why

These are the only findings that did not land as the report prescribed. Each was
a judgement call made against evidence rather than a gap.

| # | Disposition |
| --- | --- |
| **SH-03** | **Blocked — needs a product decision.** Setting `GrantFileProtocolExtraPrivileges: false` was tried and measured: the renderer entry is an ES module, module scripts are always fetched in CORS mode, and an opaque `file:` origin therefore blocks every chunk — blank window. Closing it for real means serving the renderer from `app://`, which changes the origin and orphans the `localStorage` 19 renderer files use. The fuse is now *declared* `true` in `forge.config.ts` with that measurement, and `tests/main/forge-fuses.test.ts` pins the whole fuse set. |
| **SEC-04** | **Accepted — the report's fix does not work.** Probed against a throwaway Keychain item: `security add-generic-password … -w` as the last option *prompts and requires a retype*, reads line-by-line, and stored `\n` when fed multi-line input, so routing writes through stdin would corrupt any PEM key or the Infisical cache blob. The stated fallback was applied instead: the Infisical cache skips a write whose values match what this process last stored, so the whole-project blob stops crossing argv on every resolution. |
| **INT-13** | **Blocked — needs a signed build.** Dropping `com.apple.security.cs.allow-unsigned-executable-memory` cannot be verified without signing, and no signed build is reachable from this machine. |
| **SH-08** | **Accepted.** `usePdfObjectUrl` → `<embed>` is a live consumer; removing `plugins: true` removes a shipped feature. Mitigated by SH-01 (Electron 44.3.0). |
| **SH-09** | **Accepted, and narrower than reported.** `setSpellCheckerDictionaryDownloadURL` is a documented no-op on macOS, so the Google-CDN fetch is Linux-only. Documented in `docs/guide/11-app-settings.md`; the real fix is bundling Hunspell dictionaries in the AppImage. |
| **SH-12, INT-12** | **Accepted.** Four High advisories, one `image-size` chain behind `@electron-forge/maker-dmg`, `fixAvailable: false`, build-time only, parsing an icon this repo generates. The production tree is clean. |
| **FS-10** | **Accepted.** Evaluation is done by the user's own shell rc, which `SECURITY.md` places outside the boundary, and `direnv` needs a per-directory `allow`. |
| **RR-12** | **Accepted.** The report's own remediation is "nothing until it is shown to matter on a large repo." |
| **PM-09, PM-10** | **Accepted, documented at the call site.** Informational. |

## Deliberate deviations from a report's prescription

| # | What was done instead, and why |
| --- | --- |
| **IPC-04** | `updateRepositorySettings` is ungated in the channel table on purpose and enforces its own rule: a patch touching `permissionMode` always asks the user. Gating it as `app-settings-change` would have locked a `read-only` repository's user out of the screen that relaxes it. |
| **IPC-03** | `confirmation-required` prompts only when the mode is not `workspace-trusted`. Under that mode the renderer *is* the user, and prompting would fire a modal on every settings toggle and double-confirm the delete dialogs. Under `read-only` the sensitive set is now blocked outright, which is the actual win. |
| **DB-02** | No `LIMIT n` — the repository orders ASC, so that returns the *oldest* n. An explicit tail cursor (`beforeOrdinal` / `hasOlder`) instead. |
| **DB-11** | The foreign key goes on `workspace_id`, not `root_session_id`: a Concierge or harness root has no `agent_sessions` row, so the stricter key would fail the spawn. The age-based sweep the report suggested was rejected outright — it would refund lifetime spawn quota and defeat the fork-bomb guard. Attribution fails open, so an origin naming no workspace stores `NULL` rather than refusing to delegate. |
| **CT-05** | The control token is withheld from the three repository-script terminal kinds, which were the actual finding, and kept in plain dock terminals so a hand-run `claude` with a pasted `--mcp-config` keeps working. |
| **SH-04** | The container image is pinned by digest, but `--network=none` is not applied — `electron-rebuild` fetches Electron headers — and narrowing the bind mount is unverifiable from macOS. |
| **PM-04** | Fixed as the audit asked (Plan Mode now refuses `ensemblr_set_branch_name`), which required reversing three passages of `awareness.ts` that actively instructed a planning agent to make that call. |

## Partial, with the remainder stated

| # | What is left |
| --- | --- |
| **RR-05** | The transcript is windowed to its newest 60 messages with paging, which cuts the remount cost proportionally. The `key` on `<Conversation>` is still there: removing it is a scroll-restoration gamble that needs someone to drive a tab switch mid-stream in the real app. |
| **XSS-02** | `<Trans>` no longer re-materialises `<br>`/`<strong>`/`<i>`/`<p>` from an interpolated name. A value naming one of that call site's own `components` keys still resolves to its span — a styling wrapper around part of the name, never injected copy. Stated in the test. |
| **CO-05** | Self-review is refused durably (the check falls back to the session's own persisted opening prompt). Making `reviewsByCaller` itself durable would need a transcript read per workspace tab on every `startReview` — the exact scan CO-03 exists to remove. |
| **CFG-05** | Taken as the documentation branch the finding offered: `environment_variables` is now described as inert everywhere it is documented. Removing the keys from the field maps and `schemas/settings.schema.json` would be the stronger fix. |
| **RT-05** | The per-frame copies are gone. The three finalize passes are not memoized: all three are left-to-right walks with carried state, so a `(length, lastMessage)` key only hits when the last message is also unchanged, which never happens mid-stream. |

## Could not be verified from this machine

- **Everything Linux.** The AppImage, the digest-pinned container build, the
  `0700`/`0600` database modes at runtime, the `basic_text` keyring refusal, and
  the Linux spellchecker path. No Linux host was reachable.
- **The installed packaged app end-to-end.** `requestSingleInstanceLock()` is
  held by the running development instance, and every packaged channel is pinned
  to the release userData (ADR 0054). SH-03's evidence came from loading the real
  packaged bundle in a harness with the packaged preload, which exercised the CSP
  but not Shiki, mermaid, xterm/WebGL or the PDF `<embed>` in situ.
- **`APPLE_TEAM_ID`.** INT-09's Team ID pin is wired and inert until the repo
  secret exists; it warns rather than failing so it is additive-safe meanwhile.

## Known flake, pre-existing

`tests/main/config-loader.test.ts`'s `startWatching reloads the cache and fires
onChange on external edits` intermittently hangs under a loaded machine
(observed: one timeout, then a pass, on byte-identical code that had passed
minutes earlier). `src/main/config/**` and that test are unchanged by this work.
It is an `fs.watch` timing dependency, not a regression.

## Complexity

`fallow` reports 18 complexity findings introduced against 77 inherited, peak
cyclomatic 23 in `resources/pi-extensions/delegation-barrier.mts`. Left as is:
these are the guard and dispatch functions the security fixes grew, and
refactoring working permission code for a score would trade a real risk for a
metric.
