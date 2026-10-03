import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

import type { ComputeQueueSnapshot } from '@/shared/compute-queue';

/**
 * The compute queue as main last reported it, or null until the first read
 * lands. Not persisted — every value describes the running process.
 */
export const computeQueueSnapshotAtom = atom<ComputeQueueSnapshot | null>(null);

/**
 * Whether the sidebar's compute queue panel shows only its header. Remembered
 * in localStorage across launches, so a list the user tucked away stays tucked
 * away rather than reopening every time a job arrives; read on the first render
 * so the list never flashes open before the stored choice loads.
 */
export const computeQueuePanelCollapsedAtom = atomWithStorage<boolean>(
	'ensemblr_compute_queue_panel_collapsed',
	false,
	undefined,
	{ getOnInit: true },
);
