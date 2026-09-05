# Ensemblr Control — the `ensemblr_*` tools

The permission-gated surface that lets you drive the app you are running in.
Every op validates its arguments, resolves your identity from a per-workspace
bearer token, checks scope and the workspace permission mode, applies the
delegation guardrails, and then delegates to a service that already exists.
Control adds no capability of its own — it is a gate, not a feature.

## The tools

**Conversations and delegation** — `ensemblr_start_conversation`,
`ensemblr_spawn_chat_tab`, `ensemblr_send_follow_up`, `ensemblr_wait_for_agents`,
`ensemblr_notify_orchestrator`, `ensemblr_close_tab`.

**Harnesses, terminals, run scripts** — `ensemblr_launch_harness`,
`ensemblr_start_terminal`, `ensemblr_stop_terminal`, `ensemblr_write_terminal`,
`ensemblr_read_terminal_output`, `ensemblr_list_run_scripts`.

**Tabs, focus, the board** — `ensemblr_open_tab`, `ensemblr_focus_tab`,
`ensemblr_focus_dock_tab`, `ensemblr_focus_panel`, `ensemblr_get_workspace_status`,
`ensemblr_set_workspace_status`.

**Naming and the session record** — `ensemblr_set_name`,
`ensemblr_set_branch_name`, `ensemblr_set_summary`.

**Inventory and reading** — `ensemblr_list_workspaces`, `ensemblr_list_tabs`,
`ensemblr_list_terminals`, `ensemblr_list_models`,
`ensemblr_get_conversation_status`, `ensemblr_get_last_message`,
`ensemblr_read_conversation`.

**Review** — `ensemblr_get_workspace_diff`, `ensemblr_get_diff_comments`,
`ensemblr_add_diff_comments`, `ensemblr_resolve_diff_comments`.

**Linear** — `ensemblr_linear_list_issues`, `ensemblr_linear_get_issue`,
`ensemblr_linear_get_metadata`, `ensemblr_linear_create_comment`,
`ensemblr_linear_create_issue`, `ensemblr_linear_update_issue`.

**The user, and planning** — `ensemblr_ask_user_question`,
`ensemblr_exit_plan_mode`.

**Upward** — `ensemblr_message_concierge` reaches the app-level agent that briefs
workspace agents, for the things it cannot see from where it sits: you are
blocked on something outside this workspace, the brief it gave you is wrong, the
work belongs in another repository, or you have finished. You pass no session id
— its conversation is cleared and restarted routinely, so the app resolves the
live one at send time. Refused outright when none is open (it is not queued), and
capped per conversation. `ensemblr_notify_orchestrator` is the sub-agent's
equivalent one level down.

Not every caller holds every tool. A spawned sub-agent may not delegate onward
and may not write to Linear; a terminal harness holds no chat-tab tools; Plan
Mode withholds anything that would perform the work rather than plan it. What
you actually hold is whatever your tool list shows — that list is the answer,
not this page.

## One argument vocabulary

Argument keys are deliberately shared across ops: one concept, one word,
everywhere. The ones worth memorising because a synonym feels natural:

| Key | Carries | Not |
| --- | --- | --- |
| `title` | the label of a tab, a plan, an artifact | `name` |
| `name` | the identity of a durable addressable thing — the workspace and its branch, a run script | `title` |
| `filePath` | a workspace-relative path, e.g. `src/main/main.ts` | `file`, `path` |
| `agentSessionId` | one agent conversation | `sessionId` |
| `chatTabId` | one chat tab in the workspace | `tabId` |
| `issueId` | a tracker issue id **or** its human key, e.g. `ENG-106` | — |
| `message` | prose addressed to a human or to your orchestrator | — |
| `scriptName` | which run script to start | — |

## Reading an answer

Nothing throws across the boundary. A failure comes back as a payload with a
stable code and a human-readable reason:

`invalid-args`, `denied-permission`, `denied-scope`, `denied-depth`,
`denied-quota`, `denied-rate`, `denied-deadlock`, `not-found`, `conflict`,
`timeout`, `internal`.

Linear ops answer with their own `status` word instead:

| `status` | Means |
| --- | --- |
| `ok` | the call succeeded |
| `not-connected` | **the user has not linked Linear at all.** Not an empty result, and retrying will never change it |
| `not-found` | the id resolved to nothing |
| `refused` | policy declined it — most often a target state whose Linear type is `completed` or `canceled` |
| `failed` | the request reached Linear and failed there |

`conflict` on `ensemblr_start_terminal` means a script of that kind already
holds the slot; the refusal names the terminal holding it, and `restart: true`
replaces it.

**Results are capped at 32,000 characters** and report what they cut. That is
why `ensemblr_get_workspace_diff` takes `stat: true` (which files changed, and
how large) and `filePath` (one file at a time) — call it with `stat: true`
first, then read what you actually need.

## Delegation

Do the work yourself by default. Delegate only when the task genuinely splits
into two or more independent, substantial workstreams.

The guardrails, so you know what a denial means:

| Limit | Default |
| --- | --- |
| Nesting depth | 1 — only you, the root, may spawn; children never delegate onward |
| Spawns per session | 20 |
| Spawns per minute | 10 |
| One blocking wait | 300 s, then it returns `timedOut` |

A blocking wait whose target is an ancestor of the caller is refused
(`denied-deadlock`).

The loop is **delegate → wait → evaluate → integrate**:

1. `ensemblr_start_conversation` per helper, each in a fresh tab with its own
   `title`. Omit `chatTabId` — reusing a tab keeps its old title. Keep the
   `agentSessionId` it returns. Brief each with *what to deliver*, the defaults
   it should assume rather than ask about, and whether it reports inline or
   writes a file at a path you name.
2. `ensemblr_wait_for_agents` — `mode: "all"` blocks until every child settles;
   `mode: "first"` (the default) returns on the first. Never hand-roll a polling
   loop over `ensemblr_get_conversation_status`.
3. `timedOut: true` with children still in `pending` is a lap of the loop, not a
   fault. Wait again on the pending ids. Do not re-spawn, and do not report it
   to the user as a problem.
4. Verify before you rely: open the path a child cited and read it yourself.
   `ensemblr_read_conversation` replays a child's actual tool calls when the
   claim is about what it *did* rather than what a file says.
5. Batch the children's open questions into one `ensemblr_ask_user_question`
   before you answer — up to 4 questions, 2–6 options each, your recommendation
   in the option descriptions.

A child's last message is its report, and it is persisted permanently — it
survives the child closing and an app restart. A `closed` or `idle` child is not
lost work: read it with `ensemblr_get_last_message`.

A child that cannot produce its deliverable until someone answers calls
`ensemblr_notify_orchestrator` with `need_decision` or `blocked`, which wakes a
pending wait whatever its mode. Ordinary open decisions do not arrive that way —
children park those in their reports.

## Asking the user

`ensemblr_ask_user_question` blocks with **no time limit**: it stays open until
the user answers or dismisses it, however long that takes. Never plan around it
expiring, and never hedge an answer you have not been given. Use it when a
decision is genuinely theirs — ambiguous requirements, a fork in the approach, a
destructive step — not for anything you could settle by reading the repository.

## Plan Mode

A per-chat toggle that holds you to planning, enforced per tool call rather than
requested in the prompt. Reads stay; anything that performs the work is refused.
A sub-agent spawned by a planning agent inherits it. Nothing turns it off except
the user approving a plan, submitted with `ensemblr_exit_plan_mode` — which ends
your turn, so produce nothing after it.

The app's own bookkeeping stays allowed while you plan: naming the tab, naming
the workspace and branch, recording the summary. Those label the work rather
than starting it.
