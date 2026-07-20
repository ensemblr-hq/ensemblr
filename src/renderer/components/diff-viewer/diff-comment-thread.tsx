import { BotIcon, CheckIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';
import { formatShortcut, matchesShortcut } from '@/shared/keymap';

/** Platform-formatted glyphs for the diff-comment submit shortcut. */
const COMMENT_SUBMIT_HINT = formatShortcut('diffComment.submit');

/** Where a diff comment originates, which drives its badge and editability. */
export type DiffCommentSource = 'github' | 'github-actions' | 'local';

/** A single comment anchored to a diff line, from Ensemblr-local or GitHub. */
export interface DiffComment {
	author?: string;
	body: string;
	id: string;
	isOutdated?: boolean;
	isResolved?: boolean;
	source: DiffCommentSource;
	url?: string;
}

/**
 * Inline comment thread mounted under a diff line: renders existing local and
 * GitHub/bot comments and, when the composer is open, an editor to add a new
 * local comment. GitHub and bot comments are read-only.
 */
export function DiffCommentThread({
	comments,
	composerOpen,
	onCloseComposer,
	onDelete,
	onResolve,
	onSubmit,
}: {
	comments: readonly DiffComment[];
	composerOpen: boolean;
	onCloseComposer: () => void;
	onDelete: (id: string) => void;
	onResolve: (id: string, resolved: boolean) => void;
	onSubmit: (body: string) => void;
}) {
	return (
		<div className='flex flex-col gap-1.5 border-border border-y bg-muted/20 px-4 py-2'>
			{comments.map((comment) => (
				<DiffCommentRow
					comment={comment}
					key={comment.id}
					onDelete={() => onDelete(comment.id)}
					onResolve={() => onResolve(comment.id, !comment.isResolved)}
				/>
			))}
			{composerOpen ? (
				<DiffCommentComposer onCancel={onCloseComposer} onSubmit={onSubmit} />
			) : null}
		</div>
	);
}

/** Renders one comment with a source badge and, for local comments, resolve/delete actions. */
function DiffCommentRow({
	comment,
	onDelete,
	onResolve,
}: {
	comment: DiffComment;
	onDelete: () => void;
	onResolve: () => void;
}) {
	const isLocal = comment.source === 'local';
	return (
		<div className='flex items-start justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5'>
			<div className='min-w-0 flex-1'>
				<div className='flex items-center gap-2 text-xxs'>
					<SourceBadge source={comment.source} />
					{comment.author ? (
						<span className='truncate font-mono text-muted-foreground'>
							{comment.author}
						</span>
					) : null}
					{comment.isOutdated ? (
						<span className='rounded-sm bg-muted px-1 text-muted-foreground'>
							Outdated
						</span>
					) : null}
					{comment.isResolved ? (
						<span className='rounded-sm bg-status-ok/15 px-1 text-status-ok'>
							Resolved
						</span>
					) : null}
				</div>
				<p
					className={cn(
						'whitespace-pre-wrap text-xs',
						comment.isResolved && 'text-muted-foreground line-through',
					)}
				>
					{comment.body}
				</p>
			</div>
			{isLocal ? (
				<div className='flex shrink-0 items-center gap-0.5'>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								className='size-6'
								onClick={onResolve}
								size='icon-xs'
								variant='ghost'
							>
								<CheckIcon />
								<span className='sr-only'>
									{comment.isResolved ? 'Reopen comment' : 'Resolve comment'}
								</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							{comment.isResolved ? 'Reopen comment' : 'Resolve comment'}
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								className='size-6'
								onClick={onDelete}
								size='icon-xs'
								variant='ghost'
							>
								<XIcon />
								<span className='sr-only'>Delete comment</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>Delete comment</TooltipContent>
					</Tooltip>
				</div>
			) : null}
		</div>
	);
}

/** Small badge identifying a comment's source (local, GitHub, or Actions bot). */
function SourceBadge({ source }: { source: DiffCommentSource }) {
	if (source === 'github-actions') {
		return (
			<span className='flex items-center gap-1 rounded-sm bg-muted px-1 text-muted-foreground'>
				<BotIcon className='size-3' />
				Actions bot
			</span>
		);
	}
	if (source === 'github') {
		return (
			<span className='rounded-sm bg-muted px-1 text-muted-foreground'>
				GitHub
			</span>
		);
	}
	return (
		<span className='rounded-sm bg-muted px-1 text-muted-foreground'>
			Local
		</span>
	);
}

/** Textarea composer for adding a new local comment on a diff line. */
function DiffCommentComposer({
	onCancel,
	onSubmit,
}: {
	onCancel: () => void;
	onSubmit: (body: string) => void;
}) {
	const [body, setBody] = useState('');
	const trimmed = body.trim();

	const submit = () => {
		if (trimmed.length > 0) {
			onSubmit(trimmed);
		}
	};

	return (
		<div className='flex flex-col gap-1.5 rounded-md border border-border bg-background p-2'>
			<Textarea
				autoFocus
				aria-label='New line comment'
				className='min-h-14 text-xs'
				onChange={(event) => setBody(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Escape') {
						onCancel();
						return;
					}
					if (matchesShortcut('diffComment.submit', event)) {
						event.preventDefault();
						submit();
					}
				}}
				placeholder='Add a local review comment on this line…'
				value={body}
			/>
			<div className='flex items-center justify-end gap-1.5'>
				<Button onClick={onCancel} size='xs' variant='ghost'>
					Cancel
				</Button>
				<Button disabled={trimmed.length === 0} onClick={submit} size='xs'>
					Comment
					<kbd className='ml-1.5 font-sans text-primary-foreground/70'>
						{COMMENT_SUBMIT_HINT}
					</kbd>
				</Button>
			</div>
		</div>
	);
}
