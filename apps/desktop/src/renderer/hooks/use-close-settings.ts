import { useRouter } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { settingsReturnToAtom } from '@/renderer/state/settings-ui';

/**
 * Returns a callback that closes Settings, navigating back to the screen it was
 * opened from. Falls back to the workbench root when no prior screen was
 * recorded (e.g. the app cold-started directly into Settings).
 *
 * Shared by the Settings ← Back button and the ⌘/Ctrl+W close handler so both
 * behave identically.
 */
export function useCloseSettings(): () => void {
	const router = useRouter();
	const returnTo = useAtomValue(settingsReturnToAtom);

	return useCallback(() => {
		if (returnTo) {
			// Replay the exact prior href (incl. search/hash) without having to
			// reconstruct typed route params.
			router.history.push(returnTo);
			return;
		}
		void router.navigate({ to: '/' });
	}, [returnTo, router]);
}
