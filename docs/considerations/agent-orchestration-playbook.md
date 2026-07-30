# Agent Orchestration Playbook

> The canonical guidance that teaches an agent to use the `ensemblr_*` control tools. The
> authoritative text lives in `src/shared/agent-control/awareness.ts` as a **2×2 of role by Plan
> Mode**: `ORCHESTRATOR_AWARENESS` / `SUBAGENT_AWARENESS` for working agents, and
> `PLAN_MODE_ORCHESTRATOR_AWARENESS` / `PLAN_MODE_SUBAGENT_AWARENESS` for planning ones. The role axis
> comes from `roleForDepth`: a root (depth 0) is an orchestrator that may delegate; a spawned child
> (depth ≥ 1) is a sub-agent that does its own work and never fans out. The Plan Mode axis comes from
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

The MCP endpoint serves a harness only the ops it can actually use. The chat-tab ops are absent by
design, and the service refuses them for a `harness` origin even if one is reached directly:

| Absent | Why |
|---|---|
| `ensemblr_set_name` | A harness tab is a terminal whose title is derived from the harness's own session log (`src/main/terminal/agent-conversation-title.ts`) — there is no chat tab to rename. |
| `ensemblr_set_summary` | Session summaries hang off a Pi chat tab. |
| `ensemblr_ask_user_question` | The question panel renders inside the chat tab bound to the Pi session. |
| `ensemblr_exit_plan_mode` | Plan Mode is a Pi-conversation toggle. |

A harness also gets no per-turn upkeep block — the app renders that into a Pi system prompt and a
harness has no equivalent hook — so `HARNESS_AWARENESS` carries the branch-naming nudge itself.
`ensemblr_set_branch_name` still enforces `git.renameWorkspaceOnBranch` on its own; the playbook's
job is to frame a refusal as settled rather than as a fault worth retrying.

## Role

You run inside Ensemblr and can drive the app itself. **Do the work yourself by default** — one agent
in one thread is the right tool for almost every task. Delegate **only** when the task genuinely
splits into two or more independent, substantial workstreams that can run in parallel; never spawn a
helper to do a single unit of work you could do in one pass, and never delegate a task just because
you can. When delegation is warranted, spawn helpers, **wait on them**, evaluate their output, and
integrate the result — and never tell the user to click.

Only the **root** orchestrator delegates. A spawned sub-agent does its assigned work itself and
cannot delegate onward (see [Sub-agent side](#sub-agent-side)); the default depth cap is `1`, so a
child's spawn attempt is denied `denied-depth`.

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
`src/renderer/lib/pi/ensemblr-tool-presentation.ts`), so those specifically can no longer strand an
answer. That is a backstop, not a licence: `ensemblr_close_tab`, `ensemblr_focus_*`, and every other
control call still render, and still end the run. A **failed** bookkeeping call also still renders, so
a permission denial stays visible.

## Tool map

| Goal | Tools |
|---|---|
| Delegate a subtask to a Pi sub-agent | `ensemblr_start_conversation` (fresh tab + `title`; keep its `piSessionId`). While planning, the child inherits Plan Mode. |
| Name your own tab | `ensemblr_set_name` (Pi chats only) |
| Name the workspace + git branch | `ensemblr_set_branch_name` (one-shot, placeholder names only; refuses unless the user enabled `git.renameWorkspaceOnBranch`, so call it only when the per-turn upkeep block asks) |
| Record what the session covered | `ensemblr_set_summary` (every turn; Pi chats only) |
| **Block until children settle** | `ensemblr_wait_for_agents` |
| Steer / correct a child | `ensemblr_send_follow_up`. While planning, reaches only a target that is itself planning. |
| Delegate to a CLI agent | `ensemblr_launch_harness` (claude / codex / vibe). Blocked while planning. |
| Run / inspect commands | `ensemblr_start_terminal`, `ensemblr_write_terminal`, `ensemblr_read_terminal_output`, `ensemblr_stop_terminal` |
| Inspect a child out of band | `ensemblr_get_conversation_status`, `ensemblr_get_last_message` |
| Pull the orchestrator back (sub-agents) | `ensemblr_notify_orchestrator` |
| Ask the human to decide | `ensemblr_ask_user_question` (blocks until answered; Pi chats only) |
| See the workspace | `ensemblr_list_workspaces`, `ensemblr_list_tabs`, `ensemblr_list_terminals` |
| Move / read the workspace board | `ensemblr_set_workspace_status`, `ensemblr_get_workspace_status` |
| Pick a model for a child | `ensemblr_list_models` |
| Surface work to the user | `ensemblr_focus_tab`, `ensemblr_focus_dock_tab`, `ensemblr_focus_panel` |
| Tidy up | `ensemblr_close_tab` |

## Delegate → wait → evaluate → integrate

1. **Spawn** each helper with `ensemblr_start_conversation` in its **own fresh tab** — pass a short,
   descriptive `title` and do **not** pass `chatTabId` (reusing a prior tab keeps its old title).
   Omit `wait` and keep the returned `piSessionId`. Every conversation can also rename its own tab
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
5. **Integrate** the outcomes into your own answer, and focus the relevant view so the user can
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
> hold dozens of assistant messages, so the join stops at `MAX_REPORT_CHARS` (32k) — read newest-first,
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
a = ensemblr_start_conversation({ prompt: "Write unit tests for src/foo.ts" })   // { piSessionId }
b = ensemblr_start_conversation({ prompt: "Write unit tests for src/bar.ts" })
# both children now run; block until they finish or need you:
r = ensemblr_wait_for_agents({ mode: "all" })
for child in r.completed:
  # evaluate child.lastMessage; if a child.signal is need_decision, answer it:
  if child.signal: ensemblr_send_follow_up({ piSessionId: child.piSessionId, prompt: "<decision>" })
# a signal returns the wait early, so re-wait on whoever is still running plus anyone you answered:
still_out = [p.piSessionId for p in r.pending] + answered_ids
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

What a **planning sub-agent** may not do, enforced in `src/shared/plan-mode/control-ops.ts`:

| Denied | Why |
|---|---|
| `ensemblr_start_conversation` | Nested delegation is blocked anyway (`denied-depth`); the investigation is its own to do. |
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
further sub-agents, launch harnesses, or delegate onward; that is the orchestrator's job and nested
delegation is blocked (`denied-depth`). If you are blocked or hit a decision you genuinely cannot make
alone, call `ensemblr_notify_orchestrator` (reason `need_decision` or `blocked`) instead of guessing
or stalling — it pulls your orchestrator back to you. `progress` / `done` are informational and do not
interrupt it. You may still read and inspect freely, and focus a view so the user can follow along.

## Model selection

To run a child on a specific model, first `ensemblr_list_models` (returns each model's `id`,
`provider`, `displayName`, plus the default) and pass a `model` id that appears there — prefer the
same provider you are on. If you omit `model`, the child inherits the caller's model when it's
available (Pi callers only; the extension forwards it), otherwise the app default. The server
**validates** the requested model against the catalog: an unknown id is dropped in favor of the
caller-model or default fallback rather than failing the spawn — so never invent a model id.

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
