import { MessageSquareIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CommentMarkdown } from '@/renderer/components/comment-markdown';
import { formatRelativeTimestamp } from '@/renderer/lib/workbench/relative-time';
import type { LinearCommentWire } from '@/shared/ipc/contracts/linear';

import { LinearAvatar } from './issue-avatar';

/**
 * A Linear issue's comment thread. Bodies render as markdown, the way Linear
 * itself stores and shows them — the raw source this replaced turned a quoted
 * design link into three lines of `>` and bracket noise.
 */
export function LinearIssueComments({
	comments,
}: {
	comments: LinearCommentWire[];
}) {
	const { t } = useTranslation();

	return (
		<section className='flex flex-col gap-3'>
			<h2 className='flex items-center gap-2 font-medium text-muted-foreground text-xs'>
				<MessageSquareIcon aria-hidden='true' className='size-3.5' />
				{t('linear:issue-detail.comments', 'Comments')}
				{comments.length > 0 ? (
					<span className='tabular-nums'>{comments.length}</span>
				) : null}
			</h2>
			{comments.length === 0 ? (
				<p className='text-muted-foreground text-xs'>
					{t('linear:issue-detail.no-comments', 'No comments yet.')}
				</p>
			) : (
				<ul className='flex flex-col gap-4'>
					{comments.map((comment) => (
						<IssueComment comment={comment} key={comment.id} />
					))}
				</ul>
			)}
		</section>
	);
}

/** One comment: who wrote it, when, and its markdown body. */
function IssueComment({ comment }: { comment: LinearCommentWire }) {
	const { t } = useTranslation();
	const author =
		comment.authorName ?? t('linear:issue-detail.unknown-author', 'Unknown');

	return (
		<li className='flex min-w-0 gap-2.5'>
			<LinearAvatar className='mt-0.5 size-6' name={comment.authorName} />
			<div className='flex min-w-0 flex-1 flex-col gap-1'>
				<div className='flex min-w-0 items-baseline gap-2'>
					<span className='truncate font-medium text-foreground text-xs'>
						{author}
					</span>
					{comment.createdAt ? (
						<time
							className='shrink-0 text-muted-foreground text-xxs'
							dateTime={comment.createdAt}
							title={new Date(comment.createdAt).toLocaleString()}
						>
							{formatRelativeTimestamp(comment.createdAt)}
						</time>
					) : null}
				</div>
				<CommentMarkdown body={comment.body} className='text-sm' />
			</div>
		</li>
	);
}
