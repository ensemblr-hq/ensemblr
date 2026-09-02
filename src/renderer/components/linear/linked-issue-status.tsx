import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { RefreshCwIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
	ensemblrQueryKeys,
	linearConnectionQuery,
	linearIssueQuery,
	linearMetadataQuery,
	refreshLinearIssue,
	updateLinearIssue,
} from '@/renderer/api/ensemblr';
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
import { useLinearRefresh } from '@/renderer/hooks/linear/use-linear-refresh';
import {
	deriveLinearGateState,
	describeLinearFailure,
	isLinearDataStale,
} from '@/renderer/lib/linear';
import type { WorkspaceLinkedIssueSummary } from '@/renderer/types/workbench';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';

import { LinearStateBadge } from './issue-state-badge';

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

/** Resolves and renders a workspace's linked Linear issue: connection gate, live status badge, staleness refresh, and set-status action. */
function LinearLinkedIssueStatus({
	linkedIssue,
	remoteId,
}: {
	linkedIssue: WorkspaceLinkedIssueSummary;
	remoteId: string;
}) {
	const { t } = useTranslation();
	const { data: connectionData, isLoading: connectionLoading } = useQuery(
		linearConnectionQuery,
	);
	const queryClient = useQueryClient();
	const {
		data: result,
		isFetching: queryFetching,
		isLoading: detailLoading,
	} = useQuery(linearIssueQuery(remoteId, linkedIssue.accountId));
	const refresh = useLinearRefresh(() =>
		refreshLinearIssue(queryClient, remoteId, linkedIssue.accountId),
	);
	const detailFetching = queryFetching || refresh.active;
	// Capture mount-time clock once so the stale-data check stays out of JSX
	// (avoids react-doctor flagging `new Date()` in render). Staleness threshold
	// is minutes, so a per-mount snapshot is fine.
	const now = useMemo(() => new Date(), []);
	const gate = deriveLinearGateState({
		connection: connectionData,
		isLoading: connectionLoading,
	});

	if (gate.kind === 'loading' || detailLoading) {
		return <LinkedIssueReference linkedIssue={linkedIssue} />;
	}

	if (gate.kind !== 'ready') {
		return (
			<LinearConnectPrompt
				linkedIssue={linkedIssue}
				needsReconnect={gate.kind === 'reconnect-required'}
			/>
		);
	}

	if (!result) {
		return (
			<LinearStatusUnavailable
				failureCode={null}
				linkedIssue={linkedIssue}
				onRefresh={refresh.start}
			/>
		);
	}

	if (result.status === 'error') {
		return (
			<LinearStatusUnavailable
				failureCode={result.failure.code}
				linkedIssue={linkedIssue}
				onRefresh={refresh.start}
			/>
		);
	}

	return (
		<span className='flex flex-wrap items-center gap-2'>
			<LinkedIssueReference linkedIssue={linkedIssue} />
			<LinearStateBadge
				color={result.issue.stateColor}
				name={result.issue.stateName}
				stateType={result.issue.stateType}
			/>
			{result.issue.archivedAt ? (
				<Badge variant='secondary'>
					{t('linear:issue-badges.archived', 'Archived')}
				</Badge>
			) : (
				<SetStatusMenu issue={result.issue} />
			)}
			{isLinearDataStale(result.issue.syncedAt, now) ? (
				<RefreshIssueButton
					busy={detailFetching}
					label={t(
						'linear:linked-issue.refresh-status',
						'Refresh linked issue status',
					)}
					onRefresh={refresh.start}
				/>
			) : null}
		</span>
	);
}

/** Reference plus the settings link that gets Linear connected or reconnected. */
function LinearConnectPrompt({
	linkedIssue,
	needsReconnect,
}: {
	linkedIssue: WorkspaceLinkedIssueSummary;
	needsReconnect: boolean;
}) {
	const { t } = useTranslation();

	return (
		<span className='flex flex-wrap items-center gap-2'>
			<LinkedIssueReference linkedIssue={linkedIssue} />
			<Button asChild size='sm' variant='ghost'>
				<Link to='/settings/integrations'>
					{needsReconnect
						? t('linear:linked-issue.reconnect', 'Reconnect Linear')
						: t('linear:linked-issue.connect', 'Connect Linear')}
				</Link>
			</Button>
		</span>
	);
}

/**
 * Reference plus a badge saying why the live status is missing. A retry sits
 * beside it except for `not-found`, where the issue is gone from Linear and no
 * amount of refreshing brings it back.
 * @param failureCode - The Linear failure code, or null when nothing came back at all.
 */
function LinearStatusUnavailable({
	failureCode,
	linkedIssue,
	onRefresh,
}: {
	failureCode: string | null;
	linkedIssue: WorkspaceLinkedIssueSummary;
	onRefresh: () => void;
}) {
	const { t } = useTranslation();

	return (
		<span className='flex flex-wrap items-center gap-2'>
			<LinkedIssueReference linkedIssue={linkedIssue} />
			<Badge variant='outline'>
				{failureCode === null
					? t('linear:linked-issue.status.unavailable', 'Status unavailable')
					: shortFailureLabel(failureCode, t)}
			</Badge>
			{failureCode === 'not-found' ? null : (
				<RefreshIssueButton
					busy={false}
					label={t('linear:linked-issue.refresh', 'Refresh linked issue')}
					onRefresh={onRefresh}
				/>
			)}
		</span>
	);
}

/** Icon button that re-fetches the linked issue, spinning while one is in flight. */
function RefreshIssueButton({
	busy,
	label,
	onRefresh,
}: {
	busy: boolean;
	label: string;
	onRefresh: () => void;
}) {
	return (
		<Button
			aria-label={label}
			disabled={busy}
			onClick={onRefresh}
			size='icon-sm'
			variant='ghost'
		>
			<RefreshCwIcon className={busy ? 'animate-spin' : undefined} />
		</Button>
	);
}

/** Explicit status-change menu fed by cached team workflow states. */
function SetStatusMenu({ issue }: { issue: LinearIssueWire }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { data: metadataData } = useQuery(linearMetadataQuery);
	const mutation = useMutation({
		mutationFn: (stateId: string) =>
			updateLinearIssue({ id: issue.id, input: { stateId } }),
		onSettled: async (result) => {
			if (result?.status === 'error') {
				return;
			}
			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.linearIssueAll(issue.id),
			});
		},
	});

	const states = (
		metadataData?.status === 'ok' || metadataData?.status === 'error'
			? metadataData.metadata.states
			: []
	).filter((state) => state.teamId === null || state.teamId === issue.teamId);

	if (states.length === 0) {
		return null;
	}

	const failureMessage =
		mutation.data?.status === 'error'
			? describeLinearFailure(mutation.data.failure)
			: mutation.error
				? t(
						'linear:linked-issue.update-failed',
						'Updating the Linear status failed.',
					)
				: null;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button disabled={mutation.isPending} size='sm' variant='ghost'>
						{mutation.isPending
							? t('linear:linked-issue.updating', 'Updating…')
							: t('linear:linked-issue.set-status', 'Set status')}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='start' className='w-48 p-1'>
					<DropdownMenuLabel className='px-2 pt-1.5 pb-1 text-muted-foreground text-xs'>
						{t('linear:linked-issue.set-status-menu', 'Update Linear status')}
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

/** Renders a linked issue's Linear logo, reference, and title, linking out when a URL is present. */
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

/**
 * Map a Linear failure code to a short status badge label.
 * @param code - Linear failure code
 * @param t - Translation function from the calling component
 * @returns A concise human-readable status label
 */
function shortFailureLabel(code: string, t: TFunction): string {
	switch (code) {
		case 'not-found':
			return t('linear:linked-issue.status.deleted', 'Deleted in Linear');
		case 'permission-denied':
			return t('linear:linked-issue.status.no-access', 'No access');
		case 'rate-limited':
			return t('linear:linked-issue.status.rate-limited', 'Rate limited');
		default:
			return t('linear:linked-issue.status.unavailable', 'Status unavailable');
	}
}
