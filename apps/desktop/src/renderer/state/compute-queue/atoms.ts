import { atom } from 'jotai';

import type { ComputeQueueSnapshot } from '@/shared/compute-queue';

/**
 * The compute queue as main last reported it, or null until the first read
 * lands. Not persisted — every value describes the running process.
 */
export const computeQueueSnapshotAtom = atom<ComputeQueueSnapshot | null>(null);
