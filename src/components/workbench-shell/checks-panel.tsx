import {
	CheckIcon,
	CircleDashedIcon,
	CircleIcon,
	CircleSlashIcon,
	ExternalLinkIcon,
	GitBranchIcon,
	LoaderCircleIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { WorkspaceShellModel } from '@/renderer/workbench/workbench-model';

export function ChecksPanel({ workspace }: { workspace: WorkspaceShellModel }) {
	const pullRequest = workspace.pullRequest;

	if (typeof pullRequest.number !== 'number') {
		return <ChecksEmptyState workspace={workspace} />;
	}

	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'>
				<section className='flex min-w-0 flex-col gap-2'>
					<h2 className='min-w-0 truncate font-semibold text-sm'>
						{pullRequest.title}
					</h2>
					<div className='flex min-w-0 flex-col gap-2 text-muted-foreground text-xs leading-4'>
						{pullRequest.description.map((paragraph) => (
							<p className='wrap-break-word min-w-0' key={paragraph}>
								{paragraph}
							</p>
						))}
					</div>
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Git status' />
					<PullRequestStatusRow status={pullRequest.gitStatus} />
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Checks' />
					{pullRequest.checks.map((check) => (
						<PullRequestCheckRow check={check} key={check.id} />
					))}
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader
						actionLabel={
							pullRequest.comments.length ? 'Add all to chat' : undefined
						}
						label='Comments'
					/>
					{pullRequest.comments.length ? (
						pullRequest.comments.map((comment) => (
							<PullRequestCommentRow comment={comment} key={comment.id} />
						))
					) : (
						<p className='text-muted-foreground text-xs'>No comments yet</p>
					)}
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader actionLabel='+ Add' label='Your todos' />
					{pullRequest.todos.length ? (
						pullRequest.todos.map((todo) => (
							<div
								className='flex min-h-7 min-w-0 items-center gap-2 px-1'
								key={todo.id}
							>
								<CircleIcon
									aria-hidden='true'
									className='size-3 shrink-0 text-muted-foreground'
								/>
								<span className='min-w-0 truncate text-xs'>{todo.label}</span>
							</div>
						))
					) : (
						<p className='text-muted-foreground text-xs'>No todos yet</p>
					)}
				</section>
			</div>
		</ScrollArea>
	);
}

function ChecksEmptyState({ workspace }: { workspace: WorkspaceShellModel }) {
	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'>
				<section className='flex min-w-0 flex-col gap-2'>
					<h2 className='font-semibold text-muted-foreground text-sm'>
						PR title
					</h2>
					<p className='text-muted-foreground text-xs'>PR description</p>
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Git status' />
					<ChecksActionRow actionLabel='Create PR' label='No PR open' />
					<ChecksActionRow
						actionLabel='Commit and push'
						label={`${workspace.changeSummary.files} uncommitted changes`}
					/>
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader actionLabel='+ Add' label='Your todos' />
					<p className='text-muted-foreground text-xs'>No todos yet</p>
				</section>
			</div>
		</ScrollArea>
	);
}

function ChecksSectionHeader({
	actionLabel,
	label,
}: {
	actionLabel?: string;
	label: string;
}) {
	return (
		<div className='flex min-h-6 min-w-0 items-center justify-between gap-2'>
			<h3 className='font-semibold text-muted-foreground text-xs'>{label}</h3>
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

function PullRequestStatusRow({
	status,
}: {
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
			{status.actionLabel ? (
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

function ChecksActionRow({
	actionLabel,
	label,
}: {
	actionLabel: string;
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
			<Button
				className='h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground'
				size='xs'
				variant='ghost'
			>
				{actionLabel}
			</Button>
		</div>
	);
}

function PullRequestCheckRow({
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
			<Button className='size-6' size='icon-xs' variant='ghost'>
				<ExternalLinkIcon />
				<span className='sr-only'>Open check</span>
			</Button>
		</div>
	);
}

function PullRequestCommentRow({
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
					{comment.provider}
				</span>
				<span className='min-w-0 truncate text-muted-foreground text-xs'>
					{comment.detail}
				</span>
			</div>
		</div>
	);
}

function PullRequestCheckStatusIcon({
	status,
}: {
	status: WorkspaceShellModel['pullRequest']['checks'][number]['status'];
}) {
	if (status === 'ready') {
		return (
			<CheckIcon
				aria-hidden='true'
				className='size-3 shrink-0 text-status-ok'
			/>
		);
	}

	if (status === 'pending') {
		return (
			<LoaderCircleIcon
				aria-hidden='true'
				className='size-3 shrink-0 animate-spin text-status-warning'
			/>
		);
	}

	return (
		<CircleDashedIcon
			aria-hidden='true'
			className='size-3 shrink-0 text-status-danger'
		/>
	);
}

function ProviderMark({
	provider,
}: {
	provider:
		| WorkspaceShellModel['pullRequest']['checks'][number]['provider']
		| WorkspaceShellModel['pullRequest']['comments'][number]['provider'];
}) {
	const isGithubProvider =
		provider === 'github' || provider === 'github-actions';

	return (
		<span
			className={cn(
				'grid size-3.5 shrink-0 place-items-center rounded-full',
				isGithubProvider
					? 'bg-foreground text-background'
					: 'bg-muted text-muted-foreground',
			)}
		>
			{isGithubProvider ? (
				<GitBranchIcon aria-hidden='true' className='size-2.5' />
			) : (
				<CircleSlashIcon aria-hidden='true' className='size-2.5' />
			)}
		</span>
	);
}
