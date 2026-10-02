import { resolveLinkedIssueSeed } from '@/renderer/lib/workbench';
import type { WorkspaceLinkedIssueSummary } from '@/renderer/types/workbench';
import { useWorkspaceConversationStarted } from './use-workspace-conversation-started';

/**
 * The issue this chat's composer opens with, reading the workspace-wide gate the
 * decision needs.
 *
 * The whole decision lives here rather than in the component so it can be
 * exercised without one: the bug this replaces was the composer gating on its own
 * tab having no session, which is true of every fresh tab forever and so
 * re-offered the ticket in every chat opened after the first.
 * @param agentSessionId - Agent session this chat tab is bound to, when it has one.
 * @param linkedIssue - The issue the workspace was created from, when there is one.
 * @param workspaceId - Workspace whose conversation history gates the seed.
 * @returns The issue to seed into this chat, or undefined when it opens blank.
 */
export function useLinkedIssueComposerSeed({
	agentSessionId,
	linkedIssue,
	workspaceId,
}: {
	agentSessionId: string | null;
	linkedIssue: WorkspaceLinkedIssueSummary | undefined;
	workspaceId: string;
}): WorkspaceLinkedIssueSummary | undefined {
	const conversationStarted = useWorkspaceConversationStarted(workspaceId);
	return resolveLinkedIssueSeed({
		agentSessionId,
		conversationStarted,
		linkedIssue,
	});
}
