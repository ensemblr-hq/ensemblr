import { app, type BrowserWindow } from 'electron';

import type { DrawnMenuItemRole } from '../../shared/menu-bar';

/** How far one Zoom In / Zoom Out step moves the page zoom level. */
const ZOOM_LEVEL_STEP = 0.5;

/**
 * What each role does, for the menu bar the app draws itself.
 *
 * Electron performs a role item natively and gives the template no `click` to
 * call, so a drawn bar has to carry the role out on its own. Each entry is the
 * same call Electron's own role makes, against the window whose renderer asked.
 */
const ROLE_ACTIONS: Record<DrawnMenuItemRole, (window: BrowserWindow) => void> =
	{
		about: () => {
			app.showAboutPanel();
		},
		copy: (window) => {
			window.webContents.copy();
		},
		cut: (window) => {
			window.webContents.cut();
		},
		delete: (window) => {
			window.webContents.delete();
		},
		forceReload: (window) => {
			window.webContents.reloadIgnoringCache();
		},
		minimize: (window) => {
			window.minimize();
		},
		paste: (window) => {
			window.webContents.paste();
		},
		quit: () => {
			app.quit();
		},
		redo: (window) => {
			window.webContents.redo();
		},
		resetZoom: (window) => {
			window.webContents.setZoomLevel(0);
		},
		selectAll: (window) => {
			window.webContents.selectAll();
		},
		toggleDevTools: (window) => {
			window.webContents.toggleDevTools();
		},
		undo: (window) => {
			window.webContents.undo();
		},
		zoom: (window) => {
			if (window.isMaximized()) {
				window.unmaximize();
				return;
			}
			window.maximize();
		},
		zoomIn: (window) => {
			stepZoom(window, ZOOM_LEVEL_STEP);
		},
		zoomOut: (window) => {
			stepZoom(window, -ZOOM_LEVEL_STEP);
		},
	};

/**
 * The chord Electron attaches to each role by default off darwin.
 *
 * A role item's template carries no `accelerator` — Electron fills one in when
 * it builds the item, and registers it whether or not the bar is visible. The
 * drawn bar has to be told, or the Edit menu would show bare rows beside chords
 * that do in fact work. Roles Electron leaves unbound are absent.
 */
const ROLE_ACCELERATORS: Partial<Record<DrawnMenuItemRole, string>> = {
	copy: 'Ctrl+C',
	cut: 'Ctrl+X',
	forceReload: 'Ctrl+Shift+R',
	minimize: 'Ctrl+M',
	paste: 'Ctrl+V',
	quit: 'Ctrl+Q',
	redo: 'Ctrl+Shift+Z',
	resetZoom: 'Ctrl+0',
	selectAll: 'Ctrl+A',
	toggleDevTools: 'Ctrl+Shift+I',
	undo: 'Ctrl+Z',
	zoomIn: 'Ctrl+Plus',
	zoomOut: 'Ctrl+-',
};

/**
 * Performs a role the drawn menu bar reported the user picked.
 * @param role - The role the chosen row carries
 * @param window - The window the request came from
 */
export function performMenuRole(
	role: DrawnMenuItemRole,
	window: BrowserWindow,
): void {
	ROLE_ACTIONS[role](window);
}

/**
 * The chord to show beside a role's row in the drawn bar.
 * @param role - The role the row carries
 * @returns The display-ready chord, or undefined when Electron binds none
 */
export function acceleratorForRole(
	role: DrawnMenuItemRole,
): string | undefined {
	return ROLE_ACCELERATORS[role];
}

/**
 * Moves the window's page zoom by one step, matching Electron's own zoom roles.
 * @param window - The window to zoom
 * @param step - How far to move the zoom level, signed
 */
function stepZoom(window: BrowserWindow, step: number): void {
	const { webContents } = window;
	webContents.setZoomLevel(webContents.getZoomLevel() + step);
}
