import { useCallback, useEffect, useState } from 'react';

import {
	onWindowMaximizedChanged,
	toggleMaximizeWindow,
} from '@/renderer/api/ensemblr';

/**
 * Tracks whether the window is maximized, seeded from the bootstrap snapshot and
 * thereafter written only by main's broadcast — never by the last button press.
 * The compositor's own shortcuts and a double-click on the drag strip change it
 * too, and `maximize()` is a request the window manager may not have honoured by
 * the time the call returns, so the button's own click is not evidence.
 * @returns The current maximized state and a toggle that asks main to change it.
 */
export function useWindowMaximized(): {
	maximized: boolean;
	toggle: () => Promise<void>;
} {
	const [maximized, setMaximized] = useState(readInitialMaximized);

	useEffect(
		() =>
			onWindowMaximizedChanged(({ maximized: next }) => {
				setMaximized(next);
			}),
		[],
	);

	const toggle = useCallback(async () => {
		await toggleMaximizeWindow();
	}, []);

	return { maximized, toggle };
}

/**
 * Reads the maximized state main captured when the preload bridge booted, so a
 * reload of an already-maximized window does not announce "Maximize" until the
 * next state change produces a broadcast.
 * @returns The seeded state; false when the bridge is absent, as in tests.
 */
function readInitialMaximized(): boolean {
	if (typeof window === 'undefined') {
		return false;
	}

	return window.ensemblrInitialShellSnapshot?.maximized === true;
}
