import { useQuery } from '@tanstack/react-query';
import { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	deleteRepository,
	isEnsemblrApiAvailable,
	rootDirectoryQuery,
} from '@/renderer/api/ensemblr-queries';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Label } from '@/renderer/components/ui/label';
import { LifecycleDialogActions } from '@/renderer/components/workbench-shell/lifecycle-dialog-actions';
import { LifecycleSummary } from '@/renderer/components/workbench-shell/lifecycle-summary';
import { useLifecycleDialogAction } from '@/renderer/hooks/workbench-shell/use-lifecycle-dialog-action';
import { failureText } from '@/renderer/lib/failure-text';
import { projectSummaryRows } from '@/renderer/lib/workbench/lifecycle-summary-rows';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type {
	DeleteRepositoryDiagnostic,
	DeleteRepositoryResult,
} from '@/shared/ipc/contracts/repository';
import {
	classifyManagedChild,
	MANAGED_CHILD_DEPTH,
} from '@/shared/managed-path';

/**
 * Destructive confirmation dialog for a repository. Wipes every workspace, the
 * repository row, and the repository's leftover workspace folder. The
 * repository folder itself is kept and tagged with the `.ensemblr-archived`
 * sentinel unless the user opts into removing it. Use the archive dialog for
 * the reversible lifecycle path.
 */
export function DeleteRepositoryDialog({
	onDeleted,
	onOpenChange,
	open,
	project,
}: {
	onDeleted: (projectId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	project: ProjectShellModel | null;
}) {
	return (
		// Never open without a project: callers that hold `open` and `project` in
		// separate state drop the project the moment it is deleted, and an open
		// dialog with nothing to render is an empty shell whose overlay still eats
		// every click, leaving the app unusable with no way to dismiss it.
		<Dialog onOpenChange={onOpenChange} open={open && project !== null}>
			<DialogContent className='sm:max-w-md'>
				{project ? (
					<DeleteRepositoryDialogForm
						key={`${project.id}:${open ? 'open' : 'closed'}`}
						onDeleted={onDeleted}
						onOpenChange={onOpenChange}
						project={project}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/**
 * Reports whether a repository folder lives inside the managed `repos/` root,
 * which is the only case where offering to delete it is safe — a repository
 * registered in place points at a checkout Ensemblr never created.
 *
 * Shares the depth rule with the main process rather than restating it, so the
 * two cannot drift. The renderer cannot resolve symlinks, so this only decides
 * whether to *offer* the choice; main canonicalizes both sides and refuses a
 * folder that resolves out of the root, which the toast below reports.
 * @param options - The repository's folder and the managed repositories root
 * @returns True when the folder sits directly inside the managed root
 */
function isInsideManagedRepositories({
	repositoriesPath,
	repositoryPath,
}: {
	repositoriesPath: string | undefined;
	repositoryPath: string;
}): boolean {
	if (!repositoriesPath || !repositoryPath) {
		return false;
	}

	return (
		classifyManagedChild({
			candidatePath: repositoryPath,
			expectedDepth: MANAGED_CHILD_DEPTH,
			root: repositoriesPath,
		}) === 'ok'
	);
}

/**
 * Wraps an unexpected delete-repository rejection as the diagnostic the dialog
 * already renders — a denied permission gate throws rather than reporting.
 * @param message - The thrown error's message
 * @returns A diagnostic carrying it
 */
function deleteRepositoryFailure(message: string): DeleteRepositoryDiagnostic {
	return { code: 'repository-delete-failed', message, severity: 'error' };
}

/**
 * The diagnostic explaining why a repository folder the user asked to delete is
 * still on disk, or null when there is nothing to report.
 *
 * Main reports these as warnings on a *successful* delete, and the dialog's
 * diagnostics list only renders a failure before closing, so without this the
 * refusal would never reach anyone: the folder survives an unreadable
 * permission or a path that resolves out of the managed root, and the dialog
 * closes clean.
 * @param result - What the delete IPC answered with
 * @returns The folder diagnostic to announce, or null
 */
function survivingFolderDiagnostic(
	result: DeleteRepositoryResult,
): DeleteRepositoryDiagnostic | null {
	if (result.repository?.folderDeleted !== false) {
		return null;
	}

	return (
		result.diagnostics.find(
			(diagnostic) =>
				diagnostic.code === 'repository-folder-delete-failed' ||
				diagnostic.code === 'repository-folder-external',
		) ?? null
	);
}

/** Inner delete form for a repository; owns the deleting state and failure diagnostics. */
function DeleteRepositoryDialogForm({
	onDeleted,
	onOpenChange,
	project,
}: {
	onDeleted: (projectId: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	project: ProjectShellModel;
}) {
	const { t } = useTranslation();
	const deleteFolderId = useId();
	const warningId = useId();
	const [deleteFolder, setDeleteFolder] = useState(false);
	const { data: rootDirectory } = useQuery({
		...rootDirectoryQuery,
		enabled: isEnsemblrApiAvailable(),
	});

	// `start` is recreated every render and nothing down the click path is
	// memoized, so the run closure always reads the current checkbox. A
	// `useCallback` or `memo` added here would make the flag go stale.
	const { diagnostics, isBusy, start } = useLifecycleDialogAction({
		failure: deleteRepositoryFailure,
		onOpenChange,
		onSucceeded: (result: DeleteRepositoryResult) => {
			const surviving = survivingFolderDiagnostic(result);
			if (surviving) {
				toast.warning(failureText(t, surviving), {
					description: surviving.path,
				});
			}
			return onDeleted(project.id);
		},
		operationKey: `delete-repository:${project.id}`,
		run: () => deleteRepository({ deleteFolder, repositoryId: project.id }),
	});

	const canDelete = !isBusy && isEnsemblrApiAvailable();
	const workspaceCount = project.workspaces.length;
	const canDeleteFolder = isInsideManagedRepositories({
		repositoriesPath: rootDirectory?.repositoriesPath,
		repositoryPath: project.pathLabel,
	});

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t('workbench:delete-repository.title', 'Delete repository?')}
				</DialogTitle>
				<DialogDescription className='text-xs'>
					{t(
						'workbench:delete-repository.description',
						"Permanently removes the repository and {{workspaces}} from Ensemblr. Each workspace's worktree folder is deleted and its local branch is dropped. This cannot be undone.",
						{
							workspaces: t('common:units.workspace-count', {
								count: workspaceCount,
								defaultValue_one: '{{count}} workspace',
								defaultValue_other: '{{count}} workspaces',
							}),
						},
					)}
				</DialogDescription>
			</DialogHeader>

			<LifecycleSummary rows={projectSummaryRows(project)} />

			{canDeleteFolder ? (
				<div className='flex flex-col gap-2'>
					<Label
						className='cursor-pointer items-start gap-2 font-normal text-xs leading-normal'
						htmlFor={deleteFolderId}
					>
						<Checkbox
							aria-describedby={deleteFolder ? warningId : undefined}
							checked={deleteFolder}
							className='mt-px'
							id={deleteFolderId}
							onCheckedChange={(checked) => setDeleteFolder(checked === true)}
						/>
						{t(
							'workbench:delete-repository.delete-folder',
							'Also delete the repository folder from disk',
						)}
					</Label>
					{deleteFolder ? (
						<p
							className='text-destructive text-xs leading-normal'
							id={warningId}
						>
							{t(
								'workbench:delete-repository.delete-folder-warning',
								'The folder and everything in it is removed, including uncommitted work and any branch that was never pushed.',
							)}
						</p>
					) : null}
				</div>
			) : null}

			<LifecycleDialogActions
				actionLabel={t('common:actions.delete', 'Delete')}
				actionVariant='destructive'
				canAct={canDelete}
				diagnostics={diagnostics}
				diagnosticsTestId='delete-repository-diagnostics'
				isBusy={isBusy}
				onAct={start}
				onClose={handleClose}
			/>
		</>
	);
}
