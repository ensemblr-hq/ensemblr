## Ensemblr v0.1.4

**The unattended (AFK) delivery loop is now complete, end to end.** A chat can be told the user is away and it keeps moving without them — its own composer chip, Plan Mode's opposite number — and the Concierge can now open a workspace agent directly into that mode rather than only inheriting it. The loop itself pushes an unattended change through plan, review, and a pull request on its own: it delegates the wide reading a plan needs out to a sub-agent so the orchestrator's own context lasts the whole run, and it stops itself on convergence — nothing left to fix, or the same class of problem circling — rather than on a fixed round count. The review shape moved from a sub-agent back to a peer orchestrator after the review-fix-review cycle showed what a single context window costs a fifty-file diff, alongside a co-tenancy quota that gives an unattended run room for both occupants at once.

**Agents can also reach sideways and upwards.** `ensemblr_start_conversation` with `peer: true` opens a second root orchestrator in the caller's own workspace; `ensemblr_message_concierge` gives a workspace agent a channel back to the Concierge for what it cannot see from where it sits; `ensemblr_linear_create_issue` files a ticket for the follow-up work a session finds but should not do itself.

**Elsewhere:** workspaces get a readable display name distinct from their slugged branch, the review rail is reachable at any window width through a sheet below 1024px, full screen fills its own corner with the wordmark instead of an empty gutter, dock terminals number themselves and show what they're running, and third-party CLI harnesses (Claude Code, OpenAI Codex, Mistral Vibe) now sit behind an Experimental switch, off by default.

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

### What's Changed since v0.1.3

#### Added

* **Agents can reach sideways and upwards, not only down**: `ensemblr_start_conversation` with `peer: true` opens a second root orchestrator in the caller's own workspace, capped at two agents writing one checkout and confirmed with the user whatever the permission mode; `ensemblr_message_concierge` gives a workspace agent a channel back to the Concierge; `ensemblr_linear_create_issue` files a ticket, with a search enforced as a precondition on the first create in a conversation. Decided in ADR 0059. (#442)
* **A chat can be told the user is away, and it keeps moving without them**: a per-chat AFK composer chip, Plan Mode's opposite number. `ensemblr_ask_user_question` is refused, permission confirmations auto-approve at the boundary that means "confirmation required" only, and the toggle is inherited by every conversation it spawns. (#444)
* **Deleting a repository can now take its folder with it**, for one Ensemblr cloned into the managed `repos/` root, cleaning up the leftover `workspaces/<slug>` directory, every private archive-pinning ref, and Infisical link rows along with it. (#445)
* **The Review action now defers to a repository's own review skill instead of overriding it**, running it alone rather than layering a second review guideline set on top. (#446)
* **An unattended change now runs itself through plan, review, and a pull request** instead of stopping at an uncommitted tree: `ensemblr_start_review` opens the workspace's own Review conversation as a second root orchestrator, fixes route back into that same conversation, and a new `buildAfkWorkflowDirective` block states the loop end to end. (#447)
* **The Concierge can now open a workspace agent that runs unattended**, rather than only being able to inherit AFK mode from a caller that already carries it. (#453)
* **Delegating a child now picks its reasoning budget, and the costliest tier of model needs a nod first**: `ensemblr_list_models` publishes each model's thinking-level ladder, and spawning a child onto an explicitly-named frontier model needs the user's confirmation, remembered per workspace and model for the process lifetime. (#454)
* **Dock terminals number themselves and show what they're running**, switching a tab's title to the command its foreground process reports and reverting once it exits. (#456)
* **The navigation sidebar carries a panel for as long as an app update is outstanding**, replacing a dismissible toast that could be waved away and never seen again. (#460)
* **A chat tab now shows the mode its next turn will run under** — the AFK glyph in away indigo, the Plan Mode glyph in accent — while a working chat keeps its spinner tinted to the mode instead of losing it to a static glyph. (#464)
* **Workspaces now get a readable name, and only the branch gets slugged**, so the board no longer shows a kebab slug over its own branch name with the prefix stripped. (#465)
* **The review rail is reachable on any window width**, through a resizable panel at ≥1024px or a sliding Sheet below it, closing a 720–1023px band that had no reachable rail at all. (#468)
* **Full screen fills its own corner with the wordmark** instead of leaving the traffic-lights inset as an empty gutter once macOS slides them off the window. (#469)
* **Third-party CLI agent harnesses are now gated behind an Experimental switch, off by default**, covering Claude Code, OpenAI Codex, and Mistral Vibe; with it off, the launcher, its binding, the menu item, and every playbook mention are absent rather than disabled. (#470)

#### Fixed

* **A spawned conversation no longer lands in the tab you just opened.** Claimability is now declared rather than inferred from an idle-looking row. (#451)
* **Steering a conversation whose tab was closed brings that tab back**, so a follow-up an orchestrator or the Concierge sends streams where the user is looking. (#452)
* **A workspace re-opens on the tab it was on, and closing one walks back the way you came**, fixing three compounding faults in the route loaders and the in-memory visit chain. (#448)
* **Steering a peer orchestrator or the Review conversation no longer mislabels it as a sub-agent in the timeline.** (THE-209) (#449)
* **New workspaces now actually fork from the branch configured in Git settings**, fetching the configured ref before probing it rather than silently falling back to the repository's root branch. (#459)
* **A workspace's PR status no longer flickers backwards when navigating between tabs**, making every hand-off between the live and cached status sources monotonic on a `syncedAt` stamp. (#457)
* **Closing a dock terminal tab now keeps it closed, and tab numbers follow the strip's order**, instead of the dead tab reappearing on the next workspace visit. (#462)
* **A message typed right after stopping a turn no longer gets stranded behind that stop**, since the pause is now scoped to only the messages it's actually about. (#463)
* **The chat timeline holds still while the user has scrolled up during a stream.** (THE-211) (#466)
* **A workspace being archived or deleted no longer shows stale diff counts** beside its "Archiving…" status. (#467)

#### Changed

* **CI checks run in roughly half the time**: splitting Vitest into `node` and `renderer` projects and running `lint`/`typecheck`/`test` as parallel jobs took a CI-shaped run from 96.3s to 72.8s. (#443)
* **A streaming agent turn no longer pins the whole workspace screen's render path**, cutting `Tooltip` renders from 14,911 to 380 and main-thread task time from 13.9s to 8.4s over one measured turn. (#450)
* **The AFK delivery loop now delegates its wide reading and stops itself on convergence, not on a round count**, ending on a clean round, a repeated finding, or a re-plan when one class of problem keeps circling. (#455)
* **Reviews opened by an agent moved to run as a sub-agent, then moved back to running as a peer**, after the sub-agent shape capped the very wide-reading the review exists to buy; a new co-tenancy quota (`maxPerUnattendedWorkspace: 4`) pays the underlying cost instead. (#458, #461)

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.3...v0.1.4
