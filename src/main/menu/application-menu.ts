import path from 'node:path';
import { app, Menu, type MenuItemConstructorOptions, shell } from 'electron';

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
					accelerator: 'CommandOrControl+N',
					enabled: false,
					label: 'New Workspace',
				},
				{ type: 'separator' },
				{ role: process.platform === 'darwin' ? 'close' : 'quit' },
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
