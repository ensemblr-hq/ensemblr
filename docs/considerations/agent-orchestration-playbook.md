# Agent Orchestration Playbook

## Git isolation and consent

`GIT_WORKSPACE_CONSENT` in `src/shared/agent-control/awareness.ts` supplies the
same instruction-level boundary to roots, native roots, subagents, terminal
harnesses, and both plan-mode roles; the Pi extension mirrors it with parity tests.
This changes guidance, not OS execution policy. Git writes require verifying the
assigned cwd/top-level/branch; the shared object store never grants writes to
sibling worktrees or the managed root, including through Git overrides.

Base integration is not routine catch-up, failure repair, or PR preparation.
Only an explicit human request to integrate a named base or resolve merge
conflicts permits necessary local merge/rebase and continuation for that
workspace/task; role no-HEAD and plan-mode read-only limits still apply. PR
presence/absence and AFK delivery grant no base-sync consent, and local integration
permission never grants PR merging or arbitrary imports. Without permission,
ask when attended; leave Git unchanged and report when AFK. Unexpected history
or worktree movement calls for inspection/reporting, not an automatic reset/rebase.

The launch environment also drops inherited Git repository-routing variables
(`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, object/common-directory and ref
namespace overrides, and repository-local config injection). Git otherwise uses
these instead of the assigned cwd. The shared sanitizer applies after overlays
for command, Pi, Claude, and terminal launches; checkpoint Git calls sanitize
ambient context before supplying their own private temporary index. Identity,
editor, and authentication variables remain available. This does not prevent a
running shell, agent, extension, hook, or user startup script from explicitly
setting those variables again. It is inherited-environment isolation, not an OS
sandbox or a mechanically enforced local-merge approval gate. The variable list
follows `git rev-parse --local-env-vars` and the
[official Git environment documentation](https://git-scm.com/docs/git#_environment_variables).

> The canonical guidance that teaches an agent to use the `ensemblr_*` control tools. The
> authoritative text lives in `src/shared/agent-control/awareness.ts` as three lineage audiences by
> Plan Mode: root orchestrator, depth-1 manager, and depth-2 leaf. `managerSubagentAwareness` and
> `planModeManagerSubagentAwareness` describe the middle layer; the existing sub-agent variants are
> the leaf-safe fallback. The durable descendant role and validated persisted `depth` travel together;
> missing or invalid descendant depth fails closed as a leaf, never a root or manager. The Plan Mode axis comes from
> the app per turn, and it **replaces** the role playbook rather than stacking on it — see
> [Planning with sub-agents](#planning-with-sub-agents). Both reach the two always-on injection
> points:
>
> - **Pi** — the extension's `before_agent_start` hook appends the variant chosen by the
>   app-injected `ENSEMBLR_CONTROL_ROLE` and validated `ENSEMBLR_CONTROL_DEPTH`, plus this turn's
>   Plan Mode state from `getSessionBrief`. Because a packaged app cannot import `src/` at runtime,
>   `resources/pi-extensions/ensemblr-control.mts` carries matching root, manager, and leaf variants;
>   parity tests cover the shared literals and depth-specific surface.
> - **Harnesses** (Claude Code, Codex, Mistral Vibe) — a harness launches as a root session but
>   owns a *terminal* tab, so it gets its own shorter variant, `harnessAwareness`. The MCP server's
>   `instructions` field (`src/main/agent-control/mcp-endpoint.ts`) carries it, and
>   `src/main/agent-control/harness-launch-config.ts` also appends it to the launch command as a
>   system prompt, because no harness reliably surfaces an MCP server's `instructions` to its model.
>   Harnesses are opt-in (Settings → Experimental → *Third-party CLI harnesses*), so with the switch
>   off nothing can be launched to receive that variant and every other one drops the passages that
>   name a harness — see the feature-switch paragraph in [`agent-control.md`](../agent-control.md).
>
> This file is the human-facing reference for that guidance; keep it in step with the constants by
> hand.

## What a harness does not get

The MCP endpoint serves a harness only the ops it can actually use. These four — `CHAT_TAB_ONLY_OPS`
in `src/shared/agent-control/subagent-policy.ts` — are absent by design, and the service refuses them
to any caller without a chat tab even if one is reached directly:

| Absent | Why |
| --- | --- |
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
harness has no equivalent hook — so `harnessAwareness` carries the branch-naming nudge itself.
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

You run inside Ensemblr and can drive the app itself. **Your own context window is precious,
subagents are cheap.** Delegate for independent, substantial parallel workstreams, or when a
self-contained task would fill your window with detail you only need summarized — even if there
is only one workstream. Use **Grunts** for fully specified, zero-judgment work, including trivial
tasks. Keep decisions and integration here; ask children for concise findings with evidence, not raw
dumps. Task size alone is not a reason to work inline: keep work here when briefing and verifying
would cost more of your context than doing it directly. While planning, the same tradeoff applies
to read-only investigations; the interview and decisions stay with you. When delegation is warranted,
spawn helpers, **wait on them**, evaluate their output, and integrate the result — and never tell
the user to click.

Delegation has **two edges**. A depth-0 root may open a depth-1 manager; that manager may open
fresh depth-2 leaves for independent work it will integrate. A leaf cannot delegate. The shared role
policy narrows the manager to five Ensemblr child-management ops, while authoritative depth, the
root-tree quota, and the rolling rate cap stop recursion and fork-bombing. Missing descendant depth
is leaf authority, not compatibility permission.

### Pi's delegation barrier

The Pi extension hardens the order; the playbook is not the only guard. A successful non-peer
`ensemblr_start_conversation` opens a branch-local barrier in
`resources/pi-extensions/delegation-barrier.mts`. Until `ensemblr_wait_for_agents` has returned each
tracked child settled without an unresolved signal, the extension blocks unrelated tool calls,
removes premature assistant prose at `message_end`, and queues a follow-up turn at `agent_settled`
when the model stops instead of waiting. A hard wait failure stays blocked but does not auto-retry
forever.

Parallel fan-out still works: sibling start calls in one assistant tool batch may all run. A wait in
that same batch is refused because Pi executes sibling tools concurrently and the app may not have
registered the new child ids yet. On the next turn, the extension rewrites the wait to `mode: "all"`
with every outstanding id. Explicit ids preserve the branch-local barrier across a Pi reload, while
versioned parent→child lineage in SQLite preserves ownership across an app restart. A reload during
an in-flight spawn persists a recovery intent instead; the next wait uses the app's default child set without inventing an id. Any
returned child id is adopted without a tab id so attention signals can follow the normal follow-up
cycle; the barrier stays closed until every recovered child settles without a signal. Recovery never
auto-retries.
Every transition is persisted as a custom Pi session entry and reconstructed from the active branch on
reload.

The narrow escape surface while the barrier is active exists only to finish orchestration: further
child starts, follow-ups to tracked children, tracked child-tab closure, a questionnaire prompted by
a child's attention signal, a manager's one-level `notifyOrchestrator` escalation of that signal, and
the all-child wait. Reads, edits, shell commands, terminal control,
and user-facing findings wait until the barrier closes. Peers and Concierge-spawned root
orchestrators are not children and do not open this barrier. It runs for roots and depth-1 managers;
a depth-2 leaf has no spawn surface to open it.

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
| --- | --- |
| Delegate a subtask to a sub-agent | `ensemblr_start_conversation` (fresh tab + `title`; keep its `agentSessionId`). Omitted `model` stays on the caller's runtime; an explicit model follows the live policy. While planning, the child inherits Plan Mode. |
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
| Read the Linear backlog | `ensemblr_linear_list_issues` (no descriptions), `ensemblr_linear_get_issue` (one issue, comments included), `ensemblr_linear_get_metadata` (the ids an update takes, plus `viewer` — the Linear user the account is connected as, which is the `assigneeId` for "take this ticket"). Check `status`: `not-connected` is not an empty backlog. |
| Record progress on a ticket | `ensemblr_linear_create_comment`. Sub-agents put it in their report instead. |
| Move a ticket along | `ensemblr_linear_update_issue` — state, assignee, priority, title, description, by id. `Done` and `Canceled` states are refused: take it to In Review. Blocked while planning; sub-agents report instead. |
| Keep your own ticket current | Unprompted, when the workspace was created from a Linear issue: read it before you change code, move it to a started state when you begin, and move it to `In Review` the turn the work becomes reviewable. The app names that issue in a per-turn **LINKED ISSUE** block cut to what your role and mode may actually do. |
| Pick a model for a child | `ensemblr_list_models` |
| Surface work to the user | `ensemblr_focus_tab`, `ensemblr_focus_dock_tab`, `ensemblr_focus_panel` |
| Retire a finished child's tab | `ensemblr_close_tab`, by the `chatTabId` the spawn returned — as each child settles, not at the end of the run. Archived rather than deleted, and a follow-up reopens it. |

## Delegate → wait → evaluate → integrate

**Split the work before you split the agents.** A child cold-starts with nothing but its brief, so
every fact two children both need is a repository read paid for twice — and that re-derivation is
what makes a fan-out cost more context than doing the work inline. When the workstreams share a
foundation, the orchestrator establishes it once — itself, or with one scout child — and puts the
findings with full paths into every brief; cold fan-out is for work that is genuinely disjoint. All
three orchestrating playbooks say so and a parity test pins it.

1. **Spawn** each helper with `ensemblr_start_conversation` in its **own fresh tab** — pass a short,
   descriptive `title` and do **not** pass `chatTabId` (reusing a prior tab keeps its old title).
   Omit `wait` and keep **both** returned ids — the `agentSessionId` the wait and the follow-up take,
   and the `chatTabId` `ensemblr_close_tab` takes. **Brief each child with what to deliver, not
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
     report carries its own re-fetch pointer. See `waitOutcome`
     (`src/main/agent-control/agent-control-service.ts`).
   - A child that hits a decision point calls `ensemblr_notify_orchestrator` (`need_decision` /
     `blocked`), which wakes the wait immediately **in either mode**. `waitAllSatisfied`
     (`src/main/agent-control/agent-control-service.ts`) is what makes that true under `all`:
     without it a blocked child would hold its question until the 5-minute wait timeout while its
     siblings kept running. `progress` and `done` stay informational and never cut a wait short.
3. **Evaluate.** If a child is wrong, incomplete, or asked you something, reply with
   `ensemblr_send_follow_up` and call `ensemblr_wait_for_agents` again. Repeat until done, then
   **close that child's tab** with `ensemblr_close_tab` — as it settles, not at the end of the run.
   See the note below on why closing early costs nothing.
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

> **Closing a finished child's tab costs nothing, and nothing else closes it.** A chat tab an agent
> closes is archived, not deleted — `closeTab` ends at `markClosed`
> (`src/main/chat-tabs/chat-tab-service.ts`), the transcript and the report stay on disk, and the tab
> comes back from the chat history. Even the orchestrator can undo it without asking: `sendFollowUp`
> calls `reopenClosedChatTab` before it submits (`src/main/agent-control/port-adapters.ts`), so
> steering a child whose tab was closed puts the tab back before the turn streams into it. That is
> what makes "close it as it settles" the default rather than a judgement call — the failure mode it
> replaces is a fan-out of four leaving four dead tabs around the one the user works in, and a
> multi-round run burying the strip. The exclusions are the tabs the orchestrator did not open for a
> unit of work: the user's own, a peer orchestrator's (it outlives the turn), and the Review
> conversation (it is the user's record of the review). Two hard edges of the op itself: it is a
> no-op on an already-closed tab and on a workspace's **last** open chat, so neither can strand the
> user with nothing on screen.

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
> each has spent more context than doing the research itself would have cost. Delegation preserves
> the orchestrator's context only when reports distill the work rather than replay it. `briefReport`
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
investigation tabs once it holds their reports. Every planning brief names **Explorer** as its
advisory role because the child is read-only; choosing a model without that saved tag is allowed,
but the brief records the deviation and why.

`src/main/agent-control/port-adapters.ts` also broadcasts `agentControlPlanModeChanged` from the same
site, and `usePlanModeSync` mirrors it into the child tab's toggle. That mirror is for honesty only:
enforcement reads the main-process registry, so a broadcast that never lands costs the UI, never
safety. The renderer's per-chat atom is tri-state — `null` means "the user has never decided for this
tab" and the request omits `planMode` entirely, because sending `false` for no-opinion is what used to
clear an inherited flag on the user's first message.

Plan Mode respects depth. A verified depth-1 manager may use
`ensemblr_start_conversation` and `ensemblr_send_follow_up` for fresh planning
leaves it owns; `planModeControlOpDenial` defaults missing descendant depth to 2,
so an older caller still fails closed. Every descendant is denied
`ensemblr_exit_plan_mode` and `ensemblr_ask_user_question`: the root owns plan
submission and the user interview, while descendants report decisions to their
immediate parent. A depth-2 leaf is denied all four.

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

Two more shapes are classified rather than looked past, for the same reason the git `-c` keys are.
**A segment that opens with a `FOO=bar` assignment is denied whatever follows it**: an assignment is
`env` without the word, and several of the variables an allowlisted binary reads name a program it
then runs, or move the binary the segment resolves to. There is no read-only subset to enumerate, so
a genuinely harmless prefix like `LC_ALL=C sort` is denied too — re-run the command without it.
**A guarded flag is matched in every spelling its command accepts**, not as a whole token: split at
the `=` in `--flag=value`, prefix-matched when a long name is abbreviated, and scanned letter by
letter through a clustered single-dash group. Each guard names the command that really has the flag,
so `grep -o` and `rg -o` — which mean `--only-matching` — stay allowed, and read-only forms carrying
a guarded letter inside a value (`git status -uno`, `git log -S<term>`, `date -Iseconds`) still pass.
[ADR 0044](../adr/0044-enforce-plan-mode-fail-closed-at-the-control-channel.md) records both rules
and the false-positive discipline they are held to.

## Sub-agent side

Every spawned sub-agent owns one delegated workstream and reports to its
**immediate parent**. A depth-1 manager may split that work once more across
fresh depth-2 leaves, then evaluates, verifies, and integrates those reports into
its own. A leaf does the work itself. Neither may open Review, peers, harnesses,
terminals, user dialogs, or tracker writes, and neither may steer sideways or
upward.

The last message is the report: answer first, full-path evidence, gaps,
constraints, then `Open questions` for user decisions. A manager does not forward
a leaf report as its own. It closes owned leaf tabs as they settle and keeps the
root-tree lifetime/rate budget in mind; closing does not refund it.

The surface is narrowed by durable descendant role **and validated persisted
depth**. `SUBAGENT_BLOCKED_OPS` contains the twenty leaf denials. A manager gets
only five removed: `startConversation`, `listModels`, `waitForAgents`,
`sendFollowUp`, and `closeTab`. The service additionally requires the spawn to be
a fresh immediate leaf; `chatTabId`, `peer`, explicit Plan/AFK overrides, Review,
and native runtime delegation remain unavailable. Missing or malformed depth on
a descendant is depth 2. `listRunScripts` is the only merely unusable op and is
withheld from both descendant depths.

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

A spawn follows the **live runtime policy** returned by `ensemblr_list_models`. Do not confuse the
agent runtime axis (`pi` | `claude`) with a model's **inference vendor** (`anthropic`, `openai`,
`claude-code`): both were once called "provider". The listing is the source of permitted
destinations and reports the caller runtime, allowed runtimes, and role preferences; a caller may
cross runtimes only when its current policy allows that destination. `AgentModelOption.vendor` is a branded `ModelVendorId` so the two can no longer be
compared by accident.

Resolution order, in `src/main/agent-providers/spawn-model-resolver.ts`:

1. An explicit `model` — honoured only when `ensemblr_list_models` reports its runtime in the caller's allowed destinations. A disallowed destination is **refused** with an `invalid-args` envelope, never substituted.
2. Otherwise the caller's own model — the live one its runtime forwarded (`callerModel`, Pi only)
   when the catalog places it on the caller's runtime, else the persisted session row. The row only
   learns a new model when a prompt goes through Ensemblr, so an agent that switched model inside
   its own runtime is described by the forwarded value and by nothing else.
3. Otherwise the catalog's own default for the caller's runtime, falling back to that runtime's
   first entry when the default belongs to the other one.

`ensemblr_list_models` returns `callerRuntime`, `allowedRuntimes`, the live opt-in, and every permitted
model with `id`, `runtime`, `vendor`, `displayName`, and advisory `roles`. With the opt-in off, a chat
caller's list is cut to its own runtime; with it on, the list expands to discovered, non-hidden models
on every allowed runtime. The caller runtime comes from its control origin — `pi` and `claude` chats
name theirs; a **terminal harness cannot**, because its origin is minted per workspace (`ws:<id>`)
and shared by every terminal in it. Such a caller gets the unfiltered list and must pass `model`
explicitly; omitting it is refused rather than defaulted onto Pi, and `harnessAwareness` plus both
tool descriptions say so up front so no harness has to learn it from a failed call.

A refusal is a modelled outcome, not a thrown error: the port returns
`{ ok: false, reason }` (`StartConversationOutcome`), the service turns it into an `invalid-args`
envelope, and no tab, session, or spawn-guardrail slot is consumed. Everything else that can fail
here — a runtime that will not start, a first prompt that rejects — still throws and still rolls
back.

The child's thinking level follows the same rule: requested → caller's → `medium`, each accepted only
if the child's model publishes that rung, so `max` never lands on a Pi chat.

### Advisory task roles

Use the live `ensemblr_list_models` result as the source of permitted destinations and role preferences. Every delegation brief names its chosen task role and any meaningful deviation from the configured role tags:

- **Sage** frames the decision and surfaces uncertainty.
- **Coder** handles an uncertain implementation path and proposes the smallest safe change.
- **Builder** carries a settled implementation through to working code. Coder versus Builder is about uncertainty, not task size.
- **Grunt** receives a fully determined, zero-judgment brief and reports failed preconditions instead of improvising.
- **Explorer** returns a read-only actionable implementation plan containing evidence, files, sequence, dependencies, verification, and open questions. Explorer makes no edits and does not submit a plan to the user.

AFK Mode keeps these same boundaries and names the chosen role in every child brief. Under Ensemblr chat-tab delegation it reads the live model roles and allowed runtimes once before each fan-out batch, reuses that result for every child in the batch, and refreshes it before a later batch. Claude's built-in mechanism cannot read those saved tags or cross runtimes, so it applies the vocabulary to the work without claiming the configured preference. AFK's ordinary assumption-taking rule never permits a Grunt to fill a gap or an Explorer to edit.

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
- Delegation has **two edges** — root → manager → leaf. Leaves cannot delegate.
  The root tree shares a lifetime count and rolling rate cap; never fork-bomb.
  Waiting on an ancestor or non-immediate branch is refused.
- **Writes** (spawn / close / launch / terminals / focus) act only on **your own workspace**;
  **reads** (including `wait_for_agents`) may span all open workspaces — inspect before acting.
- **Close the tabs you opened** once they have served their purpose (`ensemblr_close_tab`); a
  conversation that outlives your turn stays open, and so does any tab you did not open.
- Actions may **prompt the user for approval** depending on the workspace permission mode; expect
  and handle denials gracefully.
