# Agent Orchestration Playbook

> The canonical guidance that teaches an agent to use the `ensemblr_*` control tools. The
> authoritative text lives in `src/shared/agent-control/awareness.ts` as a **2×2 of role by Plan
> Mode**: `ORCHESTRATOR_AWARENESS` / `SUBAGENT_AWARENESS` for working agents, and
> `PLAN_MODE_ORCHESTRATOR_AWARENESS` / `PLAN_MODE_SUBAGENT_AWARENESS` for planning ones. The role axis
> comes from `resolveAgentRole(marked, depth)`: the durable sub-agent marker on the chat tab decides
> it, falling back to `roleForDepth` when there is none — a root (depth 0) is an orchestrator that may
> delegate; a spawned child (depth ≥ 1) is a sub-agent that does its own work and never fans out. The
> marker wins because depth lives in an in-memory registry a restart clears, which used to hand a
> resumed child the whole surface back. The Plan Mode axis comes from
> the app per turn, and it **replaces** the role playbook rather than stacking on it — see
> [Planning with sub-agents](#planning-with-sub-agents). Both reach the two always-on injection
> points:
>
> - **Pi** — the extension's `before_agent_start` hook appends the variant chosen by the
>   app-injected `ENSEMBLR_CONTROL_ROLE` env var (`orchestrator` | `subagent`) and this turn's
>   Plan Mode state from `getSessionBrief`. Because a packaged app cannot import `src/` at runtime,
>   `resources/pi-extensions/ensemblr-control.mts` embeds byte-identical copies of all four; a parity
>   test (`tests/main/agent-control-awareness-parity.test.ts`) fails if any drifts.
> - **Harnesses** (Claude Code, Codex, Mistral Vibe) — a harness launches as a root session but
>   owns a *terminal* tab, so it gets its own shorter variant, `HARNESS_AWARENESS`. The MCP server's
>   `instructions` field (`src/main/agent-control/mcp-endpoint.ts`) carries it, and
>   `src/main/agent-control/harness-launch-config.ts` also appends it to the launch command as a
>   system prompt, because no harness reliably surfaces an MCP server's `instructions` to its model.
>
> This file is the human-facing reference for that guidance; keep it in step with the constants by
> hand.

## What a harness does not get

The MCP endpoint serves a harness only the ops it can actually use. These four — `CHAT_TAB_ONLY_OPS`
in `src/shared/agent-control/subagent-policy.ts` — are absent by design, and the service refuses them
to any caller without a chat tab even if one is reached directly:

| Absent | Why |
|---|---|
| `ensemblr_set_name` | A harness tab is a terminal whose title is derived from the harness's own session log (`src/main/terminal/agent-conversation-title.ts`) — there is no chat tab to rename. |
| `ensemblr_set_summary` | Session summaries hang off a chat tab's session record. |
| `ensemblr_ask_user_question` | The question panel renders inside the chat tab bound to the asking session. |
| `ensemblr_exit_plan_mode` | Plan Mode is a per-chat toggle, and the plan posts into the chat tab that wrote it. |

The axis is the **tab, not the runtime**. `withheldControlOps` reads `ControlAudience.hasChatTab`, so
native Claude Code holds all four while the `claude` TUI harness holds none — same binary, different
caller. Naming a runtime here instead is what would have to be revisited every time one is added.
Plan Mode itself is narrower still: the two plan-mode playbooks are consumed only by the shipped Pi
extension, since a runtime whose only channel is MCP has its system prompt fixed at session open.

A harness also gets no per-turn upkeep block — the app renders that into a Pi system prompt and a
harness has no equivalent hook — so `HARNESS_AWARENESS` carries the branch-naming nudge itself.
`ensemblr_set_branch_name` still enforces `git.renameWorkspaceOnBranch` on its own; the playbook's
job is to frame a refusal as settled rather than as a fault worth retrying.

### How each runtime receives the upkeep block

Pi's extension pulls it over `getSessionBrief` on `before_agent_start`, which is why that op is
absent from `TOOL_DEFS` — nothing reaches it over MCP. A first-class runtime the app drives over
MCP has its system prompt fixed at session open, so `resolveAgentControlWiring` hands it a
`resolveTurnPreamble` and the adapter prepends the block to each prompt the model receives, never to
the one the app persisted. Adding a runtime that skips both leaves it holding
`ensemblr_set_branch_name`, told to follow a reminder that never arrives — Claude shipped in exactly
that state and never named a branch.

## Role

You run inside Ensemblr and can drive the app itself. **Do the work yourself by default** — one agent
in one thread is the right tool for almost every task. Delegate **only** when the task genuinely
splits into two or more independent, substantial workstreams that can run in parallel; never spawn a
helper to do a single unit of work you could do in one pass, and never delegate a task just because
you can. When delegation is warranted, spawn helpers, **wait on them**, evaluate their output, and
integrate the result — and never tell the user to click.

Only the **root** orchestrator delegates. A spawned sub-agent does its assigned work itself and
cannot delegate onward (see [Sub-agent side](#sub-agent-side)). Two independent checks say so: the
role table refuses a marked child `denied-scope`, and the depth cap — default `1` — refuses any
caller at depth ≥ 1 `denied-depth`. The role check is the durable one; the cap is what stops a root
from fork-bombing.

### Which mechanism delegates

Claude Code has a sub-agent tool of its own; Pi does not. Settings → Providers → Claude Code picks
which one a Claude chat delegates with, and the unpicked one is *absent* rather than discouraged:

- **Ensemblr chat tabs** (default) — the loop below, with `Agent`/`Task` denied through the SDK.
- **Claude Code built-in** — its own sub-agent tool, with `ensemblr_start_conversation`,
  `ensemblr_spawn_chat_tab`, `ensemblr_send_follow_up`, `ensemblr_wait_for_agents`, and
  `ensemblr_list_models` withheld from the tool list. Everything in this document that is a property
  of the *work* rather than of the mechanism — split before you fan out, brief for a deliverable,
  verify before you rely, gather the open questions — still applies.

The mechanism is fixed when the chat opens, so a change reaches the next chat. See
[The delegation-mechanism axis](../agent-control.md#the-delegation-mechanism-axis).

### The answer goes last

Your last message is your answer to the user, and it is the last thing you produce in the turn. Every
tool call comes first — the work, the bookkeeping (`ensemblr_set_summary`), the cleanup
(`ensemblr_close_tab`), the focusing.

This is a rendering constraint, not a style preference. The chat surface shows a turn as one
collapsed activity row plus the prose that follows the turn's final **visible** tool call
(`splitTurnParts` in `src/renderer/components/chat-assistant-turn.tsx` promotes only the trailing run
of finished text parts). Prose followed by another tool call is filed as working commentary and folded
into that row, rendered muted and small — so an orchestrator that writes its report and then files
something has buried the report behind a disclosure the user has to find and expand, and the pointer
sign-off that usually follows it ("full report is above") is all they see. The same rule is already on
the sub-agent side, where the reader is the orchestrator rather than the user.

`visibleTurnParts`, in the same file, drops the three bookkeeping calls entirely
(`ensemblr_set_summary`, `ensemblr_set_name`, `ensemblr_set_branch_name` — see
`src/renderer/lib/agent-timeline/ensemblr-tool-presentation.ts`), so those specifically can no longer strand an
answer. That is a backstop, not a licence: `ensemblr_close_tab`, `ensemblr_focus_*`, and every other
control call still render, and still end the run. A **failed** bookkeeping call also still renders, so
a permission denial stays visible.

## Tool map

| Goal | Tools |
|---|---|
| Delegate a subtask to a sub-agent | `ensemblr_start_conversation` (fresh tab + `title`; keep its `agentSessionId`). The child runs the caller's own agent runtime. While planning, it inherits Plan Mode. |
| Name your own tab | `ensemblr_set_name` (chat tabs only; the label goes in `title`, as it does everywhere) |
| Name the workspace + git branch | `ensemblr_set_branch_name` (once per branch, while the branch still carries the name it was cut with; refuses unless the user enabled `git.renameWorkspaceOnBranch`. Pass `userRequested: true` when the user asks for a different branch name — never `git branch -m`) |
| Record what the session covered | `ensemblr_set_summary` (every turn; chat tabs only) |
| **Block until children settle** | `ensemblr_wait_for_agents` |
| Steer / correct a child | `ensemblr_send_follow_up`. While planning, reaches only a target that is itself planning. |
| Delegate to a CLI agent | `ensemblr_launch_harness` (claude / codex / vibe). Blocked while planning. |
| Run / inspect commands | `ensemblr_start_terminal`, `ensemblr_write_terminal`, `ensemblr_read_terminal_output`, `ensemblr_stop_terminal` |
| Pick a run script to start | `ensemblr_list_run_scripts`, then `ensemblr_start_terminal` with `kind: "run"` and that `scriptName` |
| Inspect a child out of band | `ensemblr_get_conversation_status`, `ensemblr_get_last_message` |
| Audit what a child actually ran | `ensemblr_read_conversation` — its prompts, answers, and every tool call with arguments and result; call it with `stat: true` first, then page with `fromOrdinal`, or read one entry whole with `ordinal` |
| Pull the orchestrator back (sub-agents) | `ensemblr_notify_orchestrator` |
| Ask the human to decide | `ensemblr_ask_user_question` (blocks until answered, with no timeout; chat tabs only) |
| See the workspace | `ensemblr_list_workspaces`, `ensemblr_list_tabs`, `ensemblr_list_terminals` |
| Move / read the workspace board | `ensemblr_set_workspace_status`, `ensemblr_get_workspace_status` |
| Read the workspace diff | `ensemblr_get_workspace_diff` — call it with `stat: true` first, then read the whole diff or one `filePath` at a time |
| Read / leave review comments | `ensemblr_get_diff_comments`, `ensemblr_add_diff_comments` (Ensemblr-local comments only; GitHub PR threads are not included) |
| Close a comment you fixed | `ensemblr_resolve_diff_comments` — resolve in the same turn as the fix; resolve only what you actually fixed and say in your reply what you left open |
| Read the Linear backlog | `ensemblr_linear_list_issues` (no descriptions), `ensemblr_linear_get_issue` (one issue, comments included), `ensemblr_linear_get_metadata` (the ids an update takes). Check `status`: `not-connected` is not an empty backlog. |
| Record progress on a ticket | `ensemblr_linear_create_comment`. Sub-agents put it in their report instead. |
| Move a ticket along | `ensemblr_linear_update_issue` — state, assignee, priority, title, description, by id. `Done` and `Canceled` states are refused: take it to In Review. Blocked while planning; sub-agents report instead. |
| Pick a model for a child | `ensemblr_list_models` |
| Surface work to the user | `ensemblr_focus_tab`, `ensemblr_focus_dock_tab`, `ensemblr_focus_panel` |
| Tidy up | `ensemblr_close_tab` |

## Delegate → wait → evaluate → integrate

**Split the work before you split the agents.** A child cold-starts with nothing but its brief, so
every fact two children both need is a repository read paid for twice — and that re-derivation is
what makes a fan-out cost more context than doing the work inline. When the workstreams share a
foundation, the orchestrator establishes it once — itself, or with one scout child — and puts the
findings with full paths into every brief; cold fan-out is for work that is genuinely disjoint. All
three orchestrating playbooks say so and a parity test pins it.

1. **Spawn** each helper with `ensemblr_start_conversation` in its **own fresh tab** — pass a short,
   descriptive `title` and do **not** pass `chatTabId` (reusing a prior tab keeps its old title).
   Omit `wait` and keep the returned `agentSessionId`. **Brief each child with what to deliver, not
   just what to look at:** the question it answers, the defaults it should assume rather than come
   back and ask about, and whether it reports inline (the default) or writes a file at a path the
   orchestrator names — a brief phrased as a noun ("produce a reference doc", "write up the
   mapping") reads as an instruction to create one. Every conversation can also rename its own tab
   at any time with `ensemblr_set_name`; a sub-agent should do so early with a label for its task.
2. **Wait.** Once everything that can run in parallel is delegated, call `ensemblr_wait_for_agents`
   and let it **block**. This is the mechanism that stops the orchestrator racing ahead — do **not**
   hand-roll a polling loop with `ensemblr_get_conversation_status`.
   - `mode: "all"` (default target: every child you spawned) blocks until they all finish. The mode
     itself defaults to `first`, so an orchestrator that means "all" has to say so.
   - `mode: "first"` returns as soon as any one child finishes or raises a signal.
   - The result carries each settled child's `status`, `lastMessage`, and any `signal`, plus
     `pending` — the targets that had not settled, so the caller can wait on exactly those next
     instead of polling each one.
   - `reports: "brief"` (default `"full"`) shortens each `lastMessage` to `BRIEF_REPORT_CHARS`
     and appends a pointer to `ensemblr_get_last_message`, setting `reportTruncated`. Opt-in,
     because the full report is what makes a wait citable; see the note below on why it exists.
   - `timedOut: true` with targets still in `pending` is a **lap of the loop, not a fault**. The
     window is capped at `waitTimeoutMs` (5 min, `src/main/agent-control/guardrails.ts`) and
     `timeoutMs` can only ask for *less* (`Math.min`), so a child doing real work outlives it
     routinely. The result carries a `note` naming the resume call, because an orchestrator reads a
     bare boolean as something to report to the user or work around — same reason a shortened
     report carries its own re-fetch pointer. See `resumeWaitNote`
     (`src/main/agent-control/agent-control-service.ts`).
   - A child that hits a decision point calls `ensemblr_notify_orchestrator` (`need_decision` /
     `blocked`), which wakes the wait immediately **in either mode**. `waitAllSatisfied`
     (`src/main/agent-control/agent-control-service.ts`) is what makes that true under `all`:
     without it a blocked child would hold its question until the 5-minute wait timeout while its
     siblings kept running. `progress` and `done` stay informational and never cut a wait short.
3. **Evaluate.** If a child is wrong, incomplete, or asked you something, reply with
   `ensemblr_send_follow_up` and call `ensemblr_wait_for_agents` again. Repeat until done.
4. **Verify** at least one load-bearing claim per child before building on it. A report is a
   claim, not a fact the orchestrator checked; nothing else in the loop prompts a check, so a
   cited path reads as verified when nobody opened it. Both orchestrator playbooks now say so
   outright, and a parity test pins the wording.
5. **Ask** — gather every child's `Open questions`, drop what you can settle by reading, merge the
   duplicates, and put the survivors to the user with `ensemblr_ask_user_question` before writing
   the answer. See the note below on why the questions arrive here rather than mid-run.
6. **Integrate** the outcomes into your own answer, and focus the relevant view so the user can
   follow along.

> **Recovering a finished child.** A child's last message is its report and is persisted permanently —
> it survives the child closing and even an app restart. If your wait is interrupted (for example the
> app restarts) and a child then shows a `closed` or `idle` status, read its result with
> `ensemblr_get_last_message` before reacting; `closed` means the child ended, not that its work was
> lost, and `ensemblr_get_conversation_status` reports `hasFinalMessage: true` whenever that report is
> still there. Never re-spawn a child to redo work whose report you can still read.

> **`lastMessage` is a whole turn, not one message.** `findFinalTurnText`
> (`src/main/agent-control/port-adapters.ts`) scans a branch newest-first, collects every assistant
> message back to the user prompt that opened the turn, and joins them oldest-first. Reading only the
> newest message loses the common case where a child writes its findings and then closes with a
> hand-off line ("report delivered above") — the orchestrator would get the hand-off and nothing else,
> and would have to spend a `send_follow_up` round trip recovering work the child already did. A turn
> that produced no assistant text at all (a child re-prompted and still working) is skipped rather than
> treated as the end, so the report it already filed is still what comes back. A tool-heavy turn can
> hold dozens of assistant messages, so the join stops at `MAX_AGENT_PAYLOAD_CHARS` (32k,
> `src/shared/agent-control/workspace-diff.ts` — one ceiling shared with the workspace diff) — read newest-first,
> the cap sheds the narration that opened the turn, never the answer that closed it, and one child
> cannot flood its orchestrator's context from a single tool result.

> **Why `reports: "brief"` exists.** 32k caps one child, not a fan-out: four children can put four
> whole turns into one tool result, and an orchestrator that reads all of it to quote one line from
> each has spent more context than doing the research itself would have cost. That is the honest limit
> of delegation here — it buys parallelism, not context. `briefReport`
> (`src/shared/agent-control/brief-report.ts`) cuts at the last paragraph break inside
> `BRIEF_REPORT_CHARS` (1.2k) and appends the `ensemblr_get_last_message` call that recovers the rest.
> Cutting at a paragraph is what makes the short form usable: the sub-agent playbook mandates
> answer-first, evidence-second, so the head keeps the finding and the tail is exactly the half worth
> fetching on demand. It stays **opt-in** — a full report is what lets an orchestrator cite specifics
> straight into a plan — and the pointer goes into the text rather than being left to
> `reportTruncated`, because a model acts on prose.

## Example — parallel delegation

```
a = ensemblr_start_conversation({ title: "Test foo.ts", prompt: "Write unit tests for src/foo.ts" })  // { chatTabId, agentSessionId }
b = ensemblr_start_conversation({ title: "Test bar.ts", prompt: "Write unit tests for src/bar.ts" })
# both children now run; block until they finish or need you:
r = ensemblr_wait_for_agents({ mode: "all" })
for child in r.completed:
  # evaluate child.lastMessage; if a child.signal is need_decision, answer it:
  if child.signal: ensemblr_send_follow_up({ agentSessionId: child.agentSessionId, prompt: "<decision>" })
# a signal returns the wait early, so re-wait on whoever is still running plus anyone you answered:
still_out = [p.agentSessionId for p in r.pending] + answered_ids
if still_out: ensemblr_wait_for_agents({ mode: "all", targets: still_out })
```

## Planning with sub-agents

Plan Mode is a per-chat toggle that swaps an agent's role playbook for a planning one and blocks every
route back to editing the repository. It does **not** block delegation. A planning orchestrator may fan
out **read-only investigators** when the plan hinges on facts spread across two or more independent
areas of the codebase — the same delegate → wait → evaluate → integrate loop, with findings feeding the
plan rather than the work.

**Inheritance is a snapshot at spawn.** `handleStartConversation` reads the caller's Plan Mode and
passes it to the conversation port, which registers the child's session as planning in the window
between `openSession` and `submitPrompt` (`src/main/agent-control/port-adapters.ts`). That window is
load-bearing: the child is a separate process and can ask the app for its playbook before
`submitPrompt` resolves, so registering later would hand it the implementing playbook and then deny
the edits it was just told to make. After the spawn the child owns the flag, and the user can turn it
off in the child's tab. Nothing propagates the other way — approving the orchestrator's plan does not
un-plan a child that is still running, which is why the playbook tells the orchestrator to close its
investigation tabs once it holds their reports.

`src/main/agent-control/port-adapters.ts` also broadcasts `agentControlPlanModeChanged` from the same
site, and `usePlanModeSync` mirrors it into the child tab's toggle. That mirror is for honesty only:
enforcement reads the main-process registry, so a broadcast that never lands costs the UI, never
safety. The renderer's per-chat atom is tri-state — `null` means "the user has never decided for this
tab" and the request omits `planMode` entirely, because sending `false` for no-opinion is what used to
clear an inherited flag on the user's first message.

What a **planning sub-agent** may not do, enforced in `src/shared/plan-mode/control-ops.ts`. All four
are now also in the unconditional role table above, which runs first — this table is what a *planning*
caller would have met, and it survives so the plan-mode policy stays complete on its own terms rather
than depending on a second gate to cover a hole:

| Denied | Why |
|---|---|
| `ensemblr_start_conversation` | Nested delegation is blocked; the investigation is its own to do. |
| `ensemblr_send_follow_up` | It has no conversations of its own to steer. |
| `ensemblr_exit_plan_mode` | The plan belongs to the orchestrator. A plan submitted here posts into the sub-agent's own tab and renders an Approve button whose handler clears that tab's Plan Mode and submits an implementation prompt — one click would turn a read-only investigator into a writer. |
| `ensemblr_ask_user_question` | The modal renders in the sub-agent's tab while the orchestrator sits in `ensemblr_wait_for_agents`, so nobody is watching it and the child hangs to the wait timeout. `ensemblr_notify_orchestrator` reaches someone. |

These four denials deliberately skip the shared escape-hatch sentence, which tells a caller to finish
the plan and call `ensemblr_exit_plan_mode` — for a sub-agent that names a tool which just refused it.

`ensemblr_launch_harness`, `ensemblr_start_terminal`, and `ensemblr_write_terminal` stay blocked for
**both** roles: a harness has no Plan Mode and launches with approval prompts skipped, and a terminal
is a raw shell the read-only command classifier cannot see into.

### The read-only `bash` classifier

`isReadOnlyBashCommand` (`src/shared/plan-mode/bash-guard.ts`) decides what a planning agent's `bash`
call may do, and it lexes before it classifies. `lexCommand`
(`src/shared/plan-mode/shell-lexer.ts`) walks the command once, quote-aware, and hands back
quote-stripped tokens per chained segment — leaving `bash-guard.ts` to decide only what a segment's
head word is allowed to do.

That split fixed a mistake in each direction. Splitting on whitespace misread every quoted argument,
so `git -C "/path with spaces" remote -v` lost half its path and was denied as an unknown git
subcommand — a read-only command blocked for a reason the agent could not act on. And blanking
`>/dev/null` out of the raw text by string replacement meant `cat a >/dev/nullx` came back allowed
with the file write invisible: deny-by-default with a hole in it. The lexer requires a word boundary
after `/dev/null`, so only the genuine discard forms (`>/dev/null`, `1>`/`2>` variants, `2>&1`, `&>`)
pass. It also follows bash on what quotes actually do: single quotes make everything literal, double
quotes suppress redirection and separators but **still** expand `$(…)` and backticks, and an
unterminated quote is a violation rather than a guess.

The lexer follows bash on spacing too: `2> /dev/null` and `2>/dev/null` are the same redirection, so
both classify the same way. Reading the target as a word starting immediately after the `>` denied
the spaced form — the shape agents write most often — while allowing the tight one.

`git` is where the allowlist earns its keep, because a read-only subcommand is not the whole story.
`git -c <key>=<value>` sets configuration for one invocation, and several keys name a program git
then runs during an otherwise inspecting subcommand: `diff.external` and `diff.<driver>.textconv`
during `git diff`, `core.fsmonitor` during `git status`, `core.pager` whenever git pages. None needs
a terminal, and none is visible to a classifier that only reads tokens, because the command lives in
a config value. So `-c`, `--config-env`, and `--exec-path` are denied outright rather than skipped
along with their values — there is no read-only form of them to let through. `--git-dir`,
`--work-tree`, and `-C` only relocate what is read, so they still pass.

`git branch` lists until an argument turns it into ref surgery, and a bare name is such an argument:
`git branch feature` creates a ref and `git branch -f main other` resets one. Both are denied, along
with `--force`, `--set-upstream`, `--unset-upstream`, and `--edit-description`. `git branch`,
`git branch -a`, `git branch --list <pattern>`, and the `--contains`/`--merged`/`--points-at`
filters still only list.

`cd` is allowlisted. It changes the directory of a shell that exits with the command, and everything
chained after it is classified on its own, so `cd x && rm -rf y` still denies on `rm`.

## Sub-agent side

If you were spawned as a sub-agent, you were given **one delegated unit of work** — do it yourself,
end to end. The last message you leave is your report back to the orchestrator, and everything it
needs has to be **in** it: the answer first, then the evidence with full file paths, then the gaps,
then anything that changes the shape of the work. A pointer to work earlier in the turn ("report
delivered above") is the one failure mode the playbook names outright — it is all the orchestrator
would get if the turn were read one message at a time. Do **not** spawn
further sub-agents, launch harnesses, or delegate onward; that is the orchestrator's job. You may
still read and inspect freely, and focus a view so the user can follow along.

**The surface is narrowed by role, not by depth.** `SUBAGENT_BLOCKED_OPS`
(`src/shared/agent-control/subagent-policy.ts`) fails `denied-scope` for thirteen ops whatever mode
the child is in — `spawnChatTab`, `startConversation`, `sendFollowUp`, `launchHarness`,
`startTerminal`, `stopTerminal`, `writeTerminal`, `openTab`, `closeTab`, `setBranchName`,
`setWorkspaceStatus`, `askUserQuestion`, `exitPlanMode` — and `gateSubAgentRole` runs it before the
plan-mode gate on every dispatch.

That check reads the **durable tab marker** via `resolveRole`, not `origin.depth`. The distinction
is the whole point: lineage lives in the in-memory origin registry, so a child resumed after a
restart re-registers at depth 0 and a depth-only test lets it through. Most of these ops used to be
denied only as a side effect of the spawn guardrail refusing `depth >= 1`, which meant a restart
handed a child the spawn tools back — while `notifyOrchestrator`, its one escape hatch, broke on the
same missing lineage. It keys off the marker now too.

The three ops with no gate at all before this — `stopTerminal`, `writeTerminal`, `setWorkspaceStatus`
— were the sharpest of these. None is a spawn op, so no depth check ever saw them: a child could
type into any terminal in the workspace (including a harness the orchestrator launched), kill the
run script, or move the whole workspace's kanban card from inside one unit of work.

`waitForAgents`, `listModels`, and `listRunScripts` are *not* denied, only withheld from the tool
list: a child has no children to wait on, no spawn to pick a model for, and no `startTerminal` to
pick a run script for, so refusing them would imply a hazard where there is only noise. The Pi
extension registers the complement of `SUBAGENT_WITHHELD_OPS` for a sub-agent, and a parity test
compares its embedded copy of that set against the shared one.

Withholding and denying are complements. The child's tool list omits the tool so it never reaches;
the service still refuses it so a stale or hand-rolled call fails closed. Listing a tool the service
would only refuse is what teaches a model to keep reaching for it — the same reasoning that trims
the harness MCP surface.

**Naming the workspace is root-only.** `ensemblr_set_branch_name` renames the workspace *and* its
git branch, and that name describes the whole body of work rather than the one unit a child was
handed — a sub-agent naming it would label the workspace after a fragment. Two places have to agree
with the denial above: `readSessionBriefNaming`
(`src/main/agent-runtime/naming/session-brief-naming.ts`) withholds the branch bullet from a child, so the
upkeep block never asks for a call that would be refused, and both sub-agent playbooks name the tool
only to say it is refused. `setWorkspaceStatus` is denied for the same reason and had gone the other
way until this landed.

**Work from the brief.** When a brief already quotes a file's contents, the child takes them as
given and reads only what the brief did not supply. Both halves of that rule have to exist: an
orchestrator that scouts first and pastes the inventory into every brief buys nothing if the child
re-opens the same four files to confirm them — which is exactly what one did before this landed.

**The report is the deliverable.** A sub-agent creates no files unless its brief names a path —
output that genuinely has to outlive the tab goes under `.context/`, cited by full path in the
report. Without that rule a brief phrased as a noun ("a planning reference") gets read as an
instruction to write one, and the orchestrator ends up diffing a workspace to discover what its
children left behind.

**Open questions travel in the report, not in a signal.** Children reliably decline to interrupt:
across two instrumented test runs with textbook `need_decision` setups — including one where the
orchestrator deliberately withheld a fork and gave the child no instruction about being stuck — not
a single child ever called `ensemblr_notify_orchestrator`. Each one picked an option, built out both
branches, and editorialized in its closing paragraph. Rather than keep sharpening a rule the models
do not follow, the design now routes the question the way they already behave:

- A sub-agent ends its report with a literal **`Open questions`** heading: each decision as a
  one-line question, 2-6 concrete options, and which it took. That shape is not decorative — it maps
  onto `ensemblr_ask_user_question`'s questionnaire (up to 4 questions, 2-6 options each), so the
  orchestrator can lift it without re-authoring. Anything that will not fit the shape is a *gap*,
  not a question, and belongs earlier in the report.
- The orchestrator gathers those sections across all children, drops what it can settle by reading,
  merges duplicates, and asks the survivors **once, before it writes its answer**. A planning
  orchestrator folds them into its interview round instead. Skipping the step is how a decision the
  user cared about ships as a silent default.
- `notify_orchestrator` survives for the case it is actually good at: a child that cannot produce
  its deliverable *at all* until someone answers. Both orchestrator playbooks now warn that a wait
  returning no signal does **not** mean nothing needs asking — under this design that inference is
  backwards. `progress` / `done` stay informational.

A sub-agent's chat tab is **read-only to the user**: `showsComposer`
(`src/renderer/lib/workbench/composer.ts`) withholds the composer for the whole life of an
`isSubAgent` tab, and `WorkspaceConversationContent` renders nothing in its place, because the
orchestrator owns that conversation and a prompt typed alongside would interleave with the delegated
turn it is waiting on. A disabled composer used to stand there while the child streamed; it only
advertised an affordance that never unlocks. What keeps that from stranding a child nobody can
reach: stopping a conversation now cascades into everything it spawned — `stopSession`
(`src/main/agent-runtime/agent-session-lifecycle.ts`) walks the origin registry's lineage and aborts each
live descendant with reason `orchestrator-stopped`, guarding against a lineage that points back at
itself and logging rather than throwing when one child refuses to abort. The descendants are
collected in a `finally`, so a root whose own abort rejects still surfaces that failure to the
caller without taking the lineage down with it. The user's own route into a running child is the
tab close control rather than a Stop button, which left with the composer: closing a mid-turn tab
raises the confirm-then-cancel guard whose Stop action cancels that session by id. The renderer
reads the tab marker (`metadata.agentRole === 'subagent'`, written by `writeSubAgentMarker` in
`src/main/agent-control/port-adapters.ts`), which is stamped before the first prompt is submitted so
it lands on the same `broadcastTabsChanged` that reveals the spawned tab's session. If that submit
then fails on a tab the caller reused, `rollbackConversation` clears the marker again rather than
leaving a bricked composer behind. Nothing questions the user from that tab either:
`ensemblr_ask_user_question` is refused to a sub-agent in every mode, because the orchestrator that
owns the conversation is the one blocked waiting on the report. The question rides the report's
`Open questions` heading instead.

## Model selection

A spawn never crosses the **agent runtime** axis (`pi` | `claude`). Do not confuse it with a
model's **inference vendor** (`anthropic`, `openai`, `claude-code`): both were once called
"provider", and comparing one against the other is what let a Claude Code orchestrator spawn
children on Pi. `AgentModelOption.vendor` is a branded `ModelVendorId` so the two can no longer be
compared by accident.

Resolution order, in `src/main/agent-providers/spawn-model-resolver.ts`:

1. An explicit `model` — honoured only when it belongs to the caller's own runtime. A cross-runtime
   id is **refused** with an `invalid-args` envelope naming both runtimes, never substituted.
2. Otherwise the caller's own model — the live one its runtime forwarded (`callerModel`, Pi only)
   when the catalog places it on the caller's runtime, else the persisted session row. The row only
   learns a new model when a prompt goes through Ensemblr, so an agent that switched model inside
   its own runtime is described by the forwarded value and by nothing else.
3. Otherwise the catalog's own default for the caller's runtime, falling back to that runtime's
   first entry when the default belongs to the other one.

`ensemblr_list_models` (`id`, `runtime`, `vendor`, `displayName`, plus the default) is already cut to
the caller's runtime, so every id it returns is spawnable. The caller's runtime comes from its
control origin — `pi` and `claude` chats name theirs; a **terminal harness cannot**, because its
origin is minted per workspace (`ws:<id>`) and shared by every terminal in it. Such a caller gets the
unfiltered list and must pass `model` explicitly; omitting it is refused rather than defaulted onto
Pi, and `HARNESS_AWARENESS` plus both tool descriptions say so up front so no harness has to learn
it from a failed call.

A refusal is a modelled outcome, not a thrown error: the port returns
`{ ok: false, reason }` (`StartConversationOutcome`), the service turns it into an `invalid-args`
envelope, and no tab, session, or spawn-guardrail slot is consumed. Everything else that can fail
here — a runtime that will not start, a first prompt that rejects — still throws and still rolls
back.

The child's thinking level follows the same rule: requested → caller's → `medium`, each accepted only
if the child's model publishes that rung, so `max` never lands on a Pi chat.

## Run scripts

A repository declares its run scripts by name in `.ensemblr/settings.toml` (`[scripts.run.<name>]`) —
a dev server, a playground, an unsigned build — and the dock's Run button offers all of them. An
agent gets the same choice: call `ensemblr_list_run_scripts` (returns each script's `name`, `command`,
and which one is the effective default) and pass that `scriptName` to `ensemblr_start_terminal` with
`kind: "run"`. Omitting `scriptName` starts whichever script the repository marks default, falling
back to the first declared one — rarely the one an agent meant. A name that is not configured fails
with `not-found` and lists the names that are, rather than quietly launching something else. Only one
run script runs per workspace at a time, and `nonconcurrent` run mode extends that across the
repository's workspaces.

A launch that starts nothing is a **failure envelope, not an empty success** — every reason a script
declines carries its own code, so a caller can branch before reading the prose: `not-found` for a
name the repository does not configure, `conflict` for a run script already holding the workspace
(named, so a caller can tell whether it is the one it wanted), `timeout` for a restart that outlasts
its wait. A `conflict` is cleared with `ensemblr_stop_terminal` (`kind: "run"`) and a fresh start;
`ensemblr_list_terminals` reports each terminal's `scriptName`, so the running one is identifiable
without starting anything. A refused launch costs no spawn budget, so correcting a guessed name is
free.

## Etiquette & limits

- Write every file path mentioned in prose as its **full path from the workspace root**, in
  backticks — `src/renderer/components/message.tsx`, never a bare `message.tsx` or a trailing
  fragment like `components/message.tsx`. The timeline turns those into chips the user clicks to
  open the file, and only a path it can place in the file tree becomes clickable.
- Delegation is **shallow by design** — only the root may spawn; children do their own work and
  cannot delegate onward. Nesting depth (default cap `1`), per-session spawn count, and spawn rate are
  all capped by the app; never fork-bomb. Waiting on an ancestor session is refused (it would
  deadlock).
- **Writes** (spawn / close / launch / terminals / focus) act only on **your own workspace**;
  **reads** (including `wait_for_agents`) may span all open workspaces — inspect before acting.
- **Clean up** scratch tabs you created (`ensemblr_close_tab`).
- Actions may **prompt the user for approval** depending on the workspace permission mode; expect
  and handle denials gracefully.
