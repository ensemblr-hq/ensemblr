import type { AgentControlContextUsage } from './contracts.ts';

/**
 * Share of a context window, in percent, past which a conversation stops being
 * the cheapest place to put the next unit of work.
 *
 * Compared directly against what a runtime reports, which is
 * `(tokens / contextWindow) * 100` — a 0-100 scale rather than a 0-1 fraction.
 * The number is deliberately well below the point where a conversation is
 * actually in trouble: the move it prompts is handing the *next* piece of work
 * to a fresh conversation, and that is only an option while there is still room
 * to brief one.
 */
export const CONTEXT_PRESSURE_PERCENT = 50;

/**
 * What the caller can actually do about a crowded window, which is the only
 * thing the advice varies on.
 *
 * Named for the capability rather than for the role because two different roles
 * can share one answer and one role can change answer with its session's
 * delegation mechanism. `spawns-tabs` holds the Ensemblr spawn ops;
 * `spawns-natively` delegates through its own runtime's sub-agent tool and has
 * those ops withheld; `cannot-delegate` is a spawned sub-agent, which has no
 * mechanism at all and can only report. Naming the wrong one sends a model after
 * a tool its list does not carry, which is the failure this axis exists to stop.
 */
export type ContextPressureAudience =
	| 'spawns-tabs'
	| 'spawns-natively'
	| 'cannot-delegate';

/**
 * One conversation's reading, labelled by the session it belongs to. Shaped to
 * match `AgentControlConversationStatus`, `WaitedAgent`, and `PendingAgent`
 * structurally, so every result that carries a reading can be passed straight to
 * {@link delegateContextPressureNote} without being remapped first.
 */
export interface LabelledContextUsage {
	agentSessionId: string;
	contextUsage: AgentControlContextUsage | null;
}

/**
 * Whether a reading has reached the point where a fresh conversation is the
 * better home for further work. An unknown reading is not pressure: a runtime
 * that has reported no percentage yet must not be treated as a crowded one.
 * @param usage - The conversation's reading, or null when none was reported.
 * @returns True when the window is at least {@link CONTEXT_PRESSURE_PERCENT} full.
 */
export function isUnderContextPressure(
	usage: AgentControlContextUsage | null | undefined,
): boolean {
	if (!usage || usage.percent === null) {
		return false;
	}
	return usage.percent >= CONTEXT_PRESSURE_PERCENT;
}

/**
 * Renders a reading for prose, as a whole percent.
 * @param usage - A reading known to carry a percentage.
 * @returns The percentage, rounded.
 */
function wholePercent(usage: AgentControlContextUsage): number {
	return Math.round(usage.percent ?? 0);
}

/**
 * Where each audience puts the next unit of reading once its own window fills.
 *
 * A sub-agent gets no delegation clause at all: it cannot spawn, so an
 * instruction to hand work onward would name a mechanism it does not have. What
 * it can do instead is tell its orchestrator, which is the one reader able to
 * act on the number.
 */
const OWN_PRESSURE_MOVE: Record<ContextPressureAudience, string> = {
	'cannot-delegate': `You were spawned for one unit of work and cannot delegate onward, so there is no sub-agent to hand the next read to: narrow what is left to what your deliverable actually needs, and report. Say in your report that your window is filling, and carry the paths and findings you have gathered into it, so the orchestrator continues in a fresh child rather than following up here.`,
	'spawns-natively': `Hand the next unit of reading to your own runtime's sub-agent tool — a survey, a log triage, a sweep confirming a fix landed — quoting the paths and facts you already have so it does not re-derive them, and keep the deciding here. Ensemblr's spawn ops are withheld from your list in this mode, so do not go looking for one. Anything worth keeping past this conversation belongs in a file before the window runs out.`,
	'spawns-tabs': `Hand the next unit of reading to a sub-agent with ensemblr_start_conversation — a survey, a log triage, a sweep confirming a fix landed — quoting the paths and facts you already have so it does not re-derive them, and keep the deciding here. Anything worth keeping past this conversation belongs in a file before the window runs out.`,
};

/**
 * What each audience can do about a crowded conversation that is not its own.
 *
 * Only `spawns-tabs` can act on the reading directly, and it is the only one
 * told about the exception — an orchestrator that abandons a child mid-thread
 * pays to rebuild its context somewhere else. The other two hold neither the
 * spawn ops nor `sendFollowUp`, so for them the reading is something to route
 * around or to pass upward, never a conversation to reload.
 */
const DELEGATE_PRESSURE_MOVE: Record<ContextPressureAudience, string> = {
	'cannot-delegate': `You can neither spawn a conversation nor steer one from here, so this is a reading to pass on rather than a move you can make: name the crowded conversation in your report, so the orchestrator gives its next unit of work to a fresh child rather than following up there.`,
	'spawns-natively': `Ensemblr's spawn and follow-up ops are withheld from your list in this mode, so this is a reading rather than a move you can make here: put a NEW unit of work through your own runtime's sub-agent tool instead of routing it to one of these, and quote it the paths and findings it needs.`,
	'spawns-tabs': `For a NEW unit of work, spawn a fresh conversation with ensemblr_start_conversation rather than sending a follow-up: everything one of these has already read stays in it, so it starts the next task with less room than a new child would. Quote the paths and findings the fresh one needs, or it re-derives them. Follow up anyway when the work genuinely depends on what that conversation already holds — rebuilding that context elsewhere costs more than the room it saves.`,
};

/**
 * The advice a caller gets about its own window once that window is filling.
 *
 * Aimed at the decision the number actually changes — where the *next* unit of
 * reading happens — rather than at the conversation itself, which cannot move.
 * @param usage - The caller's own reading, or null when none was reported.
 * @param audience - What the caller can do about the reading.
 * @returns The note, or null when the window has room.
 */
export function ownContextPressureNote(
	usage: AgentControlContextUsage | null,
	audience: ContextPressureAudience,
): string | null {
	if (!usage || !isUnderContextPressure(usage)) {
		return null;
	}
	return `Your own context window is ${wholePercent(usage)}% full. What you have left is the budget for the rest of this task, and nothing you have already read leaves it. ${OWN_PRESSURE_MOVE[audience]}`;
}

/**
 * The advice a caller gets about conversations it is reading that have filled
 * past the threshold.
 *
 * States the exception as well as the rule for the one audience that can act on
 * it: a follow-up is still the right call when the work depends on what that
 * conversation already holds, and an orchestrator that abandons a child
 * mid-thread pays to rebuild its context somewhere else.
 * @param readings - Every conversation the result reports on, with its reading.
 * @param audience - What the caller can do about a crowded conversation.
 * @returns The note, or null when none of them is crowded.
 */
export function delegateContextPressureNote(
	readings: readonly LabelledContextUsage[],
	audience: ContextPressureAudience,
): string | null {
	const crowded = readings.flatMap((entry) =>
		entry.contextUsage && isUnderContextPressure(entry.contextUsage)
			? [`"${entry.agentSessionId}" (${wholePercent(entry.contextUsage)}%)`]
			: [],
	);
	if (crowded.length === 0) {
		return null;
	}
	const named = crowded.join(', ');
	return `Context pressure: ${named} — at or past ${CONTEXT_PRESSURE_PERCENT}% of window. ${DELEGATE_PRESSURE_MOVE[audience]}`;
}
