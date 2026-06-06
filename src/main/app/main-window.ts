import path from 'node:path';
import { BrowserWindow, screen } from 'electron';

import {
	DEFAULT_MAIN_WINDOW_HEIGHT,
	DEFAULT_MAIN_WINDOW_WIDTH,
	MAIN_WINDOW_MIN_HEIGHT,
	MAIN_WINDOW_MIN_WIDTH,
	type MainWindowState,
	type MainWindowStateStore,
	trackMainWindowState,
} from './window-state';

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
			preload: path.join(__dirname, '../preload/preload.js'),
		},
	});

	if (windowStateStore) {
		trackMainWindowState({ mainWindow, store: windowStateStore });
	}

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

function restoreMainWindowState(
	mainWindow: BrowserWindow,
	state: MainWindowState | null,
): void {
	if (state?.isMaximized && !state.isFullScreen) {
		mainWindow.maximize();
	}
}
