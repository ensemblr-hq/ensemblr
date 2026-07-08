import path from 'node:path';
import {
	app,
	BrowserWindow,
	Menu,
	type MenuItemConstructorOptions,
	shell,
} from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { getAccelerator } from '../../shared/keymap/matcher';

/**
 * Returns the on-disk path to the bundled product roadmap markdown.
 * @returns Absolute path to `mvp-sequencing.md`.
 */
function getProductRoadmapPath(): string {
	if (app.isPackaged) {
		return path.join(process.resourcesPath, 'mvp-sequencing.md');
	}

	return path.join(app.getAppPath(), 'docs/product/mvp-sequencing.md');
}

/**
 * Builds and installs the Ensemble application menu, with the macOS app menu
 * appearing only on darwin platforms.
 */
export function installApplicationMenu(): void {
	// Context-aware close: the renderer decides whether ⌘/Ctrl+W closes the
	// active tab, navigates back, or closes the window. Replaces the default
	// `close` role so the keydown reaches the web page logic instead of being
	// swallowed by the menu accelerator.
	const closeTabItem: MenuItemConstructorOptions = {
		accelerator: getAccelerator('tab.close'),
		click: () => {
			BrowserWindow.getFocusedWindow()?.webContents.send(
				IPC_CHANNELS.closeActiveTab,
			);
		},
		label: 'Close Tab',
	};

	const appMenu: MenuItemConstructorOptions[] =
		process.platform === 'darwin'
			? [
					{
						label: app.name,
						submenu: [
							{ role: 'about' },
							{ type: 'separator' },
							{ role: 'services' },
							{ type: 'separator' },
							{ role: 'hide' },
							{ role: 'hideOthers' },
							{ role: 'unhide' },
							{ type: 'separator' },
							{ role: 'quit' },
						],
					},
				]
			: [];

	const template: MenuItemConstructorOptions[] = [
		...appMenu,
		{
			label: 'File',
			submenu: [
				{
					accelerator: getAccelerator('workspace.new'),
					enabled: false,
					label: 'New Workspace',
				},
				{ type: 'separator' },
				process.platform === 'darwin' ? closeTabItem : { role: 'quit' },
			],
		},
		{
			label: 'Edit',
			submenu: [
				{ role: 'undo' },
				{ role: 'redo' },
				{ type: 'separator' },
				{ role: 'cut' },
				{ role: 'copy' },
				{ role: 'paste' },
				...(process.platform === 'darwin'
					? ([
							{ role: 'pasteAndMatchStyle' },
							{ role: 'delete' },
							{ role: 'selectAll' },
							{ type: 'separator' },
							{
								label: 'Speech',
								submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
							},
						] as MenuItemConstructorOptions[])
					: ([
							{ role: 'delete' },
							{ type: 'separator' },
							{ role: 'selectAll' },
						] as MenuItemConstructorOptions[])),
			],
		},
		{
			label: 'View',
			submenu: [
				// Reload is intentionally accelerator-less: ⌘/Ctrl+R is repurposed as
				// the workspace Run/Stop shortcut (`run.start`) and handled in the
				// renderer. Force Reload (⌘⇧R) stays as the keyboard path to a reload.
				{
					click: () => {
						BrowserWindow.getFocusedWindow()?.webContents.reload();
					},
					label: 'Reload',
				},
				{ role: 'forceReload' },
				{ role: 'toggleDevTools' },
				{ type: 'separator' },
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
			],
		},
		{
			label: 'Window',
			submenu: [
				{ role: 'minimize' },
				{ role: 'zoom' },
				...(process.platform === 'darwin'
					? ([
							{ type: 'separator' },
							{ role: 'front' },
						] as MenuItemConstructorOptions[])
					: ([closeTabItem] as MenuItemConstructorOptions[])),
			],
		},
		{
			label: 'Help',
			submenu: [
				{
					click: async () => {
						const error = await shell.openPath(getProductRoadmapPath());

						if (error) {
							console.warn('Failed to open product roadmap:', error);
						}
					},
					label: 'Open Product Roadmap',
				},
			],
		},
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
