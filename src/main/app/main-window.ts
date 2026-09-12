import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, screen } from 'electron';
import {
	resolveWindowChrome,
	type TitleBarPreference,
} from '../../shared/window-chrome.ts';
import { installContentSecurityPolicy } from './content-security-policy';
import { routeExternalLinksToBrowser } from './external-links';
import type { AppDocument } from './external-links-policy';
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
 * Where the renderer is served from in this build: the Vite dev origin, or the
 * `file:` URL of the packaged `index.html`. Both the navigation policy and the
 * Content-Security-Policy key off it, and the packaged entry doubles as the
 * path `loadFile` is given.
 * @returns The app's own document, in the shape the policies read.
 */
export function rendererDocument(): AppDocument {
	return MAIN_WINDOW_VITE_DEV_SERVER_URL
		? {
				appDocumentUrl: null,
				appOrigin: new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin,
			}
		: {
				appDocumentUrl: pathToFileURL(packagedRendererEntry()).href,
				appOrigin: null,
			};
}

/**
 * The packaged renderer's `index.html` on disk, beside the main bundle.
 * @returns The absolute path Vite's renderer build wrote.
 */
function packagedRendererEntry(): string {
	return path.join(
		__dirname,
		`../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
	);
}

/**
 * Creates the Ensemblr main BrowserWindow, restoring persisted bounds and
 * wiring the Vite-served renderer (dev URL or built bundle).
 * @param options - The persisted window-state store, the user's title-bar preference, and the colour to show wherever the page has not painted.
 * @returns The created {@link BrowserWindow}.
 */
export function createMainWindow({
	backgroundColor,
	titleBar = 'custom',
	windowStateStore,
}: {
	backgroundColor: string;
	titleBar?: TitleBarPreference;
	windowStateStore?: MainWindowStateStore;
}): BrowserWindow {
	const restoredState = windowStateStore?.load(screen.getAllDisplays()) ?? null;
	const mainWindow = new BrowserWindow({
		...resolveWindowChromeOptions(process.platform, titleBar),
		backgroundColor,
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
			// Electron ≥20 already infers all three from `nodeIntegration: false`
			// and a preload that imports nothing outside `electron`. Declared anyway
			// so the guarantee survives a preload that later reaches for `node:fs`,
			// and so a future `<webview>` is a deliberate edit rather than a default
			// quietly changing under the app.
			sandbox: true,
			webviewTag: false,
			// On macOS this is the OS spellchecker and fetches nothing; on Linux it
			// is Chromium's, which downloads the locale's Hunspell dictionary from
			// Google's CDN on first use. Left on because the renderer draws its own
			// text context menu from Chromium's verdict.
			spellcheck: true,
		},
	});

	// The renderer draws the menu itself wherever it draws the title bar, so
	// Electron's own Windows/Linux menu bar has to stay down — two bars a row
	// apart, one of them unstyled, is what a frameless window would otherwise
	// risk on an Electron that starts drawing it.
	if (resolveWindowChrome(process.platform, titleBar).drawsOwnControls) {
		mainWindow.setMenuBarVisibility(false);
	}

	if (windowStateStore) {
		trackMainWindowState({ mainWindow, store: windowStateStore });
	}

	// Composer dictation needs the microphone; nothing in the app needs any other
	// device permission, so the rest are denied instead of left to Electron's
	// permissive default.
	restrictMediaPermissions(mainWindow.webContents.session);

	installContentSecurityPolicy(
		mainWindow.webContents.session,
		MAIN_WINDOW_VITE_DEV_SERVER_URL ?? null,
	);

	// The renderer draws the text context menu itself, but only Chromium knows
	// the spellchecker's verdict for the word under the cursor.
	forwardTextContextMenus(mainWindow.webContents);

	// Send every external link to the default system browser and cancel every
	// navigation that is neither that nor the app's own document.
	routeExternalLinksToBrowser(mainWindow.webContents, rendererDocument());

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
		void mainWindow.loadFile(packagedRendererEntry());
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
