import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RefreshCwIcon } from 'lucide-react';

import {
	ensembleQueryKeys,
	linearConnectionQuery,
	linearIssueQuery,
	linearMetadataQuery,
	updateLinearIssue,
} from '@/renderer/api/ensemble';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { LinearLogo } from '@/renderer/components/workbench-shell/source-provider-logo';
import {
	deriveLinearGateState,
	describeLinearFailure,
	isLinearDataStale,
} from '@/renderer/lib/linear';
import type { WorkspaceLinkedIssueSummary } from '@/renderer/types/workbench';
import type { LinearIssueWire } from '@/shared/ipc';

import { LinearStateBadge } from './issue-meta-badges';

/**
 * Linked Linear issue surface for a workspace: reference, live status chip,
 * staleness refresh, and an explicit set-status action (never automatic —
 * ENS-049 / ADR 0024).
 */
export function LinkedIssueStatus({
	linkedIssue,
}: {
	linkedIssue: WorkspaceLinkedIssueSummary;
}) {
	if (linkedIssue.provider !== 'linear' || !linkedIssue.remoteId) {
		return <LinkedIssueReference linkedIssue={linkedIssue} />;
	}

	return (
		<LinearLinkedIssueStatus
			linkedIssue={linkedIssue}
			remoteId={linkedIssue.remoteId}
		/>
	);
}

function LinearLinkedIssueStatus({
	linkedIssue,
	remoteId,
}: {
	linkedIssue: WorkspaceLinkedIssueSummary;
	remoteId: string;
}) {
	const connection = useQuery(linearConnectionQuery);
	const detail = useQuery(linearIssueQuery(remoteId));
	const gate = deriveLinearGateState({
		connection: connection.data,
		isLoading: connection.isLoading,
	});

	if (gate.kind === 'loading' || detail.isLoading) {
		return <LinkedIssueReference linkedIssue={linkedIssue} />;
	}

	if (gate.kind !== 'ready') {
		return (
			<span className='flex flex-wrap items-center gap-2'>
				<LinkedIssueReference linkedIssue={linkedIssue} />
				<Button asChild size='sm' variant='ghost'>
					<Link to='/settings/integrations'>
						{gate.kind === 'reconnect-required'
							? 'Reconnect Linear'
							: 'Connect Linear'}
					</Link>
				</Button>
			</span>
		);
	}

	const result = detail.data;

	if (!result || result.status === 'error') {
		return (
			<span className='flex flex-wrap items-center gap-2'>
				<LinkedIssueReference linkedIssue={linkedIssue} />
				<Badge variant='outline'>
					{result
						? shortFailureLabel(result.failure.code)
						: 'Status unavailable'}
				</Badge>
				{result?.failure.code === 'not-found' ? null : (
					<Button
						aria-label='Refresh linked issue'
						onClick={() => void detail.refetch()}
						size='icon-sm'
						variant='ghost'
					>
						<RefreshCwIcon />
					</Button>
				)}
			</span>
		);
	}

	return (
		<span className='flex flex-wrap items-center gap-2'>
			<LinkedIssueReference linkedIssue={linkedIssue} />
			<LinearStateBadge
				color={result.issue.stateColor}
				name={result.issue.stateName}
			/>
			{result.issue.archivedAt ? (
				<Badge variant='secondary'>Archived</Badge>
			) : (
				<SetStatusMenu issue={result.issue} />
			)}
			{isLinearDataStale(result.issue.syncedAt, new Date()) ? (
				<Button
					aria-label='Refresh linked issue status'
					disabled={detail.isFetching}
					onClick={() => void detail.refetch()}
					size='icon-sm'
					variant='ghost'
				>
					<RefreshCwIcon
						className={detail.isFetching ? 'animate-spin' : undefined}
					/>
				</Button>
			) : null}
		</span>
	);
}

/** Explicit status-change menu fed by cached team workflow states. */
function SetStatusMenu({ issue }: { issue: LinearIssueWire }) {
	const queryClient = useQueryClient();
	const metadata = useQuery(linearMetadataQuery);
	const mutation = useMutation({
		mutationFn: (stateId: string) =>
			updateLinearIssue({ id: issue.id, input: { stateId } }),
		onSettled: async (result) => {
			if (result?.status === 'error') {
				return;
			}
			await queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.linearIssue(issue.id),
			});
		},
	});

	const states = (
		metadata.data?.status === 'ok' || metadata.data?.status === 'error'
			? metadata.data.metadata.states
			: []
	).filter((state) => state.teamId === null || state.teamId === issue.teamId);

	if (states.length === 0) {
		return null;
	}

	const failureMessage =
		mutation.data?.status === 'error'
			? describeLinearFailure(mutation.data.failure)
			: mutation.error
				? 'Updating the Linear status failed.'
				: null;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button disabled={mutation.isPending} size='sm' variant='ghost'>
						{mutation.isPending ? 'Updating…' : 'Set status'}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='start' className='w-48 p-1'>
					<DropdownMenuLabel className='px-2 pt-1.5 pb-1 text-muted-foreground text-xs'>
						Update Linear status
					</DropdownMenuLabel>
					{states.map((state) => (
						<DropdownMenuItem
							className='h-8 gap-2 px-2 text-[0.8125rem]'
							disabled={state.id === issue.stateId}
							key={state.id}
							onSelect={() => mutation.mutate(state.id)}
						>
							<span
								aria-hidden='true'
								className='size-2 shrink-0 rounded-full'
								style={{
									backgroundColor: state.color ?? 'var(--muted-foreground)',
								}}
							/>
							<span className='min-w-0 flex-1 truncate'>{state.name}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			{failureMessage ? (
				<span className='text-status-danger text-xs' role='alert'>
					{failureMessage}
				</span>
			) : null}
		</>
	);
}

function LinkedIssueReference({
	linkedIssue,
}: {
	linkedIssue: WorkspaceLinkedIssueSummary;
}) {
	const content = (
		<>
			<LinearLogo className='size-3.5 shrink-0' />
			<span className='font-mono'>{linkedIssue.reference}</span>
			<span className='min-w-0 truncate'>{linkedIssue.title}</span>
		</>
	);

	if (linkedIssue.url) {
		return (
			<a
				className='flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground'
				href={linkedIssue.url}
				rel='noreferrer'
				target='_blank'
			>
				{content}
			</a>
		);
	}

	return (
		<span className='flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs'>
			{content}
		</span>
	);
}

function shortFailureLabel(code: string): string {
	switch (code) {
		case 'not-found':
			return 'Deleted in Linear';
		case 'permission-denied':
			return 'No access';
		case 'rate-limited':
			return 'Rate limited';
		default:
			return 'Status unavailable';
	}
}
