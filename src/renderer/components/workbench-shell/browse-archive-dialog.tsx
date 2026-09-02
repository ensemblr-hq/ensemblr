import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
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
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import {
	type ArchiveRowAction,
	type ArchiveRowDiagnostic,
	BrowseArchiveRow,
} from '@/renderer/components/workbench-shell/browse-archive-row';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { ArchivedWorkspaceListEntry } from '@/shared/ipc/contracts/workspace';

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

/** Which row is running which action, plus the diagnostics one of them produced. */
interface RowActivity {
	action: ArchiveRowAction;
	workspaceId: string;
}

/**
 * Picks the message that stands in for the archive list, in the order the
 * states become knowable: no preload bridge, still loading, load failure, then
 * a repository with nothing archived.
 * @param options - Query state plus how many entries came back
 * @returns The message to show instead of the list, or null once there are rows
 */
function resolveArchiveEmptyMessage({
	apiAvailable,
	entryCount,
	isError,
	isLoading,
	t,
}: {
	apiAvailable: boolean;
	entryCount: number;
	isError: boolean;
	isLoading: boolean;
	t: TFunction;
}): string | null {
	if (!apiAvailable) {
		return t(
			'workbench:browse-archive.empty.unavailable',
			'The preload bridge is unavailable in this context.',
		);
	}
	if (isLoading) {
		return t(
			'workbench:browse-archive.empty.loading',
			'Loading archived workspaces…',
		);
	}
	if (isError) {
		return t(
			'workbench:browse-archive.empty.failed',
			'Failed to load archived workspaces.',
		);
	}
	if (entryCount === 0) {
		return t(
			'workbench:browse-archive.empty.none',
			'No archived workspaces for this repository.',
		);
	}
	return null;
}

/** Inner body that lists a repository's archived workspaces with its row actions. */
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
	const [activity, setActivity] = useState<RowActivity | null>(null);
	const [rowDiagnostics, setRowDiagnostics] = useState<{
		workspaceId: string;
		entries: ArchiveRowDiagnostic[];
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

	// One busy flag for the whole dialog, not one per button. Every action here
	// runs git against the same repository, and two `git worktree remove` runs
	// contend on the worktree admin lock and fail rather than wait — so one row's
	// action has to lock every other row, not just its own.
	const isBusy = activity !== null;

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
			}) => Promise<{ diagnostics: ArchiveRowDiagnostic[]; status: string }>;
		}) => {
			if (!apiAvailable || isBusy) {
				return;
			}
			setActivity({ action, workspaceId: entry.id });
			setRowDiagnostics(null);

			try {
				const result = await request({ workspaceId: entry.id });

				if (result.status === 'success') {
					await invalidate();
				} else {
					setRowDiagnostics({
						entries: result.diagnostics,
						workspaceId: entry.id,
					});
				}
			} catch (cause) {
				// The code carries the wording, translated; `message` is only the
				// runtime specifics the shared list appends when there are any, so a
				// throw with nothing to add leaves it empty rather than English.
				setRowDiagnostics({
					entries: [
						{
							code: 'workspace-update-failed',
							message: cause instanceof Error ? cause.message : '',
							severity: 'error',
						},
					],
					workspaceId: entry.id,
				});
			} finally {
				setActivity(null);
			}
		},
		[apiAvailable, invalidate, isBusy],
	);

	const handleUnarchive = useCallback(
		(entry: ArchivedWorkspaceListEntry) => {
			void runRowAction({
				action: 'unarchive',
				entry,
				request: unarchiveWorkspace,
			});
		},
		[runRowAction],
	);

	const handleDelete = useCallback(
		(entry: ArchivedWorkspaceListEntry) => {
			void runRowAction({
				action: 'delete',
				entry,
				request: deleteArchivedWorkspace,
			});
		},
		[runRowAction],
	);

	const emptyMessage = resolveArchiveEmptyMessage({
		apiAvailable,
		entryCount: entries.length,
		isError,
		isLoading,
		t,
	});

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
						'Restore an archived workspace, or permanently purge it. Archiving kept its branch and a snapshot of any uncommitted changes, so restoring rebuilds the workspace from git.',
					)}
				</p>
			</DialogHeader>

			<div className='-mx-4 max-h-[60vh] overflow-y-auto border-border border-t border-b'>
				{emptyMessage ? (
					<EmptyState message={emptyMessage} />
				) : (
					<ul className='divide-y divide-border'>
						{entries.map((entry) => (
							<BrowseArchiveRow
								diagnostics={
									rowDiagnostics?.workspaceId === entry.id
										? rowDiagnostics.entries
										: []
								}
								disabled={isBusy}
								entry={entry}
								key={entry.id}
								onDelete={handleDelete}
								onUnarchive={handleUnarchive}
								pendingAction={
									activity?.workspaceId === entry.id ? activity.action : null
								}
							/>
						))}
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
