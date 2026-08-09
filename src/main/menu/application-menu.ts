import path from 'node:path';
import {
	app,
	BrowserWindow,
	Menu,
	type MenuItemConstructorOptions,
	shell,
} from 'electron';
import { author } from '../../../package.json';
import type { AppSettings } from '../../shared/config';
import { resolveLanguage } from '../../shared/i18n';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { getAccelerator } from '../../shared/keymap/matcher';
import { type MenuLabels, menuLabels } from './menu-strings';

/**
 * Builds the About-panel copyright line from the package author and the current
 * year, so the notice tracks the build date instead of a baked-in constant.
 * @returns Copyright string such as `© Philipp Soldunov 2026`.
 */
function getCopyrightNotice(): string {
	return `© ${author.name} ${new Date().getFullYear()}`;
}

/**
 * Returns the on-disk path to the bundled product roadmap markdown. The bundled
 * file is the archived MVP sequencing doc, which `extraResource` copies to the
 * Resources root by basename.
 * @returns Absolute path to `mvp-sequencing.md`.
 */
function getProductRoadmapPath(): string {
	if (app.isPackaged) {
		return path.join(process.resourcesPath, 'mvp-sequencing.md');
	}

	return path.join(app.getAppPath(), 'docs/product/archive/mvp-sequencing.md');
}

/**
 * Builds the context-aware close item. The renderer decides whether ⌘/Ctrl+W
 * closes the active tab, navigates back, or closes the window, so this replaces
 * the default `close` role — otherwise the menu accelerator swallows the keydown
 * before the web page logic sees it.
 * @param labels - Native menu labels for the active language
 * @returns The Close Tab menu item
 */
function buildCloseTabItem(labels: MenuLabels): MenuItemConstructorOptions {
	return {
		accelerator: getAccelerator('tab.close'),
		click: () => {
			BrowserWindow.getFocusedWindow()?.webContents.send(
				IPC_CHANNELS.closeActiveTab,
			);
		},
		label: labels.closeTab,
	};
}

/**
 * Builds the macOS application menu, empty on other platforms. Role items keep
 * their role — which preserves the native accelerator and behavior — and gain a
 * label that overrides only the text. `services` is omitted from that treatment
 * because macOS owns its submenu.
 * @param labels - Native menu labels for the active language
 * @returns The app menu, or an empty list off darwin
 */
function buildAppMenu(labels: MenuLabels): MenuItemConstructorOptions[] {
	if (process.platform !== 'darwin') {
		return [];
	}

	return [
		{
			label: app.name,
			submenu: [
				{ label: labels.about, role: 'about' },
				{ type: 'separator' },
				{ role: 'services' },
				{ type: 'separator' },
				{ label: labels.hide, role: 'hide' },
				{ label: labels.hideOthers, role: 'hideOthers' },
				{ label: labels.unhide, role: 'unhide' },
				{ type: 'separator' },
				{ label: labels.quit, role: 'quit' },
			],
		},
	];
}

/**
 * Builds the File menu.
 * @param labels - Native menu labels for the active language
 * @param closeTabItem - The shared context-aware close item
 * @returns The File menu
 */
function buildFileMenu(
	labels: MenuLabels,
	closeTabItem: MenuItemConstructorOptions,
): MenuItemConstructorOptions {
	return {
		label: labels.file,
		submenu: [
			{
				accelerator: getAccelerator('workspace.new'),
				enabled: false,
				label: labels.newWorkspace,
			},
			{ type: 'separator' },
			process.platform === 'darwin'
				? closeTabItem
				: { label: labels.quit, role: 'quit' },
		],
	};
}

/**
 * Builds the Edit menu. The Speech submenu keeps its macOS-owned
 * `startSpeaking`/`stopSpeaking` items, which stay in the system language.
 * @param labels - Native menu labels for the active language
 * @returns The Edit menu
 */
function buildEditMenu(labels: MenuLabels): MenuItemConstructorOptions {
	const macOnly: MenuItemConstructorOptions[] = [
		{ label: labels.pasteAndMatchStyle, role: 'pasteAndMatchStyle' },
		{ label: labels.delete, role: 'delete' },
		{ label: labels.selectAll, role: 'selectAll' },
		{ type: 'separator' },
		{
			label: labels.speech,
			submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
		},
	];

	const otherPlatforms: MenuItemConstructorOptions[] = [
		{ label: labels.delete, role: 'delete' },
		{ type: 'separator' },
		{ label: labels.selectAll, role: 'selectAll' },
	];

	return {
		label: labels.edit,
		submenu: [
			{ label: labels.undo, role: 'undo' },
			{ label: labels.redo, role: 'redo' },
			{ type: 'separator' },
			{ label: labels.cut, role: 'cut' },
			{ label: labels.copy, role: 'copy' },
			{ label: labels.paste, role: 'paste' },
			...(process.platform === 'darwin' ? macOnly : otherPlatforms),
		],
	};
}

/**
 * Builds the View menu.
 * @param labels - Native menu labels for the active language
 * @returns The View menu
 */
function buildViewMenu(labels: MenuLabels): MenuItemConstructorOptions {
	return {
		label: labels.view,
		submenu: [
			// Reload is intentionally accelerator-less: ⌘/Ctrl+R is repurposed as
			// the workspace Run/Stop shortcut (`run.start`) and handled in the
			// renderer. Force Reload (⌘⇧R) stays as the keyboard path to a reload.
			{
				click: () => {
					BrowserWindow.getFocusedWindow()?.webContents.reload();
				},
				label: labels.reload,
			},
			{ label: labels.forceReload, role: 'forceReload' },
			{ label: labels.toggleDevTools, role: 'toggleDevTools' },
			{ type: 'separator' },
			{ label: labels.resetZoom, role: 'resetZoom' },
			{ label: labels.zoomIn, role: 'zoomIn' },
			{ label: labels.zoomOut, role: 'zoomOut' },
		],
	};
}

/**
 * Builds the Window menu.
 * @param labels - Native menu labels for the active language
 * @param closeTabItem - The shared context-aware close item
 * @returns The Window menu
 */
function buildWindowMenu(
	labels: MenuLabels,
	closeTabItem: MenuItemConstructorOptions,
): MenuItemConstructorOptions {
	const macOnly: MenuItemConstructorOptions[] = [
		{ type: 'separator' },
		{ label: labels.bringAllToFront, role: 'front' },
	];

	return {
		label: labels.window,
		submenu: [
			{ label: labels.minimize, role: 'minimize' },
			{ label: labels.zoom, role: 'zoom' },
			...(process.platform === 'darwin' ? macOnly : [closeTabItem]),
		],
	};
}

/**
 * Builds the Help menu.
 * @param labels - Native menu labels for the active language
 * @returns The Help menu
 */
function buildHelpMenu(labels: MenuLabels): MenuItemConstructorOptions {
	return {
		label: labels.help,
		submenu: [
			{
				click: async () => {
					const error = await shell.openPath(getProductRoadmapPath());

					if (error) {
						console.warn('Failed to open product roadmap:', error);
					}
				},
				label: labels.openProductRoadmap,
			},
		],
	};
}

/**
 * Builds and installs the Ensemblr application menu in the language the app
 * setting resolves to, with the macOS app menu appearing only on darwin.
 * `Menu.setApplicationMenu` replaces the menu wholesale, so calling this again
 * after the language changes *is* the rebuild.
 * @param readSettings - Reads the current App settings; called on every rebuild
 */
export function installApplicationMenu(readSettings: () => AppSettings): void {
	app.setAboutPanelOptions({ copyright: getCopyrightNotice() });

	const language = resolveLanguage(
		readSettings().general.language,
		app.getPreferredSystemLanguages(),
	);
	const labels = menuLabels(language, app.name);
	const closeTabItem = buildCloseTabItem(labels);

	const template: MenuItemConstructorOptions[] = [
		...buildAppMenu(labels),
		buildFileMenu(labels, closeTabItem),
		buildEditMenu(labels),
		buildViewMenu(labels),
		buildWindowMenu(labels, closeTabItem),
		buildHelpMenu(labels),
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
