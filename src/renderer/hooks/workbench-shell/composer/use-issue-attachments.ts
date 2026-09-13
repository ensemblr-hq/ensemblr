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
	ComposerIssueAttachment,
	WorkspaceLinkedIssueSummary,
} from '@/renderer/types/workbench';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import type { RepositoryIssueWire } from '@/shared/ipc/contracts/workspace-sources';

/**
 * Reads one Linear issue with its comments and renders the document the agent
 * gets. Answers null when the read failed, so a caller that already attached the
 * shorter document keeps it rather than replacing it with something thinner.
 * @param queryClient - Client used to read the live Linear issue.
 * @param id - Issue UUID to read.
 * @param accountId - Account owning the issue, when the caller knows it.
 * @returns The markdown document, or null when Linear could not be read.
 */
async function renderLinearIssueDocument(
	queryClient: QueryClient,
	id: string,
	accountId?: string,
): Promise<string | null> {
	const detail = await queryClient
		.fetchQuery(linearIssueQuery(id, accountId))
		.catch(() => null);
	return detail?.status === 'ok'
		? formatLinearIssueDocument(detail.issue, detail.comments)
		: null;
}

/**
 * Attaches a tracker issue to the composer by writing its whole content out as a
 * markdown document, so the agent never has to go and look the issue up.
 *
 * Attaching happens in two passes, because a Linear row's comments are a
 * separate read from Linear that regularly runs to several seconds. The chip
 * lands immediately from what the picker already holds — identifier, metadata
 * and the description, all of which the list sync already cached — and the
 * comments are written in behind it, repointing the chip at the fuller document.
 * Waiting for that read before showing anything left the user watching a
 * dismissed dialog and an empty composer for the whole round-trip.
 *
 * The store is content-addressed, so the second write lands at its own path and
 * the chip is moved onto it; a second pass that adds nothing resolves to the
 * path already attached and is dropped. GitHub issues arrive whole from `gh` and
 * take the first pass only.
 * @param addAttachments - Sink that appends the finished attachment to the draft
 * @param setAttachmentError - Sink for a failure the composer should surface
 * @param updateAttachment - Sink that repoints an attached chip at a new document
 * @param workspaceCwd - Absolute workspace root the document is saved under
 * @returns Callbacks for attaching a Linear issue, a GitHub issue, and the issue
 * a workspace was created from
 */
export function useIssueAttachments({
	addAttachments,
	setAttachmentError,
	updateAttachment,
	workspaceCwd,
}: {
	addAttachments: (incoming: readonly ComposerAttachment[]) => void;
	setAttachmentError: (error: string | null) => void;
	updateAttachment: (id: string, attachment: ComposerAttachment) => void;
	workspaceCwd: string;
}) {
	const queryClient = useQueryClient();

	const attach = useCallback(
		async (
			provider: 'github' | 'linear',
			reference: string,
			document: string,
		): Promise<ComposerIssueAttachment | null> => {
			setAttachmentError(null);
			try {
				const attachment = await attachIssueDocument({
					document,
					provider,
					reference,
					workspaceCwd,
				});
				addAttachments([attachment]);
				return attachment;
			} catch (cause) {
				setAttachmentError(
					cause instanceof Error
						? cause.message
						: i18n.t(
								'errors:attachment.issue-failed.message',
								'Issue could not be attached.',
							),
				);
				return null;
			}
		},
		[addAttachments, setAttachmentError, workspaceCwd],
	);

	/**
	 * Writes the fuller document behind an already-attached chip and repoints the
	 * chip at it. Never rejects, and surfaces nothing to the user: the chip carries
	 * a real document already, so a read that failed or added nothing leaves the
	 * shorter one standing rather than raising an error over a draft that is fine.
	 * Nobody awaits this, so anything thrown would otherwise land as an unhandled
	 * rejection — it goes to the console instead, where a bug in here is still
	 * findable without costing the user a message about a draft that works.
	 *
	 * `provider` is the one the chip was attached under rather than a constant,
	 * because {@link attachIssueDocument} builds the attachment id from it; a
	 * mismatch would repoint the chip onto a payload whose id disagrees with the
	 * key the draft finds it by, after which removing it silently stops working.
	 * @param attached - The chip the first pass put in the draft
	 * @param attachedDocument - What the first pass wrote, to spot a no-op rewrite
	 * @param provider - Tracker the chip was attached under
	 * @param reference - Human issue reference the document is filed under
	 * @param renderFuller - Reads the fuller document, or null when it cannot
	 */
	const upgrade = useCallback(
		async ({
			attached,
			attachedDocument,
			provider,
			reference,
			renderFuller,
		}: {
			attached: ComposerIssueAttachment;
			attachedDocument: string;
			provider: 'github' | 'linear';
			reference: string;
			renderFuller: () => Promise<string | null>;
		}): Promise<void> => {
			try {
				const document = await renderFuller();
				if (document === null || document === attachedDocument) {
					return;
				}
				const fuller = await attachIssueDocument({
					document,
					provider,
					reference,
					workspaceCwd,
				});
				if (fuller.path !== attached.path) {
					updateAttachment(attached.id, fuller);
				}
			} catch (cause) {
				console.error('Failed to attach the full issue document:', cause);
			}
		},
		[updateAttachment, workspaceCwd],
	);

	return {
		attachGithubIssue: useCallback(
			async (issue: RepositoryIssueWire): Promise<boolean> =>
				(await attach(
					'github',
					`#${issue.number}`,
					formatGithubIssueDocument(issue),
				)) !== null,
			[attach],
		),
		attachLinearIssue: useCallback(
			async (issue: LinearIssueWire): Promise<boolean> => {
				const document = formatLinearIssueDocument(issue);
				const attached = await attach('linear', issue.identifier, document);
				if (!attached) {
					return false;
				}
				void upgrade({
					attached,
					attachedDocument: document,
					provider: 'linear',
					reference: issue.identifier,
					renderFuller: () =>
						renderLinearIssueDocument(queryClient, issue.id, issue.accountId),
				});
				return true;
			},
			[attach, queryClient, upgrade],
		),
		attachLinkedIssue: useCallback(
			async (linkedIssue: WorkspaceLinkedIssueSummary): Promise<boolean> => {
				const document = formatLinkedIssueDocument(linkedIssue);
				const attached = await attach(
					linkedIssue.provider,
					linkedIssue.reference,
					document,
				);
				if (!attached) {
					return false;
				}
				const remoteId = linkedIssue.remoteId;
				if (linkedIssue.provider === 'linear' && remoteId) {
					void upgrade({
						attached,
						attachedDocument: document,
						provider: 'linear',
						reference: linkedIssue.reference,
						renderFuller: () =>
							renderLinearIssueDocument(
								queryClient,
								remoteId,
								linkedIssue.accountId,
							),
					});
				}
				return true;
			},
			[attach, queryClient, upgrade],
		),
	};
}
