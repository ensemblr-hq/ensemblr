/**
 * The control ops a spawned sub-agent may not dispatch, whatever mode it is in.
 *
 * Plan Mode already denies a planning sub-agent four ops, but its table only
 * applies while planning. Outside it the only op that consulted the caller's role
 * was `setBranchName`; everything else a sub-agent could not reach was stopped by
 * the spawn guardrail noticing `origin.depth >= 1`. That is a fork-bomb counter,
 * not a policy, and it lives in an in-memory registry: a session resumed after a
 * restart re-registers with no parent, reads as depth 0, and regains every spawn
 * op — while `notifyOrchestrator`, its one sanctioned escape hatch, fails on the
 * same missing lineage. The privileges invert exactly when they should not.
 *
 * This table takes the durable role instead, so the answer survives a restart and
 * matches what the depth-specific awareness promises. A leaf is denied the model
 * and wait ops because they are delegation capabilities at its depth ceiling;
 * `listRunScripts` alone remains merely unusable because no descendant can start
 * a workspace-owned run script.
 *
 * Everything here is a pure function of its argument, so the parity test can
 * cross-check the playbook prose against it.
 */

import type { AgentControlRole, ControlAudience } from './awareness.ts';
import type { ContextPressureAudience } from './context-pressure.ts';
import type { AgentControlOp } from './contracts.ts';
import { AGENT_CONTROL_OPS } from './contracts.ts';
import type { SubagentMechanism } from './subagent-mechanism.ts';

/**
 * Ops denied to a spawned sub-agent, mapped to the reason handed back. Each
 * reason names what to do instead, because a denial that only says no leaves the
 * model to invent a workaround.
 */
const SUBAGENT_BLOCKED_OPS: ReadonlyMap<AgentControlOp, string> = new Map([
	[
		'spawnChatTab',
		'You were spawned as a sub-agent to carry out one unit of work, and nested delegation is blocked. Do the work yourself and leave your findings as your last message.',
	],
	[
		'startConversation',
		'You were spawned as a sub-agent to carry out one unit of work, and nested delegation is blocked. Do the work yourself and leave your findings as your last message.',
	],
	[
		'startReview',
		'Opening the workspace\u2019s Review conversation belongs to the root orchestrator because it covers the whole change rather than your delegated workstream. Report what you did to your immediate parent instead.',
	],
	[
		'sendFollowUp',
		'You were spawned as a sub-agent and have no conversations of your own to steer. Driving another agent from here would put a second writer on a workspace you do not own. Leave your findings as your last message, or call `ensemblr_notify_orchestrator` if you are blocked.',
	],
	[
		'launchHarness',
		'You were spawned as a sub-agent, and launching a harness belongs to the orchestrator that spawned you. A harness is an unrestricted writer on the same worktree you and your orchestrator are working in, and it launches with approval prompts skipped. Do the work yourself, or report what would need one.',
	],
	[
		'listModels',
		'You are a leaf sub-agent at the maximum delegation depth. Model discovery is available only to an agent that can still open a fresh child.',
	],
	[
		'startTerminal',
		'You were spawned as a sub-agent, and the setup, run, and spawn terminals belong to the workspace rather than to your unit of work. Run what you need through `bash`, or say in your report which script should be started.',
	],
	[
		'stopTerminal',
		'You were spawned as a sub-agent, and the workspace terminals outlive your unit of work — the orchestrator or the user may be depending on the one you are stopping. Say in your report which terminal should be stopped and why.',
	],
	[
		'waitForAgents',
		'You are a leaf sub-agent at the maximum delegation depth and cannot own children to wait for. Report to your immediate parent instead.',
	],
	[
		'writeTerminal',
		"You were spawned as a sub-agent, and writing into an existing terminal drives a shell — including another agent's — that your unit of work does not own. Run your own commands through `bash` instead.",
	],
	[
		'openTab',
		'You were spawned as a sub-agent, and opening a file, diff, or comment tab leaves a view behind in a workspace whose tabs your orchestrator manages. Cite the full path in your report instead; you may still bring an existing tab forward with `ensemblr_focus_tab`.',
	],
	[
		'closeTab',
		'You were spawned as a sub-agent, and the tabs in this workspace are not yours to close — the one you reach for could be your orchestrator, blocked waiting on your report, or a sibling still working. You create no tabs, so you have none to clean up.',
	],
	[
		'setBranchName',
		'Naming the workspace and its git branch belongs to the root conversation, not to a spawned sub-agent: that name describes the whole body of work rather than the one unit you were handed. Report the name you would have chosen instead.',
	],
	[
		'setWorkspaceStatus',
		'The kanban status describes the whole workspace, not the one unit of work you were handed, so moving the board belongs to the root conversation that spawned you. Say in your report where you think the work now stands.',
	],
	[
		'getArchitectureDiagram',
		'The architecture diagram describes the whole codebase, not the one unit of work you were handed, so reading and redrawing it both belong to the root conversation that spawned you — which is what your playbook tells you. Read the code you were pointed at instead, and put what you learned about the shape of it in your report.',
	],
	[
		'updateArchitectureDiagram',
		'The architecture diagram describes the whole codebase, not the one unit of work you were handed, so redrawing it belongs to the root conversation that spawned you. There is no patch op either: a redraw replaces the whole tracked document, so a correction scoped to your area would silently delete every component you did not re-send — including your siblings’. Say in your report what you found mis-drawn.',
	],
	[
		'askUserQuestion',
		'You were spawned as a sub-agent, and the orchestrator that spawned you owns the conversation with the user and is blocked waiting on you — a question raised here opens a dialog in a tab nobody is watching. Put the decision under the `Open questions` heading of your report, which your orchestrator turns into a questionnaire, or call `ensemblr_notify_orchestrator` with reason `need_decision` when you cannot produce your deliverable at all without an answer.',
	],
	[
		'exitPlanMode',
		'You were spawned as a sub-agent, and submitting a plan belongs to the orchestrator that spawned you — a plan posted here would put a review panel in a tab nobody is watching. Leave your findings as your last message instead; that is what the orchestrator reads.',
	],
	[
		'linearCreateComment',
		'You were spawned as a sub-agent, and a Linear issue is read by the whole team rather than by your orchestrator. Several children working the same ticket each posting their own comment is noise the orchestrator cannot retract, so it writes to Linear once, for all of you. Put what you would have commented in your report.',
	],
	[
		'messageConcierge',
		'You were spawned as a sub-agent, and the Concierge is two levels above you: it briefed your orchestrator, not you, and it has no context for a message from a unit of work it never handed out. `ensemblr_notify_orchestrator` is your channel — reason `blocked` or `need_decision` wakes the orchestrator that is waiting on you, and it decides whether the Concierge needs to hear about it.',
	],
	[
		'linearCreateIssue',
		'You were spawned as a sub-agent, and a filed issue is a row on the team\'s board that nothing here can delete. Several children each filing the follow-up they found is exactly how a backlog fills with duplicates, so the orchestrator files once, for all of you. Put what you would have filed under the "Follow-ups" heading of your report.',
	],
	[
		'linearUpdateIssue',
		"You were spawned as a sub-agent, and an issue's state, assignee, and title describe the whole body of work rather than the one unit you were handed, so moving the ticket belongs to the orchestrator that spawned you. Say in your report where you think it now stands and let the orchestrator move it.",
	],
]);

/**
 * Ops withheld from a sub-agent's tool list because it can never usefully call
 * them, not because calling one would do harm. They stay dispatchable so a stale
 * caller meets an ordinary result rather than a denial that overstates the stakes.
 */
export const SUBAGENT_UNUSABLE_OPS: ReadonlySet<AgentControlOp> = new Set([
	'listRunScripts',
]);

/** Delegation ops a verified depth-1 sub-agent may use for its own fresh leaf. */
export const MANAGER_SUBAGENT_DELEGATION_OPS: ReadonlySet<AgentControlOp> =
	new Set([
		'startConversation',
		'sendFollowUp',
		'closeTab',
		'listModels',
		'waitForAgents',
	]);

/**
 * Every op a leaf sub-agent's tool list omits: the denied ones plus the useless
 * ones. Kept as the fail-closed default for callers that do not yet carry depth.
 */
export const SUBAGENT_WITHHELD_OPS: ReadonlySet<AgentControlOp> = new Set([
	...SUBAGENT_BLOCKED_OPS.keys(),
	...MANAGER_SUBAGENT_DELEGATION_OPS,
	...SUBAGENT_UNUSABLE_OPS,
]);

/**
 * Reports why a spawned sub-agent may not dispatch a control op.
 * @param op - The control op being dispatched.
 * @param depth - Validated lineage depth; missing input fails closed as a leaf.
 * @returns The model-facing denial reason, or null when the op may proceed.
 */
export function subAgentControlOpDenial(
	op: AgentControlOp,
	depth: 1 | 2 = 2,
): string | null {
	if (depth === 1 && MANAGER_SUBAGENT_DELEGATION_OPS.has(op)) {
		return null;
	}
	if (depth === 1 && op === 'spawnChatTab') {
		return 'A manager may open only fresh leaf conversations through startConversation; opening an arbitrary chat tab belongs to the root orchestrator.';
	}
	if (depth === 2 && MANAGER_SUBAGENT_DELEGATION_OPS.has(op)) {
		return (
			SUBAGENT_BLOCKED_OPS.get(op) ??
			'You are a leaf sub-agent at the maximum delegation depth. Report to your immediate parent instead of delegating or driving another conversation.'
		);
	}
	return SUBAGENT_BLOCKED_OPS.get(op) ?? null;
}

/**
 * Ops the Concierge is denied, mapped to the reason handed back. Every one of
 * them is a write channel into a workspace it deliberately cannot reach: a
 * terminal is a shell the read-only command rules cannot see into, a harness is
 * an unrestricted writer launched with approval prompts skipped, and a branch
 * name describes a body of work the Concierge is supervising rather than doing.
 *
 * `spawnChatTab` is here for a different reason: it opens an empty tab in *the
 * caller's own* workspace, and the Concierge has none. `startConversation` is
 * the op it wants, and that one takes a `workspaceId`.
 *
 * `openTab` and `listRunScripts` are here for a fourth: each reads or writes a
 * workspace surface through the caller's own workspace, which for a Concierge is
 * the empty string. Without these entries `openTab` creates an orphan tab nobody
 * can see and spends spawn quota doing it, and `listRunScripts` answers with an
 * empty list \u2014 both reporting `ok`, which reads to a model as the app having
 * done what it asked.
 *
 * `setName` and `setSummary` are here for a third: the Concierge is a panel, not
 * a chat tab, so both act on a row that does not exist. The chat-tab axis cannot
 * refuse them on its own — it reads the caller's species, and a Concierge runs
 * on the same runtimes a chat tab does, so it reports a tab the Concierge has
 * never had. Without this entry the calls reach the services and fail as
 * `not-found` and `internal`, which read to a model as faults worth retrying.
 */
const CONCIERGE_BLOCKED_OPS: ReadonlyMap<AgentControlOp, string> = new Map([
	[
		'spawnChatTab',
		'You have no workspace of your own to open a tab in. Use `ensemblr_start_conversation` with a `workspaceId` to put an orchestrator into a workspace instead.',
	],
	[
		'startReview',
		'The Review conversation opens over one workspace\u2019s change, and you have none of your own. Brief the orchestrator working there with `ensemblr_start_conversation` and let it open its own review.',
	],
	[
		'launchHarness',
		'A harness is an unrestricted writer on a worktree and launches with approval prompts skipped, which is exactly the access you do not have. Spawn an orchestrator into that workspace and let it decide what to run.',
	],
	[
		'startTerminal',
		'A terminal is a shell the read-only command rules cannot see into, so it would be a write channel around every limit you have. Say which script should run and let that workspace\u2019s own agent start it.',
	],
	[
		'stopTerminal',
		'The workspace terminals belong to the agents and the user working in them. Say in your answer which one should be stopped and why.',
	],
	[
		'writeTerminal',
		'Writing into a terminal drives a shell in a workspace you may not write to. Run your own read-only commands with `bash` instead.',
	],
	[
		'setBranchName',
		'The workspace name and its git branch describe a body of work you are supervising rather than doing. The orchestrator working there names it.',
	],
	[
		'setName',
		'You are a panel rather than a chat tab, so there is no tab title of yours to set. Name the conversations you open instead: `ensemblr_start_conversation` takes a `title`.',
	],
	[
		'setSummary',
		'You are a panel rather than a chat tab, so there is no tab record to summarize. What you would have put in one belongs in a memory file under `memory/`, which is the only thing that survives a context clear.',
	],
	[
		'exitPlanMode',
		'You do not plan on someone else\u2019s behalf: an orchestrator you spawn with `planMode: true` submits its own plan, in the workspace the plan is about.',
	],
	[
		'notifyOrchestrator',
		'You are the top of the tree \u2014 there is no orchestrator above you to signal. Put the decision to the user with `ensemblr_ask_user_question`.',
	],
	[
		'messageConcierge',
		'You are the Concierge \u2014 a message here would be addressed to yourself. Put the decision to the user with `ensemblr_ask_user_question`, or steer the agent you are thinking of with `ensemblr_send_follow_up`.',
	],
	[
		'openTab',
		'A file, diff, or comment tab opens in a workspace\u2019s own tab strip and spends that workspace\u2019s spawn budget, and you have no workspace of your own to open one in. Write the path in your answer instead \u2014 Ensemblr renders it as a chip the user clicks \u2014 or brief an orchestrator with `ensemblr_start_conversation`.',
	],
	[
		'getArchitectureDiagram',
		'The architecture diagram belongs to a workspace, and you have none of your own to read. Ask the orchestrator working there, or spawn one with `ensemblr_start_conversation`.',
	],
	[
		'updateArchitectureDiagram',
		'The architecture diagram belongs to a workspace, and you have none of your own to redraw. Brief the orchestrator working there with `ensemblr_start_conversation` if the diagram needs correcting.',
	],
	[
		'listRunScripts',
		'A run script exists to be started, and starting one is a shell in a workspace you may not write to. Read a script terminal that is already up with `ensemblr_read_terminal_output`, or ask the orchestrator working there what it runs.',
	],
]);

/** Every op the Concierge's tool list omits. */
export const CONCIERGE_WITHHELD_OPS: ReadonlySet<AgentControlOp> = new Set(
	CONCIERGE_BLOCKED_OPS.keys(),
);

/**
 * Reports why the Concierge may not dispatch a control op.
 * @param op - The control op being dispatched.
 * @returns The model-facing denial reason, or null when the op may proceed.
 */
export function conciergeControlOpDenial(op: AgentControlOp): string | null {
	return CONCIERGE_BLOCKED_OPS.get(op) ?? null;
}

/**
 * The only ops a retired Concierge child may still dispatch, and every one of
 * them exists to let it finish writing its memory files:
 * `checkPlanModeTool` is what clears each `write`/`edit` against the home — the
 * Pi extension blocks a guarded call outright when that check does not answer —
 * `getSessionBrief` carries the playbook the pass is told to apply, and
 * `recallMemory` is how it avoids filing a memory it already holds.
 */
const RETIRED_ALLOWED_OPS: ReadonlySet<AgentControlOp> = new Set([
	'checkPlanModeTool',
	'getSessionBrief',
	'recallMemory',
]);

/**
 * Reports why a retired Concierge child may not dispatch a control op.
 *
 * A clear hands the user a fresh conversation and leaves the child it replaced
 * running to write its memories, which puts a live Concierge token behind a
 * transcript the app no longer renders anywhere. Anything that child does to the
 * app would therefore happen with no visible cause and no way to trace it back —
 * a questionnaire raised here reaches nobody but still fires a desktop
 * notification, and a focus op moves the user's window for no reason they can
 * see. So the authority narrows to the file-writing turn it was left alive for
 * and everything else is refused, rather than being left to the prompt to
 * discourage.
 * @param op - The control op being dispatched.
 * @returns The model-facing denial reason, or null when the op may proceed.
 */
export function retiredControlOpDenial(op: AgentControlOp): string | null {
	return RETIRED_ALLOWED_OPS.has(op)
		? null
		: 'This conversation has been retired and is running only to write its memory files. The user is in a fresh conversation and sees nothing you do here, so acting on the app from this turn would be invisible to them. Write your memories and end the turn.';
}

/**
 * The two ops the architecture diagram feature owns, withheld from every caller
 * while the feature is off. This axis is a feature switch rather than a role
 * boundary, so it cuts across all the others: with the diagram off the ops are
 * absent from every list, the playbooks stop describing them, and the app ships
 * no skill for them.
 */
export const ARCHITECTURE_DIAGRAM_OPS: readonly AgentControlOp[] = [
	'getArchitectureDiagram',
	'updateArchitectureDiagram',
];

/**
 * The one op the third-party CLI harnesses own, withheld from every caller while
 * the feature is off. The same feature axis as {@link ARCHITECTURE_DIAGRAM_OPS}:
 * off, the op is absent from every list, the playbooks stop describing it, and
 * the app offers no way to launch one.
 */
export const TUI_HARNESS_OPS: readonly AgentControlOp[] = ['launchHarness'];

/**
 * Ops only the Concierge holds, withheld from every workspace agent because
 * each addresses the app above the workspace: navigating to another workspace,
 * cutting a new one, listing the projects any of them could be cut from, and
 * searching a memory index nothing else has. A workspace agent belongs to
 * exactly one project and cannot act on another, so the roster of the rest is
 * noise in its tool list. App settings are also above every workspace, and are
 * therefore held only by the active Concierge.
 */
export const CONCIERGE_ONLY_OPS: ReadonlySet<AgentControlOp> = new Set([
	'focusWorkspace',
	'createWorkspace',
	'listProjects',
	'recallMemory',
	'getAppSettings',
	'updateAppSettings',
]);

/**
 * Ops that act on a native chat tab and that the service refuses to a caller
 * without one: naming the tab, recording its summary, hosting a questionnaire in
 * it, and posting a plan into it. The second withholding axis alongside the
 * sub-agent one — a harness owns a terminal tab that titles itself from its own
 * session log, so all four would have nothing to act on.
 */
const CHAT_TAB_ONLY_OPS: ReadonlySet<AgentControlOp> = new Set([
	'setName',
	'setSummary',
	'askUserQuestion',
	'exitPlanMode',
]);

/**
 * Ops withheld from a root whose runtime delegates through its own sub-agent
 * tool. The user picked one mechanism, so the other is absent rather than
 * available-but-discouraged — an orchestrator holding both picks whichever its
 * training favours, which is the failure this axis exists to stop.
 *
 * The conversation reads (`getConversationStatus`, `getLastMessage`,
 * `readConversation`) and `closeTab` are deliberately absent from this set: they
 * act on the tabs the user already has open, not only on children. `listModels`
 * is here because its one use is choosing a spawned child's model.
 */
const NATIVE_DELEGATION_WITHHELD_OPS: ReadonlySet<AgentControlOp> = new Set([
	'spawnChatTab',
	'startConversation',
	'sendFollowUp',
	'waitForAgents',
	'listModels',
	// Not delegation, and withheld for a different reason than the four above:
	// driving the review it opens needs `sendFollowUp` to send the findings back
	// and `waitForAgents` to know it has reported, and this caller holds neither.
	// A review it can open but can neither wait on nor steer is worse than none,
	// so the unattended loop tells this role to get its second reading through
	// its own runtime's sub-agent mechanism instead.
	'startReview',
]);

/**
 * Every op a caller's tool list leaves out, folding all four withholding axes
 * into one answer: the ops an optional feature owns while it is switched off, the
 * chat-tab ops a caller without a tab cannot use, the ops a spawned sub-agent is
 * denied or has no use for, and the spawn ops a root delegating through its own
 * runtime does not hold. Listing a tool the service would only refuse teaches the
 * model to keep reaching for it, which is the same argument on every axis.
 *
 * The Concierge answers on its own rather than through those axes, because it is
 * not on the lineage one at all: it is neither a root that delegates nor a child
 * that was delegated to, so folding it in would mean answering "is it a
 * sub-agent?" about something that can never be one — but the feature axis still
 * applies to it, because a Concierge holding an op of a feature the user has
 * switched off would be handed something the rest of the app does not serve.
 * @param audience - Whether the caller has a chat tab, its lineage role, its delegation mechanism, and which optional features are on.
 * @returns The ops to withhold from that caller's tool list.
 */
export function withheldControlOps(
	audience: ControlAudience,
): ReadonlySet<AgentControlOp> {
	const featureWithheld = [
		...(audience.architectureDiagram ? [] : ARCHITECTURE_DIAGRAM_OPS),
		...(audience.tuiHarnesses ? [] : TUI_HARNESS_OPS),
	];
	if (audience.role === 'concierge') {
		const retiredWithheld = audience.retired
			? AGENT_CONTROL_OPS.filter((op) => retiredControlOpDenial(op) !== null)
			: [];
		return new Set([
			...CONCIERGE_WITHHELD_OPS,
			...retiredWithheld,
			...featureWithheld,
		]);
	}
	const delegatesNatively =
		audience.role === 'orchestrator' && audience.delegation === 'native';
	return new Set([
		...CONCIERGE_ONLY_OPS,
		...featureWithheld,
		...(audience.hasChatTab ? [] : CHAT_TAB_ONLY_OPS),
		...(audience.role === 'subagent'
			? [...SUBAGENT_WITHHELD_OPS].filter(
					(op) =>
						subAgentControlOpDenial(op, audience.depth === 1 ? 1 : 2) !==
							null || SUBAGENT_UNUSABLE_OPS.has(op),
				)
			: []),
		...(delegatesNatively ? NATIVE_DELEGATION_WITHHELD_OPS : []),
	]);
}

/**
 * Which delegation mechanism a caller can be told to reach for when a context
 * window fills, which is the same question {@link withheldControlOps} answers
 * about `startConversation` — so the two conditions are deliberately adjacent
 * and must move together.
 *
 * The lineage axis is read first because it outranks the mechanism one: a
 * sub-agent holds no spawn op whatever its session was opened with, since
 * `SUBAGENT_WITHHELD_OPS` applies before `NATIVE_DELEGATION_WITHHELD_OPS` is
 * even considered. The Concierge falls through to `spawns-tabs`, which is
 * correct rather than incidental — `CONCIERGE_BLOCKED_OPS` does not deny it
 * `startConversation`, because briefing workspace agents is most of what it
 * does.
 * @param audience - The caller's lineage role and delegation mechanism.
 * @returns What that caller can do about a crowded window.
 */
export function resolveContextPressureAudience(audience: {
	delegation: SubagentMechanism;
	role: AgentControlRole;
	depth?: 0 | 1 | 2;
}): ContextPressureAudience {
	if (audience.role === 'subagent') {
		return audience.depth === 1 ? 'spawns-tabs' : 'cannot-delegate';
	}
	return audience.role === 'orchestrator' && audience.delegation === 'native'
		? 'spawns-natively'
		: 'spawns-tabs';
}
