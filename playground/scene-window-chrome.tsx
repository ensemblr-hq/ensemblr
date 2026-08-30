import { useEffect } from 'react';

import { WindowControlCluster } from '@/renderer/components/workbench-shell/window-controls';
import { applyWindowChrome } from '@/renderer/lib/window-chrome';
import { resolveWindowChrome } from '@/shared/window-chrome';

/** The chrome Linux gets with `titleBar = custom`: Ensemblr draws the buttons. */
const LINUX_CUSTOM_CHROME = resolveWindowChrome('linux', 'custom');

/** No chrome at all, which is what a browser preview is really running under. */
const BROWSER_CHROME = resolveWindowChrome('linux', 'system');

/**
 * Puts the document under the Linux chrome for as long as a scene asks for it,
 * through the same applier `main.tsx` uses, and hands it back to the no-chrome
 * case on the way out so the next scene is not left with a reserved strip.
 *
 * Applying the real chrome rather than faking the class is the point: how much
 * room a surface leaves for the control cluster is decided by CSS keyed on
 * `html.app-window-controls`, so a scene that only rendered the buttons would
 * show none of the reservations that actually matter.
 * @param isEnabled - Whether the scene wants the Linux chrome applied.
 */
export function useSceneWindowChrome(isEnabled: boolean): void {
	useEffect(() => {
		applyWindowChrome(isEnabled ? LINUX_CUSTOM_CHROME : BROWSER_CHROME);
		return () => applyWindowChrome(BROWSER_CHROME);
	}, [isEnabled]);
}

/**
 * The cluster where the app mounts it — fixed to the window's top-right corner
 * — so a scene can check what its own surfaces do underneath it. Inert: the
 * buttons are the geometry under review, not working window controls.
 */
export function SceneWindowControls({ isEnabled }: { isEnabled: boolean }) {
	if (!isEnabled) {
		return null;
	}

	return (
		<div className='pointer-events-none fixed top-0 right-0 z-50'>
			<WindowControlCluster
				isMaximized={false}
				onClose={() => undefined}
				onMinimize={() => undefined}
				onToggleMaximize={() => undefined}
			/>
		</div>
	);
}
