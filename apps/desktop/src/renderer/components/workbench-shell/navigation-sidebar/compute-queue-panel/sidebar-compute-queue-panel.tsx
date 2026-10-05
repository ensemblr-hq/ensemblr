import { useAtom, useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { cancelComputeJob, startComputeJob } from '@/renderer/api/ensemblr';
import { SidebarFooter } from '@/renderer/components/ui/sidebar';
import { useWorkbenchLayoutRouteModelOptional } from '@/renderer/components/workbench-shell/shell-contexts';
import { useConciergeFilePreview } from '@/renderer/hooks/concierge/use-concierge-file-preview';
import { toastUnlessApplied } from '@/renderer/lib/compute-queue-actions';
import { findWorkspaceSelectionById } from '@/renderer/lib/workbench';
import {
	computeQueuePanelCollapsedAtom,
	computeQueueSnapshotAtom,
} from '@/renderer/state/compute-queue';
import type { ComputeJobSnapshot } from '@/shared/compute-queue';

import { ComputeQueuePanel } from './compute-queue-panel';

/**
 * The compute queue panel wired to the running app: main's snapshot, the
 * cancel and start-now IPC, the shared cross-workspace file opener for a job's
 * log, the workspace route a row's workspace name opens, and the remembered
 * collapsed state.
 *
 * The footer chrome lives here rather than in the panel so an idle queue shows
 * no bordered strip where the panel would have been. A visually hidden live
 * node stays mounted and announces only the running/queued summary, so a job
 * arriving is a change to something assistive tech was already watching while
 * the per-second timers stay silent. A cancel or start that fails, or finds
 * the job already past the state it acts on, is reported as a toast.
 */
export function SidebarComputeQueuePanel() {
	const { t } = useTranslation();
	const snapshot = useAtomValue(computeQueueSnapshotAtom);
	const [collapsed, setCollapsed] = useAtom(computeQueuePanelCollapsedAtom);
	const { openFilePreview } = useConciergeFilePreview(null);
	const layoutModel = useWorkbenchLayoutRouteModelOptional();

	const onCancel = useCallback(
		(jobId: string) =>
			toastUnlessApplied(
				cancelComputeJob(jobId).then((result) => result.cancelled),
				t(
					'workbench:navigation-sidebar.compute-queue.cancel-failed',
					'Could not cancel the job. It may have already finished.',
				),
			),
		[t],
	);
	const onStartNow = useCallback(
		(jobId: string) =>
			toastUnlessApplied(
				startComputeJob(jobId).then((result) => result.started),
				t(
					'workbench:navigation-sidebar.compute-queue.start-now-failed',
					'Could not start the job. It may have already started or finished.',
				),
			),
		[t],
	);
	const onOpenLog = useCallback(
		(job: ComputeJobSnapshot) => {
			if (job.logPath) {
				openFilePreview?.(job.logPath);
			}
		},
		[openFilePreview],
	);
	const workspaceOpener = useCallback(
		(job: ComputeJobSnapshot) => {
			const selection = layoutModel
				? findWorkspaceSelectionById(
						layoutModel.displayProjects,
						job.workspaceId,
					)
				: null;
			if (!layoutModel || !selection) {
				return null;
			}
			return () =>
				layoutModel.navigateToWorkspace(
					selection.project.id,
					selection.workspace.id,
				);
		},
		[layoutModel],
	);
	const runningCount =
		snapshot?.jobs.filter((job) => job.state === 'running').length ?? 0;
	const queuedCount =
		snapshot?.jobs.filter((job) => job.state === 'queued').length ?? 0;
	const hasLiveJobs = runningCount + queuedCount > 0;

	return (
		<>
			<div
				aria-live='polite'
				className='sr-only'
				data-compute-queue-announcement=''
			>
				{hasLiveJobs
					? t(
							'workbench:navigation-sidebar.compute-queue.summary',
							'{{running}} running · {{queued}} queued',
							{ queued: queuedCount, running: runningCount },
						)
					: ''}
			</div>
			{snapshot && hasLiveJobs ? (
				<SidebarFooter className='border-sidebar-border border-t px-2 py-1.5'>
					<ComputeQueuePanel
						collapsed={collapsed}
						onCancel={onCancel}
						onCollapsedChange={setCollapsed}
						onOpenLog={onOpenLog}
						onStartNow={onStartNow}
						snapshot={snapshot}
						workspaceOpener={workspaceOpener}
					/>
				</SidebarFooter>
			) : null}
		</>
	);
}
