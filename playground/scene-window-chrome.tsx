import { useSetAtom } from 'jotai';
import { useEffect } from 'react';

import {
	AppMenuBar,
	WindowTitleBarSurface,
} from '@/renderer/components/workbench-shell/window-controls';
import { applyWindowChrome } from '@/renderer/lib/window-chrome';
import { windowChromeAtom } from '@/renderer/state/window-chrome';
import type { WindowChromeSnapshot } from '@/shared/window-chrome';
import { resolveWindowChrome } from '@/shared/window-chrome';

import { MENU_BAR_FIXTURE } from './menu-bar-fixtures.ts';

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
 *
 * Writes the document and the atom together, as `WindowChromeSync` does in the
 * app: the surfaces that branch on the chrome read the atom, so a scene that
 * moved only the custom properties would leave them describing a different
 * window from the one it is drawing.
 * @param isEnabled - Whether the scene wants the Linux chrome applied.
 */
export function useSceneWindowChrome(isEnabled: boolean): void {
	const setWindowChrome = useSetAtom(windowChromeAtom);

	useEffect(() => {
		const wear = (chrome: WindowChromeSnapshot): void => {
			applyWindowChrome(chrome);
			setWindowChrome(chrome);
		};

		wear(isEnabled ? LINUX_CUSTOM_CHROME : BROWSER_CHROME);
		return () => wear(BROWSER_CHROME);
	}, [isEnabled, setWindowChrome]);
}

/**
 * The title-bar strip where the app mounts it — fixed across the window's top
 * edge — so a scene can check what its own surfaces do below it. Inert: the
 * strip is the geometry under review, not working window controls.
 */
export function SceneWindowTitleBar({ isEnabled }: { isEnabled: boolean }) {
	if (!isEnabled) {
		return null;
	}

	return (
		<div className='pointer-events-none fixed inset-x-0 top-0 z-50'>
			<WindowTitleBarSurface
				isMaximized={false}
				menu={
					<AppMenuBar menuBar={MENU_BAR_FIXTURE} onSelect={() => undefined} />
				}
				onClose={() => undefined}
				onMinimize={() => undefined}
				onToggleMaximize={() => undefined}
			/>
		</div>
	);
}
