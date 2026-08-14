# Ensemblr Control

**Ensemblr Control lets an agent drive the app it runs inside.** An agent working
in a workspace can open new conversations, launch other coding agents, run
terminals, open file and diff tabs, focus panels, and move the workspace across
the dashboard board — through a set of `ensemblr_*` tools, without the user
having to click. This is what turns Ensemblr from a place you run one agent into
a place a team of agents runs itself.

It is available to every agent species Ensemblr can run:

- **Pi**, a first-class agent runtime on the chat surface, gets the tools through
  a shipped Pi extension.
- **Claude Code**, the other first-class runtime, gets them over the same MCP
  endpoint the harnesses use, because the Agent SDK is a native MCP client.
- **Terminal harnesses** — the `claude` TUI, Codex, and Vibe — get them through
  that MCP endpoint too, auto-configured into the launch command. Vibe has no
  MCP-config flag, so its server arrives as a `VIBE_MCP_SERVERS` env prefix.

Claude Code appears twice on that list and the two are different callers, not one
— see [`harnesses.md`](./harnesses.md). Which surface a caller gets is decided by
what it *is* (`ControlAudience`: does it drive a chat tab, and is it a root or a
spawned child), never by which runtime it names.

## How it works

Ensemblr runs a small control server on `127.0.0.1` (loopback only, ephemeral
port), serving three routes: `POST /invoke` (plain JSON, for the shipped Pi
extension), `POST /mcp` (MCP streamable HTTP, for every MCP client), and
`GET /health`. The MCP endpoint is stateless — a fresh server and transport per
request — which is what lets the tool list and the playbook be cut to the caller
on every connection.

Every request carries a bearer token that Ensemblr injects into the agent's
environment; the agent never supplies its own identity. An **agent conversation**
is registered per session, so its origin carries real lineage (`parentSessionId`,
`depth`) and the guardrails below have something to count. A **terminal** —
including a harness — shares one workspace-level origin (`ws:<workspaceId>`),
because a PTY has no session the app mints a token for; that is also why a
harness cannot be told which agent runtime it is. One service validates the
request, resolves the origin from the token, enforces scope and permissions,
applies guardrails, and delegates to the app's existing services through ports.

The architecture decision is [ADR 0040](./adr/0040-use-loopback-control-server-for-agent-app-control.md);
the full design record is [`considerations/agent-control-layer.md`](./considerations/agent-control-layer.md).

## Permissions

Control actions follow the **workspace permission mode** (the same setting that
gates the agent's local tool use):

| Mode | Reads | Writes (spawn, launch, terminals, focus, board, review comments, Linear) |
| --- | --- | --- |
| `read-only` | allowed | blocked |
| `approval-required` | allowed | prompt the user to confirm |
| `workspace-trusted` | allowed | run automatically |

Scope is enforced regardless of mode: **writes act only on the caller's own
workspace**, while **reads may span all open workspaces**. Expect and handle
denials gracefully — a write can always be refused by the mode.

The write set is `WRITE_OPS` in `src/shared/agent-control/contracts.ts`, and
three ops that look like writes are deliberately outside it. `askUserQuestion`
and `notifyOrchestrator` only move prose to a human or an orchestrator, so an
agent in `read-only` mode can still ask and still escalate. `exitPlanMode` writes
a plan file yet is exempt too: it is the only exit from Plan Mode, so gating it
would strand a planning agent with every editing tool denied and no way out — it
is gated on active Plan Mode instead.

## Guardrails

Delegation is bounded so a runaway agent cannot fork-bomb the app
(`src/main/agent-control/guardrails.ts`):

- **Shallow by design** — only a root orchestrator may spawn; a spawned
  sub-agent cannot delegate onward (spawn depth capped at **1**).
- **20 spawns per session** (lifetime) and **10 per minute** (rolling).
- **Plan Mode is inherited** — a spawn from a planning parent produces a planning
  child, so a planning orchestrator can fan out read-only investigators without
  handing any of them a way to edit the repository. The depth cap still applies,
  so inheritance never recurses.
- A blocking wait times out after **5 minutes**; the child keeps running.
- Waiting on an ancestor session is refused (it would deadlock).

## The sub-agent role policy

Guardrails count spawns; they do not decide who may do what. That is the role
policy in `src/shared/agent-control/subagent-policy.ts`, which refuses a spawned
sub-agent fifteen ops with `denied-scope` **whatever mode it is in**:

`spawnChatTab`, `startConversation`, `sendFollowUp`, `launchHarness`,
`startTerminal`, `stopTerminal`, `writeTerminal`, `openTab`, `closeTab`,
`setBranchName`, `setWorkspaceStatus`, `askUserQuestion`, `exitPlanMode`,
`linearCreateComment`, `linearUpdateIssue`.

Two things run together and are easy to confuse. The spawn guardrail reads
`origin.depth`, which lives in the in-memory origin registry; the role policy
reads the **durable sub-agent marker** on the chat tab. Only the second survives
a restart. Before it existed, a resumed child re-registered at depth 0, read as a
root, and got the whole surface back — while `notifyOrchestrator`, its one
sanctioned escape hatch, broke on the same missing lineage. `notifyOrchestrator`
now keys off the marker too, so the two move together.

`waitForAgents`, `listModels`, and `listRunScripts` are not denied — a sub-agent
simply has no children to wait on, no spawn to pick a model for, and no
`startTerminal` to pick a run script for. Those three (`SUBAGENT_UNUSABLE_OPS`)
are withheld from its tool list along with the fifteen above, because listing a
tool the service would only refuse teaches the model to keep reaching for it. The
Pi extension registers the complement of `SUBAGENT_WITHHELD_OPS` — eighteen ops in
all — for a child, and a parity test compares its copy of that set against the
shared one.

What a sub-agent keeps: every read, `focusTab`/`focusDockTab`/`focusPanel`,
`setName`, `setSummary`, and `notifyOrchestrator`.

The two Linear writes are the newest members and are there for a different reason
from the rest. They are not scoped to a workspace at all — a Linear issue is read
by the whole team — so the usual "acts on someone else's workspace" argument does
not apply. What does is duplication and authority: three children each posting
their own comment on the ticket they are all working produces noise the
orchestrator cannot retract, and an issue's state, assignee, and title describe
the whole body of work rather than the one unit a child was handed. The
orchestrator writes to Linear once, for all of them. The three Linear reads stay
available, because a child that cannot read the ticket it was briefed from is
working blind.

## The chat-tab axis

Withholding runs on three axes, folded into one answer by `withheldControlOps`
(`src/shared/agent-control/subagent-policy.ts`). The second is `CHAT_TAB_ONLY_OPS`
— `setName`, `setSummary`, `askUserQuestion`, and `exitPlanMode` — which the
service refuses to any caller that drives no native chat tab. That is a property
of the **caller**, not of a runtime: a terminal harness owns a tab that titles
itself from its own session log, so all four would have nothing to act on, while
every first-class runtime on the chat surface (Pi and Claude Code alike) holds
them. `ControlAudience` carries exactly three facts — `hasChatTab`, `role`, and
`delegation` — so a runtime added later selects its surface by declaring them
rather than by being named.

## The delegation-mechanism axis

Claude Code ships a sub-agent tool of its own (`Agent`, renamed from `Task` in
Claude Code v2.1.63; both names still appear in permission-denial paths). A chat
holding it *and* the Ensemblr spawn tools picks whichever its training favours,
which in practice means the built-in one — so the orchestration playbook
describes a loop the model never enters and the user loses the visible tabs.

`app.providers.claudeSubagentMode` in `config.json` picks one, and both halves
are enforced:

| Mode | Claude's own tool | Ensemblr's spawn ops |
| --- | --- | --- |
| `ensemblr` (default) | denied via the SDK's `disallowedTools` | served |
| `native` | left alone | withheld from the tool list |

`NATIVE_DELEGATION_WITHHELD_OPS` is the third axis: `spawnChatTab`,
`startConversation`, `sendFollowUp`, `waitForAgents`, and `listModels`. The
conversation reads and `closeTab` stay — they act on tabs the user already has
open, not only on children. `NATIVE_ORCHESTRATOR_AWARENESS` is the matching
playbook, which names the runtime's own tool and says once that the spawn ops are
absent rather than leaving it to be discovered.

**The mechanism is pinned at session open**, on `AgentControlOrigin.delegation`.
The SDK fixes `disallowedTools` when `query()` opens, so a live-read tool list
would let the user flip the setting mid-session and leave that session holding
neither mechanism. A change therefore reaches the next chat, not the open one.

Pi is unaffected: it has no sub-agent tool of its own, so
`resolveAgentControlWiring` pins every non-Claude runtime to `ensemblr`
regardless of the setting. So is every spawned child, whatever its runtime — the
setting picks how a *root* delegates. Nested delegation is blocked on the other
axes already, so a child opened under `native` would keep its own sub-agent tool
live and fan out around the depth cap. Terminal harnesses are unaffected too — their control
token is minted per workspace and shared by every terminal in it, so the app
cannot tell a Claude Code CLI from a Codex one and cannot vary the tool list per
harness.

## Tool reference

Thirty-nine tools, enumerated from `TOOL_DEFS` in
`src/main/agent-control/mcp-endpoint.ts`. The argument names and types below are
the authoritative Zod schemas in `src/shared/agent-control/schemas.ts` — every
schema is a `strictObject`, so an argument not listed here is rejected as
`invalid-args` with the accepted keys named in the reply. Required arguments are
in **bold**; the rest are optional. Result shapes are in
`src/shared/agent-control/contracts.ts`.

Every row is held against those modules by
`tests/main/agent-control-doc-parity.test.ts`, which reads each argument out of
its own backtick span. Keep one span per argument, keep the bold and the `?`
saying the same thing, and write an enum's options exactly as its schema orders
them; a row the parser cannot read fails the test rather than going unchecked.

**Gate** reads: `write` follows the workspace permission mode and acts only on
the caller's own workspace; `read` is allowed in every mode and may span
workspaces; `spawn` additionally spends depth, quota, and rate budget.
**Withheld from** names the callers whose tool list omits it — `sub-agent`
(denied by role, `denied-scope`), `sub-agent*` (withheld as unusable, still
dispatchable), `no chat tab` (a terminal harness).

### Conversations and delegation

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_spawn_chat_tab` | `title?: string` | write, spawn | sub-agent |
| `ensemblr_start_conversation` | **`prompt: string`**, `chatTabId?: string`, `model?: string`, `thinkingLevel?: string`, `title?: string`, `wait?: boolean` | write, spawn | sub-agent |
| `ensemblr_send_follow_up` | **`agentSessionId: string`**, **`prompt: string`**, `wait?: boolean` | write | sub-agent |
| `ensemblr_wait_for_agents` | `targets?: string[]`, `mode?: 'first' \| 'all'`, `reports?: 'full' \| 'brief'`, `timeoutMs?: number` | read | sub-agent\* |
| `ensemblr_notify_orchestrator` | **`reason: 'need_decision' \| 'blocked' \| 'progress' \| 'done'`**, **`message: string`** | read | — |
| `ensemblr_list_models` | *(none)* | read | sub-agent\* |
| `ensemblr_close_tab` | **`chatTabId: string`** | write | sub-agent |

`waitForAgents` and `notifyOrchestrator` are reads, so they survive `read-only`
mode — a blocked child can still reach its orchestrator when every write is
refused.

### Harnesses, terminals, and run scripts

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_launch_harness` | **`harnessId: string`** | write, spawn | sub-agent |
| `ensemblr_start_terminal` | **`kind: 'setup' \| 'run' \| 'spawn'`**, `scriptName?: string`, `restart?: boolean` | write, spawn | sub-agent |
| `ensemblr_list_run_scripts` | *(none)* | read | sub-agent\* |
| `ensemblr_stop_terminal` | `terminalId?: string`, `kind?: 'setup' \| 'run'` — exactly one | write | sub-agent |
| `ensemblr_write_terminal` | **`terminalId: string`**, **`input: string`** | write | sub-agent |
| `ensemblr_read_terminal_output` | `terminalId?: string`, `kind?: 'setup' \| 'run'` — exactly one, `ansi?: boolean` | read | — |

`scriptName` is accepted only with `kind: 'run'`; any other pairing is rejected.
`restart` is accepted only with `kind: 'setup'` or `'run'`, and replaces a script
of that kind already running — which is otherwise refused with `conflict`. That
refusal names the terminal already holding the slot in its message, so recovering
the id costs no extra call.
See [Run scripts](./considerations/agent-orchestration-playbook.md#run-scripts).

`ensemblr_read_terminal_output` takes the same logical selector the start and stop
ops take, so a caller that started a run script can read it without listing
terminals for its id, and the result echoes the `terminalId` it read. A
`terminalId` is scope-checked like every other id the surface takes: reading a
terminal outside the caller's own workspace is refused with `denied-scope`. A
`kind` selector is scoped by the lookup that resolves it.

Scrollback comes back rendered readable unless `ansi: true` asks for the raw PTY
bytes: escape sequences dropped, repaint blank-line runs collapsed, and the two
cursor moves that change what the text says resolved — a carriage return
rewriting its line, and the backspaces a spinner or percentage counter walks back
over. One thing that rendering cannot recover is the head of a filled buffer: the
scrollback trims from the front, so a long-running script's first line is a
fragment and a colour code cut before its `ESC` reads as ordinary text.

### Tabs, focus, and the board

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_open_tab` | **`variant: 'file' \| 'diff' \| 'comment'`**, `filePath?: string`, `turnId?: string`, `commentBody?: string`, `prNumber?: number` | write, spawn | sub-agent |
| `ensemblr_focus_tab` | **`chatTabId: string`** | write | — |
| `ensemblr_focus_dock_tab` | `terminalId?: string`, `kind?: 'setup' \| 'run'` — exactly one | write | — |
| `ensemblr_focus_panel` | **`panel: 'files' \| 'changes' \| 'checks'`** | write | — |
| `ensemblr_set_workspace_status` | **`status: 'backlog' \| 'in-progress' \| 'in-review' \| 'done' \| 'canceled'`** | write | sub-agent |
| `ensemblr_get_workspace_status` | *(none)* | read | — |
| `ensemblr_list_workspaces` | *(none)* | read | — |
| `ensemblr_list_tabs` | `workspaceId?: string` | read | — |
| `ensemblr_list_terminals` | `workspaceId?: string` | read | — |

`file`/`diff` tabs need `filePath`; a `comment` tab needs `commentBody`.

### Naming and session record

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_set_name` | **`title: string`** | write | no chat tab |
| `ensemblr_set_branch_name` | **`name: string`** (≤ 120 chars), `userRequested?: boolean` | write | sub-agent |
| `ensemblr_set_summary` | **`title: string`** (≤ 80), **`summary: string`** (≤ 4,000) | write | no chat tab |

`ensemblr_set_summary` enforces both limits by truncation, not rejection: an
over-long field is stored cut to its cap and the result carries `truncated`, one
entry per field cut, each naming the field, the limit, and the length submitted.
Both fields can be over at once and both are reported, so a caller does not fix
one and get cut again on the other. It is the surface's most token-heavy payload
and the one whose whole point is to survive the turn, so refusing it would spend
a multi-kilobyte re-emit and risk losing the record.

#### Provisional naming in Plan Mode

Planning delays `ensemblr_set_branch_name` the longest — the agent reads,
interviews, and writes a plan before it names anything — so the app names the
workspace itself when a Plan Mode session opens or submits, from the user's
prompt alone. `deriveProvisionalBranchSlug`
(`src/main/agent-runtime/naming/provisional-branch-slug.ts`) trims the opening
pleasantry and caps at five meaningful words; the queue in
`provisional-workspace-naming.ts` applies it through the same
`applyBranchSlug` gate the agent's own call passes through.

The rename is marked `provisional`, which writes `branchProvisional: true` and
deliberately leaves `renamedAt` and `branchNamed` unwritten. Both
`isWorkspaceNameable` and `isBranchNameable` therefore still report true, so the
guess costs the agent nothing: its one naming call still lands as a first
naming. `branchProvisional` does two jobs — it stops the namer guessing again on
the next prompt, and it switches the upkeep block's branch bullet to asking for a
*better* name rather than a first one.

Because those two gates stay open, a provisional rename is admitted by a third,
narrower one: `isProvisionallyNameable` requires the workspace to still carry its
generated placeholder *and* to be unguessed. A guess only ever improves on a
placeholder, so the app never moves the branch of a workspace somebody has
titled. Both `applyBranchSlug` and the rename service's own synchronous re-check
consult it, so two namers racing the same row cannot both apply.

A landed guess is announced the same two ways the agent's `setBranchName` is: an
`agentControlTabsChanged` broadcast, and a `workspace-renamed` timeline metadata
event. The event is the load-bearing one — the sidebar's workspace name comes
from a cached navigation query that nothing else invalidates — and it renders
nothing in the transcript, so the guess stays silent.

The queue is fire-and-forget and never fails a turn. It declines when the user
has turned `git.renameWorkspaceOnBranch` off, when the branch was adopted rather
than cut, when somebody has already named the workspace, and when the prompt
yields no usable slug.

### Reading a conversation

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_get_conversation_status` | **`agentSessionId: string`** | read | — |
| `ensemblr_get_last_message` | **`agentSessionId: string`** | read | — |
| `ensemblr_read_conversation` | **`agentSessionId: string`**, `stat?: boolean`, `fromOrdinal?: number`, `ordinal?: number` | read | — |

`stat`, `ordinal`, and `fromOrdinal` are alternatives honoured in that order, not
a combination. A page caps each field at 2,000 characters and the whole page at
`MAX_AGENT_PAYLOAD_CHARS`; `ordinal` reads one entry with the field cap lifted to
the page budget. This is how an orchestrator audits what a child actually ran —
its tool calls with their arguments and results — rather than trusting the report
`getLastMessage` hands back.

### Review

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_get_workspace_diff` | `filePath?: string`, `stat?: boolean` — not both | read | — |
| `ensemblr_get_diff_comments` | `filePath?: string` | read | — |
| `ensemblr_add_diff_comments` | **`comments: { filePath: string; lineNumber?: number \| null; body: string }[]`** (1–50, body ≤ 4,000) | write | — |
| `ensemblr_resolve_diff_comments` | **`commentIds: string[]`** (1–50) | write | — |

All four act on the caller's own workspace and none takes a workspace argument.
`resolveDiffComments` is refused in Plan Mode. Any `filePath` must be relative to
the workspace and must not climb out of it — an absolute path, a drive letter, or
a `..` segment comes back as `invalid-args` rather than reaching git.

### Linear

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_linear_list_issues` | `query?: string`, `teamId?: string`, `refresh?: boolean` | read | — |
| `ensemblr_linear_get_issue` | **`issueId: string`**, `refresh?: boolean` | read | — |
| `ensemblr_linear_get_metadata` | `refresh?: boolean` | read | — |
| `ensemblr_linear_create_comment` | **`issueId: string`**, **`commentBody: string`** (≤ 8,000) | write | sub-agent |
| `ensemblr_linear_update_issue` | **`issueId: string`**, `stateId?: string`, `assigneeId?: string`, `priority?: number` (0–4), `title?: string` (≤ 255), `description?: string` (≤ 32,000) | write | sub-agent |

`linearUpdateIssue` needs at least one field beyond `issueId`, and a `stateId`
whose workflow type is `completed` or `canceled` is refused. `linearUpdateIssue`
is also refused in Plan Mode. See [Talking to Linear](#talking-to-linear).

### Asking the user, and Plan Mode

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_ask_user_question` | **`questions: { question: string; header?: string; options: { label: string; description? }[]; multiSelect?: boolean }[]`** (1–4 questions, 2–6 options each) | read | no chat tab, sub-agent |
| `ensemblr_exit_plan_mode` | **`title: string`** (≤ 80), **`plan: string`** (≤ 60,000) | read | no chat tab, sub-agent |

Both are reads rather than writes, so neither is blocked by `read-only` mode.
Option labels must be distinct within a question and must not collide with the
labels the dialog reserves for its own rows (`other`, `next`, `type something`);
questions must be distinct within a call.

### Not served over MCP

`getSessionBrief` and `checkPlanModeTool` are control ops with no entry in
`TOOL_DEFS`. They are the Pi extension's own per-turn hooks — the extension pulls
the upkeep block over `getSessionBrief` on `before_agent_start` and asks
`checkPlanModeTool` whether a built-in tool call is allowed while planning — so
nothing reaches them over MCP. A first-class runtime driven over MCP has its
system prompt fixed at session open and receives the same upkeep block through
`resolveTurnPreamble` instead.

### Choosing a model for a child

A spawn never crosses the **agent runtime** axis (`pi` | `claude`), which is
distinct from a model's inference **vendor** (`anthropic`, `openai`,
`claude-code`) — `listModels` returns both on every entry precisely because the
two were once called "provider" and got compared by accident. A child is pinned
to its caller's runtime: `startConversation` passes the caller's own
`callerRuntime` to the port, and a `model` belonging to the other runtime comes
back as `invalid-args` naming both runtimes rather than being substituted. No
tab, session, or spawn budget is consumed by that refusal.

Called from a chat tab, `listModels` is already cut to the caller's runtime and
`model` may be omitted to inherit the caller's own. Called from a terminal
harness it carries every runtime — the app cannot tell which one the caller is,
because a harness origin is minted per workspace — which is also why `model` is
**mandatory** there and omitting it is refused rather than defaulted.

## How the questionnaire behaves

The questionnaire renders in the chat tab that asked, in place of the composer,
so the answer lands where the question came from. A caller with no chat tab is
refused with `denied-scope`.

One questionnaire per session at a time: a second call while one is on screen
comes straight back unanswered rather than replacing it.

There is no timeout. The call is held until the user answers or dismisses it,
the asking turn ends, or the session does — a question left overnight is still
waiting in the morning. The transport has to hold too, which is why the Pi
extension posts over `node:http` rather than `fetch`: Node's `fetch` is undici,
whose `headersTimeout` defaults to five minutes, and it used to abort the call
while the dialog stayed on screen, so the answer the user eventually gave was
written to a dead socket and lost. Do not "tidy" that back to `fetch`.

A turn that ends before the user answers takes its questionnaire off screen:
the socket closes unanswered, `/invoke` aborts the op, and the coordinator
withdraws it. Without that the card would outlive its asker, look live, and
block the session's next question forever.

The reverse also has to hold: a window that reloads loses the card but not the
call, since the renderer keeps its pending questions in memory only. Main
re-announces every open questionnaire on `did-finish-load`, so the card comes
back rather than leaving the agent blocked on something nobody can see.

The withdrawn case, the concurrent-ask case, and the no-window case each
resolve with a `summary` that tells the agent it was not a decline, so it can
retry rather than act on a refusal that never happened. Main renders that
`summary` from the answers it validated — the renderer never supplies prose.

Length rules are asymmetric on purpose. An over-long option **label** is
rejected, because the label is rendered and truncating it would change the
choice. An over-long question **header** is **trimmed** at 64 characters, because
it is only the accessible name of a pager dot — rejecting the batch over it cost
a round trip and bought nothing. Headers no longer have to be distinct either:
`headerOf` leads every label with its `Q<n>` position, so the pager is
unambiguous however the agent worded them.

## Argument naming

Three sites describe the same ops — the Pi extension's TypeBox schemas, the MCP
endpoint's `TOOL_DEFS`, and the authoritative Zod schemas in
`src/shared/agent-control/schemas.ts`. A concept spelled two ways across them
reaches the model as two words for one thing, and it guesses: `ensemblr_set_name`
used to take `name` while `ensemblr_start_conversation` took `title` for the same
chat-tab label, so agents crossed them.

`src/shared/agent-control/arg-naming.ts` holds the vocabulary.
`CANONICAL_ARG_KEYS` lists every argument key the surface may use and the concept
it carries; an op needing a concept already listed reuses its key rather than
coining a synonym, and one needing a genuinely new concept adds a row first. The
rules that decide most cases:

- **`title`** — the human-readable label of a UI surface or an artifact: a chat
  tab, a plan, a summary. Never `name`.
- **`name`** — the identity of a durable, addressable thing: the workspace and
  its git branch, a run script. Qualified where the bare word would be ambiguous
  (`scriptName`).
- **`<noun>Id`** — an opaque identifier: `chatTabId`, `agentSessionId`,
  `terminalId`, `workspaceId`, `harnessId`, `turnId`.
- **`filePath`** — a workspace-relative path, everywhere. Never `file` or `path`.
- Text by its audience: `prompt` to a conversation, `input` to a terminal,
  `message` to a human or an orchestrator, `body` to a review comment.

Scope is the agent-facing surface only. The main-process ports behind it keep
their own vocabulary, and the service maps between the two at dispatch.

**Near misses are forgiven, not rejected.** `AGENT_CONTROL_ARG_ALIASES` maps the
spellings a tool's own name invites onto the canonical key, and `validateArgs`
rewrites them before the schema runs. Two families of alias exist today:
`name → title` on the five ops whose own name invites it (`setName`,
`setSummary`, `spawnChatTab`, `startConversation`, `exitPlanMode`), plus
`branchName`/`slug → name` on `setBranchName`; and `file`/`path → filePath` on
the three ops that take a path (`getWorkspaceDiff`, `getDiffComments`,
`openTab`). A canonical key sent alongside an alias wins. The rewrite is silent on purpose: the canonical key already travels to the
model in the tool schema, so an error would cost a round trip to teach what the
description said. When a key really is unknown, the failure names the keys the op
does accept, so the retry is informed.

`tests/main/agent-control-arg-naming.test.ts` enforces all of it — every schema
key against the vocabulary, every alias against its op's real keys, and the
parameter keys of all three surfaces against one another.

## Reviewing the diff

The four review ops let an agent read the work in its workspace, annotate it
where the user will find the annotation — on the line, in the Changes panel, not
buried in a chat turn — and close what it has fixed.

**Scope is the review panel's scope.** `ensemblr_get_workspace_diff` resolves the
workspace's `base_branch` and diffs from `merge-base(base, HEAD)` to the working
tree, so committed-on-branch edits, uncommitted edits, and untracked files all
appear — the same set the Changes panel renders. A workspace with no recorded
base degrades to the uncommitted change set, exactly as the panel does.

**Call `stat: true` first.** A workspace diff is the one payload in this surface
with no natural size ceiling. Stat mode returns the changed-file rows and totals
and issues no per-file git call, so it is the cheap probe that says whether the
full read is worth making. `filePath` and `stat` are alternatives rather than a
filter pair — sending both is refused as `invalid-args`, since a single file has
no stat and silent precedence would leave the caller unsure which read it got.

**Every read is capped at 32,000 characters** — the same `MAX_AGENT_PAYLOAD_CHARS`
ceiling a joined child report gets. A full read cuts on **whole-file boundaries
only**, because a patch severed mid-hunk is unparseable; the files it drops come
back in `omittedFiles`, each re-requestable with `filePath: "<path>"`. That per-file
call carries the same ceiling, cutting at a **hunk boundary**: the files a full
read drops are by definition the large ones, so leaving the recovery route
unbounded would turn `omittedFiles` into an instruction to blow the context the
budget had just protected. Git's own 2 MB output cap sits well above both, so the
ceiling that binds is always this one.

**Per-file reads go out eight at a time.** The app has no whole-workspace unified
diff — the Changes panel renders one file at a time — so the port composes one
from a status read plus a patch read per changed file. Those run in windows
rather than serially, and the budget is re-checked between windows, so a wide
diff stops issuing git calls once the patches already in hand fill the payload.

**Comments are Ensemblr-local.** `ensemblr_get_diff_comments` returns the notes in
the workspace's own SQLite store — the ones the user left in the Changes panel and
the ones agents filed there. Comments synced from a GitHub pull request are
deliberately **excluded**: they are a live `gh` snapshot rather than local rows,
and nothing in this surface could reply to or resolve one, so returning them would
be reading with no action attached. Every comment carries an `origin` (`user` or
`agent`), so a future `getPullRequestComments` op is purely additive.

**Authorship is stamped, not claimed.** `ensemblr_add_diff_comments` writes rows
with `origin: 'agent'` set by the port; nothing an agent can send makes its
comment read as the user's. Both surfaces badge it: the diff viewer labels the
thread, and the Checks panel carries `origin` alongside the `path:line` that has
taken its author slot.

**The write announces itself.** The comment list is a cached query that only
renderer-local mutations invalidate, and the client refetches neither on an
interval nor on window focus — so an agent's write would otherwise sit invisible
until the panel remounted. `addDiffComments` broadcasts on
`ensemblr:agent-control-review-comments-changed`, which the renderer turns into a
cache invalidation for that workspace, the same shape `tabsChanged` already uses.

**Three of the four survive both gates.** The two reads are reads, allowed in
every permission mode. `addDiffComments` and `resolveDiffComments` are writes and
follow the mode like any other. Plan Mode leaves the reads and `addDiffComments`
alone — a comment anchored to a line records what you found rather than changing
it, the same argument that keeps naming and the board available while planning.
It refuses `resolveDiffComments`: resolving asserts a finding is fixed, and
nothing is fixed while `write` and `edit` are blocked, so every resolve from Plan
Mode would be a false claim. A spawned sub-agent keeps all four: a delegated
reviewer filing comments is the point, and an implementer child closing the ones
it fixed is the same argument.

**Resolving is one-way and workspace-scoped.** `resolveDiffComments` only ever
resolves — it cannot reopen a comment the user closed (that would reverse a human
judgement with nothing in the UI to announce it) and it cannot archive one (which
drops the comment out of every listing, a delete by another name). Ids that match
no open comment on the caller's workspace come back in `notFound` rather than
failing the call, and "no such id", "another workspace's id", and "archived" are
deliberately merged into that one bucket so the op cannot be used as a
cross-workspace id-existence oracle. The port lists the caller's own comments
first and only writes ids in that set, so a foreign id never reaches the store.

## Talking to Linear

Ensemblr's Linear integration is otherwise renderer-only. The five control ops
expose a deliberate subset of it to agents, over
`src/main/agent-control/linear-ports.ts` — a gated port on the same
`LinearService` the renderer's tracker views already use. No Linear GraphQL or
cache logic lives in the control layer.

**Nothing here is workspace-scoped.** Linear is an app-level integration bound to
one account, so `LinearPort` takes no workspace argument and the op handlers drop
`origin` entirely — there is no workspace a caller could point at that is not its
own, and equally no filter narrowing a read to the work in front of it. One
account can span several teams, which is why every tool description and playbook
bullet says so outright and points at `teamId`: an agent told the list is "this
workspace's" stops narrowing and reads a stranger's ticket as its own.

**Assume it is not connected.** Most workspaces have no Linear account linked at
all, and an unlinked integration is not an empty backlog. Every op answers with a
`status` — `ok`, `not-connected`, `not-found`, `refused`, `failed` — and prose in
`message` naming the recovery. Nothing throws: the service already returns a
typed failure envelope, and the port maps it onto that one word so an agent can
tell "the user never linked Linear" (stop asking) from "wrong id" (fix it) from
"Linear is down" (retry or report). `reconnect-required` folds into
`not-connected` because the recovery is the same — the user reauthorizes.

**Done and Canceled are refused.** `AGENTS.md` says agent work never marks a
Linear ticket `Done`; it goes to `In Review` and a human closes it. That is
enforced in the port, not left to the playbook: before an update reaches Linear,
`terminalStateRefusal` resolves the `stateId` against the cached workflow states
and refuses any whose Linear `type` is `completed` **or** `canceled`
(`LINEAR_TERMINAL_STATE_TYPES`). Both, because closing a ticket as canceled is
the same act under a different label. The refusal comes back as
`status: 'refused'` with a message naming In Review — a modelled answer the agent
can act on, not an error.

The guard **fails closed**. A `stateId` the cached metadata cannot classify —
unknown id, a cached row carrying no workflow `type`, or a metadata read that
could not reach Linear — is refused too, pointing at
`ensemblr_linear_get_metadata` as the one call that resolves it. An
unclassifiable state might be a Done column, and the whole point is that the app
never posts an agent's "finished" to a tracker the team reads. A row without a
type is unclassifiable on strictly less information than a missing one, so it
takes the same refusal rather than being read as "not terminal".

**Payloads are budgeted like the workspace diff.** Every result is fitted to
`MAX_AGENT_PAYLOAD_CHARS` and says what it cut: `listIssues` returns no
descriptions at all (a hundred issues carrying theirs is what turns a list into a
context spend) and reports `omittedIssues`; `getIssue` clamps the description,
keeps the most recent comments, and reports `omittedComments`; `getMetadata`
fills one shared budget in priority order — states, teams, users, projects,
labels — so a workspace with hundreds of labels cannot crowd out the states an
update needs. Cycles are not returned at all, because no op here sets one.

**The update surface is deliberately small.** `linearUpdateIssue` takes `stateId`,
`assigneeId`, `priority`, `title`, and `description` and nothing else. Labels,
project, cycle, and due date are planning decisions a human makes in Linear, and
every field exposed here is one more thing an agent can get wrong on a ticket the
whole team reads. `createIssue` is not exposed at all: the Linear service supports
it, but filing a ticket is the decision the roadmap is made of, not a step in
carrying one out. Both are purely additive if that changes.

Ids, not names: `stateId`, `assigneeId`, and `teamId` are Linear uuids, which is
what makes `ensemblr_linear_get_metadata` the first call of any update sequence.
`issueId` is the exception and takes either the uuid or the human identifier
(`ENG-123`) — an identifier misses the local cache and always reaches Linear.

## Orchestration in practice

An agent starts as an **orchestrator** (the root, lineage depth 0) and may
delegate; anything it spawns is a **sub-agent** that does its one unit of work
itself and never fans out. The intended loop is **delegate → wait → evaluate →
integrate**:

1. **Delegate** each independent, substantial workstream to its own fresh tab
   with `ensemblr_start_conversation` (give it a short `title`), briefing each
   child with what to deliver — the question, the defaults to assume, and
   whether it reports inline or writes a named file. Shared groundwork is read
   once by the orchestrator, not re-derived by every child.
2. **Wait** with `ensemblr_wait_for_agents` — it blocks efficiently instead of
   polling, and returns the moment a child finishes or signals it needs a
   decision. It hands back each child's whole final turn by default;
   `reports: "brief"` returns each report's opening plus a pointer to
   `ensemblr_get_last_message`, which is what a wide fan-out wants.
3. **Evaluate** each result; steer a child with `ensemblr_send_follow_up` and
   wait again if needed.
4. **Verify** a load-bearing claim before building on it. A child's report is a
   claim, not a fact the orchestrator checked, and a cited path reads as verified
   even when nobody opened it — both orchestrator playbooks say so outright. When
   the claim is about what the child *did* rather than what a file says — a suite
   it ran, a command that passed — `ensemblr_read_conversation` replays its actual
   tool calls with their arguments and results; probe it with `stat: true` first.
5. **Integrate** the outcomes and focus the relevant view so the user can
   follow along.

Delegation is the exception, not the default — one agent in one thread is the
right tool for almost every task. A sub-agent's report is its only deliverable —
it writes no files unless its brief names a path.

Decisions the user owns end a child's report under an `Open questions` heading:
each one a question, 2-6 options, and the option the child took. The orchestrator
gathers those across its children and asks them in one `ensemblr_ask_user_question`
round before it answers. `ensemblr_notify_orchestrator` is reserved for a child
that cannot produce its deliverable at all until someone replies — in practice
children almost never use it, which is why the question rides the report instead.

A sub-agent's chat tab is read-only to the user: it renders **no composer at
all**, because the orchestrator owns that conversation and steers it with
`ensemblr_send_follow_up` for the tab's whole life. The transcript stays readable
— the report a child leaves behind is the point of the tab.

Stopping a conversation stops every sub-agent below it. The stop walks the origin
registry's lineage (`childrenOf`) and aborts each live child with reason
`orchestrator-stopped`, so a child is never left running with nobody able to
steer it or read its report. The descendants are collected even when the stopped
session's own abort fails — a wedged orchestrator is the likeliest one to refuse,
and the likeliest to have stranded something.

Withholding the composer withholds the Stop button with it, so the user's route
into a running child is its tab's close control: closing a tab whose agent is
mid-turn raises the confirm-then-cancel guard (`useCloseRunningChatGuard`), whose
Stop action cancels that session by id. Nothing asks the user from that tab either —
`ensemblr_ask_user_question` is refused to a sub-agent, precisely because the
orchestrator that owns the conversation is blocked waiting on its report.

Two things a wait returns as prose rather than as a flag. `timedOut: true` with
children still `pending` carries a `note` naming the exact resume call, in the
caller's own mode, because an orchestrator reads a bare timeout as a fault to
report. And a *default* wait that finds no registered children carries a `note`
too: lineage lives in the in-memory origin registry, so after a restart the
default target resolves empty even though `notifyOrchestrator` — keyed off the
durable marker — still works. Without the note, a resumed child's signal parks
in a wait that reads back "nothing needs me". The recovery is to wait again with
explicit `targets`, which the orchestrator still holds in its own transcript.

The same loop runs while planning, with read-only children: each one answers a
question about the codebase and reports back, and the orchestrator folds those
findings into the plan it submits. A sub-agent cannot submit a plan or question
the user in any mode — see
[Planning with sub-agents](./considerations/agent-orchestration-playbook.md#planning-with-sub-agents).

## See also

- [ADR 0040](./adr/0040-use-loopback-control-server-for-agent-app-control.md) — the accepted decision.
- [`considerations/agent-control-layer.md`](./considerations/agent-control-layer.md) — design record and as-built architecture.
- [`considerations/agent-orchestration-playbook.md`](./considerations/agent-orchestration-playbook.md) — the canonical tool guidance injected into every agent.
- [`harnesses.md`](./harnesses.md) — the third-party runtimes Ensemblr can launch.
