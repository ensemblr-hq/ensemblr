import { useQuery } from '@tanstack/react-query';
import { SearchIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
	allWorkspacesHistoryQuery,
	isEnsembleApiAvailable,
} from '@/renderer/api/ensemble';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useWorkbenchLayoutRouteModel } from '@/renderer/components/workbench-shell/shell-contexts';
import type { WorkspaceHistoryEntry } from '@/shared/ipc/contracts/workspace';

import { HistoryGroup } from './history-group';
import { bucketForDate } from './relative-time';

interface HistoryGroupModel {
	entries: WorkspaceHistoryEntry[];
	label: string;
}

/**
 * History screen: every workspace ever created across all projects, grouped by
 * last activity (newest first), with a client-side filter. Active rows open the
 * workspace; archived rows expose an Unarchive action. The backend already
 * returns entries sorted by `updated_at DESC`, so grouping preserves that order
 * and buckets appear newest-first.
 */
export function HistoryPage() {
	const apiAvailable = isEnsembleApiAvailable();
	const { navigateToWorkspace } = useWorkbenchLayoutRouteModel();
	const { data, isError, isLoading } = useQuery({
		...allWorkspacesHistoryQuery(),
		enabled: apiAvailable,
	});
	const [filter, setFilter] = useState('');

	const entries = useMemo(() => data?.entries ?? [], [data]);

	const filtered = useMemo(() => {
		const query = filter.trim().toLowerCase();
		if (!query) {
			return entries;
		}
		return entries.filter((entry) =>
			`${entry.repositoryName} ${entry.name} ${entry.branchName ?? ''}`
				.toLowerCase()
				.includes(query),
		);
	}, [entries, filter]);

	const groups = useMemo(() => groupByBucket(filtered), [filtered]);

	const handleOpen = useCallback(
		(entry: WorkspaceHistoryEntry) => {
			navigateToWorkspace(entry.repositoryId, entry.id);
		},
		[navigateToWorkspace],
	);

	return (
		<main className='flex min-w-0 flex-1 flex-col overflow-hidden'>
			<header className='native-toolbar flex h-12 shrink-0 items-center gap-2.5 border-border border-b px-3'>
				<SearchIcon
					aria-hidden='true'
					className='size-4 shrink-0 text-muted-foreground'
				/>
				<input
					aria-label='Filter workspaces'
					className='h-full w-full min-w-0 max-w-xl bg-transparent text-sm outline-none placeholder:text-muted-foreground'
					onChange={(event) => {
						setFilter(event.target.value);
					}}
					placeholder='Filter workspaces…'
					value={filter}
				/>
			</header>

			<ScrollArea className='min-h-0 flex-1'>
				<div className='flex flex-col gap-5 px-4 pt-2 pb-6'>
					<HistoryBody
						apiAvailable={apiAvailable}
						groups={groups}
						hasEntries={entries.length > 0}
						isError={isError}
						isLoading={isLoading}
						onOpen={handleOpen}
					/>
				</div>
			</ScrollArea>
		</main>
	);
}

function HistoryBody({
	apiAvailable,
	groups,
	hasEntries,
	isError,
	isLoading,
	onOpen,
}: {
	apiAvailable: boolean;
	groups: HistoryGroupModel[];
	hasEntries: boolean;
	isError: boolean;
	isLoading: boolean;
	onOpen: (entry: WorkspaceHistoryEntry) => void;
}) {
	if (!apiAvailable) {
		return (
			<HistoryNotice message='The preload bridge is unavailable in this context.' />
		);
	}
	if (isLoading) {
		return <HistoryNotice message='Loading workspaces…' />;
	}
	if (isError) {
		return <HistoryNotice message='Failed to load workspace history.' />;
	}
	if (!hasEntries) {
		return <HistoryNotice message='No workspaces yet.' />;
	}
	if (groups.length === 0) {
		return <HistoryNotice message='No workspaces match your filter.' />;
	}

	return (
		<>
			{groups.map((group) => (
				<HistoryGroup
					entries={group.entries}
					key={group.label}
					label={group.label}
					onOpen={onOpen}
				/>
			))}
		</>
	);
}

function HistoryNotice({ message }: { message: string }) {
	return (
		<div className='px-2 py-12 text-center text-muted-foreground text-xs'>
			{message}
		</div>
	);
}

/**
 * Groups entries into ordered relative-time buckets. Entries arrive sorted by
 * `updated_at DESC`, and a `Map` preserves insertion order, so buckets come out
 * newest-first with their rows already in order.
 */
function groupByBucket(entries: WorkspaceHistoryEntry[]): HistoryGroupModel[] {
	const buckets = new Map<string, WorkspaceHistoryEntry[]>();
	for (const entry of entries) {
		const label = bucketForDate(entry.updatedAt);
		const existing = buckets.get(label);
		if (existing) {
			existing.push(entry);
		} else {
			buckets.set(label, [entry]);
		}
	}
	return Array.from(buckets, ([label, items]) => ({ entries: items, label }));
}
