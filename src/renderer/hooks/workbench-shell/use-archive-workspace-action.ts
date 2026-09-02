import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { type AnyRouter, useRouter } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	archiveWorkspace,
	invalidateWorkspaceListViews,
	reviewMergeSettingsQuery,
	unarchiveWorkspace,
	workspaceGitStatusQuery,
} from '@/renderer/api/ensemblr-queries';
import { useRemoveHoppedWorkspaceAction } from '@/renderer/hooks/workbench-shell/use-remove-workspace-action';
import { useWorkspaceTeardownHop } from '@/renderer/hooks/workbench-shell/use-workspace-teardown-hop';
import { getErrorMessage } from '@/renderer/lib/error';
import { failureText } from '@/renderer/lib/failure-text';
import {
	type ArchivedWorkspace,
	type ArchiveWorktreePlan,
	resolveArchiveWorktreePlan,
} from '@/renderer/lib/workbench/archive-worktree-plan';
import {
	claimLifecycleRun,
	releaseLifecycleRun,
} from '@/renderer/lib/workbench/lifecycle-run-latch';
import { workspaceLifecycleDialogAtom } from '@/renderer/state/dialogs';
import { useWorkspaceLifecycleRunActions } from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { ArchiveWorkspaceStatus } from '@/shared/ipc/contracts/workspace';

/** An archive that ran, reduced to the one status and sentence a toast needs. */
interface ArchiveOutcome {
	description: string | undefined;
	status: ArchiveWorkspaceStatus;
}

/**
 * Resolves what an immediate archive would do to the worktree, or null when the
 * archive has to go through the confirmation dialog instead.
 *
 * Archiving is reversible, so it needs no confirming — except when it would
 * destroy something. Two things escalate. A worktree carrying uncommitted work
 * the removal takes with it; and a plan that drops the local branch, which
 * force-deletes it along with any commit that never reached the remote, since
 * unarchiving cuts a fresh branch from base rather than restoring the history.
 *
 * A git status that errored, or a lookup that rejected outright, escalates too:
 * an unknown worktree confirms rather than assumes it is clean. Both queries
 * carry a stale window the sidebar's own poll keeps warm, so the common case
 * answers without a round trip.
 * @param queryClient - Cache the git status and the repository's git settings are read through
 * @param workspace - The workspace about to be archived
 * @returns The worktree plan, or null when the dialog has to decide
 */
async function resolveUnconfirmedArchivePlan(
	queryClient: QueryClient,
	workspace: WorkspaceShellModel,
): Promise<ArchiveWorktreePlan | null> {
	try {
		const [status, settings] = await Promise.all([
			queryClient.fetchQuery(workspaceGitStatusQuery(workspace.pathLabel)),
			queryClient.fetchQuery(
				reviewMergeSettingsQuery({
					repositoryId: workspace.projectId,
					repositoryPath: workspace.pathLabel,
				}),
			),
		]);

		if (status.error || status.summary.files > 0) {
			return null;
		}

		const plan = resolveArchiveWorktreePlan({
			hasBranch: Boolean(workspace.branchName),
			settings,
		});
		return plan.branchCleanup ? null : plan;
	} catch (error) {
		console.error('Could not resolve the archive plan for a workspace:', error);
		return null;
	}
}

/**
 * Runs the archive IPC, folding a rejection into the same reported shape as a
 * failure it answered with so the caller has one outcome to render.
 * @param plan - What the archive should do to the worktree
 * @param workspaceId - The workspace to archive
 * @param t - Translator used to word the reported diagnostic
 * @returns The archive status plus the sentence describing it, when there is one
 */
async function runArchive(
	plan: ArchiveWorktreePlan,
	workspaceId: string,
	t: TFunction,
): Promise<ArchiveOutcome> {
	try {
		const result = await archiveWorkspace({ ...plan, workspaceId });
		return {
			description: failureText(t, result.diagnostics[0]) ?? undefined,
			status: result.status,
		};
	} catch (error) {
		return {
			description: getErrorMessage(error) ?? undefined,
			status: 'failure',
		};
	}
}

/**
 * Reports an archive that did not remove the workspace. A lifecycle hook that
 * vetoed the run is a decision rather than a fault, so it warns where a genuine
 * failure errors.
 * @param outcome - The archive that ran, and what it reported
 * @param t - Translator used to word the headline
 */
function reportUnarchivedOutcome(outcome: ArchiveOutcome, t: TFunction): void {
	if (outcome.status === 'aborted') {
		toast.warning(
			t(
				'errors:workspace-archive.skipped.title',
				'The workspace was not archived.',
			),
			{ description: outcome.description },
		);
		return;
	}

	toast.error(
		t(
			'errors:workspace-archive.failed.title',
			'Archiving the workspace failed.',
		),
		{ description: outcome.description },
	);
}

/**
 * Restores a workspace the user has just archived, behind the success toast's
 * Undo. Reports rather than throws: the toast is gone by the time this runs, so
 * a swallowed failure would leave the workspace archived with nothing said.
 * @param options - The cache and router to refresh, the translator, and the workspace to restore
 */
async function undoWorkspaceArchive({
	queryClient,
	router,
	t,
	workspaceId,
}: {
	queryClient: QueryClient;
	router: AnyRouter;
	t: TFunction;
	workspaceId: string;
}): Promise<void> {
	const reportFailure = (description: string | undefined): void => {
		toast.error(
			t(
				'errors:workspace-unarchive.failed.title',
				'Restoring the workspace failed.',
			),
			{ description },
		);
	};

	try {
		const result = await unarchiveWorkspace({ workspaceId });
		if (result.status !== 'success') {
			reportFailure(failureText(t, result.diagnostics[0]) ?? undefined);
			return;
		}
	} catch (error) {
		reportFailure(getErrorMessage(error) ?? undefined);
		return;
	}

	await invalidateWorkspaceListViews(queryClient);
	await router.invalidate();
}

/**
 * Returns the announcement for a completed archive: a success toast carrying the
 * Undo that stands in for the confirmation the archive no longer asks for.
 *
 * An archive that dropped the local branch gets no Undo. Unarchiving that one
 * cuts a fresh branch from the recorded base, so the workspace comes back
 * without the commits it had — the toast says so rather than offering to
 * reverse something it cannot.
 * @returns A callback taking the archive that completed
 */
export function useArchivedWorkspaceToast(): (
	archived: ArchivedWorkspace,
) => void {
	const queryClient = useQueryClient();
	const router = useRouter();
	const { t } = useTranslation();

	return useCallback(
		({ branchCleanup, workspaceId }: ArchivedWorkspace) => {
			const title = t(
				'errors:workspace-archive.archived.title',
				'Workspace archived.',
			);

			if (branchCleanup) {
				toast.success(title, {
					description: t(
						'errors:workspace-archive.archived.branch-dropped',
						'Its local branch was deleted, so restoring the workspace will not bring back commits you never pushed.',
					),
				});
				return;
			}

			toast.success(title, {
				action: {
					label: t('common:actions.undo', 'Undo'),
					onClick: () => {
						void undoWorkspaceArchive({
							queryClient,
							router,
							t,
							workspaceId,
						});
					},
				},
			});
		},
		[queryClient, router, t],
	);
}

/**
 * Returns the archive action every workspace menu fires — the Workspace menu,
 * the sidebar row, and the dashboard card all share this one.
 *
 * Archiving preserves `.context/` and is reversible from History and the Browse
 * archive dialog, so it runs immediately and reports with a toast rather than
 * asking first. It defers to the archive dialog behind
 * {@link workspaceLifecycleDialogAtom} for the archives that are not reversible
 * — see {@link resolveUnconfirmedArchivePlan} for which those are.
 *
 * The run is marked in `archivingWorkspaceIdsAtom` for as long as it lasts, which
 * is what puts the sidebar row and the board card into their archiving state and
 * takes the action out of reach while it runs. That mark deliberately outlives
 * the `lifecycle-run-latch` claim, which is released the moment the IPC answers:
 * the row has to keep saying so until it has actually left the list.
 *
 * Leaving the workspace before its teardown, and returning to it when the
 * archive did not happen, belongs to {@link useWorkspaceTeardownHop} — which the
 * confirmation dialog wraps its own run in too, so both paths move the shell the
 * same way.
 * @param options - Active workspace identity, used to leave the workspace before it is torn down and to pick the post-removal route fallback
 * @returns A callback that archives the workspace it is given
 */
export function useArchiveWorkspaceAction({
	activeWorkspaceId,
}: {
	activeWorkspaceId: string | null;
}): (workspace: WorkspaceShellModel) => Promise<void> {
	const queryClient = useQueryClient();
	const { t } = useTranslation();
	const requestLifecycleDialog = useSetAtom(workspaceLifecycleDialogAtom);
	const removeWorkspace = useRemoveHoppedWorkspaceAction({ activeWorkspaceId });
	const announceArchived = useArchivedWorkspaceToast();
	const archiveAwayFromWorkspace = useWorkspaceTeardownHop({
		activeWorkspaceId,
	});
	const { clearLifecycleRun, markLifecycleRun } =
		useWorkspaceLifecycleRunActions();

	return useCallback(
		async (workspace: WorkspaceShellModel) => {
			const operationKey = `archive-workspace:${workspace.id}`;
			if (!claimLifecycleRun(operationKey)) {
				// Keyed by the operation so a burst of clicks reports once rather than
				// stacking a toast per click.
				toast.warning(
					t(
						'errors:workspace-archive.in-flight.title',
						'This workspace is already being archived.',
					),
					{ id: operationKey },
				);
				return;
			}

			markLifecycleRun(workspace.id, 'archiving');

			try {
				let outcome: ArchiveOutcome;
				let plan: ArchiveWorktreePlan;
				try {
					const resolved = await resolveUnconfirmedArchivePlan(
						queryClient,
						workspace,
					);
					if (!resolved) {
						requestLifecycleDialog({ kind: 'archive', workspace });
						return;
					}

					plan = resolved;
					outcome = await archiveAwayFromWorkspace(workspace.id, () =>
						runArchive(resolved, workspace.id, t),
					);
				} finally {
					releaseLifecycleRun(operationKey);
				}

				if (outcome.status === 'success') {
					await removeWorkspace.archived(workspace.id);
					announceArchived({
						branchCleanup: plan.branchCleanup,
						workspaceId: workspace.id,
					});
					return;
				}

				reportUnarchivedOutcome(outcome, t);
				await invalidateWorkspaceListViews(queryClient);
			} finally {
				clearLifecycleRun(workspace.id);
			}
		},
		[
			announceArchived,
			archiveAwayFromWorkspace,
			clearLifecycleRun,
			markLifecycleRun,
			queryClient,
			removeWorkspace.archived,
			requestLifecycleDialog,
			t,
		],
	);
}
