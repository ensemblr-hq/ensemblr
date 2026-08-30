import path from 'node:path';
import { BrowserWindow, screen } from 'electron';
import type { TitleBarPreference } from '../../shared/window-chrome.ts';
import { routeExternalLinksToBrowser } from './external-links';
import { linuxWindowIconPath } from './linux-desktop-identity';
import { restrictMediaPermissions } from './media-permissions';
import { forwardTextContextMenus } from './text-context-menu-forwarding';
import { resolveWindowChromeOptions } from './window-chrome';
import {
	DEFAULT_MAIN_WINDOW_HEIGHT,
	DEFAULT_MAIN_WINDOW_WIDTH,
	forbidsWindowPositioning,
	MAIN_WINDOW_MIN_HEIGHT,
	MAIN_WINDOW_MIN_WIDTH,
	type MainWindowState,
	type MainWindowStateStore,
	trackMainWindowState,
} from './window-state';

/**
 * Creates the Ensemblr main BrowserWindow, restoring persisted bounds and
 * wiring the Vite-served renderer (dev URL or built bundle).
 * @param options - The persisted window-state store and the user's title-bar preference.
 * @returns The created {@link BrowserWindow}.
 */
export function createMainWindow({
	titleBar = 'custom',
	windowStateStore,
}: {
	titleBar?: TitleBarPreference;
	windowStateStore?: MainWindowStateStore;
} = {}): BrowserWindow {
	const restoredState = windowStateStore?.load(screen.getAllDisplays()) ?? null;
	const mainWindow = new BrowserWindow({
		...resolveWindowChromeOptions(process.platform, titleBar),
		backgroundColor: '#0b0808',
		height: restoredState?.bounds.height ?? DEFAULT_MAIN_WINDOW_HEIGHT,
		// Linux only: macOS reads the icon off the bundle. Undefined everywhere
		// else, which BrowserWindow treats as "unset".
		icon: linuxWindowIconPath(),
		minHeight: MAIN_WINDOW_MIN_HEIGHT,
		minWidth: MAIN_WINDOW_MIN_WIDTH,
		show: false,
		title: 'Ensemblr',
		width: restoredState?.bounds.width ?? DEFAULT_MAIN_WINDOW_WIDTH,
		...(restoredState && !forbidsWindowPositioning()
			? { x: restoredState.bounds.x, y: restoredState.bounds.y }
			: {}),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			// Chromium's built-in PDF viewer is a plugin, and Electron ships plugins
			// off; without this the file preview's PDF frame renders empty. It is the
			// only plugin modern Chromium still carries, so this grants nothing else.
			plugins: true,
			preload: path.join(__dirname, 'preload.js'),
		},
	});

	if (windowStateStore) {
		trackMainWindowState({ mainWindow, store: windowStateStore });
	}

	// Composer dictation needs the microphone; nothing in the app needs any other
	// device permission, so the rest are denied instead of left to Electron's
	// permissive default.
	restrictMediaPermissions(mainWindow.webContents.session);

	// The renderer draws the text context menu itself, but only Chromium knows
	// the spellchecker's verdict for the word under the cursor.
	forwardTextContextMenus(mainWindow.webContents);

	// Send every external link to the default system browser. In dev the renderer
	// is served from the Vite origin (treated as internal); in prod it is a file:
	// bundle, which has no http(s) origin to match.
	routeExternalLinksToBrowser(mainWindow.webContents, {
		appOrigin: MAIN_WINDOW_VITE_DEV_SERVER_URL
			? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
			: null,
	});

	mainWindow.once('ready-to-show', () => {
		restoreMainWindowState(mainWindow, restoredState);
		mainWindow.show();

		if (restoredState?.isFullScreen) {
			mainWindow.setFullScreen(true);
		}
	});

	if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
		void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
	} else {
		void mainWindow.loadFile(
			path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
		);
	}

	return mainWindow;
}

/**
 * Applies persisted window-state flags (e.g. maximized) once the window is
 * ready to show. Full-screen restoration is handled by the caller.
 * @param mainWindow - The window to update.
 * @param state - Persisted state to apply, or `null` to leave defaults.
 */
function restoreMainWindowState(
	mainWindow: BrowserWindow,
	state: MainWindowState | null,
): void {
	if (state?.isMaximized && !state.isFullScreen) {
		mainWindow.maximize();
	}
}
