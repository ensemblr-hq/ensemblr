import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestoreIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
	archivedWorkspacesQuery,
	deleteArchivedWorkspace,
	ensemblrQueryKeys,
	invalidateWorkspaceListViews,
	isEnsemblrApiAvailable,
	unarchiveWorkspace,
} from '@/renderer/api/ensemblr-queries';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { ArchiveDiagnosticsList } from '@/renderer/components/workbench-shell/archive-diagnostics-list';
import { canRestoreArchivedWorkspace } from '@/renderer/lib/archive-restore';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type {
	ArchivedWorkspaceListEntry,
	DeleteArchivedWorkspaceDiagnostic,
	UnarchiveWorkspaceDiagnostic,
} from '@/shared/ipc/contracts/workspace';

/** Props for the browse-archived-workspaces dialog. */
interface BrowseArchiveDialogProps {
	onChange: (repositoryId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	project: ProjectShellModel | null;
}

/**
 * Repository-scoped browser for archived workspaces. Lets users unarchive
 * (restore worktree + .context/) or permanently purge each entry. Backed by
 * `archivedWorkspacesQuery` so the list refreshes when archive lifecycle
 * mutations invalidate the cache.
 */
export function BrowseArchiveDialog({
	onChange,
	onOpenChange,
	open,
	project,
}: BrowseArchiveDialogProps) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='gap-4 sm:max-w-xl'>
				{project ? (
					<BrowseArchiveDialogBody
						key={`${project.id}:${open ? 'open' : 'closed'}`}
						onChange={onChange}
						project={project}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** Diagnostic surfaced against a single archived-workspace row from a delete or unarchive attempt. */
type RowDiagnostic =
	| DeleteArchivedWorkspaceDiagnostic
	| UnarchiveWorkspaceDiagnostic;

/** Inner body that lists a repository's archived workspaces with restore and purge actions. */
function BrowseArchiveDialogBody({
	onChange,
	project,
}: {
	onChange: (repositoryId: string) => Promise<void> | void;
	project: ProjectShellModel;
}) {
	const queryClient = useQueryClient();
	const apiAvailable = isEnsemblrApiAvailable();
	const { data, isLoading, isError } = useQuery({
		...archivedWorkspacesQuery(project.id),
		enabled: apiAvailable,
	});

	const entries = useMemo(() => data?.entries ?? [], [data]);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [pendingAction, setPendingAction] = useState<
		'unarchive' | 'delete' | null
	>(null);
	const [diagnostics, setDiagnostics] = useState<{
		workspaceId: string;
		entries: RowDiagnostic[];
	} | null>(null);

	const invalidate = useCallback(async () => {
		await Promise.all([
			invalidateWorkspaceListViews(queryClient),
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.archivedWorkspaces(project.id),
			}),
		]);
		await onChange(project.id);
	}, [onChange, project.id, queryClient]);

	const handleUnarchive = useCallback(
		async (entry: ArchivedWorkspaceListEntry) => {
			if (!apiAvailable) {
				return;
			}
			setPendingId(entry.id);
			setPendingAction('unarchive');
			setDiagnostics(null);

			const result = await unarchiveWorkspace({ workspaceId: entry.id });

			if (result.status === 'success') {
				await invalidate();
				setPendingId(null);
				setPendingAction(null);
				return;
			}

			setDiagnostics({ workspaceId: entry.id, entries: result.diagnostics });
			setPendingId(null);
			setPendingAction(null);
		},
		[apiAvailable, invalidate],
	);

	const handleDelete = useCallback(
		async (entry: ArchivedWorkspaceListEntry) => {
			if (!apiAvailable) {
				return;
			}
			setPendingId(entry.id);
			setPendingAction('delete');
			setDiagnostics(null);

			const result = await deleteArchivedWorkspace({ workspaceId: entry.id });

			if (result.status === 'success') {
				await invalidate();
				setPendingId(null);
				setPendingAction(null);
				return;
			}

			setDiagnostics({ workspaceId: entry.id, entries: result.diagnostics });
			setPendingId(null);
			setPendingAction(null);
		},
		[apiAvailable, invalidate],
	);

	return (
		<>
			<DialogHeader>
				<DialogTitle className='font-medium text-[0.9375rem]'>
					Workspace archive — {project.name}
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					Restore an archived workspace, or permanently purge it. Restoring
					rebuilds the worktree from the recorded base branch when branch
					cleanup ran at archive time.
				</p>
			</DialogHeader>

			<div className='-mx-4 max-h-[60vh] overflow-y-auto border-border border-t border-b'>
				{!apiAvailable ? (
					<EmptyState message='The preload bridge is unavailable in this context.' />
				) : isLoading ? (
					<EmptyState message='Loading archived workspaces…' />
				) : isError ? (
					<EmptyState message='Failed to load archived workspaces.' />
				) : entries.length === 0 ? (
					<EmptyState message='No archived workspaces for this repository.' />
				) : (
					<ul className='divide-y divide-border'>
						{entries.map((entry) => {
							const isBusy = pendingId === entry.id;
							const showDiagnostics =
								diagnostics?.workspaceId === entry.id &&
								diagnostics.entries.length > 0;
							return (
								<li
									className='flex flex-col gap-2 px-4 py-3'
									data-testid='browse-archive-row'
									key={entry.id}
								>
									<div className='flex flex-col gap-0.5'>
										<span className='font-medium text-[0.8125rem]'>
											{entry.name}
										</span>
										<span className='font-mono text-[0.6875rem] text-muted-foreground'>
											{entry.branchName ?? 'no branch'}
										</span>
										<span className='truncate font-mono text-[0.6875rem] text-muted-foreground'>
											{entry.path}
										</span>
										<span className='text-[0.6875rem] text-muted-foreground'>
											Archived {formatArchivedAt(entry.archivedAt)}
											{entry.branchCleanup
												? ' · worktree was destroyed (recreate from base branch on restore)'
												: ''}
										</span>
									</div>
									<div className='flex gap-2'>
										<Button
											className='h-8'
											disabled={isBusy || !canRestoreArchivedWorkspace(entry)}
											onClick={() => {
												void handleUnarchive(entry);
											}}
											size='sm'
											type='button'
											variant='default'
										>
											<ArchiveRestoreIcon aria-hidden='true' />
											{isBusy && pendingAction === 'unarchive'
												? 'Restoring…'
												: 'Unarchive'}
										</Button>
										<Button
											className='h-8'
											disabled={isBusy}
											onClick={() => {
												void handleDelete(entry);
											}}
											size='sm'
											type='button'
											variant='destructive'
										>
											<Trash2Icon aria-hidden='true' />
											{isBusy && pendingAction === 'delete'
												? 'Deleting…'
												: 'Delete permanently'}
										</Button>
									</div>
									{showDiagnostics ? (
										<ArchiveDiagnosticsList
											diagnostics={diagnostics?.entries ?? []}
											testId={`browse-archive-row-diagnostics-${entry.id}`}
										/>
									) : null}
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</>
	);
}

/** Renders a centered muted message when the archive list is empty. */
function EmptyState({ message }: { message: string }) {
	return (
		<div className='px-4 py-8 text-center text-muted-foreground text-xs'>
			{message}
		</div>
	);
}

/**
 * Format an archived-at ISO timestamp as a locale string, falling back to the raw value.
 * @param iso - ISO timestamp string
 * @returns The localized date-time, or the original string when parsing fails.
 */
function formatArchivedAt(iso: string): string {
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}
