import { ExternalLinkIcon, MessageSquarePlusIcon } from 'lucide-react';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { CommentMarkdown } from '@/renderer/components/comment-markdown';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { formatCommentLocation } from '@/renderer/lib/workbench/comment-body';
import { getProviderLabel } from '@/renderer/lib/workbench/provider-label';
import { formatRowDate } from '@/renderer/lib/workbench/relative-time';
import { formatCommentContext } from '@/renderer/lib/workbench/review-context';
import { useComposerInsert } from '@/renderer/state/composer';
import type {
	CommentPreviewPayload,
	PullRequestCommentReplySummary,
} from '@/renderer/types/workbench';
import { ProviderMark } from '../checks-panel/provider-mark';

/**
 * Read-only preview of a single PR comment, opened as a main-surface `document`
 * tab from the Checks panel. The full body renders as markdown, with the diff
 * anchor, timestamp, and thread replies alongside it; the comment's own "Add to
 * chat" reuses the same context formatter the Checks panel uses.
 */
export function CommentPreviewPanel({
	comment,
}: {
	comment: CommentPreviewPayload;
}) {
	const insertIntoComposer = useComposerInsert();

	const addToChat = useCallback(() => {
		insertIntoComposer(formatCommentContext(comment, comment.prNumber));
		toast.success('Comment added to chat.');
	}, [comment, insertIntoComposer]);

	return (
		<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<CommentPreviewHeader comment={comment} onAddToChat={addToChat} />
			<ScrollArea className='min-h-0 flex-1'>
				<div className='flex flex-col gap-4 p-4 text-sm'>
					<CommentMarkdown body={comment.body} />
					{comment.replies?.map((reply) => (
						<CommentReply key={reply.id} reply={reply} />
					))}
				</div>
			</ScrollArea>
		</div>
	);
}

/** Identity row for the previewed comment: who wrote it, its state, and its actions. */
function CommentPreviewHeader({
	comment,
	onAddToChat,
}: {
	comment: CommentPreviewPayload;
	onAddToChat: () => void;
}) {
	return (
		<div className='flex shrink-0 items-start justify-between gap-2 border-border border-b px-4 py-2.5'>
			<div className='flex min-w-0 flex-col gap-0.5 overflow-hidden'>
				<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
					<ProviderMark provider={comment.provider} />
					<span className='min-w-0 truncate font-semibold text-sm'>
						{comment.author ?? getProviderLabel(comment.provider)}
					</span>
					{comment.isResolved === false ? (
						<span className='shrink-0 rounded-sm bg-status-warning/15 px-1 text-status-warning text-xxs'>
							Unresolved
						</span>
					) : null}
					{comment.isOutdated ? (
						<span className='shrink-0 rounded-sm bg-muted px-1 text-muted-foreground text-xxs'>
							Outdated
						</span>
					) : null}
				</div>
				<CommentMeta
					createdAt={comment.createdAt}
					location={formatCommentLocation(comment.path, comment.line)}
					replyCount={comment.replies?.length ?? 0}
				/>
			</div>
			<div className='flex shrink-0 items-center gap-0.5'>
				<Button onClick={onAddToChat} size='icon-sm' variant='ghost'>
					<MessageSquarePlusIcon />
					<span className='sr-only'>Add comment to chat</span>
				</Button>
				{comment.url ? (
					<Button asChild size='icon-sm' variant='ghost'>
						<a
							aria-label={`Open comment on ${getProviderLabel(comment.provider)}`}
							href={comment.url}
							rel='noreferrer'
							target='_blank'
						>
							<ExternalLinkIcon />
						</a>
					</Button>
				) : null}
			</div>
		</div>
	);
}

/** Sub-header line carrying the comment's diff anchor, date, and reply count. */
function CommentMeta({
	createdAt,
	location,
	replyCount,
}: {
	createdAt?: string;
	location: string;
	replyCount: number;
}) {
	const parts = [
		location,
		createdAt ? formatRowDate(createdAt) : '',
		replyCount > 0
			? `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
			: '',
	].filter(Boolean);

	if (parts.length === 0) {
		return null;
	}

	return (
		<span className='min-w-0 truncate font-mono text-muted-foreground text-xxs'>
			{parts.join(' · ')}
		</span>
	);
}

/** One reply on the thread, indented under the head comment. */
function CommentReply({ reply }: { reply: PullRequestCommentReplySummary }) {
	return (
		<div className='flex flex-col gap-1 border-border border-l-2 pl-3'>
			<span className='truncate font-mono text-muted-foreground text-xxs'>
				{[reply.author, reply.createdAt ? formatRowDate(reply.createdAt) : '']
					.filter(Boolean)
					.join(' · ')}
			</span>
			<CommentMarkdown body={reply.body} />
		</div>
	);
}
