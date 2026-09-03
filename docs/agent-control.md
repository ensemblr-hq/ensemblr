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
harness cannot be told which agent runtime it is. The **Concierge** registers one
more origin of its own: no workspace at all, its own home as the cwd, and a
`concierge` flag that outranks lineage, so it is never resolved as an
orchestrator or a sub-agent. One service validates the request, resolves the
origin from the token, enforces scope and permissions, applies guardrails, and
delegates to the app's existing services through ports.

The architecture decision is [ADR 0040](./adr/0040-use-loopback-control-server-for-agent-app-control.md);
the full design record is [`considerations/agent-control-layer.md`](./considerations/agent-control-layer.md).

## The playbook and the skill behind it

Two channels carry what an agent knows about Ensemblr, and the split is
deliberate.

The **playbook** (`src/shared/agent-control/awareness.ts`) is injected into every
session's system prompt. It is always in context, so it carries only what a turn
cannot go without: the tool inventory the caller really holds, the etiquette, and
the bookkeeping.

The **skill** is an Agent Skill in `resources/agent-skills/`, shipped inside the
app package and loaded per launch. Only its name and description sit in context;
the body is read on demand. It carries what would be waste to repeat every turn —
the `.ensemblr/settings.toml` key reference, the run-script shape, the worktree
model, the failure vocabulary. The playbook names it, so an agent is told where
to look rather than left to notice a description.

One directory serves every runtime, because a Claude Code plugin root and a Pi
skill directory nest rather than conflict:

| Runtime | How it loads |
| --- | --- |
| Pi (`pi --mode rpc`) | `--skill <bundle>/skills/ensemblr`, beside the control extension's `-e` |
| Native Claude (Agent SDK) | `plugins: [{ type: 'local', path: <bundle> }]` |
| Claude harness (TUI) | `--plugin-dir <bundle>` |

Nothing is written into the user's repository or into `~/.claude`, so the skill
is scoped to sessions Ensemblr launched and leaves nothing behind. Paths are
resolved by `src/main/agent-skills/`, which reports `null` when the bundle is
absent — a runtime then launches exactly as it did before skills existed.

The SDK's sibling `skills` option is deliberately **not** set: it is a context
filter, so naming ours there would hide every skill the user already has.

Both slash-command listers name the bundle too
(`src/main/pi-agent/pi-slash-commands.ts`,
`src/main/claude-agent/claude-slash-commands.ts`). Discovery runs its own
resource loader, so a skill loaded only at session open would work at runtime yet
be missing from the composer's catalogue.

`tests/main/agent-skill-bundle.test.ts` holds the skill to the surfaces it
describes: every `ensemblr_*` tool it names must exist in `AGENT_CONTROL_OPS`,
and every `settings.toml` key must exist in `schemas/settings.schema.json`.
The decision is [ADR 0053](./adr/0053-ship-a-bundled-ensemblr-skill-to-both-runtimes.md).

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

**A conversation the Concierge opens is a root orchestrator, not a sub-agent of
it.** The Concierge is on no lineage axis, so what it opens is a peer with its own
delegation budget. Both axes have to say so, and the marker outranks depth, so a
spawn that stamped it unconditionally defeated the depth exemption on its own and
silently downgraded every Concierge delegation to a leaf worker. Both now read
one function — `spawnedChildRole` in `src/shared/agent-control/awareness.ts` —
which the registry spends depth on and which the spawn path stamps the marker
from. A tab the Concierge reuses has any marker its last tenant left cleared,
because the tab now hosts a root; a spawn that fails to submit puts back whatever
the tab carried before rather than assuming which way the write went.

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

**Denying the tool is not enough on a planning turn.** Claude Code's own prompt
carries a standing *"Do not call the AgentTool unless the user requested it"*
line — shipped with the model's prompt bundle, not derived from `disallowedTools`
— and `permissionMode: 'plan'` adds a plan workflow ordering a fan-out through
that same tool. Read together with the deny above, an agent holds three
instructions and nothing saying which governs, and it picks by guess.
`buildPlanModeDelegationDirective` answers all three on every planning turn, in
the harness's own vocabulary, and inverts across the mechanism: the `ensemblr`
root is told which ops replaced its denied tool, the `native` root is told its
workflow's fan-out is the right one here, and an investigator is told it holds
neither. It rides `readTurnPreamble`, so Pi never sees it — Pi gets
`PLAN_MODE_ORCHESTRATOR_AWARENESS` instead. See
[ADR 0057](./adr/0057-answer-the-harness-plan-workflow-in-the-per-turn-preamble.md).

**The mechanism is pinned at session open**, on `AgentControlOrigin.delegation`.
The SDK fixes `disallowedTools` when `query()` opens, so a live-read tool list
would let the user flip the setting mid-session and leave that session holding
neither mechanism. A change therefore reaches the next chat, not the open one.

Pi is unaffected: it has no sub-agent tool of its own, so
`resolveAgentControlWiring` pins every non-Claude runtime to `ensemblr`
regardless of the setting. So is every spawned child, whatever its runtime — the
setting picks how a *root* delegates. Nested delegation is blocked on the other
axes already, so a child opened under `native` would keep its own sub-agent tool
live and fan out around the depth cap.

**A child is recognised by its marker, not only by its lineage.**
`parentSessionId` rides the open request and a *resume* carries none, so a child
reopened after a restart reads as a root — and would take the user's `native`
setting, which is exactly the escape above. `resolveDelegation` therefore reads
the durable sub-agent marker off the chat tab as well, the same column the
control layer's role resolution prefers over lineage for the same reason. The
sub-agent variant of the plan-mode delegation directive states outright that the
runtime's tool is denied; this pin is what makes that true.

Terminal harnesses are unaffected too — their control
token is minted per workspace and shared by every terminal in it, so the app
cannot tell a Claude Code CLI from a Codex one and cannot vary the tool list per
harness.

## Tool reference

Forty-three tools, enumerated from `TOOL_DEFS` in
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
dispatchable), `no chat tab` (a terminal harness), `workspace agent` (a
Concierge-only op, meaningless to an agent that already has a workspace), and
`Concierge` (denied to the Concierge, which has neither a workspace to act in
nor a chat tab of its own).

### Conversations and delegation

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_spawn_chat_tab` | `title?: string` | write, spawn | sub-agent, Concierge |
| `ensemblr_start_conversation` | **`prompt: string`**, `chatTabId?: string`, `model?: string`, `thinkingLevel?: string`, `title?: string`, `wait?: boolean`, `workspaceId?: string` | write, spawn | sub-agent |
| `ensemblr_send_follow_up` | **`agentSessionId: string`**, **`prompt: string`**, `wait?: boolean` | write | sub-agent |
| `ensemblr_wait_for_agents` | `targets?: string[]`, `mode?: 'first' \| 'all'`, `reports?: 'full' \| 'brief'`, `timeoutMs?: number` | read | sub-agent\* |
| `ensemblr_notify_orchestrator` | **`reason: 'need_decision' \| 'blocked' \| 'progress' \| 'done'`**, **`message: string`** | read | Concierge |
| `ensemblr_list_models` | *(none)* | read | sub-agent\* |
| `ensemblr_close_tab` | **`chatTabId: string`** | write | sub-agent |

`waitForAgents` and `notifyOrchestrator` are reads, so they survive `read-only`
mode — a blocked child can still reach its orchestrator when every write is
refused.

### Harnesses, terminals, and run scripts

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_launch_harness` | **`harnessId: string`** | write, spawn | sub-agent, Concierge |
| `ensemblr_start_terminal` | **`kind: 'setup' \| 'run' \| 'spawn'`**, `scriptName?: string`, `restart?: boolean` | write, spawn | sub-agent, Concierge |
| `ensemblr_list_run_scripts` | *(none)* | read | Concierge, sub-agent\* |
| `ensemblr_stop_terminal` | `terminalId?: string`, `kind?: 'setup' \| 'run'` — exactly one | write | sub-agent, Concierge |
| `ensemblr_write_terminal` | **`terminalId: string`**, **`input: string`** | write | sub-agent, Concierge |
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
| `ensemblr_open_tab` | **`variant: 'file' \| 'diff' \| 'comment'`**, `filePath?: string`, `turnId?: string`, `commentBody?: string`, `prNumber?: number` | write, spawn | Concierge, sub-agent |
| `ensemblr_focus_tab` | **`chatTabId: string`** | write | — |
| `ensemblr_focus_dock_tab` | `terminalId?: string`, `kind?: 'setup' \| 'run'` — exactly one — `workspaceId?: string` | write | — |
| `ensemblr_focus_panel` | **`panel: 'files' \| 'changes' \| 'checks'`**, `workspaceId?: string` | write | — |
| `ensemblr_focus_workspace` | **`workspaceId: string`** | write | workspace agent |
| `ensemblr_create_workspace` | **`projectId: string`**, **`name: string`**, `baseBranch?: string` | write, spawn | workspace agent |
| `ensemblr_set_workspace_status` | **`status: 'backlog' \| 'in-progress' \| 'in-review' \| 'done' \| 'canceled'`**, `workspaceId?: string` | write | sub-agent |
| `ensemblr_get_workspace_status` | `workspaceId?: string` | read | — |
| `ensemblr_list_projects` | *(none)* | read | workspace agent |
| `ensemblr_list_workspaces` | *(none)* | read | — |
| `ensemblr_list_tabs` | `workspaceId?: string` | read | — |
| `ensemblr_list_terminals` | `workspaceId?: string` | read | — |

`file`/`diff` tabs need `filePath`; a `comment` tab needs `commentBody`.

**A `file` or `diff` tab names itself after the file.** The op stamps the target's basename as the
tab title, which is what the renderer's own openers do and is locale-neutral, so writing it from the
main process does not freeze the row into one language. A `comment` tab has no path to name it and
opens untitled, where the strip supplies a localized *Untitled* — the chat placeholder is reserved
for chat rows, so a file tab never reads as a conversation nobody named.

### Naming and session record

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_set_name` | **`title: string`** | write | no chat tab, Concierge |
| `ensemblr_set_branch_name` | **`name: string`** (≤ 120 chars), `userRequested?: boolean` | write | sub-agent, Concierge |
| `ensemblr_set_summary` | **`title: string`** (≤ 80), **`summary: string`** (≤ 4,000) | write | no chat tab, Concierge |

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
| `ensemblr_get_workspace_diff` | `filePath?: string`, `stat?: boolean` — not both, `workspaceId?: string` | read | — |
| `ensemblr_get_diff_comments` | `filePath?: string`, `workspaceId?: string` | read | — |
| `ensemblr_add_diff_comments` | **`comments: { filePath: string; lineNumber?: number \| null; body: string }[]`** (1–50, body ≤ 4,000), `workspaceId?: string` | write | — |
| `ensemblr_resolve_diff_comments` | **`commentIds: string[]`** (1–50), `workspaceId?: string` | write | — |

All four act on the caller's own workspace and none takes a workspace argument.
`resolveDiffComments` is refused in Plan Mode. Any `filePath` must be relative to
the workspace and must not climb out of it — an absolute path, a drive letter, or
a `..` segment comes back as `invalid-args` rather than reaching git.

### Linear

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_linear_list_issues` | `accountId?: string`, `query?: string`, `teamId?: string`, `refresh?: boolean` | read | — |
| `ensemblr_linear_get_issue` | `accountId?: string`, **`issueId: string`**, `refresh?: boolean` | read | — |
| `ensemblr_linear_get_metadata` | `accountId?: string`, `refresh?: boolean` | read | — |
| `ensemblr_linear_create_comment` | `accountId?: string`, **`issueId: string`**, **`commentBody: string`** (≤ 8,000) | write | sub-agent |
| `ensemblr_linear_update_issue` | `accountId?: string`, **`issueId: string`**, `stateId?: string`, `assigneeId?: string`, `priority?: number` (0–4), `title?: string` (≤ 255), `description?: string` (≤ 32,000) | write | sub-agent |

`linearUpdateIssue` needs at least one field beyond `issueId`, and a `stateId`
whose workflow type is `completed` or `canceled` is refused. `linearUpdateIssue`
is also refused in Plan Mode. Several Linear accounts can be connected at once,
so `accountId` is optional on every one of these and resolved from what the call
already names. See [Talking to Linear](#talking-to-linear).

`linearGetMetadata` also returns `viewer`, one row per in-scope account naming the
Linear `userId` that account is authorized as. An agent has no Linear identity of
its own, so that id is what "assign this to me" resolves to; without it the only
route to an `assigneeId` is matching a display name against the users table.

### The Concierge's own surface

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_recall_memory` | **`query: string`**, `limit?: number` | read | workspace agent |

`ensemblr_list_projects` is documented with the other listings above, and is the
Concierge's too: a workspace agent belongs to one project and cannot act on
another, so the roster of the rest is noise in its tool list. It is also the only
place a `projectId` for a project with **no live workspace** is handed out —
`ensemblr_list_workspaces` names a project only through the workspaces cut from
it, so an idle project is invisible there and `ensemblr_create_workspace` has
nothing to be called with. Each row carries `workspaceCount`, which is how a
project with no work in it is told from one that is busy.

`ensemblr_create_workspace` takes its `name` as a requirement rather than a
courtesy, because that one string is two things: the workspace the user reads in
the sidebar, and the git branch, which the create service slugs and joins to the
repository's branch prefix. Omitting it is not neutral — the service falls back
to the literal placeholder `workspace`, so the worktree lands as "workspace" on
`<prefix>/workspace` and the next one collides with it. The boundary schema
therefore rejects both an empty name and a list of placeholders (`workspace`,
`task`, `temp`, `test`, and friends) with a message naming what a good one looks
like. A successful create also moves the app's route to the new workspace, over
the same `focusWorkspace` port `ensemblr_focus_workspace` uses.

The Concierge writes a memory as an ordinary file under `<root>/concierge/memory/`
— which its tool policy admits because that path is inside its own home — and a
watcher reindexes it. There is therefore no write op here: one exists for search,
because searching an FTS index is the thing a file read cannot do.

**A retired Concierge child holds a third, narrower list.** Clearing the context
hands the user a fresh conversation at once and leaves the child it replaced
running one last turn to write those memory files, so for the length of that turn
a live Concierge token sits behind a transcript the renderer no longer draws
anywhere. `retiredControlOpDenial` narrows it to the three ops that turn actually
needs — `checkPlanModeTool`, which is what clears each write against the home and
which the Pi extension blocks every guarded call on when it does not answer;
`getSessionBrief`; and `ensemblr_recall_memory` — and answers `denied-scope` to
everything else. The axis is the origin's `retired` flag, set by
`OriginRegistry.retire` when the clear detaches the child and cleared only when
the pass ends and the origin is released outright. Without it the child keeps the
whole Concierge surface: `ensemblr_ask_user_question` would broadcast under a
session id no panel is watching, so the dialog renders nowhere while the desktop
notification still fires and the child blocks on an ask that has no timeout, and
a focus op would move the user's window with no cause they could see.

**The tab bookkeeping every workspace agent owes does not apply to it.** The
Concierge is a panel, not a chat tab, so `ensemblr_set_name` and
`ensemblr_set_summary` act on a row it has never had. The chat-tab axis cannot
refuse them on its own — `originHasChatTab` reads the caller's species, and a
Concierge runs on the same runtimes a chat tab does — so both are named in
`CONCIERGE_WITHHELD_OPS` instead, which withholds them from the tool list and
answers `denied-scope` to a stale caller that dispatches one anyway. Left out,
they reach the services and fail as `not-found` and `internal`: two errors in the
timeline, on a turn that owed no bookkeeping at all. A memory file is the
Concierge's equivalent, and the only one that survives a context clear.

### Asking the user, and Plan Mode

| Tool | Arguments | Gate | Withheld from |
| --- | --- | --- | --- |
| `ensemblr_ask_user_question` | **`questions: { question: string; header?: string; options: { label: string; description? }[]; multiSelect?: boolean }[]`** (1–4 questions, 2–6 options each) | read | no chat tab, sub-agent |
| `ensemblr_exit_plan_mode` | **`title: string`** (≤ 80), **`plan: string`** (≤ 60,000) | read | no chat tab, sub-agent, Concierge |

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

The brief carries a second per-turn block, `planRefinement`, for a session whose
submitted plan is still in front of the user. That is the Refine turn: the user's
changes arrive as an ordinary prompt, and without the block the agent answers in
prose and leaves them a revision they cannot approve. It rides both channels the
upkeep block does, so Pi and Claude Code are told the same thing — close this
turn by submitting the whole revised plan again.

It carries a third, `rolePlaybook`, which is the whole role playbook rather than
a block appended after one. The extension holds byte-identical copies of the
orchestrator and sub-agent playbooks and picks between them from
`ENSEMBLR_CONTROL_ROLE`; the Concierge's has no copy there, so the app sends it
down with the brief and the extension prefers whatever arrives over its own. It
is null for every workspace agent, which leaves the local copies in place. A
Concierge served the orchestrator playbook instead would be told to do the work
itself in a workspace it has none of, and to name a chat tab it does not own.

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

Inheritance reads two signals: the live model the caller's runtime reports, which
only the Pi extension forwards, and the model the app has on record for the
caller. A runtime driven over MCP forwards nothing — the protocol carries no
field for it and the app cannot ask — so on that path the second signal is the
whole answer. It names the model the caller's last turn ran on, because every
submit records what it carried on the session row, rather than one switched
inside the runtime since.

**The Concierge is read out of its own session store**
(`ConciergePort.describeSession`), because it belongs to no workspace and
`agentSessionService` holds no row for it. It was the one caller with neither
signal, so every model-less spawn from a Claude Concierge landed on the catalog
default — in practice the most expensive model in the list, with no error and no
warning. A caller whose model can be neither named nor inherited is now refused
with prose telling it to call `listModels`, rather than opened on a default
nobody chose.

That store now records a turn's model the way `agent-session-lifecycle` records a
workspace chat's, because it is the same signal read back: `modelOverride` rides
one request and is gone, so a row left at the value the session opened with would
hand a child the model its parent left several turns ago — the user's own pick in
the Concierge composer being invisible to the very spawn that inherits from it.

## How the questionnaire behaves

The questionnaire renders in the chat tab that asked, in place of the composer,
so the answer lands where the question came from. A caller with no chat tab is
refused with `denied-scope`.

The Concierge is the one asker that is not a chat tab, so its question renders in
the Concierge panel instead — above its composer rather than in place of it,
because a chat tab's draft lives in an atom and survives the swap while the
Concierge composer holds its draft in the editor itself. The pending map is keyed
by the asking session either way, and the Concierge's session id is a perfectly
good key; what it lacked was a reader, so the question sat in the map with nothing
rendering it while the agent blocked on an ask that has no timeout. Closing the
panel takes the card off screen and leaves the question pending, so reopening
brings it back.

Neither of the two things a workspace agent's question also does happens for it,
and for the one reason: there is no chat to attribute either to. It marks no chat
unread — an entry naming a tab that does not exist could never be cleared, and
would evict real marks from the capped list. And it posts no desktop
notification: `resolveNotificationTarget` refuses an empty workspace id outright,
because a target built from one carries no tab title and no workspace name, so
the notification read "Untitled chat" over a body ending in nothing and clicked
through to a workspace that does not exist.

One questionnaire per session at a time: a second call while one is on screen
comes straight back unanswered rather than replacing it.

There is no timeout. The call is held until the user answers or dismisses it,
the asking turn ends, or the session does — a question left overnight is still
waiting in the morning. The transport has to hold too, which is why the Pi
extension posts over `node:http` rather than `fetch`: Node's `fetch` is undici,
whose `headersTimeout` defaults to five minutes, and it used to abort the call
while the dialog stayed on screen, so the answer the user eventually gave was
written to a dead socket and lost. Do not "tidy" that back to `fetch`.

**And the client has to hold, which Ensemblr does not control — so it configures
it.** Every MCP client applies a per-call timeout of its own, each defaulting to
60 seconds: Codex's and Vibe's `tool_timeout_sec`, and — for Claude — the HTTP
request timeout it derives from the same per-server `timeout` key, which is what
actually aborts an http-transport call long before its own ~28-hour tool-call
default does. Since the questionnaire needs a chat tab, the MCP caller that holds
it is Claude's first-class runtime — a user who steps away for lunch would come
back to a question the app is still holding open and an agent that abandoned it
minutes in. Because Ensemblr launches these processes itself it writes the knob
rather than inheriting it: `MCP_TOOL_CALL_TIMEOUT_MS` in
`src/main/agent-control/mcp-tool-timeout.ts` is set to a day and lands in every
launch config — `claude-mcp-config.ts` for the Agent SDK,
`harness-launch-config.ts` for the three terminal harnesses. It is per server
rather than per tool, which no client exposes, so the same constant covers the
other two blocking ops a harness *does* hold: `waitForAgents`, capped at five
minutes by its own guardrail, and a `wait: true` spawn.

**Raising it per server means the app owes a bound per op.** A day is the right
answer for the four ops that block by design and the wrong one for the other
forty-one: before, a wedged port surfaced to the agent as its client's
60-second timeout and the turn carried on; after, the same wedge would hold the
agent for a day while the heartbeat reported it healthy. Port coverage does not
close that on its own — `linear-client.ts` and `workspace-git-status.ts` bound
themselves, the terminal, harness-launch and tab ports do not — so `invoke`
applies `DISPATCH_TIMEOUT_MS` (`src/main/agent-control/dispatch-deadline.ts`) to
every op except those four. A timed-out op is abandoned rather than cancelled,
and the envelope says so: the effect may still land, so the agent is told to
check the state rather than to retry.

A pending call also beats a `notifications/progress` every 20 seconds against
the `progressToken` the caller put in the request's `_meta` (`mcp-progress.ts`).
None of these clients extends its timeout on progress — Claude documents its
`timeout` as a hard wall-clock limit and Vibe hands the value to the Python
SDK's `read_timeout_seconds`, which does not reset either — so this is the
second line of defence, not the first: it keeps the call visibly alive for a
client that *does* honour `resetTimeoutOnProgress`, and it stops a held ask
being silent on the wire for as long as the user is away. A caller that sent no
token gets nothing, because the spec has no way to address progress at a request
that did not ask for it.

A turn that ends before the user answers takes its questionnaire off screen:
the socket closes unanswered, `/invoke` aborts the op, and the coordinator
withdraws it. Without that the card would outlive its asker, look live, and
block the session's next question forever. The MCP bridge does the same, and has
to: it forwards each request's own `AbortSignal` into the service, so a client
that gave up — by cancellation notice or by dropping the connection — withdraws
the dialog instead of leaving a user to answer into a void that nobody is
listening to.

The questionnaire is not the only thing on this surface that waits on a human.
In approval-required mode the confirmation prompt fronts *every* gated op, so it
carries the same signal — but it is a native `dialog.showMessageBox`, and
Electron gives no way to dismiss a box the app opened. So an abandoned prompt is
answered by giving up on the dialog rather than by closing it: the box stays up
until the user clicks, and their click is inert. The guarantee is the one that
matters — the op never runs for a caller that stopped listening, instead of
starting a terminal or launching a harness for nobody an hour after the fact.
The child-side waits honour the signal the plain way: `waitForAgents` and a
`wait: true` spawn both stop polling the moment their caller goes.

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
where the user will find the annotation — on the line, not buried in a chat turn
— and close what it has fixed.

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

**A comment op lands the user in Checks.** Comments render in two places: inline
on their lines in Changes, and as a list in Checks, which is the view that
answers "what did the agent just leave me, and what is still open". A pass that
leaves six findings wants the list, so `addDiffComments` and a `resolveDiffComments`
that actually closed something pull the review panel to Checks — through the same
`focusPanel` broadcast the tool exposes, so there is no second focus mechanism.
Enforced in `review-focus.ts` rather than steered in prose, for the reason
`linear-ports.ts` enforces the tracker rules: behaviour that depends on a model
remembering to call `ensemblr_focus_panel` is behaviour the user does not get.

The pull is **coalesced per workspace on a 60-second window that every comment op
extends**, so a pass pulls focus once however many calls it makes and however long
it runs, and a pass an hour later pulls again. That is the whole answer to
focus-stealing: one yank per pass, at the moment the pass has something to show. A
resolve batch that closed nothing pulls no focus at all — the same condition the
cache-invalidation broadcast is gated on.

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

**No read is narrowed to your workspace.** Linear is an app-level integration:
one account spans several teams, several accounts can be connected at once, and
nothing filters a list down to the work in front of you. Every tool description
and playbook bullet says so outright and points at `teamId`, because an agent
told the list is "this workspace's" stops narrowing and reads a stranger's ticket
as its own.

`LinearPort` does take the calling `workspaceId`, and the op handlers pass
`origin` through — but only to recover the account a workspace created from an
issue already belongs to, so an agent working that ticket does not have to name
the organization it came from. That is a *fallback*, applied after the entity
named has been resolved, never a scope: see the resolution order below.

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

Both refusals name the alternatives and say that **nothing in the call was
applied** — not the state, and not a `title` or `priority` that rode along with
it. The terminal refusal lists the non-terminal states of the same team by name
and id, because the classification already read every state in that team, so
making the agent spend a second `getMetadata` round trip is waste. An agent that
assumes a partial write landed never re-sends the fields that did not.

**Every other failure names its own recovery.** `recoveryFor` maps each
`LinearServiceFailureCode` onto what to do next, because the one thing these codes
share is that retrying the identical call is right for exactly one of them:
`rate-limited` gets the retry window when Linear supplied one and "get on with
other work" when it did not, `permission-denied` says not to retry at all and to
report it, `invalid-request` sends the ids back through `getMetadata`, and
`network` allows exactly one retry. `not-found` names every id it could have come
from — `stateId` and `assigneeId` miss as often as `issueId` — rather than only
the issue.

**Payloads are budgeted like the workspace diff.** Every result is fitted to
`MAX_AGENT_PAYLOAD_CHARS` and says what it cut: `listIssues` returns no
descriptions at all (a hundred issues carrying theirs is what turns a list into a
context spend) and reports `omittedIssues`; `getIssue` clamps the description,
keeps the most recent comments, and reports `omittedComments`; `getMetadata`
fills one shared budget in priority order — states, teams, users, projects,
labels — so a workspace with hundreds of labels cannot crowd out the states an
update needs. `getMetadata` returns no cycle rows, because no op here sets one;
`getIssue` does report the cycle an issue is *in*, which is schedule context an
agent reads rather than a field it writes.

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

**Several accounts can be connected at once, and ids never cross between them.**
`accountId` is optional everywhere: a read resolves it from the entity named (a
cached issue, a team's owning account), then from the workspace's own linked
issue, then from the only account there is. The order matters and is enforced,
not just documented — the workspace's account is passed to the service as
`fallbackAccountId` and applied strictly *after* the entity lookup, so a
workspace's organization can never quietly win over the issue an agent actually
named. `listIssues` is the deliberate exception and merges every account by
default, because seeing both organizations at once is what a search is for. When
resolution is genuinely ambiguous — an identifier such as `ENG-1` existing in two
organizations — the op refuses and lists the accounts on the result rather than
guessing one.

### The linked-issue directive

Having the tools is not the same as using them. A workspace created from an issue
persists that issue on its own metadata, and for as long as nothing told the agent
so, every state change happened because the user asked for one by hand — which is
the same as it not happening. What was missing was never a capability; it was the
*fact*.

`buildLinkedIssueDirective` (`src/shared/agent-control/linked-issue-directive.ts`)
renders that fact as a standing block: the identifier, the title, the `accountId`
every write has to be scoped to, and one named trigger per lifecycle step — read
the issue before changing code, move it to a started state and take the assignee
slot when implementation begins, comment when something is settled, move it to
`In Review` the moment the work is reviewable. A trigger is what produces the
behaviour; a description of what a tool does produces nothing.

It is rendered by the app rather than written into a playbook for the same reason
the language directive and the upkeep block are: the shipped Pi extension carries
byte-identical copies of the playbooks that a parity test polices, and those
copies must stay flat literals, so a block built from live state has no literal to
compare. It also means Plan Mode cannot lose it — the plan-mode playbooks replace
the role playbook, and this rides after whichever one won.

**Both axes that decide what an agent may do to a tracker are arguments**, so the
block never names a call the caller would be refused. A spawned sub-agent is
denied `linearCreateComment` and `linearUpdateIssue`, so its variant asks it to
name the state it thinks the issue should be in *in its report*; a planning root is
denied `linearUpdateIssue`, so its variant keeps the read and the comment and says
to put the target state in the plan. Role wins over mode, because a planning
sub-agent is denied strictly more.

Three channels carry it, matching the three the language directive uses:
`getSessionBrief` (Pi, spliced by the extension as `issueDirective`),
`readTurnPreamble` (the runtimes the app prompts directly), and the MCP server's
`instructions` plus the harness playbook file (callers with no per-turn hook). The
playbook file is written **per workspace** for this block's sake — one shared file
would hand every harness whichever workspace launched last.

A workspace linked to a **GitHub** issue gets no block. There is no GitHub issue op
on this surface, so a directive there would state an obligation with no tool that
could discharge it.

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
