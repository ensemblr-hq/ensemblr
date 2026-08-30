import { useCallback, useEffect, useState } from 'react';

import {
	onWindowMaximizedChanged,
	toggleMaximizeWindow,
} from '@/renderer/api/ensemblr';

/**
 * Tracks whether the window is maximized, seeded from main's broadcast rather
 * than from the last button press — the compositor's own shortcuts and a
 * double-click on the drag strip change it too, and an icon that only knew about
 * its own clicks would show the wrong one.
 * @returns The current maximized state and a toggle that writes it back.
 */
export function useWindowMaximized(): {
	maximized: boolean;
	toggle: () => Promise<void>;
} {
	const [maximized, setMaximized] = useState(false);

	useEffect(
		() =>
			onWindowMaximizedChanged(({ maximized: next }) => {
				setMaximized(next);
			}),
		[],
	);

	const toggle = useCallback(async () => {
		setMaximized(await toggleMaximizeWindow());
	}, []);

	return { maximized, toggle };
}
