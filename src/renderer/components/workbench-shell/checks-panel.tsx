import {
	CheckIcon,
	CircleDashedIcon,
	CircleIcon,
	CircleSlashIcon,
	ExternalLinkIcon,
	GitBranchIcon,
	LoaderCircleIcon,
} from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { cn } from '@/renderer/lib/utils';
import type {
	PullRequestCheckStatus,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

type ChecksPanelState =
	| {
			detail: string;
			hasPullRequest: false;
			kind: 'empty' | 'uncommitted';
			status: PullRequestCheckStatus | 'open';
			title: string;
	  }
	| {
			detail: string;
			hasPullRequest: true;
			kind:
				| 'pr-blocked'
				| 'pr-checking'
				| 'pr-open'
				| 'pr-ready'
				| 'pr-working';
			pullRequest: WorkspaceShellModel['pullRequest'];
			status: PullRequestCheckStatus | 'open';
			title: string;
	  };

type ProviderMarkKind =
	| WorkspaceShellModel['pullRequest']['checks'][number]['provider']
	| WorkspaceShellModel['pullRequest']['comments'][number]['provider']
	| NonNullable<
			WorkspaceShellModel['pullRequest']['previewDeployment']
	  >['provider'];

export function ChecksPanel({ workspace }: { workspace: WorkspaceShellModel }) {
	const panelState = getChecksPanelState(workspace);

	if (!panelState.hasPullRequest) {
		return (
			<ChecksNoPullRequestState state={panelState} workspace={workspace} />
		);
	}

	const { pullRequest } = panelState;

	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'>
				<ChecksPanelSummary state={panelState} />
				<PullRequestMetadata pullRequest={pullRequest} />

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Git status' />
					<PullRequestStatusRow
						hideAction={panelState.kind === 'pr-ready'}
						status={pullRequest.gitStatus}
					/>
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Checks' />
					{pullRequest.checks.length ? (
						pullRequest.checks.map((check) => (
							<PullRequestCheckRow check={check} key={check.id} />
						))
					) : (
						<ChecksEmptyMessage label='No checks reported yet' />
					)}
				</section>

				{pullRequest.previewDeployment ? (
					<section className='flex min-w-0 flex-col gap-1.5'>
						<ChecksSectionHeader label='Deployments' />
						<PullRequestPreviewDeploymentRow
							deployment={pullRequest.previewDeployment}
						/>
					</section>
				) : null}

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
						<ChecksEmptyMessage label='No comments yet' />
					)}
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader actionLabel='+ Add' label='Your todos' />
					{pullRequest.todos.length ? (
						pullRequest.todos.map((todo) => (
							<PullRequestTodoRow key={todo.id} todo={todo} />
						))
					) : (
						<ChecksEmptyMessage label='No todos yet' />
					)}
				</section>
			</div>
		</ScrollArea>
	);
}

function getChecksPanelState(workspace: WorkspaceShellModel): ChecksPanelState {
	const { pullRequest } = workspace;
	const hasPullRequest = typeof pullRequest.number === 'number';

	if (!hasPullRequest) {
		if (workspace.changeSummary.files > 0) {
			return {
				detail: `${formatCount(
					workspace.changeSummary.files,
					'uncommitted change',
				)} ready for PR setup.`,
				hasPullRequest: false,
				kind: 'uncommitted',
				status: 'pending',
				title: 'No pull request',
			};
		}

		return {
			detail: 'No local changes to review.',
			hasPullRequest: false,
			kind: 'empty',
			status: 'open',
			title: 'No pull request',
		};
	}

	if (pullRequest.status === 'ready-to-merge') {
		return {
			detail: pullRequest.detail || 'All required checks passed.',
			hasPullRequest: true,
			kind: 'pr-ready',
			pullRequest,
			status: 'ready',
			title: pullRequest.label || 'Ready to merge',
		};
	}

	if (pullRequest.status === 'checking') {
		return {
			detail: pullRequest.detail || 'Checks are still running.',
			hasPullRequest: true,
			kind: 'pr-checking',
			pullRequest,
			status: 'pending',
			title: pullRequest.label || 'Checks pending',
		};
	}

	if (pullRequest.status === 'blocked') {
		return {
			detail: pullRequest.detail || 'Resolve blockers before merge.',
			hasPullRequest: true,
			kind: 'pr-blocked',
			pullRequest,
			status: 'blocked',
			title: pullRequest.label || 'Checks failed',
		};
	}

	if (pullRequest.status === 'agent-working') {
		return {
			detail: pullRequest.detail || 'The agent is updating this workspace.',
			hasPullRequest: true,
			kind: 'pr-working',
			pullRequest,
			status: 'pending',
			title: 'Pull request active',
		};
	}

	return {
		detail: pullRequest.detail || 'Pull request is open.',
		hasPullRequest: true,
		kind: 'pr-open',
		pullRequest,
		status: 'open',
		title:
			pullRequest.label ||
			pullRequest.title ||
			`Pull request #${pullRequest.number}`,
	};
}

function ChecksNoPullRequestState({
	state,
	workspace,
}: {
	state: Extract<ChecksPanelState, { hasPullRequest: false }>;
	workspace: WorkspaceShellModel;
}) {
	const hasChanges = state.kind === 'uncommitted';

	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'>
				<ChecksPanelSummary state={state} />

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Git status' />
					<ChecksActionRow
						actionLabel={hasChanges ? 'Create PR' : undefined}
						label='No PR open'
					/>
					{hasChanges ? (
						<ChecksActionRow
							actionLabel='Commit and push'
							label={formatCount(
								workspace.changeSummary.files,
								'uncommitted change',
							)}
						/>
					) : null}
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader actionLabel='+ Add' label='Your todos' />
					<ChecksEmptyMessage label='No todos yet' />
				</section>
			</div>
		</ScrollArea>
	);
}

function ChecksPanelSummary({ state }: { state: ChecksPanelState }) {
	return (
		<section
			className={cn(
				'flex min-w-0 items-start gap-2 rounded-md border p-2.5',
				state.status === 'ready' &&
					'border-status-ok/30 bg-status-ok/10 text-status-ok',
				state.status === 'pending' &&
					'border-status-warning/30 bg-status-warning/10',
				state.status === 'blocked' &&
					'border-status-danger/30 bg-status-danger/10 text-status-danger',
				state.status === 'open' && 'border-border bg-muted/30',
			)}
			data-checks-panel-state={state.kind}
		>
			<ChecksPanelSummaryIcon status={state.status} />
			<div className='min-w-0 flex-1'>
				<h2 className='min-w-0 truncate font-semibold text-sm'>
					{state.title}
				</h2>
				<p
					className={cn(
						'wrap-break-word min-w-0 text-xs leading-4',
						state.status === 'ready' && 'text-status-ok',
						state.status === 'blocked' && 'text-status-danger',
						(state.status === 'pending' || state.status === 'open') &&
							'text-muted-foreground',
					)}
				>
					{state.detail}
				</p>
			</div>
		</section>
	);
}

function ChecksPanelSummaryIcon({
	status,
}: {
	status: PullRequestCheckStatus | 'open';
}) {
	if (status === 'ready') {
		return (
			<CheckIcon
				aria-hidden='true'
				className='mt-0.5 size-3.5 shrink-0 text-status-ok'
			/>
		);
	}

	if (status === 'pending') {
		return (
			<LoaderCircleIcon
				aria-hidden='true'
				className='mt-0.5 size-3.5 shrink-0 animate-spin text-status-warning'
			/>
		);
	}

	if (status === 'blocked') {
		return (
			<CircleDashedIcon
				aria-hidden='true'
				className='mt-0.5 size-3.5 shrink-0 text-status-danger'
			/>
		);
	}

	return (
		<CircleIcon
			aria-hidden='true'
			className='mt-0.5 size-3.5 shrink-0 text-muted-foreground'
		/>
	);
}

function PullRequestMetadata({
	pullRequest,
}: {
	pullRequest: WorkspaceShellModel['pullRequest'];
}) {
	return (
		<section className='flex min-w-0 flex-col gap-2'>
			<h2 className='min-w-0 truncate font-semibold text-sm'>
				{pullRequest.title || `Pull request #${pullRequest.number}`}
			</h2>
			<div className='flex min-w-0 flex-col gap-2 text-muted-foreground text-xs leading-4'>
				{pullRequest.description.length ? (
					pullRequest.description.map((paragraph) => (
						<p className='wrap-break-word min-w-0' key={paragraph}>
							{paragraph}
						</p>
					))
				) : (
					<ChecksEmptyMessage label='No description provided' />
				)}
			</div>
		</section>
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

function ChecksActionRow({
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

function PullRequestPreviewDeploymentRow({
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
					{getProviderLabel(comment.provider)}
				</span>
				<span className='min-w-0 truncate text-muted-foreground text-xs'>
					{comment.detail}
				</span>
			</div>
		</div>
	);
}

function PullRequestTodoRow({
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

function PullRequestCheckStatusIcon({
	status,
}: {
	status: PullRequestCheckStatus;
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

function ProviderMark({ provider }: { provider: ProviderMarkKind }) {
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

function ChecksEmptyMessage({ label }: { label: string }) {
	return <p className='text-muted-foreground text-xs'>{label}</p>;
}

function formatCount(count: number, singular: string) {
	return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

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
