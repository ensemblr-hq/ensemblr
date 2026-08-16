import {
	ArrowUpDownIcon,
	LayersIcon,
	PlusIcon,
	RefreshCwIcon,
	SearchIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Input } from '@/renderer/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import {
	ToggleGroup,
	ToggleGroupItem,
} from '@/renderer/components/ui/toggle-group';
import { useRefreshSpin } from '@/renderer/hooks/linear/use-refresh-spin';
import type {
	LinearIssueGrouping,
	LinearIssueScope,
	LinearIssueSort,
} from '@/renderer/lib/linear';
import type {
	LinearAccountSnapshot,
	LinearResourceWire,
} from '@/shared/ipc/contracts/linear';

/** Sentinel option value meaning "do not narrow by account". */
export const ALL_ACCOUNTS = 'all';

/** Sentinel option value meaning "do not narrow by team". */
export const ALL_TEAMS = 'all';

const SCOPES: readonly LinearIssueScope[] = ['active', 'closed', 'all'];
const SORTS: readonly LinearIssueSort[] = [
	'priority',
	'updated',
	'status',
	'title',
];
const GROUPINGS: readonly LinearIssueGrouping[] = [
	'status',
	'priority',
	'assignee',
	'none',
];

/** The search, account, and team filters plus the refresh and create actions. */
export function LinearIssueFilterBar({
	accountId,
	accounts,
	onAccountChange,
	onNewIssue,
	onQueryChange,
	onRefresh,
	onTeamChange,
	query,
	refreshing,
	showAccounts,
	teamId,
	teams,
}: {
	accountId: string;
	accounts: readonly LinearAccountSnapshot[];
	onAccountChange: (accountId: string) => void;
	onNewIssue: () => void;
	onQueryChange: (query: string) => void;
	onRefresh: () => void;
	onTeamChange: (teamId: string) => void;
	query: string;
	refreshing: boolean;
	showAccounts: boolean;
	teamId: string;
	teams: readonly LinearResourceWire[];
}) {
	const { t } = useTranslation();
	const allTeamsLabel = t('linear:issue-list.all-teams', 'All teams');
	const allAccountsLabel = t(
		'linear:issue-list.all-accounts',
		'All organizations',
	);
	const selectedTeam = teams.find((team) => team.id === teamId);

	return (
		<div className='flex items-center gap-2'>
			<div className='relative flex-1'>
				<SearchIcon
					aria-hidden='true'
					className='absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground'
				/>
				<Input
					aria-label={t(
						'linear:issue-list.search-label',
						'Search Linear issues',
					)}
					className='pl-8'
					onChange={(event) => onQueryChange(event.target.value)}
					placeholder={t(
						'linear:issue-list.search-placeholder',
						'Search by identifier or title…',
					)}
					value={query}
				/>
			</div>
			{showAccounts ? (
				<Select onValueChange={onAccountChange} value={accountId}>
					<SelectTrigger className='w-44'>
						<SelectValue placeholder={allAccountsLabel} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL_ACCOUNTS}>{allAccountsLabel}</SelectItem>
						{accounts.map((account) => (
							<SelectItem key={account.id} value={account.id}>
								{account.organizationName ??
									account.userName ??
									account.userEmail ??
									account.id}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : null}
			{teams.length > 0 ? (
				<Select onValueChange={onTeamChange} value={teamId}>
					<SelectTrigger className='w-44'>
						<SelectValue placeholder={allTeamsLabel}>
							{selectedTeam ? selectedTeam.name : allTeamsLabel}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL_TEAMS}>{allTeamsLabel}</SelectItem>
						{teams.map((team) => (
							<SelectItem key={team.id} value={team.id}>
								<span className='flex flex-col items-start'>
									{team.name}
									{showAccounts && team.organizationName ? (
										<span className='text-muted-foreground text-xs'>
											{team.organizationName}
										</span>
									) : null}
								</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : null}
			<LinearRefreshButton onRefresh={onRefresh} refreshing={refreshing} />
			<Button onClick={onNewIssue}>
				<PlusIcon /> {t('linear:issue-list.new-issue', 'New issue')}
			</Button>
		</div>
	);
}

/** Refresh control that always completes one full turn of the icon. */
function LinearRefreshButton({
	onRefresh,
	refreshing,
}: {
	onRefresh: () => void;
	refreshing: boolean;
}) {
	const { t } = useTranslation();
	const { active, start } = useRefreshSpin(refreshing);

	return (
		<Button
			aria-label={t('linear:issue-list.refresh', 'Refresh issues')}
			disabled={active}
			onClick={() => {
				start();
				onRefresh();
			}}
			size='icon'
			variant='ghost'
		>
			<RefreshCwIcon className={active ? 'animate-spin' : undefined} />
		</Button>
	);
}

/**
 * The view bar sitting above the list: completion scope on the left, then the
 * visible count and the sort and grouping pickers. Separated from the filter bar
 * because these three change how the same rows are *read*, not which rows load.
 */
export function LinearIssueViewBar({
	grouping,
	onGroupingChange,
	onScopeChange,
	onSortChange,
	scope,
	sort,
	total,
}: {
	grouping: LinearIssueGrouping;
	onGroupingChange: (grouping: LinearIssueGrouping) => void;
	onScopeChange: (scope: LinearIssueScope) => void;
	onSortChange: (sort: LinearIssueSort) => void;
	scope: LinearIssueScope;
	sort: LinearIssueSort;
	total: number;
}) {
	const { t } = useTranslation();

	return (
		<div className='flex items-center justify-between gap-2'>
			<ToggleGroup
				onValueChange={(next) => {
					if (next) {
						onScopeChange(next as LinearIssueScope);
					}
				}}
				type='single'
				value={scope}
			>
				{SCOPES.map((option) => (
					<ToggleGroupItem
						className='h-7 rounded-md px-2.5 text-xs'
						key={option}
						value={option}
					>
						{scopeLabel(option, t)}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
			<div className='flex items-center gap-1'>
				<span className='mr-1 text-muted-foreground text-xs tabular-nums'>
					{t('linear:issue-list.count', '{{count}} issues', {
						count: total,
						defaultValue_one: '{{count}} issue',
					})}
				</span>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button size='xs' variant='ghost'>
							<ArrowUpDownIcon aria-hidden='true' />
							{sortLabel(sort, t)}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='end'>
						<DropdownMenuLabel>
							{t('linear:issue-list.sort', 'Sort by')}
						</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							onValueChange={(next) => onSortChange(next as LinearIssueSort)}
							value={sort}
						>
							{SORTS.map((option) => (
								<DropdownMenuRadioItem key={option} value={option}>
									{sortLabel(option, t)}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button size='xs' variant='ghost'>
							<LayersIcon aria-hidden='true' />
							{groupingLabel(grouping, t)}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='end'>
						<DropdownMenuLabel>
							{t('linear:issue-list.group', 'Group by')}
						</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							onValueChange={(next) =>
								onGroupingChange(next as LinearIssueGrouping)
							}
							value={grouping}
						>
							{GROUPINGS.map((option) => (
								<DropdownMenuRadioItem key={option} value={option}>
									{groupingLabel(option, t)}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

/**
 * Label for one completion-scope segment.
 * @param scope - The scope segment being labelled
 * @param t - Translation function from the calling component
 * @returns The segment's label in the active language
 */
function scopeLabel(
	scope: LinearIssueScope,
	t: (key: string, fallback: string) => string,
): string {
	switch (scope) {
		case 'active':
			return t('linear:issue-list.scope.active', 'Active');
		case 'closed':
			return t('linear:issue-list.scope.closed', 'Closed');
		default:
			return t('linear:issue-list.scope.all', 'All');
	}
}

/**
 * Label for one sort option, used on the trigger and inside the menu.
 * @param sort - The sort option being labelled
 * @param t - Translation function from the calling component
 * @returns The option's label in the active language
 */
function sortLabel(
	sort: LinearIssueSort,
	t: (key: string, fallback: string) => string,
): string {
	switch (sort) {
		case 'priority':
			return t('linear:issue-list.sort-by.priority', 'Priority');
		case 'status':
			return t('linear:issue-list.sort-by.status', 'Status');
		case 'title':
			return t('linear:issue-list.sort-by.title', 'Title');
		default:
			return t('linear:issue-list.sort-by.updated', 'Updated');
	}
}

/**
 * Label for one grouping option, used on the trigger and inside the menu.
 * @param grouping - The grouping option being labelled
 * @param t - Translation function from the calling component
 * @returns The option's label in the active language
 */
function groupingLabel(
	grouping: LinearIssueGrouping,
	t: (key: string, fallback: string) => string,
): string {
	switch (grouping) {
		case 'assignee':
			return t('linear:issue-list.group-by.assignee', 'Assignee');
		case 'priority':
			return t('linear:issue-list.group-by.priority', 'Priority');
		case 'status':
			return t('linear:issue-list.group-by.status', 'Status');
		default:
			return t('linear:issue-list.group-by.none', 'No grouping');
	}
}
