import type { MenuItemConstructorOptions } from 'electron';

import type { MenuContext } from '../../shared/menu-commands';
import type { MenuItemFactory } from './menu-item';
import type { MenuLabels } from './menu-strings';

/**
 * Builds the Workspace menu: everything scoped to the workspace on screen —
 * scripts and terminals, its files, its place on the board, and its lifecycle.
 * @param labels - Native menu labels for the active language
 * @param items - Factory for the command items in this menu
 * @param context - The last context the renderer reported, or null
 * @returns The Workspace menu
 */
export function buildWorkspaceMenu(
	labels: MenuLabels,
	items: MenuItemFactory,
	context: MenuContext | null,
): MenuItemConstructorOptions {
	return {
		label: labels.workspace,
		submenu: [
			items.command('run.toggle', labels.run, { checkbox: true }),
			items.submenu(
				'run.script',
				labels.runScript,
				context?.runScripts ?? [],
				labels.noRunScripts,
			),
			items.command('run.setup', labels.runSetupScript),
			items.command('terminal.new', labels.newTerminal),
			items.command('agents.open', labels.agentHarness),
			{ type: 'separator' },
			items.command('files.search', labels.findFile),
			items.submenu(
				'workspace.openIn',
				labels.openIn,
				context?.openTargets ?? [],
				labels.noOpenTargets,
			),
			{ type: 'separator' },
			items.command('workspace.rename', labels.renameWorkspace),
			{
				label: labels.status,
				submenu: [
					items.command('workspace.status.backlog', labels.statusBacklog, {
						radio: true,
					}),
					items.command(
						'workspace.status.inProgress',
						labels.statusInProgress,
						{ radio: true },
					),
					items.command('workspace.status.inReview', labels.statusInReview, {
						radio: true,
					}),
					items.command('workspace.status.done', labels.statusDone, {
						radio: true,
					}),
					items.command('workspace.status.cancelled', labels.statusCancelled, {
						radio: true,
					}),
				],
			},
			{ type: 'separator' },
			items.command('workspace.archive', labels.archiveWorkspace),
			items.command('workspace.delete', labels.deleteWorkspace),
		],
	};
}
