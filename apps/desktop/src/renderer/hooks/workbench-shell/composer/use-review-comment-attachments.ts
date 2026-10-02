import type { TFunction } from 'i18next';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { attachReviewComment } from '@/renderer/lib/workbench/composer-attachments';
import { useComposerAttachmentInsert } from '@/renderer/state/composer';
import type { PullRequestCommentSummary } from '@/renderer/types/workbench';

/**
 * How many comments one bulk "Add all to chat" may attach. Each comment becomes
 * a document the composer inlines whole, so an unbounded batch on a busy pull
 * request would spend the agent's context before the user's own question is
 * read. Past the cap the rest stay on their rows, and the toast says how many
 * landed rather than leaving the shortfall silent.
 */
const MAX_BULK_ATTACHMENTS = 10;

/**
 * Reports how attaching one comment went.
 * @param t - Translator for the toast copy
 * @param failed - How many of the one comment failed to write
 */
function reportSingle(t: TFunction, failed: number): void {
	if (failed > 0) {
		toast.error(
			t(
				'errors:attachment.review-comment-failed.message',
				'Comment could not be attached.',
			),
		);
		return;
	}
	toast.success(
		t('review:comment.added-to-chat.title', 'Comment is attached to the chat.'),
	);
}

/**
 * Reports how a batch went, naming the shortfall whenever the user ends up with
 * fewer chips than comments — because the cap trimmed the batch or because a
 * thread would not write.
 * @param t - Translator for the toast copy
 * @param counts - How many were requested, attempted, and failed
 */
function reportBatch(
	t: TFunction,
	counts: { attempted: number; failed: number; requested: number },
): void {
	if (counts.failed > 0) {
		toast.error(
			t(
				'errors:attachment.review-comments-failed.message',
				'{{count}} of {{total}} comments could not be attached.',
				{ count: counts.failed, total: counts.attempted },
			),
		);
		return;
	}
	if (counts.attempted < counts.requested) {
		toast.success(
			t(
				'review:comments.added-to-chat.capped',
				'{{count}} of {{total}} comments attached — add the rest from their rows.',
				{ count: counts.attempted, total: counts.requested },
			),
		);
		return;
	}
	toast.success(
		t(
			'review:comments.added-to-chat.title',
			'Outstanding comments are attached to the chat.',
		),
	);
}

/**
 * Attaches review comments to the composer as chips, the one path the Checks
 * panel and the comment preview both take. Each comment is written out as a
 * markdown document and dropped in the draft where the user is typing.
 *
 * A comment that fails to write is skipped rather than taking the batch down
 * with it, so one unreadable thread cannot block the other five — the toast then
 * reports how many of them fell out.
 * @param prNumber - The pull request the comments belong to, when known
 * @param workspaceCwd - Absolute workspace root the documents are saved under
 * @returns Callbacks attaching one comment and attaching a batch of them
 */
export function useReviewCommentAttachments({
	prNumber,
	workspaceCwd,
}: {
	prNumber?: number;
	workspaceCwd: string;
}): {
	attachComment: (comment: PullRequestCommentSummary) => void;
	attachComments: (comments: readonly PullRequestCommentSummary[]) => void;
} {
	const { t } = useTranslation();
	const insertAttachment = useComposerAttachmentInsert(workspaceCwd);

	const attachAll = useCallback(
		async (selected: readonly PullRequestCommentSummary[]): Promise<number> => {
			const settled = await Promise.allSettled(
				selected.map((comment) =>
					attachReviewComment({ comment, prNumber, workspaceCwd }),
				),
			);
			for (const result of settled) {
				if (result.status === 'fulfilled') {
					insertAttachment(result.value);
				}
			}
			return settled.filter((result) => result.status === 'rejected').length;
		},
		[insertAttachment, prNumber, workspaceCwd],
	);

	return useMemo(
		() => ({
			attachComment(comment) {
				void attachAll([comment]).then((failed) => {
					reportSingle(t, failed);
				});
			},
			attachComments(comments) {
				const attempted = comments.slice(0, MAX_BULK_ATTACHMENTS);
				void attachAll(attempted).then((failed) => {
					reportBatch(t, {
						attempted: attempted.length,
						failed,
						requested: comments.length,
					});
				});
			},
		}),
		[attachAll, t],
	);
}
