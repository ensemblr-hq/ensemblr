import type { TFunction } from 'i18next';

/**
 * The label the maximized Concierge panel's sidebar rail and its header trigger
 * both carry, naming what the next press does rather than what the sidebar
 * currently is.
 * @param sidebarIsCollapsed - Whether the navigation sidebar is closed
 * @param t - Translation function from the calling component
 * @returns The action label for the sidebar toggle
 */
export function conciergeSidebarEdgeLabel(
	sidebarIsCollapsed: boolean,
	t: TFunction,
): string {
	return sidebarIsCollapsed
		? t('workbench:concierge.panel.expand-sidebar', 'Show the sidebar')
		: t('workbench:concierge.panel.collapse-sidebar', 'Hide the sidebar');
}
