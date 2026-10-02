import { useSetAtom } from 'jotai';
import { useEffect } from 'react';

import { onWindowChromeChanged } from '@/renderer/api/ensemblr';
import { applyWindowChrome } from '@/renderer/lib/window-chrome';
import { windowChromeAtom } from '@/renderer/state/window-chrome';

/**
 * Keeps the shell's window-chrome state in step with the live window, drawing
 * nothing itself.
 *
 * Full screen is the one part of the chrome that moves while the window lives —
 * macOS takes its traffic lights away there — so main pushes a fresh snapshot on
 * each transition. This writes it to the CSS custom properties every inset-aware
 * surface reads, and to the atom the surfaces that branch on it re-render from.
 *
 * Mounted at the app root rather than inside a route: a settings route has no
 * sidebar, and a subscription that lived there would miss the transitions that
 * happened while it was away.
 */
export function WindowChromeSync() {
	const setWindowChrome = useSetAtom(windowChromeAtom);

	useEffect(
		() =>
			onWindowChromeChanged((snapshot) => {
				applyWindowChrome(snapshot);
				setWindowChrome(snapshot);
			}),
		[setWindowChrome],
	);

	return null;
}
