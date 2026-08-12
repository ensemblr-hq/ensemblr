import type { MenuItemConstructorOptions } from 'electron';

import type { MenuItemFactory } from './menu-item';
import type { MenuLabels } from './menu-strings';

/**
 * Builds the Window menu. Off darwin it carries the close item, which macOS
 * keeps in File instead.
 * @param labels - Native menu labels for the active language
 * @param items - Factory for the command items in this menu
 * @returns The Window menu
 */
export function buildWindowMenu(
	labels: MenuLabels,
	items: MenuItemFactory,
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
			...(process.platform === 'darwin'
				? macOnly
				: [items.command('tab.close', labels.closeTab)]),
		],
	};
}
