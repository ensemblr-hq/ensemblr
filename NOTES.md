# Ensemblr v0.1.15

Ensemblr 0.1.15 is a hardening release: a full remediation of the 2026-09-12 security and performance audit, durable renderer state in SQLite, and shared repository settings that travel on a workspace branch.

### Highlights

* **The 2026-09-12 security and performance audit is fully remediated.** All 147 findings are closed. The per-repository permission mode is now read repository-first, so `read-only` and `approval-required` actually engage instead of showing as selected while inert; the permission gate covers all 54 write channels rather than the eleven that opted in, and a new channel is a compile error against the channel-to-action table. Plan Mode's bash allowlist no longer admits an escape through `sort --compress-program`, writers into the repository-controlled `.context` tree no longer follow symlinks, and the agent event log has a retention policy. (#569)
* **Durable state and shared settings.** Renderer local storage is mirrored into SQLite, so UI state survives a cleared web storage partition. Shared repository settings — setup and run scripts, environment layers, prompt configuration — publish onto a workspace branch and reach collaborators through the repository instead of each machine. (#574, #561)
* **Agent work is easier to follow and harder to lose.** Tool call previews render on one text surface across runtimes, activity indicators say more about what a session is doing, offscreen agent questions raise a notification, and delegation can be held until you ask for it. (#568, #553, #560, #567)
* **Review, workspace, and Pi fixes.** The PR header waits for a merge the push has actually verified, the review rail is seated at a width the panel group can fit, the file and changes lists no longer follow a symlinked directory out of the worktree, a refused agent can correct itself, and Pi tool calls whose result line is discarded now settle. (#587, #588, #586, #566, #565, #564, #563, #589)

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

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.14...v0.1.15>
