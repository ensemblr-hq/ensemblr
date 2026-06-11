import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { PlusIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';

import {
	linearIssuesQuery,
	linearMetadataQuery,
} from '@/renderer/api/ensemble';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { describeLinearFailure } from '@/renderer/lib/linear';
import type { LinearIssueWire } from '@/shared/ipc';

import { LinearIssueEditorDialog } from './issue-editor-dialog';
import { LinearIssueMetaBadges } from './issue-meta-badges';

const ALL_TEAMS = 'all';

/** Linear issue browse list: search, team filter, refresh, and issue rows. */
export function LinearIssueList() {
	const navigate = useNavigate();
	const [query, setQuery] = useState('');
	const [teamId, setTeamId] = useState<string>(ALL_TEAMS);
	const [editorOpen, setEditorOpen] = useState(false);

	const metadata = useQuery(linearMetadataQuery);
	const issues = useQuery(
		linearIssuesQuery({
			...(query ? { query } : {}),
			...(teamId !== ALL_TEAMS ? { teamId } : {}),
		}),
	);

	const teams =
		metadata.data?.status === 'ok' || metadata.data?.status === 'error'
			? metadata.data.metadata.teams
			: [];
	const result = issues.data;
	const rows = result?.issues ?? [];

	return (
		<div className='flex w-full flex-col gap-3'>
			<div className='flex items-center gap-2'>
				<div className='relative flex-1'>
					<SearchIcon
						aria-hidden='true'
						className='absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground'
					/>
					<Input
						aria-label='Search Linear issues'
						className='pl-8'
						onChange={(event) => setQuery(event.target.value)}
						placeholder='Search by identifier or title…'
						value={query}
					/>
				</div>
				{teams.length > 0 ? (
					<Select onValueChange={setTeamId} value={teamId}>
						<SelectTrigger className='w-44' size='sm'>
							<SelectValue placeholder='All teams' />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL_TEAMS}>All teams</SelectItem>
							{teams.map((team) => (
								<SelectItem key={team.id} value={team.id}>
									{team.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : null}
				<Button
					aria-label='Refresh issues'
					disabled={issues.isFetching}
					onClick={() => void issues.refetch()}
					size='icon-sm'
					variant='ghost'
				>
					<RefreshCwIcon
						className={issues.isFetching ? 'animate-spin' : undefined}
					/>
				</Button>
				<Button onClick={() => setEditorOpen(true)} size='sm'>
					<PlusIcon /> New issue
				</Button>
			</div>
			<LinearIssueEditorDialog onOpenChange={setEditorOpen} open={editorOpen} />

			{result?.status === 'error' ? (
				<p className='rounded-md border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-status-danger text-xs'>
					{describeLinearFailure(result.failure)}
				</p>
			) : null}

			{issues.isLoading ? (
				<div className='flex flex-col gap-2'>
					<Skeleton className='h-12 w-full' />
					<Skeleton className='h-12 w-full' />
					<Skeleton className='h-12 w-full' />
				</div>
			) : rows.length === 0 ? (
				<p className='py-12 text-center text-muted-foreground text-xs'>
					{query
						? 'No issues match your search.'
						: 'No Linear issues are cached yet. Refresh to sync from Linear.'}
				</p>
			) : (
				<ul className='flex flex-col divide-y divide-border rounded-lg border border-border'>
					{rows.map((issue) => (
						<LinearIssueRow
							issue={issue}
							key={issue.id}
							onOpen={() =>
								void navigate({
									params: { issueId: issue.id },
									to: '/linear/$issueId',
								})
							}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

function LinearIssueRow({
	issue,
	onOpen,
}: {
	issue: LinearIssueWire;
	onOpen: () => void;
}) {
	return (
		<li>
			<button
				className='flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50'
				onClick={onOpen}
				type='button'
			>
				<span className='shrink-0 font-mono text-muted-foreground text-xs'>
					{issue.identifier}
				</span>
				<span className='min-w-0 flex-1 truncate text-sm'>{issue.title}</span>
				<LinearIssueMetaBadges issue={issue} />
			</button>
		</li>
	);
}
