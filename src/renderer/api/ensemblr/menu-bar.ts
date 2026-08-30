import {
	EMPTY_MENU_BAR,
	type MenuBarDescriptor,
	type MenuBarInvokeRequest,
} from '@/shared/menu-bar';

import { getEnsemblrApiOrNull } from './query-keys';

/**
 * Reads the menu bar as main last built it.
 * @returns The current bar; an empty one without the preload bridge.
 */
export async function getMenuBar(): Promise<MenuBarDescriptor> {
	return (await getEnsemblrApiOrNull()?.getMenuBar()) ?? EMPTY_MENU_BAR;
}

/**
 * Subscribes to the menu bar, resent whenever main rebuilds the native menu.
 * @param listener - Called with each new bar.
 * @returns An unsubscribe function; a no-op without the preload bridge.
 */
export function onMenuBarChanged(
	listener: (payload: MenuBarDescriptor) => void,
): () => void {
	return getEnsemblrApiOrNull()?.onMenuBarChanged(listener) ?? (() => {});
}

/**
 * Performs the row the user picked in the app-drawn menu bar. A no-op without
 * the preload bridge.
 * @param request - The row, with the revision it was drawn from.
 */
export async function invokeMenuBarItem(
	request: MenuBarInvokeRequest,
): Promise<void> {
	await getEnsemblrApiOrNull()?.invokeMenuBarItem(request);
}
