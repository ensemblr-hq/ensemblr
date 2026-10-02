import type { WindowMaximizedBroadcast } from '@/shared/ipc/contracts/repository-navigation';
import type { WindowChromeSnapshot } from '@/shared/window-chrome';

import { getEnsemblrApiOrNull } from './query-keys';

/** Minimizes the window. A no-op without the preload bridge. */
export async function minimizeWindow(): Promise<void> {
	await getEnsemblrApiOrNull()?.minimizeWindow();
}

/**
 * Closes the window, which runs the quit confirmation when agents are still
 * working. A no-op without the preload bridge.
 */
export async function closeWindow(): Promise<void> {
	await getEnsemblrApiOrNull()?.closeWindow();
}

/**
 * Maximizes the window, or restores it when it already is.
 * @returns The state it left the window in; `false` without the preload bridge.
 */
export async function toggleMaximizeWindow(): Promise<boolean> {
	const result = await getEnsemblrApiOrNull()?.toggleMaximizeWindow();
	return result?.maximized ?? false;
}

/**
 * Quits and starts this build again, draining running agents on the way out.
 * A no-op without the preload bridge.
 */
export async function relaunchApp(): Promise<void> {
	await getEnsemblrApiOrNull()?.relaunchApp();
}

/**
 * Subscribes to the chrome the live window wears, which full screen changes
 * under the shell.
 * @param listener - Called with each new snapshot.
 * @returns An unsubscribe function; a no-op without the preload bridge.
 */
export function onWindowChromeChanged(
	listener: (snapshot: WindowChromeSnapshot) => void,
): () => void {
	return getEnsemblrApiOrNull()?.onWindowChromeChanged(listener) ?? (() => {});
}

/**
 * Subscribes to the window's maximized state.
 * @param listener - Called with each new state.
 * @returns An unsubscribe function; a no-op without the preload bridge.
 */
export function onWindowMaximizedChanged(
	listener: (payload: WindowMaximizedBroadcast) => void,
): () => void {
	return (
		getEnsemblrApiOrNull()?.onWindowMaximizedChanged(listener) ?? (() => {})
	);
}
