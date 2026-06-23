import path from 'node:path';
import { BrowserWindow, screen } from 'electron';

import { routeExternalLinksToBrowser } from './external-links';
import {
	DEFAULT_MAIN_WINDOW_HEIGHT,
	DEFAULT_MAIN_WINDOW_WIDTH,
	MAIN_WINDOW_MIN_HEIGHT,
	MAIN_WINDOW_MIN_WIDTH,
	type MainWindowState,
	type MainWindowStateStore,
	trackMainWindowState,
} from './window-state';

/** Options for {@link createMainWindow}. */
interface CreateMainWindowOptions {
	windowStateStore?: MainWindowStateStore;
}

const macosChromeOptions =
	process.platform === 'darwin'
		? {
				titleBarStyle: 'hiddenInset' as const,
				trafficLightPosition: { x: 14, y: 14 },
			}
		: {};

/**
 * Creates the Ensemble main BrowserWindow, restoring persisted bounds and
 * wiring the Vite-served renderer (dev URL or built bundle).
 * @param options - Optional dependencies including the persisted window-state store.
 * @returns The created {@link BrowserWindow}.
 */
export function createMainWindow({
	windowStateStore,
}: CreateMainWindowOptions = {}): BrowserWindow {
	const restoredState = windowStateStore?.load(screen.getAllDisplays()) ?? null;
	const mainWindow = new BrowserWindow({
		...macosChromeOptions,
		backgroundColor: '#0b0808',
		height: restoredState?.bounds.height ?? DEFAULT_MAIN_WINDOW_HEIGHT,
		minHeight: MAIN_WINDOW_MIN_HEIGHT,
		minWidth: MAIN_WINDOW_MIN_WIDTH,
		show: false,
		title: 'Ensemble',
		width: restoredState?.bounds.width ?? DEFAULT_MAIN_WINDOW_WIDTH,
		...(restoredState
			? { x: restoredState.bounds.x, y: restoredState.bounds.y }
			: {}),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(__dirname, 'preload.js'),
		},
	});

	if (windowStateStore) {
		trackMainWindowState({ mainWindow, store: windowStateStore });
	}

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
