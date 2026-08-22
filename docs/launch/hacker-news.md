# Show HN announcement

Launch copy for Ensemblr on Hacker News. Post the URL, then add the body below as
the first comment (HN convention for a Show HN).

- **Link to submit:** https://github.com/ensemblr-hq/ensemblr
- **Best posting window:** Tue–Thu, 08:00–10:00 ET, when the front page turns over fastest.
- Update the version and download line before posting if a newer beta has shipped.
- Replace `[N] months` in the opening line with the real figure before posting.

---

## Title

HN caps titles at 80 characters. Character counts are in brackets.

**Preferred**

```
Show HN: Ensemblr – a macOS app where the coding agent drives the app itself
```
[78]

**Alternates**

```
Show HN: Ensemblr – run several coding agents, each in its own git worktree
```
[77]

```
Show HN: Ensemblr – multi-agent workspaces for the Claude Code and Pi CLIs
```
[76]

Avoid superlatives and "revolutionary/powerful" framing. HN downweights hype in
titles and the mods will rewrite anything that reads like a press release.

---

## Body (first comment)

```
Hi HN. I'm Philipp. I've been building this alone from Cyprus for the past
[N] months.

Ensemblr is a macOS app for running several coding agents at once without
them stepping on each other. It ships no agent of its own — it drives the
Pi CLI or the Claude Code CLI you already installed and authenticated.

Two ideas hold it together.

The first is that the agent can drive the app. There's a permission-gated
tool surface (I call it Ensemblr Control) that lets an agent open chat tabs
and start conversations in them, launch a harness in a terminal, start and
read run scripts, read the workspace diff and leave review comments on
specific lines, read and move Linear issues, ask me a multiple-choice
question and block on my answer, and move its own workspace across the
board. So the root agent can delegate a unit of work per sub-agent, each in
its own tab and its own context, then block on ensemblr_wait_for_agents
until they report back. No polling loop I had to hand-roll, and no agent
pretending it delegated when it didn't.

Pi reaches that surface through a shipped extension; Claude Code and any
other MCP-capable harness reach the exact same operations through an
embedded MCP server on loopback. One implementation behind both, so the two
surfaces can't drift.

The second idea is that isolation is what makes the first one safe rather
than reckless. Every workspace is a git worktree with its own branch,
working tree, agent sessions, run state, and review path. A fan-out of
agents can't collide because they're not in the same working tree. You
start a workspace from a branch, a GitHub PR, or a Linear issue, and the
dashboard board carries the work that has no workspace yet — unstarted
Linear issues and unassigned GitHub issues — so dragging one rightward is
what creates the workspace from it.

The guardrails are code, not prompt text, which is the part I care most
about getting right:

- Sub-agents never delegate onward, so the tree stays one level deep.
  Nesting depth is capped at 1, a session gets 20 spawns for its lifetime,
  and 10 per rolling minute. A wait whose target is your own ancestor is
  refused instead of deadlocking.
- Nothing at any depth can move a tracker issue to a completed or canceled
  state. Agent work stops at In Review, refused at the port rather than
  discouraged in a prompt.
- Plan mode holds an agent to read-only tools until it submits a plan,
  checked per tool call at the control channel, and inherited by every
  sub-agent it spawns.
- Linear writes are withheld from sub-agents entirely.

There's no account, no sign-in, no backend of mine in the path, and no
telemetry. State is a local SQLite database, secrets go to the macOS
Keychain, and GitHub tokens stay with gh. I store none of them, because
there's no token field in the app to leak from.

Caveats, since Show HN is the wrong place to bury them:

- macOS on Apple silicon only. No Intel, no Linux, no Windows, and none of
  those are close.
- You need git, an authenticated gh, and at least one of pi or claude. The
  app checks all of this on first launch and offers a fix per failing check,
  but it genuinely cannot work without them.
- It's 0.1.0-beta.14. Pre-1.0, expect rough edges and breaking changes.

If you want to try it:

  brew install --cask ensemblr-hq/tap/ensemblr

Or grab the .dmg from the releases page. Builds are signed, hardened,
notarized and stapled, so it opens without a Gatekeeper argument. Source is
Apache-2.0.

What I'd most like feedback on: whether the guardrails above are the right
ones. I picked "stop at In Review" and "one level of delegation" from my own
close calls, not from data, and I'd rather hear now than after someone loses
an afternoon.
```

---

## Prepared replies

Things the thread will ask. Answer in your own words; these are the facts, not scripts.

**"Isn't this just git worktrees plus tmux?"**
Worktrees are the substrate, not the product. What you don't get from tmux is an
agent that can open a tab, delegate into it, block until the child reports, and
have the app refuse the operations it shouldn't be doing. The isolation exists so
the delegation is safe.

**"Why not support Windows/Linux?"**
One person, and the app leans on the Keychain, the native menu bar, and a signed
and notarized macOS build. Porting means owning three sets of platform bugs at
once. Ask again after 1.0.

**"Why bring-your-own CLI instead of API keys?"**
Your credentials, your models, your config, and nothing new to leak. It also
means the Claude Agent SDK's ~260 MB per-platform binary stays out of the app.

**"How is Ensemblr Control authenticated?"**
A loopback HTTP server on an ephemeral port, alive for the life of the app. Every
agent gets a bearer token injected into its environment, scoped to that session.
The agent never supplies its own identity and the token never appears on a
command line.

**"Business model?"**
Apache-2.0 and free today. Nothing is decided beyond that, and there is no
telemetry to change my mind with.

**"Does it write to my tracker?"**
Only when it's a Linear issue the workspace is linked to, only from the root
agent, and never into a completed or canceled state. Backlog issues on the board
are read-only: dismissing one hides it locally and its real status stays yours.

---

## Checklist before posting

- [ ] Version, download link, and beta number match the current release.
- [ ] The demo video on the README plays on a cold load without a GitHub login.
- [ ] `brew install --cask ensemblr-hq/tap/ensemblr` works on a clean machine.
- [ ] Free for the following 4–6 hours to answer the thread. An unanswered Show HN dies.
