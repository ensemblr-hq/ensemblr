import {
	CheckCircle2Icon,
	CheckIcon,
	CircleIcon,
	ExternalLinkIcon,
	EyeOffIcon,
	FileDiffIcon,
	LoaderCircleIcon,
	MessageSquarePlusIcon,
	TriangleAlertIcon,
	XIcon,
} from 'lucide-react';

import { FilePathLabel } from '@/renderer/components/file-path-label';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import { getProviderLabel } from '@/renderer/lib/workbench/provider-label';
import type {
	FileOpenOptions,
	PullRequestCheckStatus,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { ProviderMark } from './provider-mark';

/** Row showing the PR's current git status with optional action button. */
export function PullRequestStatusRow({
	disabled = false,
	hideAction = false,
	onAction,
	status,
}: {
	/**
	 * Blocks the action while an agent turn is changing the state it acts on. A
	 * missing `onAction` blocks it too, so the button is never a live no-op.
	 */
	disabled?: boolean;
	hideAction?: boolean;
	onAction?: () => void;
	status: WorkspaceShellModel['pullRequest']['gitStatus'];
}) {
	return (
		<div className='flex min-h-7 min-w-0 items-center justify-between gap-2 px-1'>
			<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
				<CircleIcon
					aria-hidden='true'
					className='size-3 shrink-0 text-muted-foreground'
				/>
				<span className='min-w-0 truncate font-medium text-xs'>
					{status.label}
				</span>
			</div>
			{status.actionLabel && !hideAction ? (
				<Button
					className='h-6 px-1.5 text-xs'
					disabled={disabled || !onAction}
					onClick={onAction}
					size='xs'
					variant='subtle'
				>
					{status.actionLabel}
				</Button>
			) : null}
		</div>
	);
}

/** Row naming one file that cannot merge cleanly with the base branch. */
export function PullRequestConflictRow({ path }: { path: string }) {
	return (
		<div
			className='flex min-h-7 min-w-0 items-center gap-2 px-1 font-mono text-xs'
			data-conflict-path={path}
		>
			<TriangleAlertIcon
				aria-label='Conflicted'
				className='size-3.5 shrink-0 text-status-danger'
				role='img'
			/>
			<FilePathLabel path={path} />
		</div>
	);
}

/** Renders the semantic icon for a GitHub check's current state. */
function CheckStatusIcon({ status }: { status: PullRequestCheckStatus }) {
	if (status === 'pending') {
		return (
			<span
				aria-label='Running'
				className='grid size-3.5 shrink-0 place-items-center text-status-warning'
				role='img'
			>
				<LoaderCircleIcon
					aria-hidden='true'
					className='size-3 motion-safe:animate-spin'
				/>
			</span>
		);
	}

	if (status === 'ready') {
		return (
			<span
				aria-label='Passed'
				className='grid size-3.5 shrink-0 place-items-center text-status-ok'
				role='img'
			>
				<CheckIcon aria-hidden='true' className='size-3.5' />
			</span>
		);
	}

	return (
		<span
			aria-label='Failed'
			className='grid size-3.5 shrink-0 place-items-center text-status-danger'
			role='img'
		>
			<XIcon aria-hidden='true' className='size-3.5' />
		</span>
	);
}

/** Renders one live GitHub check with status, provider, duration, and details link. */
export function PullRequestCheckRow({
	check,
}: {
	check: WorkspaceShellModel['pullRequest']['checks'][number];
}) {
	const baseClassName =
		'flex min-h-7 min-w-0 items-center justify-between gap-2 rounded-sm px-1 text-xs';
	const contents = (
		<>
			<div className='flex min-w-0 flex-1 items-center gap-2 overflow-hidden'>
				<CheckStatusIcon status={check.status} />
				<ProviderMark provider={check.provider} />
				<span className='min-w-0 truncate font-medium text-xs'>
					{check.label}
				</span>
				{check.durationLabel ? (
					<span className='shrink-0 text-muted-foreground'>
						{check.durationLabel}
					</span>
				) : null}
			</div>
			{check.url ? (
				<ExternalLinkIcon
					aria-hidden='true'
					className='size-3.5 shrink-0 text-muted-foreground'
				/>
			) : null}
		</>
	);

	if (check.url) {
		return (
			<a
				aria-label={`${check.label} check details (opens in new tab)`}
				className={cn(
					baseClassName,
					'outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring',
				)}
				data-check-status={check.status}
				href={check.url}
				rel='noreferrer'
				target='_blank'
			>
				{contents}
			</a>
		);
	}

	return (
		<div className={baseClassName} data-check-status={check.status}>
			{contents}
		</div>
	);
}

/** Reusable row with leading icon, label/detail text, and trailing action. */
export function ChecksActionRow({
	actionLabel,
	disabled = false,
	label,
	onAction,
}: {
	actionLabel?: string;
	/**
	 * Blocks the action while an agent turn is changing the state it acts on. A
	 * missing `onAction` blocks it too, so the button is never a live no-op.
	 */
	disabled?: boolean;
	label: string;
	onAction?: () => void;
}) {
	return (
		<div className='flex min-h-7 min-w-0 items-center justify-between gap-2 px-1'>
			<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
				<CircleIcon
					aria-hidden='true'
					className='size-3 shrink-0 text-muted-foreground'
				/>
				<span className='min-w-0 truncate text-xs'>{label}</span>
			</div>
			{actionLabel ? (
				<Button
					className='h-6 px-1.5 text-xs'
					disabled={disabled || !onAction}
					onClick={onAction}
					size='xs'
					variant='ghost'
				>
					{actionLabel}
				</Button>
			) : null}
		</div>
	);
}

/**
 * Badge naming a comment's resolution state, matching the diff thread's colours.
 * Renders nothing when the comment has no resolution to report — a plain issue
 * comment or a bot annotation is neither resolved nor open.
 */
function CommentResolutionBadge({
	isResolved,
}: {
	isResolved?: boolean | null;
}) {
	if (isResolved === true) {
		return (
			<span className='shrink-0 rounded-sm bg-status-ok/15 px-1 text-status-ok text-xxs'>
				Resolved
			</span>
		);
	}
	if (isResolved === false) {
		return (
			<span className='shrink-0 rounded-sm bg-status-warning/15 px-1 text-status-warning text-xxs'>
				Unresolved
			</span>
		);
	}
	return null;
}

/**
 * Single PR comment row. Clicking the row opens a read-only preview tab into the
 * workspace's ephemeral preview slot, and double-clicking keeps that tab open;
 * hovering reveals Go-to-line, Hide (session-only dismiss), and Add-to-chat
 * actions. The leading badge shows the comment author (falling back to the
 * provider label), and `detail` carries the comment's first line of prose,
 * falling back to its `path:line` location when the body has none. A resolved
 * comment strikes its own text through, the same way a done todo does, so the
 * list reads as work left rather than work logged.
 */
export function PullRequestCommentRow({
	comment,
	onAddToChat,
	onHide,
	onJumpToLine,
	onOpenPreview,
}: {
	comment: WorkspaceShellModel['pullRequest']['comments'][number];
	onAddToChat?: () => void;
	onHide?: () => void;
	/** Omitted, not disabled, when the comment carries no path and line to reach. */
	onJumpToLine?: () => void;
	onOpenPreview?: (options?: FileOpenOptions) => void;
}) {
	const isResolved = comment.isResolved === true;

	return (
		<div className='group flex min-h-7 min-w-0 items-center justify-between gap-2 overflow-hidden rounded-md px-1 hover:bg-muted'>
			<button
				className={cn(
					'flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left',
					onOpenPreview ? 'cursor-pointer' : 'cursor-default',
				)}
				disabled={!onOpenPreview}
				onClick={onOpenPreview ? () => onOpenPreview() : undefined}
				onDoubleClick={
					onOpenPreview ? () => onOpenPreview({ preview: false }) : undefined
				}
				type='button'
			>
				<ProviderMark provider={comment.provider} />
				<span
					className={cn(
						'max-w-28 shrink-0 truncate font-semibold text-xs',
						isResolved && 'text-muted-foreground line-through',
					)}
				>
					{comment.author ?? getProviderLabel(comment.provider)}
				</span>
				<span
					className={cn(
						'min-w-0 truncate text-muted-foreground text-xs',
						isResolved && 'line-through',
					)}
				>
					{comment.detail}
				</span>
				{comment.origin === 'agent' ? (
					<span className='shrink-0 rounded-sm bg-muted px-1 text-muted-foreground text-xxs'>
						Agent
					</span>
				) : null}
				<CommentResolutionBadge isResolved={comment.isResolved} />
			</button>
			<div className='hidden shrink-0 items-center gap-0.5 group-hover:flex'>
				{onJumpToLine ? (
					<Button
						className='size-6'
						onClick={onJumpToLine}
						size='icon-xs'
						variant='ghost'
					>
						<FileDiffIcon />
						<span className='sr-only'>Go to line in diff</span>
					</Button>
				) : null}
				{onHide ? (
					<Button
						className='size-6'
						onClick={onHide}
						size='icon-xs'
						variant='ghost'
					>
						<EyeOffIcon />
						<span className='sr-only'>Hide comment</span>
					</Button>
				) : null}
				{onAddToChat ? (
					<Button
						className='size-6'
						onClick={onAddToChat}
						size='icon-xs'
						variant='ghost'
					>
						<MessageSquarePlusIcon />
						<span className='sr-only'>Add comment to chat</span>
					</Button>
				) : null}
			</div>
		</div>
	);
}

/** Single PR todo row with toggle, add-to-chat, and delete actions. */
export function PullRequestTodoRow({
	onAddToChat,
	onDelete,
	onToggle,
	todo,
}: {
	onAddToChat?: () => void;
	onDelete?: () => void;
	onToggle?: () => void;
	todo: WorkspaceShellModel['pullRequest']['todos'][number];
}) {
	const isDone = todo.status === 'done';
	const ToggleIcon = isDone ? CheckCircle2Icon : CircleIcon;

	return (
		<div className='group flex min-h-7 min-w-0 items-center justify-between gap-2 px-1'>
			<button
				aria-label={`Mark todo ${isDone ? 'open' : 'done'}: ${todo.label}`}
				className='flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left'
				onClick={onToggle}
				type='button'
			>
				<ToggleIcon
					aria-hidden='true'
					className={cn(
						'size-3 shrink-0',
						isDone ? 'text-status-ok' : 'text-muted-foreground',
					)}
				/>
				<span
					className={cn(
						'min-w-0 truncate text-xs',
						isDone ? 'text-muted-foreground line-through' : undefined,
					)}
				>
					{todo.label}
				</span>
			</button>
			<div className='flex shrink-0 items-center gap-0.5'>
				{onAddToChat ? (
					<Button
						className='size-6'
						onClick={onAddToChat}
						size='icon-xs'
						variant='ghost'
					>
						<MessageSquarePlusIcon />
						<span className='sr-only'>Add todo to chat</span>
					</Button>
				) : null}
				{onDelete ? (
					<Button
						className='size-6'
						onClick={onDelete}
						size='icon-xs'
						variant='ghost'
					>
						<XIcon />
						<span className='sr-only'>Delete todo</span>
					</Button>
				) : null}
			</div>
		</div>
	);
}
