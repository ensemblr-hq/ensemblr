/**
 * The block a workspace agent's message to the Concierge arrives as.
 *
 * Messaging upward is the one control op whose payload is read by another model
 * rather than by the app, so the framing is the feature. The Concierge is
 * supervising several workspaces at once and has no way to tell an orchestrator's
 * report from something the user typed: both land in the same composer, as the
 * same kind of turn. Without a header naming the sender it would answer a
 * blocked agent as if the human had asked, and act on a workspace it was never
 * told the message came from.
 *
 * Rendered in `shared/` rather than at the port so the wording is one string both
 * the delivering port and its test read, and so the reason vocabulary sits beside
 * the contract that fixes it.
 */

/**
 * Why a workspace agent is messaging the Concierge. The first four are
 * {@link OrchestratorSignalReason}'s, deliberately: signalling upward is one act
 * whether the recipient is the agent that spawned you or the Concierge above it,
 * and two vocabularies for it would make a model pick by feel. `brief_wrong` is
 * the one the Concierge alone can act on — only the agent that wrote the brief
 * can correct it.
 */
export const CONCIERGE_MESSAGE_REASONS = [
	'need_decision',
	'blocked',
	'brief_wrong',
	'progress',
	'done',
] as const;

/** A single reason a message to the Concierge carries. */
export type ConciergeMessageReason = (typeof CONCIERGE_MESSAGE_REASONS)[number];

/** Upper bound on a message to the Concierge. */
export const CONCIERGE_MESSAGE_LIMITS = {
	maxMessageLength: 4_000,
} as const;

/** The line each reason renders as, in the Concierge's own reading order. */
const REASON_HEADLINES: Readonly<Record<ConciergeMessageReason, string>> = {
	blocked: 'is blocked and cannot finish without something outside its reach',
	brief_wrong: 'reports that the brief it was given is wrong',
	done: 'reports that the work it was given is finished',
	need_decision: 'needs a decision before it can carry on',
	progress: 'is reporting progress, and wants nothing back',
};

/**
 * Names what the Concierge should do about each reason. Split from the headline
 * because the two answer different questions — what happened, and whether this
 * turn owes a reply — and a model handed only the first treats every message as
 * something to act on, including the progress note that explicitly is not.
 */
const REASON_GUIDANCE: Readonly<Record<ConciergeMessageReason, string>> = {
	blocked:
		'Decide what unblocks it and say so with `ensemblr_send_follow_up`, or tell the user this needs them. Do not re-brief it with the same instruction.',
	brief_wrong:
		'You wrote that brief, so you are the only one who can correct it. Re-read what you sent, decide whether the agent is right, and either correct it with `ensemblr_send_follow_up` or say why the brief stands.',
	done: 'Read its last message with `ensemblr_get_last_message` before you act on this — "finished" is the agent\'s own account of its work, not a verified one.',
	need_decision:
		'Answer it with `ensemblr_send_follow_up` if the decision is yours to make, or put it to the user with `ensemblr_ask_user_question` if it is theirs. It is waiting.',
	progress:
		'Nothing is being asked of you. Do not reply to it, and do not start a turn of work off the back of this alone.',
};

/** Where a message came from, as the app resolves it rather than as the agent claims. */
export interface ConciergeMessageSender {
	/** Session id of the sending agent, for `ensemblr_send_follow_up`. */
	agentSessionId: string;
	/** The sender's chat tab title, or null when it has none the app can name. */
	tabTitle: string | null;
	/** The workspace the sender is working in, named as the sidebar names it. */
	workspaceName: string | null;
	workspaceId: string;
}

/**
 * Renders the message the Concierge's conversation receives as a turn.
 *
 * Every identifying field is the app's own resolution of the caller's control
 * token rather than anything the agent passed, so a sending agent cannot claim to
 * be working in a workspace it is not — which matters more here than on any other
 * op, because the Concierge acts on other workspaces on the strength of it.
 * @param input - The resolved sender, the reason, and the agent's own prose.
 * @returns The prompt text to submit into the Concierge conversation.
 */
export function buildConciergeMessage(input: {
	message: string;
	reason: ConciergeMessageReason;
	sender: ConciergeMessageSender;
}): string {
	const { message, reason, sender } = input;
	const where = sender.workspaceName ?? sender.workspaceId;
	const who = sender.tabTitle ? `"${sender.tabTitle}" in ${where}` : where;
	return [
		`MESSAGE FROM AN AGENT — the orchestrator ${who} ${REASON_HEADLINES[reason]}. This is not the user speaking; it is an agent working in a workspace, addressing you directly. ${REASON_GUIDANCE[reason]}`,
		'',
		`Its session id is \`${sender.agentSessionId}\` and its workspace id is \`${sender.workspaceId}\`, which is what \`ensemblr_send_follow_up\` and the workspace-addressed ops take.`,
		'',
		'---',
		'',
		message,
	].join('\n');
}
