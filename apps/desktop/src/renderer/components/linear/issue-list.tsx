import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	linearConnectionQuery,
	linearIssuesQuery,
	linearMetadataQuery,
	refreshLinearIssues,
} from '@/renderer/api/ensemblr';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { useLinearAssigneeFilter } from '@/renderer/hooks/linear/use-linear-assignee-filter';
import { useLinearRefresh } from '@/renderer/hooks/linear/use-linear-refresh';
import { useDebouncedValue } from '@/renderer/hooks/use-debounced-value';
import {
	ALL_ACCOUNTS,
	ALL_TEAMS,
	describeLinearAccountFailures,
	describeLinearFailure,
	type LinearIssueBoard,
	type LinearIssueGroup,
	type LinearIssueScope,
	orderLinearIssues,
	resolveLinearIssueFilters,
} from '@/renderer/lib/linear';
import {
	linearIssueGroupingAtom,
	linearIssueScopeAtom,
	linearIssueSortAtom,
	useLinearIssueFilters,
} from '@/renderer/state/linear';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import { LinearIssueEditorDialog } from './issue-editor-dialog';
import { LinearPriorityIcon, LinearStateIcon } from './issue-glyphs';
import { LinearIssueFilterBar, LinearIssueViewBar } from './issue-list-toolbar';
import { LinearIssueRow } from './issue-row';

/** How long the search box must hold still before the list is re-read. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Linear issue browse list across every connected account: search, account,
 * team, and assignee filters, a completion scope, and sortable, groupable rows.
 * The assignee facet narrows the rows the read returned rather than the read
 * itself, so its options stay complete while it is applied. Every one of
 * those is remembered, so opening an issue and coming back returns to the same
 * view. Rows are merged rather than grouped by account, so each carries its
 * organization when the visible set actually spans more than one.
 */
export function LinearIssueList() {
	const { i18n, t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [editorOpen, setEditorOpen] = useState(false);
	const [scope, setScope] = useAtom(linearIssueScopeAtom);
	const [sort, setSort] = useAtom(linearIssueSortAtom);
	const [grouping, setGrouping] = useAtom(linearIssueGroupingAtom);
	const { clear, filters, setAccountId, setQuery, setTeamId, toggleAssignee } =
		useLinearIssueFilters();
	const settledQuery = useDebouncedValue(filters.query, SEARCH_DEBOUNCE_MS);

	const { data: summary } = useQuery(linearConnectionQuery);
	const { data: metadataData } = useQuery(linearMetadataQuery);

	const accounts = useMemo(() => summary?.accounts ?? [], [summary]);
	const { accountId, teamId, teams } = useMemo(
		() =>
			resolveLinearIssueFilters({
				accounts: summary?.accounts,
				filters,
				teams: metadataData?.metadata.teams,
			}),
		[filters, metadataData, summary],
	);
	const request = useMemo(
		() => ({
			...(accountId !== ALL_ACCOUNTS ? { accountId } : {}),
			...(settledQuery ? { query: settledQuery } : {}),
			...(teamId !== ALL_TEAMS ? { teamId } : {}),
		}),
		[accountId, settledQuery, teamId],
	);
	const refresh = useLinearRefresh(() =>
		refreshLinearIssues(queryClient, request),
	);
	const {
		data: result,
		isFetching: issuesFetching,
		isLoading: issuesLoading,
	} = useQuery(linearIssuesQuery(request));

	const showAccountFilter = accounts.length > 1;
	const rows = useMemo(() => result?.issues ?? [], [result]);
	const assignee = useLinearAssigneeFilter({
		issues: rows,
		selection: filters.assignees,
	});
	const assignedRows = useMemo(
		() => rows.filter(assignee.matches),
		[assignee.matches, rows],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: group headings are named through the i18n singleton, so the language is a real input Biome cannot see.
	const board = useMemo(
		() => orderLinearIssues({ grouping, issues: assignedRows, scope, sort }),
		[assignedRows, grouping, i18n.language, scope, sort],
	);
	const showOrganization = useMemo(
		() => spansOrganizations(assignedRows),
		[assignedRows],
	);
	const showProject = useMemo(
		() => grouping !== 'project' && hasProjects(board),
		[board, grouping],
	);

	return (
		<div className='flex w-full flex-col gap-3'>
			<LinearIssueFilterBar
				accountId={accountId}
				accounts={accounts}
				assignee={{
					onToggle: toggleAssignee,
					options: assignee.options,
					selection: filters.assignees,
				}}
				onAccountChange={setAccountId}
				onClearFilters={clear}
				onNewIssue={() => setEditorOpen(true)}
				onQueryChange={setQuery}
				onRefresh={refresh.start}
				onTeamChange={setTeamId}
				query={filters.query}
				refreshing={issuesFetching || refresh.active}
				showAccounts={showAccountFilter}
				teamId={teamId}
				teams={teams}
			/>
			<LinearIssueEditorDialog onOpenChange={setEditorOpen} open={editorOpen} />

			{result?.status === 'error' ? (
				<p className='rounded-md border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-status-danger text-xs'>
					{describeLinearFailure(result.failure)}
				</p>
			) : null}

			{result && result.accountFailures.length > 0 ? (
				<p className='rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-status-warning text-xs'>
					{describeLinearAccountFailures(result.accountFailures)}
				</p>
			) : null}

			<LinearIssueViewBar
				grouping={grouping}
				onGroupingChange={setGrouping}
				onScopeChange={setScope}
				onSortChange={setSort}
				scope={scope}
				sort={sort}
				total={board.total}
			/>

			{issuesLoading ? (
				<div className='flex flex-col gap-2'>
					<Skeleton className='h-10 w-full' />
					<Skeleton className='h-10 w-full' />
					<Skeleton className='h-10 w-full' />
				</div>
			) : board.total === 0 ? (
				<p className='rounded-lg border border-border border-dashed px-3 py-12 text-center text-muted-foreground text-xs'>
					{emptyText({
						hasAssignedRows: assignedRows.length > 0,
						hasRows: rows.length > 0,
						query: filters.query,
						scope,
						t,
					})}
				</p>
			) : (
				<div className='flex flex-col gap-4'>
					{board.groups.map((group) => (
						<LinearIssueGroupSection
							group={group}
							key={group.id}
							onOpen={(issue) =>
								void navigate({
									params: { issueId: issue.id },
									to: '/linear/$issueId',
								})
							}
							showOrganization={showOrganization}
							showProject={showProject}
						/>
					))}
				</div>
			)}
		</div>
	);
}

/**
 * One grouped section: a sticky header naming the bucket and its size, over a
 * card of rows. The header is what turns a flat merged list into something that
 * can be read a section at a time.
 */
function LinearIssueGroupSection({
	group,
	onOpen,
	showOrganization,
	showProject,
}: {
	group: LinearIssueGroup;
	onOpen: (issue: LinearIssueWire) => void;
	showOrganization: boolean;
	showProject: boolean;
}) {
	return (
		<section className='flex flex-col gap-1.5'>
			{group.label === null ? null : (
				<header className='sticky top-0 z-10 flex items-center gap-2 bg-background/80 py-1 backdrop-blur-sm'>
					{group.stateBucket ? (
						<LinearStateIcon bucket={group.stateBucket} />
					) : null}
					{group.priority === null ? null : (
						<LinearPriorityIcon priority={group.priority} />
					)}
					<h2 className='font-medium text-foreground text-xs'>{group.label}</h2>
					<span className='text-muted-foreground text-xxs tabular-nums'>
						{group.issues.length}
					</span>
				</header>
			)}
			<ul className='flex flex-col divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-pane/40'>
				{group.issues.map((issue) => (
					<LinearIssueRow
						issue={issue}
						key={issue.id}
						onOpen={() => onOpen(issue)}
						showOrganization={showOrganization}
						showProject={showProject}
					/>
				))}
			</ul>
		</section>
	);
}

/**
 * True when any issue the list is about to render is filed under a Linear
 * project. When none is, the project column would be empty on every row, so it
 * is left out rather than reserved.
 * @param board - The grouped sections about to be rendered
 * @returns Whether the project column carries information
 */
function hasProjects(board: LinearIssueBoard): boolean {
	return board.groups.some((group) =>
		group.issues.some((issue) => issue.projectName !== null),
	);
}

/**
 * True when the loaded rows come from more than one Linear organization. Two
 * accounts under one organization name make the badge pure repetition, so the
 * check is on the names actually rendered rather than on the account count.
 * @param issues - The rows about to be rendered
 * @returns Whether the organization badge carries information
 */
function spansOrganizations(issues: readonly LinearIssueWire[]): boolean {
	return new Set(issues.map((issue) => issue.organizationName)).size > 1;
}

/**
 * Copy for an empty list, which has four quite different causes: nothing
 * cached, nothing matching the search, nobody the assignee facet keeps, or
 * everything filtered out by the scope.
 * @param options - Whether any rows loaded and survived the assignee facet, the search text, the active scope, and `t`
 * @returns The sentence to show in place of the list
 */
function emptyText({
	hasAssignedRows,
	hasRows,
	query,
	scope,
	t,
}: {
	hasAssignedRows: boolean;
	hasRows: boolean;
	query: string;
	scope: LinearIssueScope;
	t: (key: string, fallback: string) => string;
}): string {
	if (hasRows && !hasAssignedRows) {
		return t(
			'linear:issue-list.empty-assignee',
			'No issues here match the assignee filter.',
		);
	}

	if (hasRows) {
		return scope === 'closed'
			? t('linear:issue-list.empty-closed', 'No closed issues here yet.')
			: t(
					'linear:issue-list.empty-scope',
					'Every issue here is closed. Switch to All to see them.',
				);
	}

	return query
		? t('linear:issue-list.empty-search', 'No issues match your search.')
		: t(
				'linear:issue-list.empty',
				'No Linear issues are cached yet. Refresh to sync from Linear.',
			);
}
