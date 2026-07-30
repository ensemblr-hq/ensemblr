/**
 * Mirrors main's Plan Mode state into the renderer's per-chat toggle. The one
 * writer today is a spawn: `ensemblr_start_conversation` from a planning agent
 * puts the child's session into Plan Mode through the control layer, which never
 * touches the IPC handlers the composer's toggle rides. Without this mirror the
 * child's composer would show the toggle off while its `write`/`edit` calls are
 * being denied, and the user's next message into that tab would send
 * `planMode: false` and clear the state main is enforcing.
 *
 * This is a mirror, not the boundary: enforcement reads main's registry, so a
 * broadcast that never lands costs honesty in the UI, never safety.
 */
import { useStore } from 'jotai';
import { useEffect } from 'react';

import { chatPlanModeAtomFamily } from '@/renderer/state/preferences';

/**
 * Subscribes the per-chat Plan Mode toggles to main-process broadcasts. Mount once
 * at the app root: a spawn lands in a tab the user is not looking at, so the write
 * has to happen whether or not that chat's composer is mounted.
 */
export function usePlanModeSync(): void {
	const store = useStore();
	useEffect(() => {
		const unsubscribe = window.ensemblr?.onPlanModeChanged((payload) => {
			store.set(chatPlanModeAtomFamily(payload.chatTabId), payload.planMode);
		});
		return () => unsubscribe?.();
	}, [store]);
}
