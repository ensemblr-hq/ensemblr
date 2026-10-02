import { contextBridge, ipcRenderer } from 'electron';

import { resolveWindowChrome } from '../src/shared/window-chrome.ts';

/**
 * Preload for the demo window.
 *
 * Deliberately not `src/preload/preload.ts`: exposing the real bridge would put
 * `window.ensemblr` behind `contextBridge` as a frozen, non-configurable
 * property, and the demo bridge — a `get`-trap Proxy over ~200 method names —
 * cannot be installed over it. Leaving the name free is the whole job.
 *
 * `ensemblrInitialShellSnapshot` carries only the window chrome, which is the
 * one field `readWindowChrome` reads; the renderer's query-cache seeding treats
 * the rest as absent, which is correct here since the scenario supplies it.
 */
contextBridge.exposeInMainWorld('ensemblrInitialShellSnapshot', {
	windowChrome: resolveWindowChrome(process.platform, 'system'),
});

contextBridge.exposeInMainWorld('ensemblrDemo', {
	/**
	 * Captures the window, chrome included, through the main process.
	 * @param scenarioId - Scenario the shot is filed under.
	 * @param theme - Theme the shot was taken in.
	 * @returns The path the PNG was written to, or null when the capture failed.
	 */
	capture: (scenarioId: string, theme: string): Promise<string | null> =>
		ipcRenderer.invoke('demo:capture', { scenarioId, theme }),
	/**
	 * Resizes the window's content area to a scenario's declared size.
	 * @param size - Content width and height in CSS pixels.
	 */
	setContentSize: (size: { height: number; width: number }): Promise<void> =>
		ipcRenderer.invoke('demo:set-content-size', size),
});
