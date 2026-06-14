import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, MessageSquarePlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
	deleteReviewComment,
	ensembleQueryKeys,
	reviewCommentsQuery,
	saveReviewComment,
} from '@/renderer/api/ensemble-queries';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { formatCommentContext } from '@/renderer/lib/workbench/review-context';
import { useComposerInsert } from '@/renderer/state/composer-insert';
import type { ReviewCommentWire } from '@/shared/ipc';

function parseDraftLine(draftLine: string): number | null {
	const parsed = Number.parseInt(draftLine, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Local review comments scoped to the open file, with add/resolve/delete. */
export function FileCommentSection({
	filePath,
	workspaceId,
}: {
	filePath: string;
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const commentsQueryState = useQuery(reviewCommentsQuery(workspaceId));
	const insertIntoComposer = useComposerInsert();
	const [draftBody, setDraftBody] = useState('');
	const [draftLine, setDraftLine] = useState('');

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: ensembleQueryKeys.reviewComments(workspaceId),
		});
	const onError = (error: unknown) =>
		toast.error('Comment update failed', {
			description: error instanceof Error ? error.message : undefined,
		});

	const addMutation = useMutation({
		mutationFn: () =>
			saveReviewComment({
				body: draftBody.trim(),
				filePath,
				lineNumber: parseDraftLine(draftLine),
				workspaceId,
			}),
		onError,
		onSuccess: () => {
			setDraftBody('');
			setDraftLine('');
			void invalidate();
		},
	});
	const resolveMutation = useMutation({
		mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) =>
			saveReviewComment({
				id,
				status: resolved ? 'resolved' : 'open',
				workspaceId,
			}),
		onError,
		onSuccess: invalidate,
	});
	const deleteMutation = useMutation({
		mutationFn: (id: string) => deleteReviewComment({ id }),
		onError,
		onSuccess: invalidate,
	});

	const fileComments = (commentsQueryState.data?.comments ?? []).filter(
		(comment) => comment.filePath === filePath,
	);

	return (
		<section className='flex flex-col gap-2 border-border border-t p-4'>
			<h3 className='font-semibold text-muted-foreground text-xs'>
				Local comments ({fileComments.length})
			</h3>
			{fileComments.map((comment) => (
				<FileCommentRow
					comment={comment}
					key={comment.id}
					onAddToChat={() => {
						insertIntoComposer(
							formatCommentContext({
								detail: `${comment.filePath}${
									comment.lineNumber ? `:${comment.lineNumber}` : ''
								} — ${comment.body}`,
								id: comment.id,
								provider: 'local',
							}),
						);
						toast.success('Comment added to chat.');
					}}
					onDelete={() => deleteMutation.mutate(comment.id)}
					onToggleResolved={() =>
						resolveMutation.mutate({
							id: comment.id,
							resolved: comment.status !== 'resolved',
						})
					}
				/>
			))}
			<div className='flex flex-col gap-1.5'>
				<div className='flex items-center gap-1.5'>
					<Input
						aria-label='Comment line number'
						className='h-7 w-20 text-xs'
						inputMode='numeric'
						onChange={(event) =>
							setDraftLine(event.target.value.replace(/[^\d]/g, ''))
						}
						placeholder='Line'
						value={draftLine}
					/>
					<Textarea
						aria-label='New local comment'
						className='min-h-7 flex-1 text-xs'
						onChange={(event) => setDraftBody(event.target.value)}
						placeholder='Add a local review comment…'
						rows={1}
						value={draftBody}
					/>
					<Button
						className='h-7 text-xs'
						disabled={draftBody.trim().length === 0 || addMutation.isPending}
						onClick={() => addMutation.mutate()}
						size='xs'
					>
						Comment
					</Button>
				</div>
				<p className='text-muted-foreground text-xxs'>
					Local comments stay in Ensemble — they are never posted to GitHub.
				</p>
			</div>
		</section>
	);
}

function FileCommentRow({
	comment,
	onAddToChat,
	onDelete,
	onToggleResolved,
}: {
	comment: ReviewCommentWire;
	onAddToChat: () => void;
	onDelete: () => void;
	onToggleResolved: () => void;
}) {
	const isResolved = comment.status === 'resolved';

	return (
		<div className='flex items-start justify-between gap-2 rounded-md border border-border bg-pane px-2.5 py-1.5'>
			<div className='min-w-0 flex-1'>
				<div className='flex items-center gap-2 text-xxs'>
					<span className='font-mono text-muted-foreground'>
						{comment.lineNumber ? `Line ${comment.lineNumber}` : 'File'}
					</span>
					<span className='rounded-sm bg-muted px-1 text-muted-foreground'>
						Local
					</span>
					{isResolved ? (
						<span className='rounded-sm bg-status-ok/15 px-1 text-status-ok'>
							Resolved
						</span>
					) : null}
				</div>
				<p
					className={
						isResolved
							? 'text-muted-foreground text-xs line-through'
							: 'text-xs'
					}
				>
					{comment.body}
				</p>
			</div>
			<div className='flex shrink-0 items-center gap-0.5'>
				<Button
					className='size-6'
					onClick={onAddToChat}
					size='icon-xs'
					variant='ghost'
				>
					<MessageSquarePlusIcon />
					<span className='sr-only'>Add comment to chat</span>
				</Button>
				<Button
					className='size-6'
					onClick={onToggleResolved}
					size='icon-xs'
					variant='ghost'
				>
					<CheckIcon />
					<span className='sr-only'>
						{isResolved ? 'Reopen comment' : 'Resolve comment'}
					</span>
				</Button>
				<Button
					className='size-6'
					onClick={onDelete}
					size='icon-xs'
					variant='ghost'
				>
					<XIcon />
					<span className='sr-only'>Delete comment</span>
				</Button>
			</div>
		</div>
	);
}
