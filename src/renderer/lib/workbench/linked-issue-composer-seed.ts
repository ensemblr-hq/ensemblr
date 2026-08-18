/**
 * Builds the first-prompt composer draft for a workspace created from an issue:
 * one headline reading `reference title`. Offered for the user to edit and send
 * — never auto-submitted.
 *
 * Deliberately *not* the issue's contents. Those ride along as an attachment
 * chip carrying the full issue document, so pasting the body here too would send
 * the agent the same text twice and put the only complete copy behind an
 * editable, deletable textbox. The headline stays so the draft reads as being
 * about something rather than opening blank.
 */

import type {
	LinkedIssueComposerSeedInput,
	WorkspaceLinkedIssueSummary,
} from '@/renderer/types/workbench';

/** Formats a linked issue's headline into the first-prompt composer draft. */
export function formatLinkedIssueComposerSeed(
	issue: LinkedIssueComposerSeedInput,
): string {
	return `${issue.reference} ${issue.title}`.trim();
}

/**
 * The issue a chat's composer should open with, or undefined when there is
 * nothing to seed.
 *
 * A workspace hands its issue to one conversation, not to every chat ever opened
 * in it: `conversationStarted` is the workspace-wide gate, and once any agent
 * session exists there the ticket has been delivered. An unsettled gate
 * (`null`) seeds nothing either, because re-offering the ticket on a list that
 * has not loaded would put it back in front of a user who already sent it.
 * @param agentSessionId - Agent session this chat tab is bound to, when it has one
 * @param conversationStarted - Whether the workspace holds an agent session, or null while unknown
 * @param linkedIssue - The issue the workspace was created from, when there is one
 * @returns The issue to seed, or undefined when this chat opens blank
 */
export function resolveLinkedIssueSeed({
	agentSessionId,
	conversationStarted,
	linkedIssue,
}: {
	agentSessionId: string | null;
	conversationStarted: boolean | null;
	linkedIssue: WorkspaceLinkedIssueSummary | undefined;
}): WorkspaceLinkedIssueSummary | undefined {
	return linkedIssue && conversationStarted === false && !agentSessionId
		? linkedIssue
		: undefined;
}
