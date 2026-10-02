import type { AnyRouter } from '@tanstack/react-router';
import { getDefaultStore } from 'jotai';
import { settingsReturnToAtom } from '@/renderer/state/settings-ui';

const SETTINGS_PREFIX = '/settings';

/**
 * Records the screen the user came from whenever navigation crosses into
 * Settings, so closing Settings (Back button or ⌘/Ctrl+W) can return there
 * instead of the workbench root. A single subscription is the chokepoint for
 * every Settings entry point (command palette, diagnostics remediation, etc.)
 * and naturally ignores navigation *within* Settings.
 * @param router - Router instance to subscribe to.
 */
export function installSettingsReturnTracker(router: AnyRouter): void {
	const store = getDefaultStore();

	router.subscribe('onResolved', ({ fromLocation, toLocation }) => {
		const entering = toLocation.pathname.startsWith(SETTINGS_PREFIX);
		const fromSettings =
			fromLocation?.pathname.startsWith(SETTINGS_PREFIX) ?? false;

		// Capture only on the boundary into Settings, and only from a genuine
		// prior screen (cold start has no `fromLocation` → keep the root fallback).
		if (entering && !fromSettings && fromLocation) {
			store.set(settingsReturnToAtom, fromLocation.href);
		}
	});
}
