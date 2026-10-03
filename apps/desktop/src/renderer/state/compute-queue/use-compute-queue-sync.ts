import { useSetAtom } from 'jotai';
import { useEffect } from 'react';

import {
	readComputeQueueSnapshot,
	subscribeComputeQueueChanged,
} from '@/renderer/api/ensemblr';

import { computeQueueSnapshotAtom } from './atoms';

/**
 * Keeps the compute queue snapshot in step with main: one initial read for the
 * first render, then every broadcast. A broadcast that lands before the read
 * resolves wins, since the read may describe an older queue. Mount once at the
 * app root.
 */
export function useComputeQueueSync(): void {
	const setSnapshot = useSetAtom(computeQueueSnapshotAtom);

	useEffect(() => {
		const unsubscribe = subscribeComputeQueueChanged((event) =>
			setSnapshot(event.snapshot),
		);
		readComputeQueueSnapshot()
			.then((snapshot) => setSnapshot((current) => current ?? snapshot))
			.catch((error: unknown) => {
				console.error('Failed to read the compute queue snapshot:', error);
			});
		return unsubscribe;
	}, [setSnapshot]);
}
