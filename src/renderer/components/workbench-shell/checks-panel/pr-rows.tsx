import { CircleIcon, ExternalLinkIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import type { ProviderMarkKind } from '@/renderer/types/components';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { ProviderMark } from './provider-mark';
import { PullRequestCheckStatusIcon } from './status-icon';

/** Row showing the PR's current git status with optional action button. */
export function PullRequestStatusRow({
	hideAction = false,
	status,
}: {
	hideAction?: boolean;
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
					className='h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground'
					size='xs'
					variant='ghost'
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
}: {
	actionLabel?: string;
	label: string;
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
					className='h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground'
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
}: {
	check: WorkspaceShellModel['pullRequest']['checks'][number];
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

/** Single PR comment row with author, body, and reply action. */
export function PullRequestCommentRow({
	comment,
}: {
	comment: WorkspaceShellModel['pullRequest']['comments'][number];
}) {
	return (
		<div className='flex min-h-7 min-w-0 items-center gap-2 overflow-hidden px-1'>
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
			</div>
		</div>
	);
}

/** Single PR todo row with checkbox and label. */
export function PullRequestTodoRow({
	todo,
}: {
	todo: WorkspaceShellModel['pullRequest']['todos'][number];
}) {
	return (
		<div className='flex min-h-7 min-w-0 items-center gap-2 px-1'>
			<CircleIcon
				aria-hidden='true'
				className='size-3 shrink-0 text-muted-foreground'
			/>
			<span className='min-w-0 truncate text-xs'>{todo.label}</span>
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

	return 'Preview';
}
