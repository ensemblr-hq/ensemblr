import path from 'node:path';
import { BrowserWindow } from 'electron';

const macosChromeOptions =
	process.platform === 'darwin'
		? {
				titleBarStyle: 'hiddenInset' as const,
				trafficLightPosition: { x: 14, y: 14 },
			}
		: {};

export function createMainWindow(): BrowserWindow {
	const mainWindow = new BrowserWindow({
		...macosChromeOptions,
		backgroundColor: '#0b0808',
		height: 820,
		minHeight: 640,
		minWidth: 960,
		show: false,
		title: 'Ensemble',
		width: 1280,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(__dirname, '../preload/preload.js'),
		},
	});

	mainWindow.once('ready-to-show', () => {
		mainWindow.show();
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
