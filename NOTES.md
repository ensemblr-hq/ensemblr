# Ensemblr v0.1.16

Ensemblr 0.1.16 is a patch release: a planning agent on a trusted or read-only workspace gets its control surface back.

### Highlights

* **A planning agent can drive the app again.** On a trusted or read-only workspace, a planning Claude session could not name its tab, name its branch, record a summary, ask a question, fan out, or submit its plan — two independent gates closing on it at once. Ensemblr's own: `setBranchName` had been added to the plan-mode block list by the 2026-09-12 audit remediation, contradicting ADR 0050, which asks a planning session to name the work first so the board does not sit on a placeholder through the whole interview. Claude Code's own: any MCP tool the CLI cannot read as read-only is routed through a permission callback that only `approval-required` workspaces wire, so everywhere else the whole `mcp__ensemblr__*` surface came back refused — and `ExitPlanMode`, `EnterPlanMode` and `AskUserQuestion` are published only to a session that supplies that callback, leaving a planning session with no way out at all. The block-list entry is removed, and the plan-mode `PreToolUse` guard now clears the control tools with a hook `allow` the CLI honours ahead of the mode. Authority stays where it was: at the control server, per op and per role, with the workspace permission mode still applied on top. (#593)
* **Documentation corrected and pinned to the published release.** A drift sweep over `docs/` checked every claim against the code, the config, or the published release rather than the prose that made it — ADR counts, IPC and contract module counts, the agent-control op tables, the Claude SDK surface and its options, and every version reference, download URL, and asset filename. (#591)

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

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.15...v0.1.16>
