# 0050. Name a Planning Workspace Before the Agent Does

Date: 2026-08-14

## Status

Accepted

Extends [0044](./0044-enforce-plan-mode-fail-closed-at-the-control-channel.md),
whose §1 records that Plan Mode reaches an agent as *policy* over the control
channel. That is still true of enforcement; this ADR adds the one thing policy
alone could not deliver — prompt text for a runtime the app prompts directly.

## Context

A workspace carries a generated placeholder name — `poulenc`, `gregson-williams`
— until an agent calls `ensemblr_set_branch_name`. In Plan Mode that call
routinely never landed until *after* the plan was approved: the agent explored,
interviewed the user, and wrote a plan first. For the whole of that, the board
showed a workspace whose name said nothing about what it was doing.

The tab title was never the gap. `src/main/agent-runtime/naming/session-naming.ts`
already derives one from the first prompt at open, instantly, with no model in
the loop. The workspace and its branch had no equivalent.

Two independent causes, one per runtime.

**Claude Code never received the carve-out.** `PLAN_MODE_UPKEEP_CLAUSE`
(`src/shared/agent-control/awareness.ts`) exists precisely to say the upkeep
block stays allowed while planning. It lives inside the plan-mode playbooks,
which are Pi-only by design: `preambleFor` is also served to harnesses over MCP
that have no plan-mode toggle. Claude learns of Plan Mode only as the SDK's
`permissionMode: 'plan'`, which carries its own *"You MUST NOT run any
non-readonly tools… This supersedes any other instructions"*. Set against a block
asking it to call three `WRITE_OPS`, it resolved the conflict in favour of the
stronger instruction — correctly, on the text it could see — and deferred every
name.

**The upkeep block carried no timing.** It said *what* to call and never *when*.
The summary bullet actively pushed the wrong way ("once the work is done"), and
the slot it named — "before you write your closing answer" — does not exist in
Plan Mode, where the agent must produce nothing after `ensemblr_exit_plan_mode`.

Prompt text alone would not have been enough anyway. Even a perfectly-worded
block only takes effect when the model chooses to act on it, and the user's
complaint was about latency, not compliance.

## Decision

**Two changes, one per cause.**

**1. The app names the workspace itself, provisionally.** When a Plan Mode
session opens or submits, a fire-and-forget queue derives a slug from the user's
prompt and applies it through the same `applyBranchSlug` gate the agent's own
call uses. No model runs, so the name appears within a second and cannot be
delayed by a slow provider.

The rename is marked `provisional`, which writes `branchProvisional: true` and
leaves `renamedAt` and `branchNamed` **unwritten**. This is the load-bearing
detail: `isWorkspaceNameable` and `isBranchNameable` both still report true, so
every existing gate behaves as if nothing has been named. The guess costs the
agent nothing — its one naming call still lands as a first naming, and the
upkeep block still asks for it. `branchProvisional` is read for exactly two
things: refusing a *second* guess (otherwise the branch would move on every
prompt of a planning session), and switching the branch bullet to ask for a
better name rather than a first one.

The alternative — stamp normally, then add a predicate letting an agent re-name
over a provisional name — was rejected. It would have put a new condition into
both the nudge-eligibility check and the apply gate, where this design touches
neither.

Leaving those gates open does mean a provisional rename needs an admission test
of its own, and it is deliberately *narrower* than either: `isProvisionallyNameable`
requires the generated placeholder to still be in place as well as the branch to
be unguessed. Gating on `isBranchNameable` alone would have let the app move the
git branch of a workspace the user had explicitly titled — a workspace that only
had its display name changed keeps `branchNamed: false` — onto a slug guessed
from one prompt. A guess is only ever an improvement on a placeholder, so it is
scoped to placeholders. `RenameWorkspaceService` re-checks the same predicate
synchronously against the freshly-read row, because the open gates mean two
namers racing the same workspace would otherwise both find it unsettled.

A landed guess is announced on both channels the agent's own `setBranchName`
uses: the `agentControlTabsChanged` broadcast, and a `workspace-renamed` timeline
metadata event via `agentSessionService.appendWorkspaceRenamed`. The broadcast
alone was not enough — its one renderer subscriber invalidates the chat-tab
queries, while the sidebar's workspace name comes from a cached navigation query
that only the metadata event invalidates. Without it the row moved in SQLite and
the board went on showing the placeholder, which is the whole symptom. Metadata
events render nothing in the transcript, so the guess is still silent.

**2. The upkeep block carries its own plan-mode variant.** `buildSessionBriefNudge`
takes a `planMode` flag and, when set, states the carve-out inline, tells the
agent to name now rather than after the plan, and retimes the summary call to
just before `ensemblr_exit_plan_mode`. Both delivery paths pass the flag:
`handleGetSessionBrief` for Pi, `readTurnPreamble` for Claude.

Putting the carve-out in the *block* rather than routing the plan-mode playbook
into Claude's preamble is deliberate. The block is already rebuilt per turn from
live state and already reaches both runtimes; the playbook is fixed at session
open, is written against Pi's tool names, and would sit alongside Claude's native
plan-mode prompt saying overlapping things in different words.

## Consequences

- A planning workspace is named within a second of the first prompt, on both
  runtimes, whatever the model decides to do.
- A provisional name is a guess made before anything was read, and will sometimes
  be worse than what the agent would have picked. It is explicitly labelled as
  such to the agent, and replacing it is free.
- Plan Mode now moves the git branch up to twice — once provisionally, once when
  the agent names it. Both go through `RenameWorkspaceService`, so the workspace
  row and git never diverge.
- `RenameWorkspaceService.rename` takes `RenameWorkspaceInput`, which extends the
  IPC request type with a main-process-only `provisional` flag. It is kept off
  the IPC contract on purpose: a renderer asking for a rename that does not
  settle the name is not a request that makes sense.
- `src/shared/agent-control/session-brief.ts` now renders two variants of every
  bullet. That file stays the single renderer — it is built from runtime state
  and shipped in the brief payload, so the Pi extension still appends text it
  never authors and there is no second copy to drift.
