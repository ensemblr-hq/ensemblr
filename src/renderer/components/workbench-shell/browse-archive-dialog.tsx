import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveIcon, ArchiveRestoreIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
}: {
	onChange: (repositoryId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	project: ProjectShellModel | null;
}) {
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
	const { t } = useTranslation();
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

	const runRowAction = useCallback(
		async ({
			action,
			entry,
			request,
		}: {
			action: 'delete' | 'unarchive';
			entry: ArchivedWorkspaceListEntry;
			request: (payload: {
				workspaceId: string;
			}) => Promise<{ diagnostics: RowDiagnostic[]; status: string }>;
		}) => {
			if (!apiAvailable) {
				return;
			}
			setPendingId(entry.id);
			setPendingAction(action);
			setDiagnostics(null);

			const result = await request({ workspaceId: entry.id });

			if (result.status === 'success') {
				await invalidate();
			} else {
				setDiagnostics({ entries: result.diagnostics, workspaceId: entry.id });
			}
			setPendingId(null);
			setPendingAction(null);
		},
		[apiAvailable, invalidate],
	);

	const handleUnarchive = useCallback(
		(entry: ArchivedWorkspaceListEntry) =>
			runRowAction({ action: 'unarchive', entry, request: unarchiveWorkspace }),
		[runRowAction],
	);

	const handleDelete = useCallback(
		(entry: ArchivedWorkspaceListEntry) =>
			runRowAction({
				action: 'delete',
				entry,
				request: deleteArchivedWorkspace,
			}),
		[runRowAction],
	);

	return (
		<>
			<DialogHeader>
				<DialogTitle className='font-medium text-[0.9375rem]'>
					{t(
						'workbench:browse-archive.title',
						'Workspace archive — {{repository}}',
						{ repository: project.name },
					)}
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					{t(
						'workbench:browse-archive.description',
						'Restore an archived workspace, or permanently purge it. Restoring rebuilds the worktree from the recorded base branch when branch cleanup ran at archive time.',
					)}
				</p>
			</DialogHeader>

			<div className='-mx-4 max-h-[60vh] overflow-y-auto border-border border-t border-b'>
				{!apiAvailable ? (
					<EmptyState
						message={t(
							'workbench:browse-archive.empty.unavailable',
							'The preload bridge is unavailable in this context.',
						)}
					/>
				) : isLoading ? (
					<EmptyState
						message={t(
							'workbench:browse-archive.empty.loading',
							'Loading archived workspaces…',
						)}
					/>
				) : isError ? (
					<EmptyState
						message={t(
							'workbench:browse-archive.empty.failed',
							'Failed to load archived workspaces.',
						)}
					/>
				) : entries.length === 0 ? (
					<EmptyState
						message={t(
							'workbench:browse-archive.empty.none',
							'No archived workspaces for this repository.',
						)}
					/>
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
										<span className='flex items-center gap-1.5 font-medium text-[0.8125rem]'>
											<ArchiveIcon
												aria-hidden='true'
												className='size-3.5 text-muted-foreground'
											/>
											{entry.name}
										</span>
										<span className='font-mono text-[0.6875rem] text-muted-foreground'>
											{entry.branchName ??
												t(
													'workbench:browse-archive.row.no-branch',
													'no branch',
												)}
										</span>
										<span className='truncate font-mono text-[0.6875rem] text-muted-foreground'>
											{entry.path}
										</span>
										<span className='text-[0.6875rem] text-muted-foreground'>
											{entry.branchCleanup
												? t(
														'workbench:browse-archive.row.archived-destroyed',
														'Archived {{date}} · worktree was destroyed (recreate from base branch on restore)',
														{ date: formatArchivedAt(entry.archivedAt) },
													)
												: t(
														'workbench:browse-archive.row.archived',
														'Archived {{date}}',
														{ date: formatArchivedAt(entry.archivedAt) },
													)}
										</span>
									</div>
									<div className='flex gap-2'>
										<Button
											className='h-8'
											disabled={isBusy || !canRestoreArchivedWorkspace(entry)}
											onClick={() => {
												void handleUnarchive(entry);
											}}
											pending={isBusy && pendingAction === 'unarchive'}
											size='sm'
											type='button'
											variant='default'
										>
											<ArchiveRestoreIcon
												aria-hidden='true'
												data-icon='inline-start'
											/>
											{t('common:actions.unarchive', 'Unarchive')}
										</Button>
										<Button
											className='h-8'
											disabled={isBusy}
											onClick={() => {
												void handleDelete(entry);
											}}
											pending={isBusy && pendingAction === 'delete'}
											size='sm'
											type='button'
											variant='destructive'
										>
											<Trash2Icon aria-hidden='true' data-icon='inline-start' />
											{t(
												'workbench:browse-archive.row.delete-permanently',
												'Delete permanently',
											)}
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
