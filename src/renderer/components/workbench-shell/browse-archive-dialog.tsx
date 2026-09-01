import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDriveDownloadIcon } from 'lucide-react';
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
import {
	type ArchiveRowAction,
	type ArchiveRowDiagnostic,
	BrowseArchiveRow,
} from '@/renderer/components/workbench-shell/browse-archive-row';
import { useArchiveReclaim } from '@/renderer/hooks/workbench-shell/use-archive-reclaim';
import { formatBytes } from '@/renderer/lib/workbench';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { ArchivedWorkspaceListEntry } from '@/shared/ipc/contracts/workspace';

/**
 * Repository-scoped browser for archived workspaces. Lets users unarchive
 * (restore worktree + .context/), reclaim the disk a still-materialized
 * worktree occupies, or permanently purge each entry. Backed by
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

/** Inner body that lists a repository's archived workspaces with its row actions. */
function BrowseArchiveDialogBody({
	onChange,
	project,
}: {
	onChange: (repositoryId: string) => Promise<void> | void;
	project: ProjectShellModel;
}) {
	const { i18n, t } = useTranslation();
	const queryClient = useQueryClient();
	const apiAvailable = isEnsemblrApiAvailable();
	const { data, isLoading, isError } = useQuery({
		...archivedWorkspacesQuery(project.id),
		enabled: apiAvailable,
	});

	const entries = useMemo(() => data?.entries ?? [], [data]);
	const reclaimable = useMemo(
		() => entries.filter((entry) => entry.pathExists),
		[entries],
	);
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

	const reclaim = useArchiveReclaim(invalidate);

	// One busy flag for the whole dialog, not one per button. Every action here
	// runs git against the same repository, and two `git worktree remove` runs
	// contend on the worktree admin lock and fail rather than wait — so a reclaim
	// in flight has to lock the bulk button and every other row, not just its own.
	const isBusy =
		activity !== null ||
		reclaim.reclaimingId !== null ||
		reclaim.isReclaimingAll;

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
			reclaim.clearReport();

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
		[apiAvailable, invalidate, isBusy, reclaim.clearReport],
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

	const handleReclaimOne = useCallback(
		(entry: ArchivedWorkspaceListEntry) => {
			if (isBusy) {
				return;
			}
			setRowDiagnostics(null);
			reclaim.reclaimOne(entry);
		},
		[isBusy, reclaim.reclaimOne],
	);

	const handleReclaimAll = useCallback(() => {
		if (isBusy) {
			return;
		}
		setRowDiagnostics(null);
		reclaim.reclaimAll(reclaimable);
	}, [isBusy, reclaim.reclaimAll, reclaimable]);

	const diagnostics = rowDiagnostics ?? reclaim.diagnostics;
	const freed = formatBytes(reclaim.reclaimedBytes, i18n.language);

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
						'Restore an archived workspace, reclaim the disk its worktree still occupies, or permanently purge it. Reclaiming keeps the branch and any uncommitted changes, so the workspace is rebuilt from git when you unarchive it.',
					)}
				</p>
			</DialogHeader>

			{reclaimable.length > 0 ? (
				<div className='flex items-center justify-between gap-3'>
					<p className='text-muted-foreground text-xs'>
						{t(
							'workbench:browse-archive.reclaimable',
							'{{count}} archived workspace still has its worktree on disk.',
							{ count: reclaimable.length },
						)}
					</p>
					<Button
						className='h-8 shrink-0'
						data-testid='browse-archive-reclaim-all'
						disabled={isBusy}
						onClick={handleReclaimAll}
						pending={reclaim.isReclaimingAll}
						size='sm'
						type='button'
						variant='outline'
					>
						<HardDriveDownloadIcon
							aria-hidden='true'
							data-icon='inline-start'
						/>
						{t('workbench:browse-archive.reclaim-all', 'Reclaim all')}
					</Button>
				</div>
			) : null}

			{freed ? (
				<p
					className='text-muted-foreground text-xs'
					data-testid='browse-archive-reclaimed'
				>
					{t('workbench:browse-archive.reclaimed', 'Reclaimed {{size}}.', {
						size: freed,
					})}
				</p>
			) : null}

			{diagnostics && diagnostics.workspaceId === null ? (
				<ArchiveDiagnosticsList
					diagnostics={diagnostics.entries}
					testId='browse-archive-diagnostics'
				/>
			) : null}

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
						{entries.map((entry) => (
							<BrowseArchiveRow
								diagnostics={
									diagnostics?.workspaceId === entry.id
										? diagnostics.entries
										: []
								}
								disabled={isBusy}
								entry={entry}
								key={entry.id}
								onDelete={handleDelete}
								onReclaim={handleReclaimOne}
								onUnarchive={handleUnarchive}
								pendingAction={rowPendingAction({
									activity,
									entry,
									isReclaimingAll: reclaim.isReclaimingAll,
									reclaimingId: reclaim.reclaimingId,
								})}
							/>
						))}
					</ul>
				)}
			</div>
		</>
	);
}

/**
 * The action a row should show as running: its own, or the bulk reclaim, which
 * every still-materialized row is part of at once. This drives the spinner
 * only — whether a row's buttons are usable is the dialog-wide `isBusy`, since
 * an action on one row locks every other.
 * @param options - Current row activity, the row, and the reclaim hook's state.
 * @returns The pending action, or null when the row is idle.
 */
function rowPendingAction({
	activity,
	entry,
	isReclaimingAll,
	reclaimingId,
}: {
	activity: RowActivity | null;
	entry: ArchivedWorkspaceListEntry;
	isReclaimingAll: boolean;
	reclaimingId: string | null;
}): ArchiveRowAction | null {
	if (activity?.workspaceId === entry.id) {
		return activity.action;
	}
	if (reclaimingId === entry.id) {
		return 'reclaim';
	}
	return isReclaimingAll && entry.pathExists ? 'reclaim' : null;
}

/** Renders a centered muted message when the archive list is empty. */
function EmptyState({ message }: { message: string }) {
	return (
		<div className='px-4 py-8 text-center text-muted-foreground text-xs'>
			{message}
		</div>
	);
}
