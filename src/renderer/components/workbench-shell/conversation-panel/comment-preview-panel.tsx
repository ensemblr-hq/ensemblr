import { ExternalLinkIcon, MessageSquarePlusIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { CommentMarkdown } from '@/renderer/components/comment-markdown';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useReviewCommentAttachments } from '@/renderer/hooks/workbench-shell/composer/use-review-comment-attachments';
import { cn } from '@/renderer/lib/utils';
import { formatCommentLocation } from '@/renderer/lib/workbench/comment-body';
import { getProviderLabel } from '@/renderer/lib/workbench/provider-label';
import { formatRowDate } from '@/renderer/lib/workbench/relative-time';
import type {
	CommentPreviewPayload,
	PullRequestCommentReplySummary,
} from '@/renderer/types/workbench';
import { ProviderMark } from '../checks-panel/provider-mark';
import {
	DOCUMENT_BODY_CLASSES,
	DOCUMENT_COLUMN_CLASSES,
} from './document-column';
import { useWorkspaceFileDiffOpener } from './file-preview-context';

/**
 * Read-only preview of a single PR comment, opened as a main-surface `document`
 * tab from the Checks panel. The full body renders as markdown, with the diff
 * anchor, timestamp, and thread replies alongside it; the comment's own "Add to
 * chat" drops the same chip the Checks panel does.
 */
export function CommentPreviewPanel({
	comment,
	workspaceCwd,
}: {
	comment: CommentPreviewPayload;
	/** Absolute workspace root the comment document is written under. */
	workspaceCwd: string;
}) {
	const { attachComment } = useReviewCommentAttachments({
		prNumber: comment.prNumber,
		workspaceCwd,
	});
	const openWorkspaceFileDiff = useWorkspaceFileDiffOpener();

	const { line, path } = comment;
	const jumpToLine = useCallback(() => {
		if (openWorkspaceFileDiff && path && line !== undefined) {
			openWorkspaceFileDiff(path, undefined, { revealLine: line });
		}
	}, [line, openWorkspaceFileDiff, path]);
	const canJumpToLine =
		Boolean(openWorkspaceFileDiff) && Boolean(path) && line !== undefined;

	return (
		<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<CommentPreviewHeader
				comment={comment}
				onAddToChat={() => {
					attachComment(comment);
				}}
				onJumpToLine={canJumpToLine ? jumpToLine : undefined}
			/>
			<ScrollArea className='min-h-0 flex-1'>
				<div className={cn(DOCUMENT_BODY_CLASSES, 'flex flex-col gap-4')}>
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
	onJumpToLine,
}: {
	comment: CommentPreviewPayload;
	onAddToChat: () => void;
	onJumpToLine?: () => void;
}) {
	const { t } = useTranslation();
	return (
		<div className='shrink-0 border-border border-b'>
			<div
				className={cn(
					DOCUMENT_COLUMN_CLASSES,
					'flex items-start justify-between gap-2 py-2.5',
				)}
			>
				<div className='flex min-w-0 flex-col gap-0.5 overflow-hidden'>
					<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
						<ProviderMark provider={comment.provider} />
						<span className='min-w-0 truncate font-semibold text-sm'>
							{comment.author ?? getProviderLabel(comment.provider)}
						</span>
						{comment.isResolved === false ? (
							<span className='shrink-0 rounded-sm bg-status-warning/15 px-1 text-status-warning text-xxs'>
								{t('review:comment-preview.state.unresolved', 'Unresolved')}
							</span>
						) : null}
						{comment.isOutdated ? (
							<span className='shrink-0 rounded-sm bg-muted px-1 text-muted-foreground text-xxs'>
								{t('review:comment-preview.state.outdated', 'Outdated')}
							</span>
						) : null}
					</div>
					<CommentMeta
						createdAt={comment.createdAt}
						location={formatCommentLocation(comment.path, comment.line)}
						onJumpToLine={onJumpToLine}
						replyCount={comment.replies?.length ?? 0}
					/>
				</div>
				<div className='flex shrink-0 items-center gap-0.5'>
					<Button onClick={onAddToChat} size='icon-sm' variant='ghost'>
						<MessageSquarePlusIcon />
						<span className='sr-only'>
							{t(
								'review:comment-preview.actions.add-to-chat',
								'Add comment to chat',
							)}
						</span>
					</Button>
					{comment.url ? (
						<Button asChild size='icon-sm' variant='ghost'>
							<a
								aria-label={t(
									'review:comment-preview.actions.open-external',
									'Open comment on {{provider}}',
									{ provider: getProviderLabel(comment.provider) },
								)}
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
		</div>
	);
}

/**
 * Sub-header line carrying the comment's diff anchor, date, and reply count. The
 * anchor is the only actionable part, so it is split out of the joined line
 * rather than making the whole run clickable.
 */
function CommentMeta({
	createdAt,
	location,
	onJumpToLine,
	replyCount,
}: {
	createdAt?: string;
	location: string;
	onJumpToLine?: () => void;
	replyCount: number;
}) {
	const { t } = useTranslation();
	const trailing = [
		createdAt ? formatRowDate(createdAt) : '',
		replyCount > 0
			? t('review:comment-preview.reply-count', {
					count: replyCount,
					defaultValue_one: '{{count}} reply',
					defaultValue_other: '{{count}} replies',
				})
			: '',
	].filter(Boolean);

	if (!location && trailing.length === 0) {
		return null;
	}

	return (
		<span className='flex min-w-0 items-center gap-1 font-mono text-muted-foreground text-xxs'>
			<CommentLocation location={location} onJumpToLine={onJumpToLine} />
			{trailing.length > 0 ? (
				<span className='shrink-0 truncate'>
					{location ? ' · ' : ''}
					{trailing.join(' · ')}
				</span>
			) : null}
		</span>
	);
}

/**
 * The comment's `path:line` anchor, actionable when the surrounding workspace
 * can open the diff and inert text when it cannot.
 */
function CommentLocation({
	location,
	onJumpToLine,
}: {
	location: string;
	onJumpToLine?: () => void;
}) {
	if (!location) {
		return null;
	}
	if (!onJumpToLine) {
		return <span className='min-w-0 truncate'>{location}</span>;
	}
	return (
		<button
			className='min-w-0 cursor-pointer truncate rounded-xs underline decoration-dotted underline-offset-2 hover:text-foreground'
			onClick={onJumpToLine}
			type='button'
		>
			{location}
		</button>
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
