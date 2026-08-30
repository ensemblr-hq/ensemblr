import type { MenuItemConstructorOptions } from 'electron';

import type { MenuContext } from '../../shared/menu-commands';
import type { MenuItemFactory } from './menu-item';
import type { MenuLabels } from './menu-strings';

/**
 * Builds the File menu: the creation actions, the ways to bring a repository
 * into the app, and the close item.
 *
 * New Terminal is deliberately absent — it lives in the Workspace menu beside
 * the scripts it shares a dock with, and listing it twice would register its
 * accelerator twice.
 *
 * Off darwin there is no application menu to host Settings, Check for Updates
 * and Quit, so they land here. Close Tab is not repeated: the Window menu
 * already carries it off darwin.
 * @param labels - Native menu labels for the active language
 * @param items - Factory for the command items in this menu
 * @param context - The last context the renderer reported, or null
 * @returns The File menu
 */
export function buildFileMenu(
	labels: MenuLabels,
	items: MenuItemFactory,
	context: MenuContext | null,
): MenuItemConstructorOptions {
	return {
		label: labels.file,
		submenu: [
			items.command('workspace.new', labels.newWorkspace),
			items.command('tab.new', labels.newChat),
			{ type: 'separator' },
			{
				label: labels.addRepository,
				submenu: [
					items.command('project.addFromGithub', labels.addFromGithub),
					items.command('project.addFromLocal', labels.addFromLocal),
					items.command('project.quickStart', labels.quickStart),
				],
			},
			items.submenu(
				'project.openRecent',
				labels.openRecent,
				context?.recentProjects ?? [],
				labels.noRecentProjects,
			),
			{ type: 'separator' },
			...(process.platform === 'darwin'
				? [items.command('tab.close', labels.closeTab)]
				: [
						items.command('settings.open', labels.settings),
						items.command('app.checkForUpdates', labels.checkForUpdates),
						{ type: 'separator' as const },
						{ label: labels.quit, role: 'quit' as const },
					]),
		],
	};
}
