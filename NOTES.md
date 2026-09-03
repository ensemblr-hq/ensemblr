## Ensemblr v0.1.0-beta.24

**Cloning offers a branch picker, and Plan Mode stops guessing about delegation.** Cloning a repository now offers the same branch picker create-from-source already has, so a repository whose work happens off GitHub's default branch checks out where it should from the first workspace onward. A Claude Code chat planning inside Ensemblr no longer has to guess between three disagreeing instructions about delegation — the per-turn preamble now says which one governs, closing two related holes where a sub-agent could raise a review panel nobody is watching or inherit the root's own delegation rights across a resume. And a branch cut from a base whose own pull request is already merged stops reporting itself as merged.

### What's Changed

#### Added

* **The clone dialog offers a branch picker, not just a URL field**: a repository whose work happens on anything but GitHub's default branch was cloned onto the wrong branch and seeded its first workspace off it. `cloneBranch` now reaches `git clone --branch` on both the `gh` and `git` leg, and the picked branch is persisted as the repository's `branchFrom` setting before the clone reports success, so every later workspace forks from it too. A new IPC surface, `ensemblr:github-remote-branch-list`, reads branches for a not-yet-cloned repository straight from its URL, keyed by URL since no repository row or checkout exists yet. `github-branches.ts` owns the GraphQL query, its parser, and the default-pin ordering for both the picker and the existing Git settings page, so the two surfaces cannot drift. (#418)

* **A Claude Code chat in Plan Mode is told which of its three delegation instructions governs**: the SDK's own Plan Workflow ("Launch up to 3 Explore agents IN PARALLEL"), a standing "don't call AgentTool unless requested" line baked into the model's prompt bundle, and Ensemblr's own denial of `Agent`/`Task` on the `ensemblr` mechanism disagreed with no signal for which one to follow — one turn was observed reasoning through the conflict out loud and picking the safer-sounding one by guess. `buildPlanModeDelegationDirective` now renders a block naming the runtime's actual delegation tool and its correct replacement literally, appended to the per-turn preamble, with three variants: the root agent on `ensemblr` (told `ensemblr_start_conversation` replaces its denied tool), the root agent on `native` (told the SDK's own fan-out is exactly right here), and an investigator sub-agent (told the fan-out step isn't its to run and where `ExitPlanMode` belongs instead). Two related holes were found and fixed alongside it: a sub-agent could still raise a review panel through Claude Code's native `ExitPlanMode` tool, which the deny list built for exactly that case never covered; and a resumed child session could inherit the root's own delegation rights, because the lineage field pinning it to a mechanism carries nothing across a resume. (#417)

#### Fixed

* **A branch forked from a base whose own pull request is merged no longer reports itself as merged**: `git worktree add` without `--no-track` inherits the base as its upstream whenever the fork point is a remote-tracking ref — which is every Ensemblr workspace — so `gh pr view` was handed the base branch as the head ref and answered with the base's own, already-merged, pull request; an unpushed branch also claimed to be up to date with the remote off the same inherited upstream. Branches are now cut with `--no-track` at both sites that create them, and a runtime guard rejects an upstream that merely names the workspace's stored base branch for branches already on disk — except where the worktree is genuinely parked on that base, which keeps its real ahead/behind counts rather than reading as unpushed. (#416)

* **Dependency Bumps** (#404, #407, #410, #411): `@xmldom/xmldom` 0.9.10 → 0.9.12, `fast-uri` 3.1.5 → 3.1.7, `qs` 6.15.2 → 6.16.0, and `browserslist` (dev) 4.28.2 → 4.28.8.

---

*Full changelog*: https://github.com/ensemblr-hq/ensemblr/compare/v0.1.0-beta.23...v0.1.0-beta.24
