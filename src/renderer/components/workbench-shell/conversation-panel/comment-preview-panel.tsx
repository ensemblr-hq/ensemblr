import { ExternalLinkIcon, MessageSquarePlusIcon } from 'lucide-react';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { ChatMessageText } from '@/renderer/components/chat-message-text';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { formatCommentContext } from '@/renderer/lib/workbench/review-context';
import { useComposerInsert } from '@/renderer/state/composer';
import type { CommentPreviewPayload } from '@/renderer/types/workbench';
import { getProviderLabel } from '../checks-panel/provider-label';
import { ProviderMark } from '../checks-panel/provider-mark';

/**
 * Read-only preview of a single PR comment, opened as a main-surface `document`
 * tab from the Checks panel. The body is rendered as markdown; the comment's
 * own "Add to chat" reuses the same context formatter the Checks panel uses.
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
			<div className='flex shrink-0 items-center justify-between gap-2 border-border border-b px-4 py-2.5'>
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
				</div>
				<div className='flex shrink-0 items-center gap-0.5'>
					<Button onClick={addToChat} size='icon-sm' variant='ghost'>
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
			<ScrollArea className='min-h-0 flex-1'>
				<div className='p-4 text-sm'>
					<ChatMessageText text={comment.detail} />
				</div>
			</ScrollArea>
		</div>
	);
}
