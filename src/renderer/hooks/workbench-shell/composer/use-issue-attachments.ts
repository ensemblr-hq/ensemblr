import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { linearIssueQuery } from '@/renderer/api/ensemblr';
import { formatGithubIssueDocument } from '@/renderer/lib/github';
import { i18n } from '@/renderer/lib/i18n';
import { formatLinearIssueDocument } from '@/renderer/lib/linear';
import { attachIssueDocument } from '@/renderer/lib/workbench/composer-attachments';
import { formatLinkedIssueDocument } from '@/renderer/lib/workbench/linked-issue-document';
import type {
	ComposerAttachment,
	WorkspaceLinkedIssueSummary,
} from '@/renderer/types/workbench';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import type { RepositoryIssueWire } from '@/shared/ipc/contracts/workspace-sources';

/**
 * Renders a workspace's linked issue as a document, preferring the live Linear
 * row (which brings the comments with it) and falling back to the summary the
 * workspace already stores. GitHub is remembered only by its URL, so there is no
 * row to fetch and the summary is all there is.
 * @param linkedIssue - The summary captured when the workspace was created.
 * @param queryClient - Client used to read the live Linear issue.
 * @returns The markdown document to attach.
 */
async function renderLinkedIssueDocument(
	linkedIssue: WorkspaceLinkedIssueSummary,
	queryClient: QueryClient,
): Promise<string> {
	if (linkedIssue.provider !== 'linear' || !linkedIssue.remoteId) {
		return formatLinkedIssueDocument(linkedIssue);
	}
	const detail = await queryClient
		.fetchQuery(linearIssueQuery(linkedIssue.remoteId, linkedIssue.accountId))
		.catch(() => null);
	return detail?.status === 'ok'
		? formatLinearIssueDocument(detail.issue, detail.comments)
		: formatLinkedIssueDocument(linkedIssue);
}

/**
 * Attaches a tracker issue to the composer by writing its whole content out as a
 * markdown document first. Linear rows arrive from the picker without their
 * comments, so the full issue is fetched before rendering — the point of the
 * attachment is that the agent never has to go and look the issue up.
 * @param addAttachments - Sink that appends the finished attachment to the draft
 * @param setAttachmentError - Sink for a failure the composer should surface
 * @param workspaceCwd - Absolute workspace root the document is saved under
 * @returns Callbacks for attaching a Linear issue, a GitHub issue, and the issue
 * a workspace was created from
 */
export function useIssueAttachments({
	addAttachments,
	setAttachmentError,
	workspaceCwd,
}: {
	addAttachments: (incoming: readonly ComposerAttachment[]) => void;
	setAttachmentError: (error: string | null) => void;
	workspaceCwd: string;
}) {
	const queryClient = useQueryClient();

	const attach = useCallback(
		async (
			provider: 'github' | 'linear',
			reference: string,
			renderDocument: () => Promise<string>,
		): Promise<boolean> => {
			setAttachmentError(null);
			try {
				addAttachments([
					await attachIssueDocument({
						document: await renderDocument(),
						provider,
						reference,
						workspaceCwd,
					}),
				]);
				return true;
			} catch (cause) {
				setAttachmentError(
					cause instanceof Error
						? cause.message
						: i18n.t(
								'errors:attachment.issue-failed.message',
								'Issue could not be attached.',
							),
				);
				return false;
			}
		},
		[addAttachments, setAttachmentError, workspaceCwd],
	);

	return {
		attachGithubIssue: useCallback(
			(issue: RepositoryIssueWire) =>
				attach('github', `#${issue.number}`, async () =>
					formatGithubIssueDocument(issue),
				),
			[attach],
		),
		attachLinearIssue: useCallback(
			(issue: LinearIssueWire) =>
				attach('linear', issue.identifier, async () => {
					const detail = await queryClient
						.fetchQuery(linearIssueQuery(issue.id, issue.accountId))
						.catch(() => null);
					return detail?.status === 'ok'
						? formatLinearIssueDocument(detail.issue, detail.comments)
						: formatLinearIssueDocument(issue);
				}),
			[attach, queryClient],
		),
		attachLinkedIssue: useCallback(
			(linkedIssue: WorkspaceLinkedIssueSummary) =>
				attach(linkedIssue.provider, linkedIssue.reference, () =>
					renderLinkedIssueDocument(linkedIssue, queryClient),
				),
			[attach, queryClient],
		),
	};
}
