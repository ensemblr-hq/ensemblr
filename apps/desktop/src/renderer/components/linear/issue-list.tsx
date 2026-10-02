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
import { useLinearRefresh } from '@/renderer/hooks/linear/use-linear-refresh';
import { useDebouncedValue } from '@/renderer/hooks/use-debounced-value';
import {
	ALL_ACCOUNTS,
	ALL_TEAMS,
	describeLinearAccountFailures,
	describeLinearFailure,
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
 * Linear issue browse list across every connected account: search, account and
 * team filters, a completion scope, and sortable, groupable rows. Every one of
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
	const { clear, filters, setAccountId, setQuery, setTeamId } =
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: group headings are named through the i18n singleton, so the language is a real input Biome cannot see.
	const board = useMemo(
		() => orderLinearIssues({ grouping, issues: rows, scope, sort }),
		[grouping, i18n.language, rows, scope, sort],
	);
	const showOrganization = useMemo(() => spansOrganizations(rows), [rows]);

	return (
		<div className='flex w-full flex-col gap-3'>
			<LinearIssueFilterBar
				accountId={accountId}
				accounts={accounts}
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
}: {
	group: LinearIssueGroup;
	onOpen: (issue: LinearIssueWire) => void;
	showOrganization: boolean;
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
					/>
				))}
			</ul>
		</section>
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
 * Copy for an empty list, which has three quite different causes: nothing
 * cached, nothing matching the search, or everything filtered out by the scope.
 * @param options - Whether any rows loaded, the search text, the active scope, and `t`
 * @returns The sentence to show in place of the list
 */
function emptyText({
	hasRows,
	query,
	scope,
	t,
}: {
	hasRows: boolean;
	query: string;
	scope: LinearIssueScope;
	t: (key: string, fallback: string) => string;
}): string {
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
