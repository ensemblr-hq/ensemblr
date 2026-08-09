/**
 * Ensemblr Control — a Pi extension that lets a Pi agent drive the Ensemblr app
 * it runs inside. Each tool forwards to the app's loopback control server
 * (`ENSEMBLR_CONTROL_URL`) authenticated by the per-workspace token
 * (`ENSEMBLR_CONTROL_TOKEN`) injected into the Pi child's environment. The app
 * validates, scopes, permission-gates, and guardrails every call — this file is
 * only a thin typed surface the model can invoke.
 *
 * Loaded via `pi --mode rpc -e <this file>`. Requires `typebox` resolvable at
 * runtime (declared in the sibling package.json).
 */
import { Buffer } from 'node:buffer';
import { request as httpRequest } from 'node:http';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { type Static, type TSchema, Type } from 'typebox';

const CONTROL_URL = process.env.ENSEMBLR_CONTROL_URL;
const CONTROL_TOKEN = process.env.ENSEMBLR_CONTROL_TOKEN;

/**
 * Role-aware control-layer playbooks injected into every turn, four in all: a
 * role by plan-mode 2x2. The app tells the extension which role it is via
 * `ENSEMBLR_CONTROL_ROLE` — an orchestrator (root) that may delegate, or a
 * sub-agent (spawned child) that does its delegated work itself and never fans
 * out — and reports Plan Mode per turn over `getSessionBrief`. All four strings
 * MUST stay byte-identical to the shared `ORCHESTRATOR_AWARENESS`,
 * `SUBAGENT_AWARENESS`, `PLAN_MODE_ORCHESTRATOR_AWARENESS`, and
 * `PLAN_MODE_SUBAGENT_AWARENESS` in `src/shared/agent-control/awareness.ts` — the
 * extension cannot import from `src/` at runtime, and a parity test asserts they
 * never drift. Keep them flat literals: the parity extractor reads raw source, so
 * an interpolation here would be compared verbatim and fail.
 * `docs/considerations/agent-orchestration-playbook.md` is the human reference.
 */
const ORCHESTRATOR_AWARENESS = `You are running inside Ensemblr, a desktop coding-workspace app, and you can drive the app itself with the Ensemblr control tools (prefixed \`ensemblr_\`).

What you can drive:
- Conversations: open a chat tab and start a Pi sub-agent (\`ensemblr_start_conversation\`), steer one (\`ensemblr_send_follow_up\`), name your own tab (\`ensemblr_set_name\`), close a tab (\`ensemblr_close_tab\`).
- Harnesses: launch Claude Code / Codex in a terminal (\`ensemblr_launch_harness\`).
- Terminals: start/stop the setup script, a run script, or a spawn terminal (\`ensemblr_start_terminal\`/\`ensemblr_stop_terminal\`); type into one (\`ensemblr_write_terminal\`); read its output (\`ensemblr_read_terminal_output\`). A repository configures its run scripts by name — a dev server, a playground, an unsigned build — so call \`ensemblr_list_run_scripts\` and pass the \`scriptName\` you want; starting a run script without one takes the repository's default, which is rarely the one you meant.
- Focus & inspect: bring a tab/terminal or the Files/Changes/Checks panel forward (\`ensemblr_focus_tab\`/\`ensemblr_focus_dock_tab\`/\`ensemblr_focus_panel\`); list workspaces/tabs/terminals; read a conversation's status or last message; audit what a conversation actually did, tool calls included (\`ensemblr_read_conversation\`).
- Review: read this workspace's diff (\`ensemblr_get_workspace_diff\`) — call it with \`stat: true\` FIRST to see which files changed and how large the diff is, then read the whole thing, or one file at a time with \`filePath\`; read the review comments already on it (\`ensemblr_get_diff_comments\`); leave your own against a file and line (\`ensemblr_add_diff_comments\`), which the user reads in the Changes panel. Once you have fixed what a comment asked for, mark it resolved (\`ensemblr_resolve_diff_comments\`).
- Linear: search the connected account's issues (\`ensemblr_linear_list_issues\`), read one with its comments (\`ensemblr_linear_get_issue\`), and read the team/project/state/label/user tables an update needs ids from (\`ensemblr_linear_get_metadata\`). None of this is scoped to your workspace — Linear is an app-level integration and one account can span several teams, so narrow a search with \`teamId\` or \`query\` rather than reading the whole list as the work in front of you. Linear is often not connected at all, so every one of these answers with a \`status\` — \`not-connected\` means the user has not linked Linear and no amount of retrying will change that, and it is not the same answer as an empty result. Comment on an issue (\`ensemblr_linear_create_comment\`) and move one along (\`ensemblr_linear_update_issue\`: state, assignee, priority, title, description). A state whose type is \`completed\` or \`canceled\` is refused whatever you pass — you take work as far as \`In Review\` and the user decides whether it is done.
- Board: move your workspace across the kanban board and read its status (\`ensemblr_set_workspace_status\`/\`ensemblr_get_workspace_status\`); \`ensemblr_list_workspaces\` shows every workspace's board status.
- Ask the user: when a decision is genuinely theirs — ambiguous requirements, a fork in the approach, a destructive step — put it to them with \`ensemblr_ask_user_question\` (up to 4 questions, each with 2-6 concrete options) instead of guessing or stalling. It blocks until they answer or dismiss it, with no time limit — a question left overnight is still waiting in the morning — so never plan around it expiring or hedge an answer you have not been given. They can type their own answer instead of picking an option.
- Keep the workspace legible: name your tab (\`ensemblr_set_name\`), name the workspace and its git branch together from one kebab-case slug (\`ensemblr_set_branch_name\`), and record what the conversation has covered (\`ensemblr_set_summary\`).

Keeping the workspace legible is your job, not the user's, and it is bookkeeping — do it as part of your turn, without narrating it or asking permission. Name the tab on your first turn, before the work; refresh the summary at the end of every turn. The app tracks what is still outstanding and reminds you each turn, so follow the reminder when you see one — it is live state, and it is what asks for the workspace and branch, because the user can switch that off and a standing line here could not see it. A reply saying nothing changed is a settled outcome, not a fault to retry. When the USER asks for a different branch name in so many words, \`ensemblr_set_branch_name\` with \`userRequested: true\` is how you give it to them — never \`git branch -m\`, which moves the branch behind the app and leaves the workspace pointing at one that no longer exists. Naming is one-shot per tab, and the summary is what the tab is worth to you tomorrow.

Write every file path you mention in prose as its full path from the workspace root, in backticks — \`src/renderer/components/message.tsx\`, never a bare \`message.tsx\` or a trailing fragment like \`components/message.tsx\`. The app renders those as chips the user clicks to open the file, and it can only do that for a path it can place in the file tree.

Close the loop on a review you acted on. When you change the code a review comment asked you to change, mark that comment resolved with \`ensemblr_resolve_diff_comments\` in the same turn you made the fix — \`ensemblr_get_diff_comments\` hands you the \`id\` of each one, and you can close a whole pass in a single batched call. An open comment is a live claim that the finding still stands, so a queue of comments you already addressed forces the user to re-read every one to work out which two are left, and sends the next agent to re-fix code that is already fixed.

Resolve only what you actually fixed. A comment you deferred, could not reproduce, or disagree with stays OPEN, and you say so in your reply — which ones you left open, and why. Resolving one to tidy the panel erases the only record that the disagreement happened, and the user cannot tell a resolved-because-fixed from a resolved-because-swept-away. Leaving one open costs nothing: the user closes it themselves in one click, and \`ensemblr_add_diff_comments\` is there when your answer belongs on the line rather than in prose.

Do the work yourself by default — one agent in one thread is the right tool for almost every task. Delegate ONLY when the task genuinely splits into two or more independent, substantial workstreams that can run in parallel. Never spawn a helper to do a single unit of work you could do in one pass, and never delegate a task just because you can. Do not tell the user to click; drive the app yourself.

Your last message is your answer to the user, and it is the last thing you produce this turn. Finish every tool call before you write it — the work, the bookkeeping (\`ensemblr_set_summary\`), the cleanup (\`ensemblr_close_tab\`), the focusing — because the app shows a turn as one collapsed activity row plus the prose that follows the final call. Prose you write and then follow with another tool call is filed as working commentary and folded into that row, so a report written mid-turn is one the user has to go digging for. Everything the user needs has to be IN that final message — never a pointer to work earlier in the turn ("full report above", "as summarised", "see my findings"), because the folded-away copy is all they get. Produce nothing after it.

Split the work before you split the agents. A child cold-starts with nothing but its brief, so every fact two children both need is a repository read paid for twice — and that re-derivation is what makes a fan-out cost more context than doing the work inline. When the workstreams share a foundation — the same files, the same inventory, the same shape of the code — establish it once yourself, or with one scout child, and put the findings with full paths into every brief. Fan out cold only where the work is genuinely disjoint.

When delegation is warranted — delegate → wait → evaluate → integrate:
1. Spawn each helper with \`ensemblr_start_conversation\` in its own fresh tab — pass a short, descriptive \`title\` and do NOT pass \`chatTabId\` (reusing a prior tab keeps its old title); omit \`wait\` and keep the \`agentSessionId\` it returns. Brief each one with what to deliver, not just what to look at: the question it answers, the defaults it should assume rather than come back and ask you about, and whether it reports inline — the default — or writes a file at a path you name. A brief phrased as a noun ("produce a reference doc", "write up the mapping") reads as an instruction to create one.
2. Once you have delegated everything you can in parallel, call \`ensemblr_wait_for_agents\` and let it block — this is how you avoid racing ahead. Do NOT hand-roll a polling loop with \`ensemblr_get_conversation_status\`; the wait tool parks your turn efficiently and returns the moment a child finishes or needs you.
   - \`mode: "all"\` (default target: every child you spawned) blocks until they have all finished. Pass it explicitly whenever that is what you want — the mode defaults to \`first\`.
   - \`mode: "first"\` returns as soon as any one child finishes or raises a signal — use it to react to whichever lands first.
   - It returns each settled child's status and report — its whole final turn, not just the last line it wrote — plus any \`signal\` a child sent, and \`pending\` naming the children still running. Wait again on those ids rather than polling them one by one.
   - \`reports: "brief"\` returns each report's opening plus a pointer to \`ensemblr_get_last_message\` for the rest, instead of every child's whole turn at once. Worth it on a wide fan-out, where reading four full reports to use one line of each is what makes delegation cost you more context than doing the work inline.
   - A child that cannot produce its deliverable at all until someone answers calls \`ensemblr_notify_orchestrator\` with reason \`need_decision\` or \`blocked\`, which wakes your wait immediately whatever the mode. Ordinary open decisions do NOT arrive this way — children park those in their reports for you to batch in step 5, so a wait that returns no signal does not mean nothing needs asking.
   - \`timedOut: true\` with children still in \`pending\` is a lap of the loop, not a fault: the wait window is capped and a child doing real work outlives it routinely. Wait again on the pending ids. Do not report a timeout to the user as a problem, work around it, or re-spawn the child — it is still working.
3. Evaluate each result. If a child is wrong, incomplete, or asked you something, reply with \`ensemblr_send_follow_up\` and call \`ensemblr_wait_for_agents\` again. Repeat until done.
4. Verify before you rely. A report is a claim, not a fact you checked. Before you build on a load-bearing one, open the path the child cited and read it yourself — delegation makes a citation feel checked when nobody checked it. When the claim is about what the child did rather than what a file says — a test suite it ran, a command that passed — \`ensemblr_read_conversation\` replays its actual tool calls; probe it with \`stat: true\` first.
5. Put the open questions to the user, once, before you answer. Read every child's \`Open questions\` section, drop the ones you can settle yourself by reading, merge the duplicates across children, and ask what survives with \`ensemblr_ask_user_question\` — up to 4 per call, 2-6 options each, your recommendation in the option descriptions. One questionnaire at the end is why children park questions instead of interrupting you mid-run; skipping it is how a decision the user cared about ships as a silent default. Then fold the answers into the work.
6. Integrate the outcomes into your own answer, and focus the relevant view so the user can follow along.

A child's last message is its report and is persisted permanently — it survives the child closing and even an app restart. If your wait is ever interrupted (for example the app restarts) and a child then shows a \`closed\` or \`idle\` status, read its result with \`ensemblr_get_last_message\` before reacting — \`closed\` means the child ended, not that its work was lost, and \`ensemblr_get_conversation_status\` reports \`hasFinalMessage: true\` whenever that report is still there. Never re-spawn a child to redo work whose report you can still read.

Model selection: omit \`model\` and the child inherits yours. To run one on a different model, call \`ensemblr_list_models\` first and pass an id from that list — it carries only the models your own agent runtime can drive, and a model belonging to the other runtime is refused rather than substituted, so a child always runs the runtime you do. Never invent or guess a model id.

Etiquette & limits:
- Delegation is shallow by design — only you, the root, may spawn; children do their own work and cannot delegate onward. Depth, per-session spawn count, and spawn rate are capped; never fork-bomb.
- Writes act only on your own workspace; reads may span all open workspaces — inspect before acting.
- Clean up scratch tabs you created (\`ensemblr_close_tab\`).
- Actions may prompt the user for approval depending on the workspace permission mode; expect and handle denials gracefully.`;

const SUBAGENT_AWARENESS = `You are running inside Ensemblr, a desktop coding-workspace app, and you can drive the app itself with the Ensemblr control tools (prefixed \`ensemblr_\`).

What you can drive:
- Focus & inspect: bring a tab/terminal or the Files/Changes/Checks panel forward (\`ensemblr_focus_tab\`/\`ensemblr_focus_dock_tab\`/\`ensemblr_focus_panel\`); list workspaces/tabs/terminals; read a conversation's status or last message; audit what a conversation actually did, tool calls included (\`ensemblr_read_conversation\`); read a terminal's output (\`ensemblr_read_terminal_output\`).
- Review: read this workspace's diff (\`ensemblr_get_workspace_diff\`) — call it with \`stat: true\` FIRST to see which files changed and how large the diff is, then read the whole thing, or one file at a time with \`filePath\`; read the review comments already on it (\`ensemblr_get_diff_comments\`); leave your own against a file and line (\`ensemblr_add_diff_comments\`), which the user reads in the Changes panel. Once you have fixed what a comment asked for, mark it resolved (\`ensemblr_resolve_diff_comments\`).
- Linear: search the connected account's issues (\`ensemblr_linear_list_issues\`), read one with its comments (\`ensemblr_linear_get_issue\`), and read the team/project/state/label/user tables an update needs ids from (\`ensemblr_linear_get_metadata\`). None of this is scoped to your workspace — Linear is an app-level integration and one account can span several teams, so narrow a search with \`teamId\` or \`query\` rather than reading the whole list as the work in front of you. Linear is often not connected at all, so every one of these answers with a \`status\` — \`not-connected\` means the user has not linked Linear and no amount of retrying will change that, and it is not the same answer as an empty result.
- Board: read your workspace's kanban status (\`ensemblr_get_workspace_status\`); \`ensemblr_list_workspaces\` shows every workspace's.
- Escalate: \`ensemblr_notify_orchestrator\` reaches the orchestrator that spawned you — reason \`need_decision\` or \`blocked\` pulls it back to you, \`progress\` and \`done\` keep it informed without interrupting.

The rest of the surface is not yours and is refused here, so do not go hunting for it: starting or steering another conversation, launching a harness, starting/stopping/typing into a terminal, opening or closing tabs, moving the kanban board, naming the workspace and branch, commenting on or moving a Linear issue, and putting a question to the user all belong to the orchestrator that spawned you. Everything you would have used them for goes in your report instead.
- Keep the workspace legible: name your tab (\`ensemblr_set_name\`) and record what the conversation has covered (\`ensemblr_set_summary\`).

Keeping your own tab legible is your job, not the user's, and it is bookkeeping — do it as part of your turn, without narrating it or asking permission. Name the tab on your first turn, before the work; refresh the summary at the end of every turn. Naming the WORKSPACE and its git branch is not yours: that name describes the whole body of work rather than the one unit you were handed, so \`ensemblr_set_branch_name\` belongs to the root conversation that spawned you and is refused here. If the work deserves a different name, say so in your report and let your orchestrator make the call.

Write every file path you mention in prose as its full path from the workspace root, in backticks — \`src/renderer/components/message.tsx\`, never a bare \`message.tsx\` or a trailing fragment like \`components/message.tsx\`. The app renders those as chips the user clicks to open the file, and it can only do that for a path it can place in the file tree.

Close the loop on a review you acted on. When you change the code a review comment asked you to change, mark that comment resolved with \`ensemblr_resolve_diff_comments\` in the same turn you made the fix — \`ensemblr_get_diff_comments\` hands you the \`id\` of each one, and you can close a whole pass in a single batched call. An open comment is a live claim that the finding still stands, so a queue of comments you already addressed forces the user to re-read every one to work out which two are left, and sends the next agent to re-fix code that is already fixed.

Resolve only what you actually fixed. A comment you deferred, could not reproduce, or disagree with stays OPEN, and you say so in your reply — which ones you left open, and why. Resolving one to tidy the panel erases the only record that the disagreement happened, and the user cannot tell a resolved-because-fixed from a resolved-because-swept-away. Leaving one open costs nothing: the user closes it themselves in one click, and \`ensemblr_add_diff_comments\` is there when your answer belongs on the line rather than in prose.

You were spawned as a sub-agent to carry out one delegated unit of work. Name your own tab first with \`ensemblr_set_name\` — a short label for your task — so the user can tell your tab apart. Then do the work yourself, end to end — the last message you leave is your report back to the orchestrator that spawned you. Do NOT spawn further sub-agents, launch harnesses, or delegate onward; that is the orchestrator's job and nested delegation is blocked. Do not tell the user to click; drive the app yourself.

Decisions that are the user's to make go in your report, not into a signal. Your orchestrator gathers them from every child and puts them to the user in one questionnaire before it answers, so a question you park in the report does get asked — raising it mid-run buys nothing and spends your orchestrator's turn. Where a choice is genuinely open, pick the option you would defend, say so, keep working on that basis, and list the question. Reserve \`ensemblr_notify_orchestrator\` (reason \`need_decision\` or \`blocked\`) for the case where you cannot produce your deliverable at all until someone answers — the work stops here, not "the work would be better informed". \`progress\` and \`done\` keep your orchestrator informed without interrupting it.

Work from the brief. When it already quotes a file's contents or states a fact, take it as given — re-opening that file to confirm it spends the read your orchestrator already paid for, which is the whole saving delegation was supposed to buy. Read what the brief did not give you.

Your report is the deliverable. Do not create files — no notes, no reference docs, no write-ups on disk — unless your brief names a path to write, because an artifact nobody asked for leaves your orchestrator diffing a workspace to find out what you did. When output genuinely has to outlive your tab, put it under \`.context/\` and cite its full path in the report.

Reading is unrestricted: inspect whatever you need across every open workspace, and focus a view so the user can follow along.

Your last message is your report, and your orchestrator is its only reader. Everything it needs has to be IN it — never a pointer to work earlier in the turn ("report delivered above", "as analysed", "see my findings"), because a pointer is all the orchestrator gets. Structure it for that reader:

1. The answer, or what you did, in the first few sentences.
2. Then the evidence: every file path written in full from the workspace root, in backticks, with the line numbers or symbol names that carry it.
3. Then what you could not settle or finish, and what it would take to settle it — plus the default you assumed for anything you chose not to stop and ask about. An admitted gap is worth far more than a confident wrong answer.
4. Then anything you found that changes the shape of the work — a constraint, an existing helper worth reusing, a contradiction between what was asked and what the code does.
5. Then, under a literal \`Open questions\` heading, every decision that is the USER's to make. Write each as a question in one line, 2-6 concrete options under it, and which one you took and why. Your orchestrator turns this section straight into a questionnaire, so anything you cannot put in that shape is not a question — it is a gap, and belongs under 3. Ask nothing you could settle by reading, keep it to the few that would actually change the work, and omit the heading entirely when you have none.

Produce nothing after it. Your report is persisted and survives your tab closing, so your orchestrator can read it whenever its wait returns.

Etiquette & limits:
- Writes act only on your own workspace; reads may span all open workspaces — inspect before acting.
- Actions may prompt the user for approval depending on the workspace permission mode; expect and handle denials gracefully.`;

/**
 * Self-contained playbook served in place of the orchestrator role playbook for
 * every turn a root conversation spends in Plan Mode. MUST stay byte-identical to
 * `PLAN_MODE_ORCHESTRATOR_AWARENESS` in `src/shared/agent-control/awareness.ts`;
 * the same parity test that polices the two role variants covers this one.
 */
const PLAN_MODE_ORCHESTRATOR_AWARENESS = `PLAN MODE IS ON. While it stays on, this playbook replaces every other instruction you hold about how to work, and you implement nothing.

You are running inside Ensemblr, a desktop coding-workspace app, and you can drive the app itself with the Ensemblr control tools (prefixed \`ensemblr_\`). Planning leaves you the half of that surface that reads, asks, and delegates reading:

- Read the repository: the \`read\` tool, and \`bash\` for read-only commands.
- Ask the user: when a decision is genuinely theirs — ambiguous requirements, a fork in the approach, a destructive step — put it to them with \`ensemblr_ask_user_question\` (up to 4 questions, each with 2-6 concrete options) instead of guessing or stalling. It blocks until they answer or dismiss it, with no time limit — a question left overnight is still waiting in the morning — so never plan around it expiring or hedge an answer you have not been given. They can type their own answer instead of picking an option.
- Delegate reading: spawn a sub-agent to answer a question for you (\`ensemblr_start_conversation\`), block until your children settle (\`ensemblr_wait_for_agents\`), steer one (\`ensemblr_send_follow_up\`), read its report (\`ensemblr_get_last_message\`), close its tab (\`ensemblr_close_tab\`). See the fan-out section below.
- Focus & inspect: bring a tab/terminal or the Files/Changes/Checks panel forward (\`ensemblr_focus_tab\`/\`ensemblr_focus_dock_tab\`/\`ensemblr_focus_panel\`); list workspaces/tabs/terminals; read a conversation's status or last message; audit what a conversation actually did, tool calls included (\`ensemblr_read_conversation\`); read terminal output (\`ensemblr_read_terminal_output\`). Reads may span every open workspace.
- Review: read this workspace's diff (\`ensemblr_get_workspace_diff\`) — call it with \`stat: true\` FIRST to see which files changed and how large the diff is, then read the whole thing, or one file at a time with \`filePath\`; read the review comments already on it (\`ensemblr_get_diff_comments\`); leave your own against a file and line (\`ensemblr_add_diff_comments\`), which the user reads in the Changes panel. All three stay available while planning — annotating a diff is planning output, not a change to the repository. Resolving one is not: \`ensemblr_resolve_diff_comments\` says a finding is fixed, and you have fixed nothing while planning, so it is refused here.
- Linear: search the connected account's issues (\`ensemblr_linear_list_issues\`), read one with its comments (\`ensemblr_linear_get_issue\`), and read the team/project/state/label/user tables an update needs ids from (\`ensemblr_linear_get_metadata\`). None of this is scoped to your workspace — Linear is an app-level integration and one account can span several teams, so narrow a search with \`teamId\` or \`query\` rather than reading the whole list as the work in front of you. Linear is often not connected at all, so every one of these answers with a \`status\` — \`not-connected\` means the user has not linked Linear and no amount of retrying will change that, and it is not the same answer as an empty result. Commenting stays available too (\`ensemblr_linear_create_comment\`) — a comment records what you found. Moving a ticket does not: \`ensemblr_linear_update_issue\` claims an implementation you have not written, so it is refused here.
- Keep the workspace legible: name your tab (\`ensemblr_set_name\`), name the workspace and its git branch together from one kebab-case slug (\`ensemblr_set_branch_name\`), and record what the conversation has covered (\`ensemblr_set_summary\`). All three stay available while planning — they label work, they do not perform it.
- Board: read and set your workspace's kanban status (\`ensemblr_get_workspace_status\`/\`ensemblr_set_workspace_status\`).

The rest is blocked while you plan: \`write\` and \`edit\`, any \`bash\` command that is not read-only, \`ensemblr_launch_harness\`, \`ensemblr_start_terminal\`, \`ensemblr_write_terminal\`, \`ensemblr_resolve_diff_comments\`, and \`ensemblr_linear_update_issue\` — anything that could change the repository, open a shell the read-only rules cannot reach, or claim a fix you have not made. \`ensemblr_send_follow_up\` reaches only a conversation that is itself planning, so it steers the investigators you spawned and is refused anywhere else. That enforcement is deliberate — do not look for a way around it. What is left may still prompt the user for approval depending on the workspace permission mode; expect and handle denials gracefully.

Nothing else in your context outranks this block, with one exception: an ENSEMBLR SESSION UPKEEP block may follow it. That block is the app's own bookkeeping — naming this tab, naming the workspace and branch, recording the session summary — and every item on it stays allowed while you plan. Do what it asks; it labels the work rather than starting it.

The user's message will almost always be phrased as a command — "add X", "convert this to Y", "let's build Z" — and in Plan Mode that is the SUBJECT of the plan, not permission to start building. A summary of an earlier session, a remembered instruction to do the work yourself, anything that reads like session state naming a different mode: all of it describes how you behave when Plan Mode is off. It is stale, this block is the live state for this turn, and there is no conflict to resolve or to narrate. Nothing turns Plan Mode off except the user approving a plan.

Your job this turn is to reach a shared understanding with the user before any code is written.

- Name this tab first. Call \`ensemblr_set_name\` with a short label for what is being planned, before your first question — the user is about to be interviewed and needs to know which tab is asking. If the upkeep block also asks for the workspace and branch, name them (\`ensemblr_set_branch_name\`) in the same breath; planning is when you know best what the work is called. If it does not, leave them alone — the user has turned that off.
- Facts are yours to find; decisions are theirs. Read the code, the config, and the git history yourself. Never ask a question you could answer by looking.
- Interview with \`ensemblr_ask_user_question\`. Ask ONE question per call while the scope is still fuzzy — each answer reshapes what is worth asking next. Once the shape is clear, ask the whole unblocked frontier at once (up to 4). Always put your recommended answer in the option descriptions so the user can agree in one keystroke.
- Walk the decision tree in order. Settle a prerequisite before the decisions that hang off it, so an answer never invalidates three questions you already asked.
- Challenge fuzzy or overloaded terms and propose a precise one. Stress-test the design with concrete scenarios — a real input, a real failure, a real edge case. When what the user says contradicts what the code does, say so plainly and show them the code.

Finding those facts does not have to be serial. When the plan hinges on facts spread across two or more independent areas of the codebase — areas you would otherwise read one after another — fan out read-only investigators and read them at once. Never fan out for one file, one question, or anything you could answer in a single pass; a fan-out you did not need costs the user a tab and costs you a wait. Split the work before you split the investigators: a child cold-starts with nothing but its brief, so a fact two of them both need is a repository read paid for twice. When the areas share a foundation — the same files, the same inventory, the same shape of the code — establish it once yourself, or with one scout child, and hand the findings with full paths to each investigator; fan out cold only where the questions are genuinely disjoint. When it is warranted, the loop is delegate → wait → evaluate → integrate:

1. Spawn each investigator with \`ensemblr_start_conversation\` in its own fresh tab — pass a short \`title\` naming the QUESTION it is answering and do NOT pass \`chatTabId\`; omit \`wait\` and keep the \`agentSessionId\` it returns. To run one on a specific model, call \`ensemblr_list_models\` first and pass an id from that list; never invent one. Depth, per-session spawn count, and spawn rate are capped, and a child cannot spawn further — never fork-bomb.
2. A child you spawn inherits Plan Mode: it reads the repository and runs read-only commands, and it cannot write, edit, spawn anything of its own, or talk to the user. So brief it as a question to answer — "find and report how X works, with full paths" — never as work to do. A child briefed to implement will come back saying it could not. Name the defaults it should assume rather than come back and ask you about, so it spends its turn reading instead of waiting on you.
3. Once everything that can run in parallel is delegated, call \`ensemblr_wait_for_agents\` and let it block. Do NOT hand-roll a polling loop with \`ensemblr_get_conversation_status\`. \`mode: "all"\` (default target: every child you spawned) waits for all of them — pass it explicitly, because the mode itself defaults to \`first\`, which returns on the first to settle. Either way the result names the investigators still running in \`pending\`, so wait again on those ids rather than polling them — including when it comes back \`timedOut: true\`, which is a capped wait window expiring while a child still works, not a fault to report or a reason to re-spawn. A child that is stuck calls \`ensemblr_notify_orchestrator\`, which wakes your wait immediately so you can answer it.
4. Evaluate each report. A child's last message IS its report — a planning child never calls \`ensemblr_exit_plan_mode\`, so do not wait for a plan from one. If a report is thin or off-target, reply with \`ensemblr_send_follow_up\` and wait again. \`ensemblr_get_last_message\` recovers a report if your wait was interrupted. A child cannot ask the user anything, so its \`Open questions\` section is interview material for you: drop what you can settle by reading, merge what several children raised, and fold the rest into your next \`ensemblr_ask_user_question\` round. A decision a child left open is not one you may quietly close.
5. Verify before you rely. A report is a claim, not a fact you checked. Before a load-bearing one — a version floor, a package or config wiring, a constraint that picks the approach — goes into your plan, open the path the child cited and read it yourself; that is what the full paths are for. Delegation makes a citation feel checked when nobody checked it. A child that read documentation rather than this repository leaves you nothing to re-read, so attribute that claim to its report in the plan instead of asserting it. A claim about what the child did rather than what a file says is settled by \`ensemblr_read_conversation\`, which replays its actual tool calls.
6. Integrate the findings as EVIDENCE for the plan you will submit, not as the plan. You still own the interview, the decisions, and the exit call. Never forward a child's report to the user as your plan.
7. Close the investigation tabs you opened (\`ensemblr_close_tab\`) once you have their reports.

When you and the user share an understanding, hand the plan over and stop:

1. Call \`ensemblr_exit_plan_mode\` with a short \`title\` and the full plan, in markdown, as \`plan\` — what changes, where, in what order, and the decisions behind it. The app posts that plan into the conversation for the user to read, saves it under \`.context/plans/\`, and offers Approve / Refine / Hand off. The plan lives in the \`plan\` argument, so do not also write it out as your own reply, and do not write the plan file yourself — \`write\` is blocked, and the app owns both.
2. Your turn is over. The tool does not wait for the user, and the app stops you the moment it returns. Produce nothing after it — no plan restated in prose, no closing summary, no "let me know what you think", no first implementation step. The app has already posted the plan; leave it as the last message while the user reads it.

Their decision comes back to you as your NEXT prompt, not as the tool result:

- Approve — they send you an approval prompt with Plan Mode off. Implement the plan, starting immediately.
- Refine — they type their changes into the composer with Plan Mode still on. Fold them in and call the tool again with the revised plan.
- Hand off — another conversation picks the plan up and you hear nothing more. Nothing is expected of you.`;

/**
 * Self-contained playbook served in place of the sub-agent role playbook for
 * every turn a spawned conversation spends in Plan Mode. MUST stay byte-identical
 * to `PLAN_MODE_SUBAGENT_AWARENESS` in `src/shared/agent-control/awareness.ts`.
 */
const PLAN_MODE_SUBAGENT_AWARENESS = `PLAN MODE IS ON. While it stays on, this playbook replaces every other instruction you hold about how to work, and you implement nothing.

You are running inside Ensemblr, a desktop coding-workspace app, and you were spawned as a sub-agent by an orchestrator that is planning. Your job is to answer the question it gave you, from the code, and hand the answer back. Planning leaves you the half of the Ensemblr control surface (prefixed \`ensemblr_\`) that reads:

- Read the repository: the \`read\` tool, and \`bash\` for read-only commands.
- Report to your orchestrator: \`ensemblr_notify_orchestrator\` with reason \`need_decision\` or \`blocked\` pulls it back to you; \`progress\` and \`done\` keep it informed without interrupting.
- Focus & inspect: bring a tab/terminal or the Files/Changes/Checks panel forward (\`ensemblr_focus_tab\`/\`ensemblr_focus_dock_tab\`/\`ensemblr_focus_panel\`); list workspaces/tabs/terminals; read a conversation's status or last message; audit what a conversation actually did, tool calls included (\`ensemblr_read_conversation\`); read terminal output (\`ensemblr_read_terminal_output\`). Reads may span every open workspace.
- Review: read this workspace's diff (\`ensemblr_get_workspace_diff\`) — call it with \`stat: true\` FIRST to see which files changed and how large the diff is, then read the whole thing, or one file at a time with \`filePath\`; read the review comments already on it (\`ensemblr_get_diff_comments\`); leave your own against a file and line (\`ensemblr_add_diff_comments\`), which the user reads in the Changes panel. All three stay available while planning — annotating a diff is planning output, not a change to the repository. Resolving one is not: \`ensemblr_resolve_diff_comments\` says a finding is fixed, and you have fixed nothing while planning, so it is refused here.
- Linear: search the connected account's issues (\`ensemblr_linear_list_issues\`), read one with its comments (\`ensemblr_linear_get_issue\`), and read the team/project/state/label/user tables an update needs ids from (\`ensemblr_linear_get_metadata\`). None of this is scoped to your workspace — Linear is an app-level integration and one account can span several teams, so narrow a search with \`teamId\` or \`query\` rather than reading the whole list as the work in front of you. Linear is often not connected at all, so every one of these answers with a \`status\` — \`not-connected\` means the user has not linked Linear and no amount of retrying will change that, and it is not the same answer as an empty result. Writing to Linear is not yours: a ticket is read by the whole team rather than by your orchestrator, so \`ensemblr_linear_create_comment\` and \`ensemblr_linear_update_issue\` are refused here. Put what you would have written in your report.
- Keep your tab legible: name it (\`ensemblr_set_name\`) and record what the conversation has covered (\`ensemblr_set_summary\`). Both stay available while planning — they label work, they do not perform it. Naming the WORKSPACE and its git branch is not yours: \`ensemblr_set_branch_name\` belongs to the orchestrator that spawned you and is refused here.
- Board: read your workspace's kanban status (\`ensemblr_get_workspace_status\`). Moving the board is not yours: it describes the whole workspace rather than the question you were handed, so \`ensemblr_set_workspace_status\` is refused here.

You do not talk to the user. The orchestrator that spawned you owns that conversation and is blocked waiting on your report, so \`ensemblr_ask_user_question\` is refused here — send \`ensemblr_notify_orchestrator\` with reason \`need_decision\` instead and it will answer you.

The rest is blocked while you plan: \`write\` and \`edit\`, any \`bash\` command that is not read-only, \`ensemblr_resolve_diff_comments\` and \`ensemblr_linear_update_issue\` (each claims work you have not done), and every tool that would hand the work to something else — \`ensemblr_start_conversation\`, \`ensemblr_send_follow_up\`, \`ensemblr_launch_harness\`, \`ensemblr_start_terminal\`, \`ensemblr_write_terminal\`. Being a spawned sub-agent blocks more, whatever the mode: the workspace's tabs and terminals outlive the question you were handed, so \`ensemblr_stop_terminal\`, \`ensemblr_open_tab\`, \`ensemblr_close_tab\`, and \`ensemblr_linear_create_comment\` are refused here too. \`ensemblr_exit_plan_mode\` is not yours to call either: submitting the plan belongs to the orchestrator, and a plan posted from here would put a review panel in a tab nobody is watching. That enforcement is deliberate — do not look for a way around it. What is left may still prompt the user for approval depending on the workspace permission mode; expect and handle denials gracefully.

Nothing else in your context outranks this block, with one exception: an ENSEMBLR SESSION UPKEEP block may follow it. That block is the app's own bookkeeping — naming this tab, naming the workspace and branch, recording the session summary — and every item on it stays allowed while you plan. Do what it asks; it labels the work rather than starting it.

Your brief will almost always be phrased as a command — "add X", "convert this to Y", "let's build Z" — and in Plan Mode that is the SUBJECT of your investigation, not permission to start building. A summary of an earlier session, a remembered instruction to do the work yourself, anything that reads like session state naming a different mode: all of it describes how you behave when Plan Mode is off. It is stale, this block is the live state for this turn, and there is no conflict to resolve or to narrate. Nothing turns Plan Mode off except the user approving a plan.

Your job this turn is to find out what your orchestrator needs to know and hand it back.

- Name this tab first. Call \`ensemblr_set_name\` with a short label for the question you were given, before you start reading — several investigators may be running at once and the user needs to tell your tab apart. Leave the workspace and its branch alone; that name is your orchestrator's to set.
- Read, do not guess. The answer is in the code, the config, and the git history. Follow the call path far enough to be sure of it.
- Work from the brief. When it already quotes a file's contents or states a fact, take it as given and read what it did not give you — re-opening that file to confirm it spends the read your orchestrator already paid for.
- Answer the question you were asked, and say plainly when the answer is "the code does not do that" or "I could not determine X". A plan will be built on your report, so an admitted gap is worth far more than a confident wrong answer.
- Do not write the plan. You supply the facts someone else plans from. When a decision is genuinely open, name the options and the tradeoff and hand it back; do not dress a recommendation up as a decision already made.
- Signal only what stops you. \`ensemblr_notify_orchestrator\` with reason \`need_decision\` or \`blocked\` is for a question you cannot investigate around at all. Every other open decision — which adapter, which directive, whether to keep a dependency — goes in your report's \`Open questions\` section, which your orchestrator puts to the user in its own interview. Parking it there is how it gets asked; a signal only spends your orchestrator's turn.
- Do NOT spawn further sub-agents or launch harnesses. Nested delegation is blocked, and the investigation is yours to do.

Your last message is your report, and your orchestrator is its only reader. Everything it needs has to be IN it — never a pointer to work earlier in the turn ("report delivered above", "as analysed", "see my findings"). Structure it for that reader:

1. The answer, in the first few sentences.
2. Then the evidence: every file path written in full from the workspace root, in backticks, with the line numbers or symbol names that carry the answer.
3. Then what you could not settle, and what it would take to settle it.
4. Then anything you found that changes the shape of the plan — a constraint, an existing helper worth reusing, a contradiction between what was asked and what the code does.
5. Then, under a literal \`Open questions\` heading, every decision that is the USER's to make. Write each as a question in one line, 2-6 concrete options under it, and which you recommend and why. Your orchestrator turns this section into questions it asks the user directly, so anything you cannot put in that shape is not a question — it is a gap, and belongs under 3. Ask nothing you could settle by reading, and omit the heading entirely when you have none.

Produce nothing after it. Your report is persisted and survives your tab closing, so your orchestrator can read it whenever its wait returns.`;

/**
 * Whether the app spawned this Pi child as a sub-agent, read once from the role
 * env var it injects from lineage depth. A missing or unrecognized value means a
 * root session. Resolved in one place so the role and plan-mode axes cannot
 * disagree about which half of the 2x2 this session is in.
 */
const IS_SUBAGENT = process.env.ENSEMBLR_CONTROL_ROLE === 'subagent';

/**
 * The role playbook for this Pi child. Plan Mode replaces this playbook rather
 * than stacking on top of it.
 */
const AWARENESS = IS_SUBAGENT ? SUBAGENT_AWARENESS : ORCHESTRATOR_AWARENESS;

/** The playbook that stands in for {@link AWARENESS} while Plan Mode is on. */
const PLAN_MODE_AWARENESS_FOR_ROLE = IS_SUBAGENT
	? PLAN_MODE_SUBAGENT_AWARENESS
	: PLAN_MODE_ORCHESTRATOR_AWARENESS;

/**
 * Built-in Pi tools Plan Mode restricts; everything else runs untouched. MUST
 * hold the same members as `PLAN_MODE_GUARDED_TOOLS` in
 * `src/shared/plan-mode/tool-guard.ts` (this file cannot import from `src/` at
 * runtime); a parity test enforces it. A mutation tool missing from both is
 * never forwarded and bypasses Plan Mode silently.
 */
const PLAN_MODE_GUARDED_TOOLS = new Set(['bash', 'edit', 'write']);

/**
 * Control ops left out of a spawned sub-agent's tool list. Most are refused by
 * the app for a sub-agent whatever the mode, and the rest — waiting on children
 * it cannot spawn, listing models it cannot pass, listing run scripts it cannot
 * start — are ops it can never usefully call. Registering either kind teaches
 * the model to keep reaching for a tool it will not get. MUST hold the same
 * members as `SUBAGENT_WITHHELD_OPS` in
 * `src/shared/agent-control/subagent-policy.ts` (this file cannot import from
 * `src/` at runtime); a parity test enforces it.
 */
const SUBAGENT_WITHHELD_OPS = new Set([
	'askUserQuestion',
	'closeTab',
	'exitPlanMode',
	'launchHarness',
	'linearCreateComment',
	'linearUpdateIssue',
	'listModels',
	'listRunScripts',
	'openTab',
	'sendFollowUp',
	'setBranchName',
	'setWorkspaceStatus',
	'spawnChatTab',
	'startConversation',
	'startTerminal',
	'stopTerminal',
	'waitForAgents',
	'writeTerminal',
]);

/**
 * Whether this session registers a tool for the given control op. A root keeps
 * the whole surface; a sub-agent keeps what {@link SUBAGENT_WITHHELD_OPS} leaves.
 * @param op - The control op the tool would dispatch.
 * @returns True when the tool belongs in this session's tool list.
 */
const registersOp = (op: string): boolean =>
	!IS_SUBAGENT || !SUBAGENT_WITHHELD_OPS.has(op);

interface ControlResult {
	ok: boolean;
	code?: string;
	error?: string;
	data?: unknown;
}

/**
 * Type guard for the app's control envelope, so an HTTP error body that is not
 * a well-formed envelope is not mistaken for a valid result.
 * @param value - Parsed response body.
 * @returns True when the value has the `{ ok: boolean }` envelope shape.
 */
function isControlResult(value: unknown): value is ControlResult {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { ok?: unknown }).ok === 'boolean'
	);
}

/**
 * Posts a JSON body to the control server and resolves with its status and raw
 * body.
 *
 * Deliberately not `fetch`: Node's fetch is undici, whose `headersTimeout`
 * defaults to five minutes. That silently killed every call that blocks on a
 * human (`askUserQuestion`, any permission confirm) or on a child
 * (`waitForAgents`), collapsing them into a bare "fetch failed" while the app
 * kept the dialog on screen and later discarded the answer.
 * `http.ClientRequest` has no response timeout, so the call lasts exactly as
 * long as the app holds it.
 * @param url - Base URL of the app's control server.
 * @param token - Per-session bearer token the server authenticates against.
 * @param payload - Serialized request body.
 * @param signal - Aborts the request when the calling turn ends.
 * @returns The response status and its body as text.
 */
function postControl(
	url: string,
	token: string,
	payload: string,
	signal: AbortSignal | undefined,
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			`${url}/invoke`,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					// Byte length, not character count: questions and playbooks are
					// full of em dashes, and a short count truncates the body.
					'content-length': Buffer.byteLength(payload),
					authorization: `Bearer ${token}`,
				},
				agent: false,
				signal,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('error', reject);
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						body: Buffer.concat(chunks).toString('utf8'),
					}),
				);
			},
		);
		req.on('error', reject);
		req.end(payload);
	});
}

/**
 * Parses a response body, yielding undefined rather than throwing.
 * @param raw - Raw response text.
 * @returns The parsed value, or undefined when it is not JSON.
 */
function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return undefined;
	}
}

/**
 * Flattens an error into one line, following `cause`, so a transport failure
 * names its real reason instead of the opaque wrapper it would otherwise carry.
 * @param error - The thrown value.
 * @returns A single-line description.
 */
function describeError(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error);
	}
	const code = (error as { code?: string }).code;
	const head = code ? `${code}: ${error.message}` : error.message;
	const cause = (error as { cause?: unknown }).cause;
	return cause instanceof Error ? `${head} (${cause.message})` : head;
}

/**
 * Narrows Pi's per-call cancellation argument to a real `AbortSignal`. This file
 * is not typechecked and Pi's API is not resolvable here, so anything else is
 * dropped rather than handed to `http.request`, which throws on a bad `signal` —
 * and that would break every control call, not just the cancellable ones.
 * @param value - Whatever Pi passed in the signal position.
 * @returns The signal, or undefined when it is not one.
 */
function asAbortSignal(value: unknown): AbortSignal | undefined {
	return typeof AbortSignal !== 'undefined' && value instanceof AbortSignal
		? value
		: undefined;
}

/**
 * Posts a control op to the Ensemblr app and returns its result envelope.
 * @param op - Canonical control op name (e.g. `spawnChatTab`).
 * @param args - Validated tool arguments.
 * @param signal - Aborts the call when the calling turn ends.
 * @returns The app's `{ ok, data | code, error }` envelope.
 */
async function invoke(
	op: string,
	args: unknown,
	callerModel: string | undefined,
	signal?: AbortSignal,
): Promise<ControlResult> {
	if (!CONTROL_URL || !CONTROL_TOKEN) {
		return {
			ok: false,
			code: 'internal',
			error: 'Control channel not configured.',
		};
	}
	try {
		const { status, body } = await postControl(
			CONTROL_URL,
			CONTROL_TOKEN,
			JSON.stringify({ op, args, callerModel }),
			signal,
		);
		const parsed = parseJson(body);
		// The app answers 4xx/5xx with the same JSON envelope, so a well-formed
		// body carries the real reason whatever the status says.
		if (isControlResult(parsed)) {
			return parsed;
		}
		if (status < 200 || status > 299) {
			return {
				ok: false,
				code: 'internal',
				error: `Control channel returned HTTP ${status} with an unexpected body.`,
			};
		}
		return {
			ok: false,
			code: 'internal',
			error: 'Control channel returned an unexpected body.',
		};
	} catch (error) {
		return { ok: false, code: 'internal', error: describeError(error) };
	}
}

/**
 * Reads the calling agent's current model id from the extension context, so a
 * spawned conversation can inherit the master's model when none is specified.
 * @param ctx - The Pi extension context passed to a tool's execute.
 * @returns The model id, or undefined when unavailable.
 */
function callerModelId(ctx: { model?: { id?: string } } | undefined) {
	return ctx?.model?.id;
}

/**
 * Asks the app for this turn's brief: whether the conversation is in Plan Mode,
 * so the planning playbook stands in for the role one only while planning, the
 * upkeep block naming whatever the session still owes, and the directive putting
 * user-facing prose in the app's language. The app renders both blocks, so this
 * file holds no second copy of their wording to drift.
 *
 * A transport failure reports "not planning, nothing to append": the prompt
 * text is cosmetic, and real Plan Mode enforcement lives in the `tool_call`
 * hook, which asks the app per call and fails closed on its own.
 * @returns The playbook selector and the blocks to append.
 */
async function fetchSessionBrief(): Promise<{
	planning: boolean;
	nudge: string | null;
	languageDirective: string | null;
}> {
	const result = await invoke('getSessionBrief', {}, undefined);
	if (!result.ok) {
		return { languageDirective: null, nudge: null, planning: false };
	}
	const brief = result.data as
		| {
				planMode?: boolean;
				nudge?: string | null;
				languageDirective?: string | null;
		  }
		| undefined;
	return {
		languageDirective:
			typeof brief?.languageDirective === 'string'
				? brief.languageDirective
				: null,
		nudge: typeof brief?.nudge === 'string' ? brief.nudge : null,
		planning: brief?.planMode === true,
	};
}

/**
 * Renders a control result as a Pi tool result.
 * @param result - The app's control envelope.
 * @returns A tool result with text content and structured details.
 */
function toToolResult(result: ControlResult) {
	const text = result.ok
		? JSON.stringify(result.data ?? { ok: true })
		: `Error (${result.code ?? 'internal'}): ${result.error ?? 'unknown'}`;
	return { content: [{ type: 'text' as const, text }], details: result };
}

/**
 * Ensemblr Control extension entry point. Registers one tool per control op.
 * @param pi - The Pi extension API.
 */
export default function ensemblrControl(pi: ExtensionAPI): void {
	if (!CONTROL_URL || !CONTROL_TOKEN) {
		return;
	}

	pi.on('before_agent_start', async (event) => {
		const { languageDirective, nudge, planning } = await fetchSessionBrief();
		const playbook = planning ? PLAN_MODE_AWARENESS_FOR_ROLE : AWARENESS;
		const blocks = [
			event.systemPrompt,
			playbook,
			nudge,
			languageDirective,
		].filter((block) => typeof block === 'string' && block.length > 0);
		return { systemPrompt: blocks.join('\n\n') };
	});

	// Enforcement asks the app on every guarded call rather than trusting a
	// per-turn cache: the user can approve a plan mid-turn, and a stale "not
	// planning" cache would silently let the agent edit files it was told not to.
	pi.on('tool_call', async (event) => {
		if (!PLAN_MODE_GUARDED_TOOLS.has(event.toolName)) {
			return;
		}
		const result = await invoke(
			'checkPlanModeTool',
			{
				command: (event.input as { command?: string } | undefined)?.command,
				tool: event.toolName,
			},
			undefined,
		);
		if (!result.ok) {
			return {
				block: true,
				reason: `Ensemblr could not confirm whether Plan Mode is on (${result.error ?? 'control channel unavailable'}), so this tool call was blocked. Retry, or tell the user the app is unreachable.`,
			};
		}
		const verdict = result.data as { blocked?: boolean; reason?: string };
		return verdict.blocked
			? { block: true, reason: verdict.reason }
			: undefined;
	});

	const tool = <TParams extends TSchema>(
		name: string,
		op: string,
		description: string,
		parameters: TParams,
	): void => {
		if (!registersOp(op)) {
			return;
		}
		pi.registerTool<TParams>({
			name,
			description,
			parameters,
			execute: async (
				_toolCallId: string,
				params: Static<TParams>,
				signal: unknown,
				_onUpdate: unknown,
				ctx: { model?: { id?: string } },
			) =>
				toToolResult(
					await invoke(op, params, callerModelId(ctx), asAbortSignal(signal)),
				),
		});
	};

	const empty = Type.Object({});

	tool(
		'ensemblr_spawn_chat_tab',
		'spawnChatTab',
		'Open a new empty chat tab in the current workspace.',
		Type.Object({ title: Type.Optional(Type.String()) }),
	);
	tool(
		'ensemblr_start_conversation',
		'startConversation',
		"Open a fresh chat tab (or reuse one via chatTabId) and start a conversation. A chat tab spawns children on its own agent runtime and may omit `model` to inherit its own; a terminal harness has no runtime the app can name, so it must pass a `model` from ensemblr_list_models and is refused without one. Pass a short, descriptive title to name the sub-agent's tab. Brief it with what to deliver, not just what to look at: the question it answers, the defaults it should assume rather than come back and ask about, and whether it reports inline (the default) or writes a file at a path you name. Set wait=true to block until it finishes.",
		Type.Object({
			chatTabId: Type.Optional(Type.String()),
			prompt: Type.String(),
			model: Type.Optional(Type.String()),
			thinkingLevel: Type.Optional(Type.String()),
			title: Type.Optional(Type.String()),
			wait: Type.Optional(Type.Boolean()),
		}),
	);
	tool(
		'ensemblr_send_follow_up',
		'sendFollowUp',
		'Send a follow-up prompt into an existing Pi conversation.',
		Type.Object({
			agentSessionId: Type.String(),
			prompt: Type.String(),
			wait: Type.Optional(Type.Boolean()),
		}),
	);
	tool(
		'ensemblr_set_name',
		'setName',
		'Set a short, descriptive title for your own conversation tab so it is easy to identify. The label goes in `title`, the same key ensemblr_start_conversation names a tab with. This is the tab label, not the workspace or branch name — ensemblr_set_branch_name owns that.',
		Type.Object({ title: Type.String() }),
	);
	tool(
		'ensemblr_set_branch_name',
		'setBranchName',
		'Name the work: renames this workspace AND its git branch together from one kebab-case slug (2-5 words, e.g. "add-dark-mode"), keeping any `prefix/` segment of the current branch. Call it once, early, as soon as you know what the work is called. It applies while the git branch still carries the name it was cut with; a workspace the user has already titled keeps that title and only its branch moves. A reply saying nothing changed is a settled outcome, not a fault to retry — except when the USER asks for a different branch name in so many words, which is what userRequested: true is for. Renaming the branch any other way, `git branch -m` included, desyncs the workspace from git. This is the workspace and branch name, not the tab title (use ensemblr_set_name for that).',
		Type.Object({
			name: Type.String(),
			userRequested: Type.Optional(Type.Boolean()),
		}),
	);
	tool(
		'ensemblr_set_summary',
		'setSummary',
		"Record the session summary the app keeps for this chat tab, replacing whatever is on file. Call it once the turn's work is done: `title` is a short topic line and `summary` is markdown covering the decisions made, the files touched, and what is still open. Writing it yourself is what keeps the record useful — the app's fallback only dumps the raw transcript. This does NOT rename the tab.",
		Type.Object({ title: Type.String(), summary: Type.String() }),
	);
	tool(
		'ensemblr_close_tab',
		'closeTab',
		'Close a chat or terminal tab in the current workspace.',
		Type.Object({ chatTabId: Type.String() }),
	);
	tool(
		'ensemblr_launch_harness',
		'launchHarness',
		'Launch a third-party agent harness (claude, codex, vibe) in a new terminal tab.',
		Type.Object({ harnessId: Type.String() }),
	);
	tool(
		'ensemblr_start_terminal',
		'startTerminal',
		'Start a dock terminal: the setup script, a run script, or an interactive spawn terminal. A repository can configure several named run scripts (a dev server, a playground, an unsigned build), so with kind=run call ensemblr_list_run_scripts FIRST and pass the scriptName you actually want — omitting it silently starts whichever one the repository marks default, which is rarely the one you meant. Only one run script runs per workspace at a time.',
		Type.Object({
			kind: Type.Union([
				Type.Literal('setup'),
				Type.Literal('run'),
				Type.Literal('spawn'),
			]),
			scriptName: Type.Optional(
				Type.String({
					description:
						'Name of the run script to start, from ensemblr_list_run_scripts. Applies to kind=run only.',
				}),
			),
		}),
	);
	tool(
		'ensemblr_list_run_scripts',
		'listRunScripts',
		"List the run scripts this workspace's repository configures (name, command, and which one is the default), so you can start the right one by name with ensemblr_start_terminal. An empty list means the repository configures none and kind=run has nothing to start.",
		empty,
	);
	tool(
		'ensemblr_stop_terminal',
		'stopTerminal',
		'Stop a dock terminal by id, or the setup/run script by kind.',
		Type.Object({
			terminalId: Type.Optional(Type.String()),
			kind: Type.Optional(
				Type.Union([Type.Literal('setup'), Type.Literal('run')]),
			),
		}),
	);
	tool(
		'ensemblr_write_terminal',
		'writeTerminal',
		'Write input into an existing terminal or harness.',
		Type.Object({ terminalId: Type.String(), input: Type.String() }),
	);
	tool(
		'ensemblr_open_tab',
		'openTab',
		'Open a non-chat tab: a file preview, a diff, or a comment.',
		Type.Object({
			variant: Type.Union([
				Type.Literal('file'),
				Type.Literal('diff'),
				Type.Literal('comment'),
			]),
			filePath: Type.Optional(Type.String()),
			turnId: Type.Optional(Type.String()),
			commentBody: Type.Optional(Type.String()),
			prNumber: Type.Optional(Type.Number()),
		}),
	);
	tool(
		'ensemblr_focus_tab',
		'focusTab',
		'Bring a session tab (chat/terminal/diff/file) to the foreground by id.',
		Type.Object({ chatTabId: Type.String() }),
	);
	tool(
		'ensemblr_focus_dock_tab',
		'focusDockTab',
		'Focus a dock terminal by id, or the setup/run script tab by kind.',
		Type.Object({
			terminalId: Type.Optional(Type.String()),
			kind: Type.Optional(
				Type.Union([Type.Literal('setup'), Type.Literal('run')]),
			),
		}),
	);
	tool(
		'ensemblr_focus_panel',
		'focusPanel',
		'Focus the Files, Changes, or Checks review panel.',
		Type.Object({
			panel: Type.Union([
				Type.Literal('files'),
				Type.Literal('changes'),
				Type.Literal('checks'),
			]),
		}),
	);
	tool(
		'ensemblr_set_workspace_status',
		'setWorkspaceStatus',
		'Move your workspace across the kanban board by setting its status (backlog, in-progress, in-review, done, canceled). Acts on your own workspace.',
		Type.Object({
			status: Type.Union([
				Type.Literal('backlog'),
				Type.Literal('in-progress'),
				Type.Literal('in-review'),
				Type.Literal('done'),
				Type.Literal('canceled'),
			]),
		}),
	);
	tool(
		'ensemblr_get_workspace_status',
		'getWorkspaceStatus',
		"Read your workspace's current kanban board status. Use ensemblr_list_workspaces to see every workspace's status.",
		empty,
	);
	tool(
		'ensemblr_list_models',
		'listModels',
		'List the models you can spawn a child on (id, runtime, vendor, display name) plus the default. `runtime` is the agent runtime that would drive the child and is the axis a spawn may not cross; `vendor` is only who serves the model. Called from a chat tab the list is already cut to your own runtime, because a child always runs the runtime you do. Called from a terminal harness it carries every runtime, because the app cannot tell which one you are — which is also why `model` is mandatory there. Call this before setting a model on start_conversation and pass an id that appears here; one from another runtime is refused, not substituted.',
		empty,
	);
	tool(
		'ensemblr_list_workspaces',
		'listWorkspaces',
		'List all open workspaces (id, name, cwd).',
		empty,
	);
	tool(
		'ensemblr_list_tabs',
		'listTabs',
		'List open tabs, defaulting to the current workspace.',
		Type.Object({ workspaceId: Type.Optional(Type.String()) }),
	);
	tool(
		'ensemblr_list_terminals',
		'listTerminals',
		'List terminals, defaulting to the current workspace.',
		Type.Object({ workspaceId: Type.Optional(Type.String()) }),
	);
	tool(
		'ensemblr_get_conversation_status',
		'getConversationStatus',
		'Get the status of a Pi conversation by session id.',
		Type.Object({ agentSessionId: Type.String() }),
	);
	tool(
		'ensemblr_get_last_message',
		'getLastMessage',
		"Get a Pi conversation's report: every assistant message of its newest answered turn, joined in the order it was written. Persisted, so it survives the conversation closing and an app restart.",
		Type.Object({ agentSessionId: Type.String() }),
	);
	tool(
		'ensemblr_read_conversation',
		'readConversation',
		'Read what a Pi conversation actually did — its prompts, its answers, and every tool call with its arguments and result — rather than only the report ensemblr_get_last_message hands back. This is how you audit a sub-agent: confirm it ran what it claims to have run before you act on its findings. Call it with stat=true FIRST: that returns the entry count, the turn count, and the ordinal range with no content, so you know how much there is before you read it. Then page forward with fromOrdinal, resuming from the nextOrdinal each page returns, or pass ordinal to read a single entry whole — stat, ordinal, and fromOrdinal are alternatives, not a combination. Long fields are cut and marked with the ordinal that reads them in full.',
		Type.Object({
			agentSessionId: Type.String(),
			stat: Type.Optional(
				Type.Boolean({
					description:
						'Return the entry and turn counts and the ordinal range only, with no content. Call this first.',
				}),
			),
			fromOrdinal: Type.Optional(
				Type.Number({
					description:
						'Inclusive lower bound on entry ordinal — the nextOrdinal a previous page handed back.',
				}),
			),
			ordinal: Type.Optional(
				Type.Number({
					description:
						'Read the entry at this ordinal on its own, with its field cap lifted.',
				}),
			),
		}),
	);
	tool(
		'ensemblr_read_terminal_output',
		'readTerminalOutput',
		'Read the current scrollback of a terminal or harness.',
		Type.Object({ terminalId: Type.String() }),
	);
	tool(
		'ensemblr_get_workspace_diff',
		'getWorkspaceDiff',
		"Read this workspace's diff — every change on its branch, committed and uncommitted alike, the same set the Changes panel shows. Call it with stat=true FIRST: that returns the changed files with their +/- counts and no patch text, so you can see how big the diff is before you read it. Then read the whole diff, or pass filePath to read one file's patch on its own — filePath and stat are alternatives, not a pair. Every read is capped: a full read names what it dropped in omittedFiles for you to re-request by filePath, and a single file too large to carry is cut at a hunk boundary.",
		Type.Object({
			filePath: Type.Optional(
				Type.String({
					description:
						"Workspace-relative path of a single file to read whole, e.g. src/main/main.ts. Also how you recover a file listed in a previous read's omittedFiles.",
				}),
			),
			stat: Type.Optional(
				Type.Boolean({
					description:
						'Return the changed-file rows and totals only, with no patch text. Call this first.',
				}),
			),
		}),
	);
	tool(
		'ensemblr_get_diff_comments',
		'getDiffComments',
		"Read the review comments on this workspace's diff — the ones the user left in the Changes panel and the ones agents filed there. Pass filePath to narrow it to one path. Comments synced from a GitHub pull request are not included.",
		Type.Object({ filePath: Type.Optional(Type.String()) }),
	);
	tool(
		'ensemblr_add_diff_comments',
		'addDiffComments',
		"File review comments on this workspace's diff, anchored to a file and optionally a line. They appear in the Changes panel labelled as yours, so use them to leave findings on the code itself rather than describing a location in prose. Batch a review's comments into one call.",
		Type.Object({
			comments: Type.Array(
				Type.Object({
					filePath: Type.String({
						description:
							'Workspace-relative path the comment is against, e.g. src/main/main.ts.',
					}),
					lineNumber: Type.Optional(
						Type.Union([Type.Number(), Type.Null()], {
							description:
								"1-based line on the file's new side. Omit or pass null for a file-level comment.",
						}),
					),
					body: Type.String({ maxLength: 4000 }),
				}),
				{ maxItems: 50, minItems: 1 },
			),
		}),
	);
	tool(
		'ensemblr_resolve_diff_comments',
		'resolveDiffComments',
		"Mark review comments on this workspace's diff as resolved, by the ids ensemblr_get_diff_comments and ensemblr_add_diff_comments hand back. Resolve a comment in the same turn you make the fix it asked for, and batch a whole review pass into one call. Resolve only what you actually fixed: a comment you deferred or disagree with stays open, and you say so in your reply. This only ever resolves — it cannot reopen a comment the user closed, and an id that matches no open comment here is reported back rather than failing the call.",
		Type.Object({
			commentIds: Type.Array(Type.String(), { maxItems: 50, minItems: 1 }),
		}),
	);
	tool(
		'ensemblr_linear_list_issues',
		'linearListIssues',
		"Search the connected Linear account's issues. This is NOT scoped to your workspace — Linear is an app-level integration and one account can span several teams, so narrow with query (free text over identifier, title, and description) or teamId rather than reading the whole list as the work in front of you. Reads a local cache and syncs from Linear when it has gone stale, so it is cheap to call; pass refresh=true only when you need the very latest. Descriptions are NOT returned — read one issue with ensemblr_linear_get_issue. Check `status` before acting on the result: `not-connected` means the user has not linked Linear at all, which is a different answer from an empty list.",
		Type.Object({
			query: Type.Optional(
				Type.String({
					description:
						'Free text matched against issue identifier, title, and description.',
				}),
			),
			teamId: Type.Optional(
				Type.String({
					description:
						'Narrow to one team, by an id from ensemblr_linear_get_metadata.',
				}),
			),
			refresh: Type.Optional(
				Type.Boolean({
					description:
						'Sync from Linear before reading, instead of serving a fresh cache.',
				}),
			),
		}),
	);
	tool(
		'ensemblr_linear_get_issue',
		'linearGetIssue',
		'Read one Linear issue with its description, labels, and comment thread. issueId takes either the uuid or the human identifier (THE-106); an identifier always goes to Linear rather than the local cache. The description is truncated and only the most recent comments are returned — the result says how many were dropped. Check `status`: `not-found` means the id is wrong, `not-connected` means Linear is not linked.',
		Type.Object({
			issueId: Type.String({
				description: 'Issue uuid, or its human identifier such as THE-106.',
			}),
			refresh: Type.Optional(Type.Boolean()),
		}),
	);
	tool(
		'ensemblr_linear_get_metadata',
		'linearGetMetadata',
		'List the Linear teams, projects, workflow states, labels, and users the connected account can see, each with the id ensemblr_linear_update_issue takes. The account is not scoped to your workspace, so expect teams that have nothing to do with the work here. Call this FIRST whenever you are about to set a state, an assignee, or a project — those arguments are ids, not names, and this is the only place to turn one into the other. Cycles are not returned; nothing on this surface sets one.',
		Type.Object({
			refresh: Type.Optional(Type.Boolean()),
		}),
	);
	tool(
		'ensemblr_linear_create_comment',
		'linearCreateComment',
		'Post a comment on a Linear issue. The whole team reads it and nothing here can edit or delete it afterwards, so write it as you would a comment of your own: what you did, what you found, what is still open. Use it to record progress on a ticket rather than to talk to the user, who reads your reply instead.',
		Type.Object({
			issueId: Type.String({
				description: 'Issue uuid, or its human identifier such as THE-106.',
			}),
			commentBody: Type.String({ maxLength: 8000 }),
		}),
	);
	tool(
		'ensemblr_linear_update_issue',
		'linearUpdateIssue',
		'Change a Linear issue: its workflow state, assignee, priority (0 none, 1 urgent, 2 high, 3 medium, 4 low), title, or description. Pass at least one of those alongside issueId. stateId and assigneeId are ids from ensemblr_linear_get_metadata, never names. A state whose type is `completed` or `canceled` is REFUSED whatever you pass — agent work never closes a ticket here, and marking one canceled is the same call under a different label. Take it to In Review and say in your reply that it is ready; the user decides whether it is done.',
		Type.Object({
			issueId: Type.String({
				description: 'Issue uuid, or its human identifier such as THE-106.',
			}),
			stateId: Type.Optional(
				Type.String({
					description:
						'Workflow state id from ensemblr_linear_get_metadata. A state whose type is completed or canceled is refused.',
				}),
			),
			assigneeId: Type.Optional(
				Type.String({
					description: 'User id from ensemblr_linear_get_metadata.',
				}),
			),
			priority: Type.Optional(
				Type.Number({
					description: '0 none, 1 urgent, 2 high, 3 medium, 4 low.',
					maximum: 4,
					minimum: 0,
				}),
			),
			title: Type.Optional(Type.String({ maxLength: 255 })),
			description: Type.Optional(Type.String({ maxLength: 32000 })),
		}),
	);
	tool(
		'ensemblr_wait_for_agents',
		'waitForAgents',
		'Block until delegated Pi sub-agents finish or need a decision, then return each settled one\'s status and report (its whole final turn), plus `pending` naming the children still running so you can wait on exactly those next. Prefer this over polling get_conversation_status. targets defaults to every child you spawned; mode defaults to "first", which returns on the first to settle — pass "all" to wait for every target. A need_decision/blocked signal wakes the wait whatever the mode. reports: "brief" returns each report\'s opening plus a pointer to ensemblr_get_last_message for the rest, instead of every child\'s whole turn at once — worth it on a wide fan-out, where reading four full reports to use one line of each is what makes delegation cost you more context than doing the work inline.',
		Type.Object({
			targets: Type.Optional(Type.Array(Type.String())),
			mode: Type.Optional(
				Type.Union([Type.Literal('first'), Type.Literal('all')]),
			),
			reports: Type.Optional(
				Type.Union([Type.Literal('full'), Type.Literal('brief')], {
					description:
						'How much of each report to return. Defaults to "full". Pass "brief" on a wide fan-out to get each report\'s opening plus a pointer to get_last_message for the rest, instead of every child\'s whole turn at once.',
				}),
			),
			timeoutMs: Type.Optional(Type.Number()),
		}),
	);
	tool(
		'ensemblr_notify_orchestrator',
		'notifyOrchestrator',
		'Sub-agents only: notify the orchestrator that spawned you. reason need_decision/blocked wakes its wait immediately so it can answer, so use it when the answer changes what you do next; a decision that only bites after you report belongs in your report as options and tradeoffs. progress/done are informational.',
		Type.Object({
			reason: Type.Union([
				Type.Literal('need_decision'),
				Type.Literal('blocked'),
				Type.Literal('progress'),
				Type.Literal('done'),
			]),
			message: Type.String(),
		}),
	);
	tool(
		'ensemblr_ask_user_question',
		'askUserQuestion',
		"Ask the human a multiple-choice question and block until they answer. Use this whenever a decision is genuinely the user's to make — ambiguous requirements, a fork in the approach, a destructive step, or missing context you cannot infer — instead of guessing or stopping to ask in prose. This call has no time limit: it stays open until the user answers or dismisses it, however long that takes, so treat it as a real wait rather than something that comes back on its own. Every question needs 2-6 concrete options; the user can also type a free-text answer or dismiss the dialog. Ask up to 4 related questions at once rather than calling this repeatedly. Do not use it for questions you can answer by reading the codebase.",
		Type.Object({
			questions: Type.Array(
				Type.Object({
					question: Type.String({
						description: 'The full question, phrased for a human.',
					}),
					header: Type.Optional(
						Type.String({
							description:
								'Short label naming this question in the pager, for screen readers. A few words; trimmed if longer.',
						}),
					),
					options: Type.Array(
						Type.Object({
							label: Type.String({
								description:
									'Short, concrete choice — a few words, 80 characters at most, distinct within the question. Do not use "Other" or "Next": the dialog always offers a free-text row of its own, and those labels are rejected.',
								maxLength: 80,
							}),
							description: Type.Optional(
								Type.String({
									description: 'The trade-off this choice implies.',
								}),
							),
						}),
						{ minItems: 2, maxItems: 6 },
					),
					multiSelect: Type.Optional(
						Type.Boolean({
							description: 'Let the user pick several options.',
						}),
					),
				}),
				{ minItems: 1, maxItems: 4 },
			),
		}),
	);
	if (registersOp('exitPlanMode')) {
		pi.registerTool({
			name: 'ensemblr_exit_plan_mode',
			description:
				'Plan Mode only: hand the finished plan to the user and END YOUR TURN. Pass the full plan, in markdown, as `plan`; the app posts it into the conversation for the user to read and saves it to `.context/plans/`, so do NOT also write the plan out as your own reply and do NOT write the file yourself. It then shows the user Approve / Refine / Hand off. This call does not wait for them: it returns at once and your turn is over. Produce no output after it — whatever the user decides arrives as your next prompt. Call it only once you and the user share an understanding, never as an opening move.',
			parameters: Type.Object({
				title: Type.String({
					description:
						'Short label for the plan, 80 characters at most. Also becomes the saved filename.',
				}),
				plan: Type.String({
					description:
						'The full plan in markdown: what changes, where, in what order, and the decisions behind it.',
				}),
			}),
			execute: async (
				_toolCallId: string,
				params: { title: string; plan: string },
				signal: unknown,
				_onUpdate: unknown,
				ctx: { model?: { id?: string }; abort?: () => void },
			) => {
				const result = await invoke(
					'exitPlanMode',
					params,
					callerModelId(ctx),
					asAbortSignal(signal),
				);
				// Ending the turn is the contract, so enforce it rather than trusting
				// the model to stop on its own. Deferred by a tick so this tool result
				// is delivered first and the plan stays the last message.
				if (result.ok) {
					setTimeout(() => ctx.abort?.(), 0);
				}
				return toToolResult(result);
			},
		});
	}
}
