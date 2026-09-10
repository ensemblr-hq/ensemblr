# Ensemblr v0.1.14

Ensemblr 0.1.14 makes multi-agent work easier to direct and follow, with a bounded two-level delegation hierarchy, a live Agents panel, and safer unattended workflows.

### Highlights

* **Two-level delegation with a live Agents panel.** An orchestrator can delegate a workstream to a manager, which can split it across leaf agents. Ensemblr preserves lineage and spawn budgets across restarts, shows live activity and context usage, links child conversations back to their parent, and keeps completed history compact. (#535, #544, #547)
* **Models can be assigned orchestration roles.** Settings now support Sage, Coder, Builder, Grunt, and Explorer preferences, plus opt-in delegation between Pi and Claude Code. AFK agents choose review delegation for the work at hand, and delegation guidance preserves the parent orchestrator's context. (#537, #541, #542)
* **Safer plans, workspaces, and guardrails.** Workspace Git operations scrub inherited Git environment state, Plan Mode preserves refinements and locks the composer while review is pending, and internal wait-barrier refusals stay out of the user-facing timeline without hiding real errors. (#536, #543, #546)
* **Desktop workflow polish on macOS and Linux.** Caffeinate handling recovers cleanly across battery changes, Linux sidebar sheets clear the native title bar, the Concierge can manage app settings, and workspace files now distinguish symlinks and dotenv files. (#534, #538, #539, #545)

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

*Full changelog*: <https://github.com/ensemblr-hq/ensemblr/compare/v0.1.12...v0.1.14>
