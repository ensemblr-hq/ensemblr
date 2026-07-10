import { useQuery } from '@tanstack/react-query';
import { CheckIcon, MoreVerticalIcon, Undo2Icon, XIcon } from 'lucide-react';
import { useState } from 'react';

import { workspaceCommitsQuery } from '@/renderer/api/ensemblr';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { cn } from '@/renderer/lib/utils';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { ChangesSource } from '@/renderer/types/workbench-shell';

/**
 * Dismissable pill showing the active non-default change source. Clicking it
 * (the ✕) clears the filter back to "All changes".
 */
export function ChangesSourceBadge({
	onClear,
	source,
}: {
	onClear: () => void;
	source: ChangesSource;
}) {
	if (source.kind === 'all') {
		return null;
	}
	const label =
		source.kind === 'uncommitted' ? 'Uncommitted' : source.shortHash;

	return (
		<Button
			className='h-7 max-w-40 gap-1 px-2'
			onClick={onClear}
			size='xs'
			title={source.kind === 'commit' ? source.subject : 'Uncommitted changes'}
			variant='outline'
		>
			<XIcon data-icon='inline-start' />
			<span className={cn('truncate', source.kind === 'commit' && 'font-mono')}>
				{label}
			</span>
		</Button>
	);
}

/** Dropdown for picking the Changes tab's source: all, uncommitted, or a commit. */
export function ChangesOverflowMenu({
	onDiscardAll,
	onSelectSource,
	source,
	workspace,
}: {
	/** Opens the confirm dialog to discard every uncommitted change, when any exist. */
	onDiscardAll: () => void;
	onSelectSource: (source: ChangesSource) => void;
	source: ChangesSource;
	workspace: WorkspaceShellModel;
}) {
	// Defer the `git log` call until the menu actually opens — there's no reason
	// to read commits for every workspace the user merely glances at.
	const [open, setOpen] = useState(false);
	// Scope the list to this branch's own commits so base-branch history (and the
	// root/initial commit) never pollutes the menu.
	const baseRef = workspace.landingSummary?.branchSource.baseBranch ?? null;
	const { data, isError, isPending } = useQuery({
		...workspaceCommitsQuery(workspace.pathLabel, baseRef),
		enabled: open && Boolean(workspace.pathLabel),
	});
	const commits = data?.commits ?? [];
	const hasCommitFailure = isError || Boolean(data?.error);
	const uncommittedCount = workspace.changeSummary.files;

	return (
		<DropdownMenu onOpenChange={setOpen} open={open}>
			<DropdownMenuTrigger asChild>
				<Button size='icon-sm' variant='ghost'>
					<MoreVerticalIcon />
					<span className='sr-only'>Open changes menu</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-80 p-0'>
				<div className='p-1'>
					<DropdownMenuItem
						className='h-9 px-2 text-sm'
						onSelect={() => onSelectSource({ kind: 'all' })}
					>
						<span className='min-w-0 flex-1 truncate'>All changes</span>
						{source.kind === 'all' ? (
							<CheckIcon aria-hidden='true' className='size-4' />
						) : null}
					</DropdownMenuItem>
					<DropdownMenuItem
						className='items-start px-2 py-2'
						onSelect={() => onSelectSource({ kind: 'uncommitted' })}
					>
						<div className='min-w-0 flex-1'>
							<div className='truncate font-medium text-sm'>
								Uncommitted changes
							</div>
							<div className='text-muted-foreground text-xs'>
								{uncommittedCount > 0
									? `${uncommittedCount} ${
											uncommittedCount === 1 ? 'file' : 'files'
										} changed`
									: 'No uncommitted changes'}
							</div>
						</div>
						{source.kind === 'uncommitted' ? (
							<CheckIcon aria-hidden='true' className='size-4' />
						) : (
							<DropdownMenuShortcut>⌥⌘U</DropdownMenuShortcut>
						)}
					</DropdownMenuItem>
				</div>
				<DropdownMenuSeparator className='my-0' />
				<div className='max-h-72 overflow-y-auto p-1'>
					{hasCommitFailure ? (
						<div className='px-2 py-2 text-muted-foreground text-xs'>
							Could not load commits.
						</div>
					) : isPending ? (
						<div className='px-2 py-2 text-muted-foreground text-xs'>
							Loading commits…
						</div>
					) : commits.length ? (
						commits.map((commit) => (
							<DropdownMenuItem
								className='items-start px-2 py-2'
								key={commit.hash}
								onSelect={() =>
									onSelectSource({
										hash: commit.hash,
										kind: 'commit',
										shortHash: commit.shortHash,
										subject: commit.subject,
									})
								}
							>
								<div className='min-w-0 flex-1'>
									<div className='truncate font-medium text-sm'>
										{commit.subject}
									</div>
									<div className='truncate text-muted-foreground text-xs'>
										{commit.shortHash} • {commit.author} • {commit.relativeTime}
									</div>
								</div>
								{source.kind === 'commit' && source.hash === commit.hash ? (
									<CheckIcon aria-hidden='true' className='mt-0.5 size-4' />
								) : null}
							</DropdownMenuItem>
						))
					) : (
						<div className='px-2 py-2 text-muted-foreground text-xs'>
							No commits yet.
						</div>
					)}
				</div>
				{uncommittedCount > 0 ? (
					<>
						<DropdownMenuSeparator className='my-0' />
						<div className='p-1'>
							<DropdownMenuItem
								className='h-9 gap-2 px-2 text-sm text-status-danger focus:text-status-danger'
								onSelect={onDiscardAll}
							>
								<Undo2Icon aria-hidden='true' />
								<span className='min-w-0 flex-1 truncate'>
									Discard all uncommitted changes
								</span>
							</DropdownMenuItem>
						</div>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
