import { BrowserWindow } from 'electron';

import type { DescribedMenuItem, MenuItemFactory } from './menu-item';
import { performMenuRole } from './menu-roles';
import type { MenuLabels } from './menu-strings';

/**
 * Builds the View menu: the palette, the layout toggles, the Concierge's own
 * surface controls, the panel and theme radio groups, and page zoom. Reload and
 * the developer tools sit one level down under Developer, because they are
 * browser plumbing rather than product.
 * @param labels - Native menu labels for the active language
 * @param items - Factory for the command items in this menu
 * @returns The View menu
 */
export function buildViewMenu(
	labels: MenuLabels,
	items: MenuItemFactory,
): DescribedMenuItem {
	return {
		label: labels.view,
		submenu: [
			items.command('palette.open', labels.commandPalette),
			{ type: 'separator' },
			items.command('layout.toggleSidebar', labels.sidebar, { checkbox: true }),
			items.command('layout.toggleRightSidebar', labels.rightSidebar, {
				checkbox: true,
			}),
			items.command('layout.toggleDock', labels.dock, { checkbox: true }),
			{
				label: labels.concierge,
				submenu: [
					items.command('concierge.toggle', labels.conciergeShow, {
						checkbox: true,
					}),
					items.command(
						'concierge.toggleFullscreen',
						labels.conciergeMaximize,
						{ checkbox: true },
					),
					{ type: 'separator' },
					items.command(
						'concierge.focusComposer',
						labels.conciergeFocusComposer,
					),
					items.command('concierge.clear', labels.conciergeClear),
				],
			},
			{ type: 'separator' },
			items.command('changes.uncommitted', labels.uncommittedChanges),
			{
				label: labels.panel,
				submenu: [
					items.command('panel.files', labels.panelFiles, { radio: true }),
					items.command('panel.changes', labels.panelChanges, { radio: true }),
					items.command('panel.checks', labels.panelChecks, { radio: true }),
				],
			},
			{ type: 'separator' },
			{
				label: labels.goTo,
				submenu: [
					items.command('go.workbench', labels.goWorkbench),
					items.command('go.linear', labels.goLinear),
					items.command('go.history', labels.goHistory),
				],
			},
			{
				label: labels.appearance,
				submenu: [
					items.command('theme.system', labels.themeSystem, { radio: true }),
					items.command('theme.light', labels.themeLight, { radio: true }),
					items.command('theme.dark', labels.themeDark, { radio: true }),
				],
			},
			{ type: 'separator' },
			items.command('toolCalls.toggleCollapse', labels.collapseToolCalls, {
				checkbox: true,
			}),
			{ type: 'separator' },
			{ label: labels.resetZoom, role: 'resetZoom' },
			{ label: labels.zoomIn, role: 'zoomIn' },
			{ label: labels.zoomOut, role: 'zoomOut' },
			{ type: 'separator' },
			{
				label: labels.developer,
				submenu: [
					// Reload is intentionally accelerator-less: ⌘/Ctrl+R is repurposed as
					// the workspace Run/Stop shortcut (`run.start`) and handled in the
					// renderer. Force Reload (⌘⇧R) stays as the keyboard path to a reload.
					{
						click: () => {
							const focused = BrowserWindow.getFocusedWindow();
							if (focused) {
								performMenuRole('reload', focused);
							}
						},
						drawnRole: 'reload',
						label: labels.reload,
					},
					{ label: labels.forceReload, role: 'forceReload' },
					{ label: labels.toggleDevTools, role: 'toggleDevTools' },
				],
			},
		],
	};
}
