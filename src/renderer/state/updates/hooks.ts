import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';

import { checkForUpdates, installUpdate } from '@/renderer/api/ensemblr';
import type { UpdateStatusSnapshot } from '@/shared/ipc/contracts/update';

import { updateStatusAtom } from './atoms';
import type { UpdateActions } from './use-update-sync';

/**
 * Reads the updater's state, or null before the first read lands. Surfaces that
 * render a version render nothing until it does, rather than guessing one.
 * @returns The current snapshot, or null
 */
export function useUpdateStatus(): UpdateStatusSnapshot | null {
	return useAtomValue(updateStatusAtom);
}

/**
 * The two things a surface can ask the updater to do. Both write the resulting
 * snapshot straight back, so a button reflects its own outcome without waiting
 * for main's broadcast to arrive.
 * @returns Stable check and install callbacks
 */
export function useUpdateActions(): UpdateActions {
	const setStatus = useSetAtom(updateStatusAtom);

	const check = useCallback(async () => {
		setStatus(await checkForUpdates());
	}, [setStatus]);

	const install = useCallback(async () => {
		setStatus(await installUpdate());
	}, [setStatus]);

	return useMemo(() => ({ check, install }), [check, install]);
}
