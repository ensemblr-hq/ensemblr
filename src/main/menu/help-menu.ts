import type { MenuItemConstructorOptions } from 'electron';

import type { MenuItemFactory } from './menu-item';
import type { MenuLabels } from './menu-strings';

/**
 * Builds the Help menu.
 *
 * The `help` role is load-bearing rather than cosmetic: macOS attaches its Help
 * search field — which indexes every menu item title in the app — only to the
 * menu carrying that role.
 * @param labels - Native menu labels for the active language
 * @param items - Factory for the command items in this menu
 * @returns The Help menu
 */
export function buildHelpMenu(
	labels: MenuLabels,
	items: MenuItemFactory,
): MenuItemConstructorOptions {
	return {
		label: labels.help,
		role: 'help',
		submenu: [
			items.command('help.shortcuts', labels.keyboardShortcuts),
			{ type: 'separator' },
			items.command('help.diagnostics', labels.diagnostics),
			items.command('help.configFile', labels.openConfigFile),
		],
	};
}
