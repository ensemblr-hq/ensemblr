import { useSetAtom } from 'jotai';
import { useEffect } from 'react';

import {
	readComputeQueueSnapshot,
	subscribeComputeQueueChanged,
} from '@/renderer/api/ensemblr';

import { computeQueueSnapshotAtom } from './atoms';

/**
 * Keeps the compute queue snapshot in step with main: one initial read for the
 * first render, then every broadcast. Mount once at the app root.
 */
export function useComputeQueueSync(): void {
	const setSnapshot = useSetAtom(computeQueueSnapshotAtom);

	useEffect(() => {
		const unsubscribe = subscribeComputeQueueChanged((event) =>
			setSnapshot(event.snapshot),
		);
		void readComputeQueueSnapshot()
			.then(setSnapshot)
			.catch(() => undefined);
		return unsubscribe;
	}, [setSnapshot]);
}
