/**
 * Mirrors main's AFK state into the renderer's per-chat toggle. The one writer
 * today is a spawn: `ensemblr_start_conversation` from an unattended agent puts
 * the child's session into AFK through the control layer, which never touches
 * the IPC handlers the composer's toggle rides. Without this mirror the child's
 * composer would show the chip off while its question tool was being refused,
 * and the user's next message into that tab would send `afkMode: false` and
 * clear the state main is enforcing.
 *
 * This is a mirror, not the boundary: enforcement reads main's registry, so a
 * broadcast that never lands costs honesty in the UI, never safety. The same
 * shape as `plan-mode-sync.ts`, for the same reasons.
 */
import { useStore } from 'jotai';
import { useEffect } from 'react';

import { chatAfkModeAtomFamily } from '@/renderer/state/preferences';

/**
 * Subscribes the per-chat AFK toggles to main-process broadcasts. Mount once at
 * the app root: a spawn lands in a tab the user is not looking at, so the write
 * has to happen whether or not that chat's composer is mounted.
 */
export function useAfkModeSync(): void {
	const store = useStore();
	useEffect(() => {
		const unsubscribe = window.ensemblr?.onAfkModeChanged((payload) => {
			store.set(chatAfkModeAtomFamily(payload.chatTabId), payload.afkMode);
		});
		return () => unsubscribe?.();
	}, [store]);
}
