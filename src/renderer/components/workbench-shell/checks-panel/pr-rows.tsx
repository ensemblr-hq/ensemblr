import {
	CheckCircle2Icon,
	CircleIcon,
	ExternalLinkIcon,
	MessageSquarePlusIcon,
	XIcon,
} from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import type { ProviderMarkKind } from '@/renderer/types/components';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { ProviderMark } from './provider-mark';
import { PullRequestCheckStatusIcon } from './status-icon';

/** Row showing the PR's current git status with optional action button. */
export function PullRequestStatusRow({
	hideAction = false,
	onAction,
	status,
}: {
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

/** Reusable row with leading icon, label/detail text, and trailing action. */
export function ChecksActionRow({
	actionLabel,
	label,
	onAction,
}: {
	actionLabel?: string;
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

/** Single PR check row with provider icon, label, and ask-for-help action. */
export function PullRequestCheckRow({
	check,
	onAddToChat,
}: {
	check: WorkspaceShellModel['pullRequest']['checks'][number];
	onAddToChat?: () => void;
}) {
	return (
		<div className='flex min-h-7 min-w-0 items-center justify-between gap-2 px-1'>
			<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
				<PullRequestCheckStatusIcon status={check.status} />
				<ProviderMark provider={check.provider} />
				<div className='flex min-w-0 items-center gap-2'>
					<span className='min-w-0 truncate font-medium text-xs'>
						{check.label}
					</span>
					{check.durationLabel ? (
						<span className='shrink-0 text-muted-foreground text-xs'>
							{check.durationLabel}
						</span>
					) : null}
				</div>
			</div>
			<div className='flex shrink-0 items-center gap-0.5'>
				{onAddToChat ? (
					<Button
						className='size-6'
						onClick={onAddToChat}
						size='icon-xs'
						variant='ghost'
					>
						<MessageSquarePlusIcon />
						<span className='sr-only'>Add {check.label} failure to chat</span>
					</Button>
				) : null}
				{check.url ? (
					<Button asChild className='size-6' size='icon-xs' variant='ghost'>
						<a
							aria-label={`Open ${check.label} check`}
							href={check.url}
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

/** Preview-deployment row showing provider, status, and external open action. */
export function PullRequestPreviewDeploymentRow({
	deployment,
}: {
	deployment: NonNullable<
		WorkspaceShellModel['pullRequest']['previewDeployment']
	>;
}) {
	const providerLabel = getProviderLabel(deployment.provider);
	const previewLabel =
		providerLabel === 'Preview'
			? 'preview deployment'
			: `${providerLabel} preview deployment`;

	return (
		<div className='flex min-h-7 min-w-0 items-center justify-between gap-2 px-1'>
			<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
				<PullRequestCheckStatusIcon status={deployment.status} />
				<ProviderMark provider={deployment.provider} />
				<div className='flex min-w-0 items-center gap-2'>
					<span className='min-w-0 truncate font-medium text-xs'>
						{deployment.label}
					</span>
					<span className='shrink-0 text-muted-foreground text-xs'>
						{providerLabel}
					</span>
				</div>
			</div>
			<Button asChild className='size-6' size='icon-xs' variant='ghost'>
				<a
					aria-label={`Open ${previewLabel}`}
					href={deployment.url}
					rel='noreferrer'
					target='_blank'
				>
					<ExternalLinkIcon />
				</a>
			</Button>
		</div>
	);
}

/** Single PR comment row with author, body, and add-to-chat action. */
export function PullRequestCommentRow({
	comment,
	onAddToChat,
}: {
	comment: WorkspaceShellModel['pullRequest']['comments'][number];
	onAddToChat?: () => void;
}) {
	return (
		<div className='flex min-h-7 min-w-0 items-center justify-between gap-2 overflow-hidden px-1'>
			<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
				<CircleIcon
					aria-hidden='true'
					className='size-3 shrink-0 text-muted-foreground'
				/>
				<ProviderMark provider={comment.provider} />
				<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
					<span className='max-w-28 shrink-0 truncate font-semibold text-xs'>
						{getProviderLabel(comment.provider)}
					</span>
					<span className='min-w-0 truncate text-muted-foreground text-xs'>
						{comment.detail}
					</span>
					{comment.isResolved === false ? (
						<span className='shrink-0 rounded-sm bg-status-warning/15 px-1 text-status-warning text-xxs'>
							Unresolved
						</span>
					) : null}
				</div>
			</div>
			<div className='flex shrink-0 items-center gap-0.5'>
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
				{comment.url ? (
					<Button asChild className='size-6' size='icon-xs' variant='ghost'>
						<a
							aria-label='Open comment on GitHub'
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

/** Maps a {@link ProviderMarkKind} to a short display label. */
function getProviderLabel(provider: ProviderMarkKind) {
	if (provider === 'github') {
		return 'GitHub';
	}

	if (provider === 'github-actions') {
		return 'GitHub Actions';
	}

	if (provider === 'vercel') {
		return 'Vercel';
	}

	if (provider === 'netlify') {
		return 'Netlify';
	}

	if (provider === 'linear') {
		return 'Linear';
	}

	if (provider === 'local') {
		return 'Local';
	}

	return 'Preview';
}
