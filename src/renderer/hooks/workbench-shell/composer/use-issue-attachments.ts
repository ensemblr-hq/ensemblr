import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { linearIssueQuery } from '@/renderer/api/ensemblr';
import { formatGithubIssueDocument } from '@/renderer/lib/github';
import { i18n } from '@/renderer/lib/i18n';
import { formatLinearIssueDocument } from '@/renderer/lib/linear';
import { attachIssueDocument } from '@/renderer/lib/workbench/composer-attachments';
import type { ComposerAttachment } from '@/renderer/types/workbench';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import type { RepositoryIssueWire } from '@/shared/ipc/contracts/workspace-sources';

/**
 * Attaches a tracker issue to the composer by writing its whole content out as a
 * markdown document first. Linear rows arrive from the picker without their
 * comments, so the full issue is fetched before rendering — the point of the
 * attachment is that the agent never has to go and look the issue up.
 * @param addAttachments - Sink that appends the finished attachment to the draft
 * @param setAttachmentError - Sink for a failure the composer should surface
 * @param workspaceCwd - Absolute workspace root the document is saved under
 * @returns Callbacks for attaching a Linear and a GitHub issue
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
		) => {
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
			} catch (cause) {
				setAttachmentError(
					cause instanceof Error
						? cause.message
						: i18n.t(
								'errors:attachment.issue-failed.message',
								'Issue could not be attached.',
							),
				);
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
	};
}
