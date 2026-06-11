import path from 'node:path';
import { app, Menu, type MenuItemConstructorOptions, shell } from 'electron';
import { getAccelerator } from '../../shared/keymap';

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
				{ role: process.platform === 'darwin' ? 'close' : 'quit' },
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
				{ role: 'reload' },
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
					: ([{ role: 'close' }] as MenuItemConstructorOptions[])),
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
