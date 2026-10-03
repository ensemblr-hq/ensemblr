import { useAtomValue } from 'jotai';
import { useCallback } from 'react';

import { cancelComputeJob } from '@/renderer/api/ensemblr';
import { SidebarFooter } from '@/renderer/components/ui/sidebar';
import { useConciergeFilePreview } from '@/renderer/hooks/concierge/use-concierge-file-preview';
import { computeQueueSnapshotAtom } from '@/renderer/state/compute-queue';
import type { ComputeJobSnapshot } from '@/shared/compute-queue';

import { ComputeQueuePanel } from './compute-queue-panel';

/**
 * The compute queue panel wired to the running app: main's snapshot, the
 * cancel IPC, and the shared cross-workspace file opener for a job's log.
 *
 * The footer chrome lives here rather than in the panel so an idle queue shows
 * no bordered strip where the panel would have been. The live region wraps the
 * slot and stays mounted, so a job arriving is announced as a change to
 * something assistive tech was already watching.
 */
export function SidebarComputeQueuePanel() {
	const snapshot = useAtomValue(computeQueueSnapshotAtom);
	const { openFilePreview } = useConciergeFilePreview(null);

	const onCancel = useCallback((jobId: string) => {
		void cancelComputeJob(jobId).catch(() => undefined);
	}, []);
	const onOpenLog = useCallback(
		(job: ComputeJobSnapshot) => {
			if (job.logPath) {
				openFilePreview?.(job.logPath);
			}
		},
		[openFilePreview],
	);
	const hasLiveJobs =
		snapshot?.jobs.some(
			(job) => job.state === 'queued' || job.state === 'running',
		) ?? false;

	return (
		<div aria-live='polite'>
			{snapshot && hasLiveJobs ? (
				<SidebarFooter className='border-sidebar-border border-t p-2'>
					<ComputeQueuePanel
						onCancel={onCancel}
						onOpenLog={onOpenLog}
						snapshot={snapshot}
					/>
				</SidebarFooter>
			) : null}
		</div>
	);
}
