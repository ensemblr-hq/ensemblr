import { app, type MenuItemConstructorOptions } from 'electron';

import type { MenuItemFactory } from './menu-item';
import type { MenuLabels } from './menu-strings';

/**
 * Builds the macOS application menu, empty on other platforms. Role items keep
 * their role — which preserves the native accelerator and behavior — and gain a
 * label that overrides only the text. `services` is omitted from that treatment
 * because macOS owns its submenu.
 * @param labels - Native menu labels for the active language
 * @param items - Factory for the command items in this menu
 * @returns The app menu, or an empty list off darwin
 */
export function buildAppMenu(
	labels: MenuLabels,
	items: MenuItemFactory,
): MenuItemConstructorOptions[] {
	if (process.platform !== 'darwin') {
		return [];
	}

	return [
		{
			label: app.name,
			submenu: [
				{ label: labels.about, role: 'about' },
				{ type: 'separator' },
				items.command('settings.open', labels.settings),
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
