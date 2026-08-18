import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	linearConnectionQuery,
	linearIssuesQuery,
	repositoryIssuesQuery,
} from '@/renderer/api/ensemblr';
import { LinearStateBadge } from '@/renderer/components/linear/issue-state-badge';
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/renderer/components/ui/command';
import {
	GithubLogo,
	LinearLogo,
} from '@/renderer/components/workbench-shell/source-provider-logo';
import { useDebouncedValue } from '@/renderer/hooks/use-debounced-value';
import {
	deriveLinearGateState,
	describeLinearAccountFailures,
} from '@/renderer/lib/linear';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import type { RepositoryIssueWire } from '@/shared/ipc/contracts/workspace-sources';

/** How long the search box must hold still before Linear is queried again. */
const SEARCH_DEBOUNCE_MS = 250;

/** One issue the picker can hand back, tagged with the tracker it came from. */
export type PickedIssue =
	| { issue: LinearIssueWire; provider: 'linear' }
	| { issue: RepositoryIssueWire; provider: 'github' };

/**
 * Filters GitHub issues against the typed query. `gh issue list` returns the
 * repository's open issues in one shot, so filtering happens here rather than by
 * re-querying on every keystroke — unlike Linear, which searches server-side.
 * @param issues - Every issue the repository reported.
 * @param query - The search box's current text.
 * @returns The issues whose number or title match.
 */
function matchGithubIssues(
	issues: readonly RepositoryIssueWire[],
	query: string,
): readonly RepositoryIssueWire[] {
	const needle = query.trim().toLowerCase().replace(/^#/, '');
	if (!needle) {
		return issues;
	}
	return issues.filter(
		(issue) =>
			String(issue.number).includes(needle) ||
			issue.title.toLowerCase().includes(needle),
	);
}

/**
 * Command-palette picker for attaching one issue, from either tracker. Both
 * sources share a search box and a list so the user picks the issue they have in
 * mind without first having to say where it lives.
 */
export function IssuePickerDialog({
	onOpenChange,
	onSelect,
	open,
	repositoryId,
}: {
	onOpenChange: (open: boolean) => void;
	onSelect: (picked: PickedIssue) => void;
	open: boolean;
	repositoryId: string;
}) {
	const { t } = useTranslation();
	const [query, setQuery] = useState('');
	const settledQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
	const { data: connectionData, isLoading: connectionLoading } = useQuery({
		...linearConnectionQuery,
		enabled: open,
	});
	const { data: linearData, isLoading: linearLoading } = useQuery({
		...linearIssuesQuery(settledQuery ? { query: settledQuery } : {}),
		enabled: open,
	});
	const { data: githubData, isLoading: githubLoading } = useQuery({
		...repositoryIssuesQuery(repositoryId),
		enabled: open,
	});

	const linearReady =
		deriveLinearGateState({
			connection: connectionData,
			isLoading: connectionLoading,
		}).kind === 'ready';
	const linearRows = linearReady ? (linearData?.issues ?? []) : [];
	const linearAccountFailures = linearReady
		? (linearData?.accountFailures ?? [])
		: [];
	const showLinearOrganizations = (connectionData?.accounts.length ?? 0) > 1;
	const githubRows = useMemo(
		() => matchGithubIssues(githubData?.issues ?? [], query),
		[githubData?.issues, query],
	);

	const loading = linearLoading || githubLoading;
	const pick = (picked: PickedIssue) => {
		onSelect(picked);
		onOpenChange(false);
	};

	return (
		<CommandDialog
			className='max-w-xl translate-y-0 sm:max-w-xl'
			description={t(
				'workbench:issue-picker.description',
				'Search Linear and GitHub issues and pick one to attach.',
			)}
			onOpenChange={onOpenChange}
			open={open}
			title={t('workbench:issue-picker.title', 'Attach issue')}
		>
			<Command className='rounded-xl border-0' shouldFilter={false}>
				<CommandInput
					onValueChange={setQuery}
					placeholder={t(
						'workbench:issue-picker.search-placeholder',
						'Search by identifier, number, or title…',
					)}
					value={query}
				/>
				<CommandList className='max-h-80'>
					<CommandEmpty className='py-8 text-muted-foreground text-xs'>
						{loading
							? t('workbench:issue-picker.loading', 'Loading issues…')
							: t(
									'workbench:issue-picker.empty',
									'No issues match your search.',
								)}
					</CommandEmpty>
					{linearRows.length > 0 ? (
						<CommandGroup
							heading={t('workbench:issue-picker.group-linear', 'Linear')}
						>
							{linearRows.map((issue) => (
								<CommandItem
									className='h-11'
									key={issue.id}
									keywords={[
										issue.identifier,
										issue.title,
										...(issue.organizationName ? [issue.organizationName] : []),
									]}
									onSelect={() => pick({ issue, provider: 'linear' })}
									value={`linear:${issue.id}`}
								>
									<LinearLogo className='size-4 shrink-0 text-muted-foreground' />
									<span className='shrink-0 font-mono text-muted-foreground text-xxs'>
										{issue.identifier}
									</span>
									<span className='min-w-0 flex-1 truncate text-[0.8125rem]'>
										{issue.title}
									</span>
									{showLinearOrganizations && issue.organizationName ? (
										<span className='shrink-0 truncate text-muted-foreground text-xxs'>
											{issue.organizationName}
										</span>
									) : null}
									<LinearStateBadge
										color={issue.stateColor}
										name={issue.stateName}
										stateType={issue.stateType}
									/>
								</CommandItem>
							))}
						</CommandGroup>
					) : null}
					{githubRows.length > 0 ? (
						<CommandGroup
							heading={t('workbench:issue-picker.group-github', 'GitHub')}
						>
							{githubRows.map((issue) => (
								<CommandItem
									className='h-11'
									key={issue.number}
									keywords={[String(issue.number), issue.title]}
									onSelect={() => pick({ issue, provider: 'github' })}
									value={`github:${issue.number}`}
								>
									<GithubLogo className='size-4 shrink-0 text-muted-foreground' />
									<span className='shrink-0 font-mono text-muted-foreground text-xxs'>
										#{issue.number}
									</span>
									<span className='min-w-0 flex-1 truncate text-[0.8125rem]'>
										{issue.title}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					) : null}
				</CommandList>
				{linearAccountFailures.length > 0 ? (
					<p className='mx-1 mb-1 rounded-lg bg-status-warning/5 px-2 py-1.5 text-status-warning text-xs'>
						{describeLinearAccountFailures(linearAccountFailures)}
					</p>
				) : null}
				{linearReady ? null : (
					<p className='mx-1 mb-1 rounded-lg bg-muted/40 px-2 py-1.5 text-muted-foreground text-xs'>
						{t(
							'workbench:issue-picker.linear-not-connected',
							'No Linear account is connected, so only GitHub issues are listed. Sign in from integration settings.',
						)}
					</p>
				)}
			</Command>
		</CommandDialog>
	);
}
